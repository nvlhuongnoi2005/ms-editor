package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxJSONBody = 2_000_000

type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }
func fail(status int, format string, args ...any) error {
	return &apiError{status, fmt.Sprintf(format, args...)}
}

type app struct {
	db         *pgxpool.Pool
	staticRoot string
}
type changesetInfo struct {
	ID                string `json:"id"`
	Dataset           string `json:"dataset,omitempty"`
	Status            string `json:"status"`
	BaseRevision      *int64 `json:"baseRevision,omitempty"`
	CommittedRevision *int64 `json:"committedRevision,omitempty"`
	CreatedAt         any    `json:"createdAt,omitempty"`
	ClosedAt          any    `json:"closedAt,omitempty"`
}
type member struct {
	Type     string `json:"type"`
	Ref      int64  `json:"ref"`
	Role     string `json:"role"`
	Sequence int    `json:"sequence"`
}
type normalizedChange struct {
	Operation, Type       string
	ID, SourceID          int64
	Version, LonE7, LatE7 *int64
	Tags                  map[string]string
	NodeRefs              []int64
	Members               []member
}
type entityRow struct {
	Type         string
	ID, Version  int64
	Visible      bool
	Tags         json.RawMessage
	LonE7, LatE7 *int64
	NodeRefs     []int64
	Members      json.RawMessage
}

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL())
	if err != nil {
		log.Fatalf("open Canonical DB pool: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("ping Canonical DB: %v", err)
	}
	if os.Getenv("EDITOR_ENSURE_INDEXES") == "1" {
		if err := ensureSpatialIndexes(ctx, pool); err != nil {
			log.Fatalf("ensure spatial indexes: %v", err)
		}
	}
	if err := serveEditorAPI(&app{pool, staticRoot()}); err != nil {
		log.Fatal(err)
	}
}

func serveEditorAPI(handler http.Handler) error {
	if address := os.Getenv("EDITOR_API_ADDR"); address != "" {
		server := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
		log.Printf("Map Service Editor (Go): http://%s", server.Addr)
		return server.ListenAndServe()
	}

	// Browsers on Windows may resolve localhost to ::1 before 127.0.0.1.
	// Serve both loopback families so localhost and 127.0.0.1 reach the same API.
	ipv4, err := net.Listen("tcp4", "127.0.0.1:4173")
	if err != nil {
		return fmt.Errorf("listen on IPv4 loopback: %w", err)
	}
	ipv6, err := net.Listen("tcp6", "[::1]:4173")
	if err != nil {
		_ = ipv4.Close()
		return fmt.Errorf("listen on IPv6 loopback: %w", err)
	}

	log.Printf("Map Service Editor (Go): http://localhost:4173")
	errorsCh := make(chan error, 2)
	serve := func(listener net.Listener) {
		server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
		errorsCh <- server.Serve(listener)
	}
	go serve(ipv4)
	go serve(ipv6)
	return <-errorsCh
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var err error
	switch {
	case r.URL.Path == "/healthz" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "editor-api", "runtime": "go"})
		return
	case r.URL.Path == "/api/graph" && r.Method == http.MethodGet:
		err = a.serveGraph(r.Context(), w, r)
	case strings.HasPrefix(r.URL.Path, "/api/0.6/"):
		err = a.serveChangeset(r.Context(), w, r)
	default:
		a.serveStatic(w, r)
		return
	}
	if err == nil {
		return
	}
	var apiErr *apiError
	if errors.As(err, &apiErr) {
		writeJSON(w, apiErr.status, map[string]string{"error": apiErr.message})
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	writeJSON(w, 500, map[string]string{"error": "Internal server error."})
}

func (a *app) serveChangeset(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	if r.URL.Path == "/api/0.6/changeset/create" && r.Method == http.MethodPut {
		return a.createChangeset(ctx, w, r)
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/0.6/changeset/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return fail(404, "API route was not found.")
	}
	id, err := parseID(parts[0], "Changeset id")
	if err != nil {
		return err
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		return a.getChangeset(ctx, w, id)
	}
	if len(parts) == 2 && parts[1] == "upload" && r.Method == http.MethodPost {
		return a.uploadChangeset(ctx, w, r, id)
	}
	if len(parts) == 2 && parts[1] == "close" && r.Method == http.MethodPut {
		return a.closeChangeset(ctx, w, id)
	}
	return fail(405, "Method is not allowed for this API route.")
}

func (a *app) createChangeset(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Dataset string `json:"dataset"`
		Comment string `json:"comment"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if !validDataset(body.Dataset) {
		return fail(400, "A dataset name is required.")
	}
	var datasetID string
	var revision int64
	err := a.db.QueryRow(ctx, "SELECT id, canonical_revision FROM editor.dataset WHERE name = $1 AND state = 'ready' ORDER BY created_at DESC LIMIT 1", body.Dataset).Scan(&datasetID, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "The requested canonical dataset is not ready.")
	}
	if err != nil {
		return err
	}
	if len(body.Comment) > 255 {
		body.Comment = body.Comment[:255]
	}
	var id int64
	var created time.Time
	err = a.db.QueryRow(ctx, "INSERT INTO editor.changeset (dataset_id, status, comment, author_id, base_revision) VALUES ($1, 'open', $2, 'local-admin', $3) RETURNING id, created_at", datasetID, nullableString(body.Comment), revision).Scan(&id, &created)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"changeset": changesetInfo{ID: strconv.FormatInt(id, 10), Dataset: body.Dataset, Status: "open", BaseRevision: &revision, CreatedAt: created}})
	return nil
}

func (a *app) getChangeset(ctx context.Context, w http.ResponseWriter, id int64) error {
	var status string
	var base int64
	var committed *int64
	var created time.Time
	var closed *time.Time
	err := a.db.QueryRow(ctx, "SELECT status, base_revision, committed_revision, created_at, closed_at FROM editor.changeset WHERE id = $1", id).Scan(&status, &base, &committed, &created, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(404, "Changeset was not found.")
	}
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"changeset": changesetInfo{ID: strconv.FormatInt(id, 10), Status: status, BaseRevision: &base, CommittedRevision: committed, CreatedAt: created, ClosedAt: closed}})
	return nil
}

func (a *app) closeChangeset(ctx context.Context, w http.ResponseWriter, id int64) error {
	var status string
	var committed *int64
	var closed time.Time
	err := a.db.QueryRow(ctx, "UPDATE editor.changeset SET status = 'closed', closed_at = now() WHERE id = $1 AND status IN ('open','committed') RETURNING status, committed_revision, closed_at", id).Scan(&status, &committed, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "Changeset cannot be closed.")
	}
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"changeset": changesetInfo{ID: strconv.FormatInt(id, 10), Status: status, CommittedRevision: committed, ClosedAt: closed}})
	return nil
}

func (a *app) uploadChangeset(ctx context.Context, w http.ResponseWriter, r *http.Request, changesetID int64) error {
	var body struct {
		Changes []json.RawMessage `json:"changes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if len(body.Changes) == 0 || len(body.Changes) > 500 {
		return fail(400, "changes must contain between 1 and 500 items.")
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var datasetID, status string
	err = tx.QueryRow(ctx, "SELECT changeset.dataset_id, changeset.status FROM editor.changeset changeset JOIN editor.dataset dataset ON dataset.id = changeset.dataset_id WHERE changeset.id = $1 FOR UPDATE", changesetID).Scan(&datasetID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(404, "Changeset was not found.")
	}
	if err != nil {
		return err
	}
	if status != "open" {
		return fail(409, "Changeset is not open for upload.")
	}
	idMap, nextIDs := map[string]int64{}, map[string]int64{}
	for _, raw := range body.Changes {
		op, entity, err := rawOperationEntity(raw)
		if err != nil {
			return err
		}
		if op != "create" {
			continue
		}
		typeName, sourceID, err := rawTypeID(entity)
		if err != nil {
			return err
		}
		key := typeName + ":" + strconv.FormatInt(sourceID, 10)
		if _, ok := idMap[key]; ok {
			return fail(400, "A created entity id appears more than once.")
		}
		if _, ok := nextIDs[typeName]; !ok {
			next, err := allocateID(ctx, tx, datasetID, typeName)
			if err != nil {
				return err
			}
			nextIDs[typeName] = next
		}
		idMap[key] = nextIDs[typeName]
		nextIDs[typeName]++
	}
	changes := make([]normalizedChange, 0, len(body.Changes))
	for _, raw := range body.Changes {
		change, err := normalizeChange(raw, idMap)
		if err != nil {
			return err
		}
		changes = append(changes, change)
	}
	changedWays, changedNodes := []int64{}, []int64{}
	audit, diff := make([]map[string]any, 0, len(changes)), make([]map[string]any, 0, len(changes))
	for _, change := range changes {
		existing, found, err := fetchEntity(ctx, tx, datasetID, change.Type, change.ID, true)
		if err != nil {
			return err
		}
		if change.Operation == "create" && found {
			return fail(409, "Entity id already exists.")
		}
		if change.Operation != "create" && !found {
			return fail(404, "Entity was not found.")
		}
		if found && (existing.Version != deref(change.Version) || !existing.Visible) {
			return fail(409, "Entity version conflict. Reload the entity before saving.")
		}
		if change.Type == "way" && change.Operation != "delete" {
			if err := assertWayNodes(ctx, tx, datasetID, change.NodeRefs); err != nil {
				return err
			}
		}
		if change.Type == "relation" && change.Operation != "delete" {
			if err := assertRelationMembers(ctx, tx, datasetID, change.Members); err != nil {
				return err
			}
		}
		effective := change
		if change.Operation == "delete" {
			effective = deletionChange(change, existing)
		}
		after, err := writeEntity(ctx, tx, datasetID, changesetID, effective, existing, found)
		if err != nil {
			return err
		}
		if needsBboxRebuild(change, existing, found) {
			if change.Type == "way" {
				changedWays = append(changedWays, change.ID)
			}
			if change.Type == "node" {
				changedNodes = append(changedNodes, change.ID)
			}
		}
		var before any
		if found {
			before = entityPayload(existing)
		}
		audit = append(audit, map[string]any{"operation": change.Operation, "before": before, "after": entityPayload(after)})
		diff = append(diff, map[string]any{"type": change.Type, "oldId": strconv.FormatInt(change.SourceID, 10), "newId": strconv.FormatInt(change.ID, 10), "newVersion": after.Version})
	}
	if len(changedWays) > 0 || len(changedNodes) > 0 {
		if _, err := tx.Exec(ctx, rebuildBboxSQL, datasetID, changedWays, changedNodes); err != nil {
			return err
		}
	}
	var revision int64
	if err := tx.QueryRow(ctx, "UPDATE editor.dataset SET canonical_revision = canonical_revision + 1 WHERE id = $1 RETURNING canonical_revision", datasetID).Scan(&revision); err != nil {
		return err
	}
	for sequence, item := range audit {
		before, _ := json.Marshal(item["before"])
		after, _ := json.Marshal(item["after"])
		payload := item["after"].(map[string]any)
		if _, err := tx.Exec(ctx, "INSERT INTO editor.entity_change (changeset_id, sequence, entity_type, entity_id, operation, before_payload, after_payload) VALUES ($1, $2, $3::editor.entity_type, $4, $5, $6, $7)", changesetID, sequence, payload["type"], payload["id"], item["operation"], before, after); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE editor.changeset SET status = 'committed', committed_revision = $2 WHERE id = $1", changesetID, revision); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO editor.dataset_revision (dataset_id, revision, changeset_id) VALUES ($1,$2,$3)", datasetID, revision, changesetID); err != nil {
		return err
	}
	diffJSON, _ := json.Marshal(diff)
	if _, err := tx.Exec(ctx, "INSERT INTO editor.outbox_event (dataset_id, revision, type, payload) VALUES ($1,$2,'canonical.changeset.committed',$3)", datasetID, revision, diffJSON); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"changeset": changesetInfo{ID: strconv.FormatInt(changesetID, 10), Status: "committed", CommittedRevision: &revision}, "diffResult": diff})
	return nil
}

func (a *app) serveGraph(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		dataset = "vietnam-260901"
	}
	bbox, ok := parseBbox(r.URL.Query().Get("bbox"))
	if !ok || !validDataset(dataset) {
		return fail(400, "A valid, compact bbox and dataset are required.")
	}
	limit := boundedInt(r.URL.Query().Get("limit"), 260, 1, 1200)
	var datasetID string
	var revision int64
	err := a.db.QueryRow(ctx, "SELECT id, canonical_revision FROM editor.dataset WHERE name = $1 AND state = 'ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&datasetID, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "The requested canonical dataset is not ready.")
	}
	if err != nil {
		return err
	}
	ways, err := graphWays(ctx, a.db, datasetID, bbox, limit)
	if err != nil {
		return err
	}
	points, err := graphPoints(ctx, a.db, datasetID, bbox, min(limit, 300))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"type": "FeatureCollection", "dataset": dataset, "canonicalRevision": revision, "features": append(ways, points...), "relations": []any{}})
	return nil
}

func rawOperationEntity(raw json.RawMessage) (string, map[string]json.RawMessage, error) {
	var outer map[string]json.RawMessage
	if json.Unmarshal(raw, &outer) != nil {
		return "", nil, fail(400, "Each change must be an object.")
	}
	var op string
	if json.Unmarshal(outer["operation"], &op) != nil || (op != "create" && op != "modify" && op != "delete") {
		return "", nil, fail(400, "Change operation must be create, modify, or delete.")
	}
	entity := outer
	if nested, ok := outer["entity"]; ok {
		if json.Unmarshal(nested, &entity) != nil {
			return "", nil, fail(400, "Entity must be an object.")
		}
	}
	return op, entity, nil
}
func rawTypeID(entity map[string]json.RawMessage) (string, int64, error) {
	field := entity["type"]
	if field == nil {
		field = entity["entityType"]
	}
	var typeName string
	if json.Unmarshal(field, &typeName) != nil || (typeName != "node" && typeName != "way" && typeName != "relation") {
		return "", 0, fail(400, "Entity type must be node, way, or relation.")
	}
	field = entity["id"]
	if field == nil {
		field = entity["entityId"]
	}
	id, err := rawInt(field, "Entity id")
	return typeName, id, err
}
func normalizeChange(raw json.RawMessage, idMap map[string]int64) (normalizedChange, error) {
	op, entity, err := rawOperationEntity(raw)
	if err != nil {
		return normalizedChange{}, err
	}
	typeName, sourceID, err := rawTypeID(entity)
	if err != nil {
		return normalizedChange{}, err
	}
	id := sourceID
	if op == "create" {
		id = idMap[typeName+":"+strconv.FormatInt(sourceID, 10)]
	}
	if id == 0 || (op != "create" && id < 1) {
		return normalizedChange{}, fail(400, "Existing entity ids must be positive.")
	}
	change := normalizedChange{Operation: op, Type: typeName, ID: id, SourceID: sourceID}
	if op != "create" {
		v, err := rawInt(entity["version"], "Entity version")
		if err != nil || v < 1 {
			return change, fail(400, "Entity version must be positive.")
		}
		change.Version = &v
	}
	if op != "delete" || entity["tags"] != nil {
		tags, err := rawTags(entity["tags"])
		if err != nil {
			return change, err
		}
		change.Tags = tags
	}
	switch typeName {
	case "node":
		if op == "delete" && entity["lon"] == nil && entity["lat"] == nil {
			return change, nil
		}
		lon, err := rawFloat(entity["lon"], "Node lon")
		if err != nil {
			return change, err
		}
		lat, err := rawFloat(entity["lat"], "Node lat")
		if err != nil {
			return change, err
		}
		if lon < -180 || lon > 180 || lat < -90 || lat > 90 {
			return change, fail(400, "Node lon and lat must be valid WGS84 coordinates.")
		}
		lonE7, latE7 := int64(math.Round(lon*1e7)), int64(math.Round(lat*1e7))
		change.LonE7, change.LatE7 = &lonE7, &latE7
	case "way":
		refs := entity["nodeRefs"]
		if refs == nil {
			refs = entity["nodes"]
		}
		if op == "delete" && refs == nil {
			return change, nil
		}
		var rawRefs []json.RawMessage
		if json.Unmarshal(refs, &rawRefs) != nil || len(rawRefs) < 2 {
			return change, fail(400, "Way nodeRefs must contain at least two nodes.")
		}
		for _, item := range rawRefs {
			var object map[string]json.RawMessage
			_ = json.Unmarshal(item, &object)
			idRaw := item
			if object != nil {
				idRaw = object["id"]
			}
			ref, err := rawInt(idRaw, "Way node reference")
			if err != nil {
				return change, err
			}
			if mapped, ok := idMap["node:"+strconv.FormatInt(ref, 10)]; ok {
				ref = mapped
			}
			change.NodeRefs = append(change.NodeRefs, ref)
		}
	case "relation":
		membersRaw := entity["members"]
		if op == "delete" && membersRaw == nil {
			return change, nil
		}
		if json.Unmarshal(membersRaw, &change.Members) != nil {
			return change, fail(400, "Relation members must be an array.")
		}
		for i := range change.Members {
			item := &change.Members[i]
			if item.Type != "node" && item.Type != "way" && item.Type != "relation" || item.Ref < 1 {
				return change, fail(400, "Relation member is invalid.")
			}
			if mapped, ok := idMap[item.Type+":"+strconv.FormatInt(item.Ref, 10)]; ok {
				item.Ref = mapped
			}
			item.Sequence = i
		}
	}
	return change, nil
}

func fetchEntity(ctx context.Context, tx pgx.Tx, datasetID, typeName string, id int64, lock bool) (entityRow, bool, error) {
	query := "SELECT entity_type, entity_id, version, visible, tags, node_lon_e7, node_lat_e7, node_refs, members FROM editor.entity_current WHERE dataset_id = $1 AND entity_type = $2::editor.entity_type AND entity_id = $3"
	if lock {
		query += " FOR UPDATE"
	}
	var row entityRow
	err := tx.QueryRow(ctx, query, datasetID, typeName, id).Scan(&row.Type, &row.ID, &row.Version, &row.Visible, &row.Tags, &row.LonE7, &row.LatE7, &row.NodeRefs, &row.Members)
	if errors.Is(err, pgx.ErrNoRows) {
		return entityRow{}, false, nil
	}
	return row, err == nil, err
}
func allocateID(ctx context.Context, tx pgx.Tx, datasetID, typeName string) (int64, error) {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", datasetID+":"+typeName); err != nil {
		return 0, err
	}
	var id int64
	err := tx.QueryRow(ctx, "SELECT COALESCE(MAX(entity_id),0)+1 FROM editor.entity_current WHERE dataset_id=$1 AND entity_type=$2::editor.entity_type", datasetID, typeName).Scan(&id)
	return id, err
}
func assertWayNodes(ctx context.Context, tx pgx.Tx, datasetID string, refs []int64) error {
	var count int
	if err := tx.QueryRow(ctx, "SELECT count(DISTINCT entity_id) FROM editor.entity_current WHERE dataset_id=$1 AND entity_type='node'::editor.entity_type AND visible AND entity_id=ANY($2::bigint[])", datasetID, refs).Scan(&count); err != nil {
		return err
	}
	if count != len(uniqueIDs(refs)) {
		return fail(409, "A way references a missing or deleted node.")
	}
	return nil
}
func assertRelationMembers(ctx context.Context, tx pgx.Tx, datasetID string, members []member) error {
	for _, item := range members {
		var found bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM editor.entity_current WHERE dataset_id=$1 AND entity_type=$2::editor.entity_type AND entity_id=$3 AND visible)", datasetID, item.Type, item.Ref).Scan(&found); err != nil {
			return err
		}
		if !found {
			return fail(409, "A relation references a missing or deleted entity.")
		}
	}
	return nil
}
func deletionChange(change normalizedChange, existing entityRow) normalizedChange {
	change.Tags = tagsFromJSON(existing.Tags)
	if change.Type == "node" {
		change.LonE7, change.LatE7 = existing.LonE7, existing.LatE7
	}
	if change.Type == "way" {
		change.NodeRefs = existing.NodeRefs
	}
	if change.Type == "relation" {
		_ = json.Unmarshal(existing.Members, &change.Members)
	}
	return change
}
func writeEntity(ctx context.Context, tx pgx.Tx, datasetID string, changesetID int64, change normalizedChange, existing entityRow, found bool) (entityRow, error) {
	tags, _ := json.Marshal(change.Tags)
	var members any
	if change.Type == "relation" {
		members, _ = json.Marshal(change.Members)
	}
	var bbox any
	if change.Type == "node" {
		bbox = bboxForNode(deref(change.LonE7), deref(change.LatE7))
	}
	var next entityRow
	err := tx.QueryRow(ctx, `INSERT INTO editor.entity_current (dataset_id,entity_type,entity_id,version,visible,tags,node_lon_e7,node_lat_e7,node_refs,members,bbox,changeset_id,updated_at) VALUES ($1,$2::editor.entity_type,$3,$4,$5,$6,$7,$8,$9,$10,ST_GeomFromText($11,4326),$12,now()) ON CONFLICT (dataset_id,entity_type,entity_id) DO UPDATE SET version=EXCLUDED.version,visible=EXCLUDED.visible,tags=EXCLUDED.tags,node_lon_e7=EXCLUDED.node_lon_e7,node_lat_e7=EXCLUDED.node_lat_e7,node_refs=EXCLUDED.node_refs,members=EXCLUDED.members,bbox=COALESCE(EXCLUDED.bbox,entity_current.bbox),changeset_id=EXCLUDED.changeset_id,updated_at=now() RETURNING entity_type,entity_id,version,visible,tags,node_lon_e7,node_lat_e7,node_refs,members`, datasetID, change.Type, change.ID, nextVersion(existing, found), change.Operation != "delete", tags, change.LonE7, change.LatE7, change.NodeRefs, members, bbox, changesetID).Scan(&next.Type, &next.ID, &next.Version, &next.Visible, &next.Tags, &next.LonE7, &next.LatE7, &next.NodeRefs, &next.Members)
	if err == nil {
		return next, nil
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) {
		return entityRow{}, fail(422, "Canonical schema rejected this %s: %s", change.Type, pgError.Message)
	}
	return entityRow{}, err
}
func needsBboxRebuild(change normalizedChange, existing entityRow, found bool) bool {
	if change.Type == "way" {
		return change.Operation == "create" || (change.Operation == "modify" && !sameRefs(existing.NodeRefs, change.NodeRefs))
	}
	if change.Type == "node" {
		return change.Operation == "delete" || (change.Operation == "modify" && (!found || deref(existing.LonE7) != deref(change.LonE7) || deref(existing.LatE7) != deref(change.LatE7)))
	}
	return false
}

const rebuildBboxSQL = `WITH affected AS (SELECT entity_id FROM editor.entity_current WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible AND (entity_id=ANY($2::bigint[]) OR node_refs && $3::bigint[])), envelopes AS (SELECT way.entity_id,ST_Envelope(ST_Collect(ST_SetSRID(ST_MakePoint(node.node_lon_e7::double precision/10000000,node.node_lat_e7::double precision/10000000),4326))) AS bbox FROM affected JOIN editor.entity_current way ON way.dataset_id=$1 AND way.entity_type='way'::editor.entity_type AND way.visible AND way.entity_id=affected.entity_id JOIN LATERAL unnest(way.node_refs) AS reference(node_id) ON TRUE JOIN editor.entity_current node ON node.dataset_id=way.dataset_id AND node.entity_type='node'::editor.entity_type AND node.entity_id=reference.node_id AND node.visible GROUP BY way.entity_id) UPDATE editor.entity_current way SET bbox=envelopes.bbox,updated_at=now() FROM envelopes WHERE way.dataset_id=$1 AND way.entity_type='way'::editor.entity_type AND way.entity_id=envelopes.entity_id`

func graphWays(ctx context.Context, db *pgxpool.Pool, datasetID string, bbox [4]float64, limit int) ([]any, error) {
	rows, err := db.Query(ctx, `WITH viewport_ways AS (SELECT entity_id,version,tags,node_refs FROM editor.entity_current WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible AND bbox && ST_MakeEnvelope($2,$3,$4,$5,4326) ORDER BY bbox <-> ST_SetSRID(ST_MakePoint(($2+$4)/2,($3+$5)/2),4326) LIMIT $6) SELECT way.entity_id,way.version,way.tags,jsonb_agg(jsonb_build_object('id',node.entity_id,'version',node.version,'tags',node.tags,'coordinates',jsonb_build_array(node.node_lon_e7::double precision/10000000,node.node_lat_e7::double precision/10000000)) ORDER BY reference.position) FROM viewport_ways way JOIN LATERAL unnest(way.node_refs) WITH ORDINALITY AS reference(node_id,position) ON TRUE JOIN editor.entity_current node ON node.dataset_id=$1 AND node.entity_type='node'::editor.entity_type AND node.entity_id=reference.node_id AND node.visible GROUP BY way.entity_id,way.version,way.tags ORDER BY way.entity_id`, datasetID, bbox[0], bbox[1], bbox[2], bbox[3], limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	features := []any{}
	for rows.Next() {
		var id, version int64
		var tagsJSON, nodesJSON []byte
		if err := rows.Scan(&id, &version, &tagsJSON, &nodesJSON); err != nil {
			return nil, err
		}
		var tags map[string]string
		var nodes []struct {
			ID          int64             `json:"id"`
			Version     int64             `json:"version"`
			Tags        map[string]string `json:"tags"`
			Coordinates []float64         `json:"coordinates"`
		}
		_ = json.Unmarshal(tagsJSON, &tags)
		if json.Unmarshal(nodesJSON, &nodes) != nil || len(nodes) < 2 {
			continue
		}
		coords, refs := make([][]float64, 0, len(nodes)), make([]string, 0, len(nodes))
		nodePayloads := make([]map[string]any, 0, len(nodes))
		for _, node := range nodes {
			coords = append(coords, node.Coordinates)
			nodeID := strconv.FormatInt(node.ID, 10)
			refs = append(refs, nodeID)
			nodePayloads = append(nodePayloads, map[string]any{"id": nodeID, "version": node.Version, "tags": node.Tags, "coordinates": node.Coordinates})
		}
		closed := len(coords) > 3 && coords[0][0] == coords[len(coords)-1][0] && coords[0][1] == coords[len(coords)-1][1]
		area := closed && (tags["area"] == "yes" || tags["building"] != "" || tags["landuse"] != "" || tags["leisure"] != "" || tags["amenity"] != "" || tags["aeroway"] != "" || contains([]string{"water", "wood", "scrub", "wetland", "beach", "sand"}, tags["natural"]))
		geometryType := "LineString"
		var geometryCoords any = coords
		if area {
			geometryType = "Polygon"
			geometryCoords = [][][]float64{coords}
		}
		features = append(features, map[string]any{"type": "Feature", "id": "way-" + strconv.FormatInt(id, 10), "properties": map[string]any{"entityType": "way", "entityId": strconv.FormatInt(id, 10), "version": version, "name": tags["name"], "tags": tags, "nodeIds": refs, "nodes": nodePayloads}, "geometry": map[string]any{"type": geometryType, "coordinates": geometryCoords}})
	}
	return features, rows.Err()
}
func graphPoints(ctx context.Context, db *pgxpool.Pool, datasetID string, bbox [4]float64, limit int) ([]any, error) {
	rows, err := db.Query(ctx, `SELECT entity_id,version,tags,node_lon_e7::double precision/10000000,node_lat_e7::double precision/10000000 FROM editor.entity_current WHERE dataset_id=$1 AND entity_type='node'::editor.entity_type AND visible AND tags<>'{}'::jsonb AND bbox && ST_MakeEnvelope($2,$3,$4,$5,4326) ORDER BY bbox <-> ST_SetSRID(ST_MakePoint(($2+$4)/2,($3+$5)/2),4326) LIMIT $6`, datasetID, bbox[0], bbox[1], bbox[2], bbox[3], limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	features := []any{}
	for rows.Next() {
		var id, version int64
		var tagsJSON []byte
		var lon, lat float64
		if err := rows.Scan(&id, &version, &tagsJSON, &lon, &lat); err != nil {
			return nil, err
		}
		tags := tagsFromJSON(tagsJSON)
		coordinates := []float64{lon, lat}
		features = append(features, map[string]any{"type": "Feature", "id": "node-" + strconv.FormatInt(id, 10), "properties": map[string]any{"entityType": "node", "entityId": strconv.FormatInt(id, 10), "version": version, "name": tags["name"], "tags": tags, "coordinates": coordinates}, "geometry": map[string]any{"type": "Point", "coordinates": coordinates}})
	}
	return features, rows.Err()
}

func (a *app) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	requested := strings.TrimPrefix(r.URL.Path, "/")
	if requested == "" {
		requested = "index.html"
	}
	path := filepath.Join(a.staticRoot, filepath.FromSlash(requested))
	relative, err := filepath.Rel(a.staticRoot, path)
	if err != nil || strings.HasPrefix(relative, "..") {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if filepath.Ext(path) == ".mjs" || filepath.Ext(path) == ".js" {
		contentType = "text/javascript"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, path)
}
func decodeJSON(r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return fail(400, "Request body must be valid JSON.")
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
func parseID(value, label string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fail(400, "%s must be an integer.", label)
	}
	return id, nil
}
func rawInt(raw json.RawMessage, label string) (int64, error) {
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		if value, err := number.Int64(); err == nil {
			return value, nil
		}
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return parseID(text, label)
	}
	return 0, fail(400, "%s must be an integer.", label)
}
func rawFloat(raw json.RawMessage, label string) (float64, error) {
	var value float64
	if json.Unmarshal(raw, &value) != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, fail(400, "%s must be a valid coordinate.", label)
	}
	return value, nil
}
func rawTags(raw json.RawMessage) (map[string]string, error) {
	if raw == nil {
		return map[string]string{}, nil
	}
	var tags map[string]string
	if json.Unmarshal(raw, &tags) != nil || len(tags) > 256 {
		return nil, fail(400, "Entity tags must be an object.")
	}
	for key, value := range tags {
		if key == "" || len(key) > 255 || len(value) > 255 {
			return nil, fail(400, "Tags contain an invalid key or value.")
		}
	}
	return tags, nil
}
func tagsFromJSON(raw []byte) map[string]string {
	tags := map[string]string{}
	_ = json.Unmarshal(raw, &tags)
	return tags
}
func entityPayload(row entityRow) map[string]any {
	payload := map[string]any{"type": row.Type, "id": strconv.FormatInt(row.ID, 10), "version": row.Version, "visible": row.Visible, "tags": tagsFromJSON(row.Tags)}
	if row.Type == "node" {
		payload["lon"] = float64(deref(row.LonE7)) / 1e7
		payload["lat"] = float64(deref(row.LatE7)) / 1e7
	}
	if row.Type == "way" {
		payload["nodeRefs"] = row.NodeRefs
	}
	if row.Type == "relation" {
		var members any
		_ = json.Unmarshal(row.Members, &members)
		payload["members"] = members
	}
	return payload
}
func bboxForNode(lon, lat int64) string {
	x, y, epsilon := float64(lon)/1e7, float64(lat)/1e7, .000000001
	return fmt.Sprintf("POLYGON((%.10f %.10f,%.10f %.10f,%.10f %.10f,%.10f %.10f,%.10f %.10f))", x-epsilon, y-epsilon, x+epsilon, y-epsilon, x+epsilon, y+epsilon, x-epsilon, y+epsilon, x-epsilon, y-epsilon)
}
func deref(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
func nextVersion(row entityRow, found bool) int64 {
	if found {
		return row.Version + 1
	}
	return 1
}
func sameRefs(left, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
func uniqueIDs(values []int64) []int64 {
	set := map[int64]struct{}{}
	for _, value := range values {
		set[value] = struct{}{}
	}
	result := make([]int64, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	return result
}
func parseBbox(value string) ([4]float64, bool) {
	var bbox [4]float64
	parts := strings.Split(value, ",")
	if len(parts) != 4 {
		return bbox, false
	}
	for i := range parts {
		number, err := strconv.ParseFloat(parts[i], 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return bbox, false
		}
		bbox[i] = number
	}
	return bbox, bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 && bbox[0] < bbox[2] && bbox[1] < bbox[3] && bbox[2]-bbox[0] <= .3 && bbox[3]-bbox[1] <= .3
}
func validDataset(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if !(char == '-' || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}
func boundedInt(value string, fallback, low, high int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed == 0 {
		return fallback
	}
	if parsed < low {
		return low
	}
	if parsed > high {
		return high
	}
	return parsed
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	if value := localEnv()[key]; value != "" {
		return value
	}
	return fallback
}
func localEnv() map[string]string {
	values := map[string]string{}
	for _, path := range []string{"../infra/.env", "infra/.env"} {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(content), "\n") {
			pair := strings.SplitN(strings.TrimSpace(line), "=", 2)
			if len(pair) == 2 && pair[0] != "" {
				values[pair[0]] = strings.Trim(pair[1], " '\"")
			}
		}
		break
	}
	return values
}
func databaseURL() string {
	env := localEnv()
	host := getenv("CANONICAL_DB_HOST", "127.0.0.1")
	port := getenv("CANONICAL_DB_PORT", env["POSTGRES_PORT"])
	if port == "" {
		port = "5432"
	}
	user := getenv("CANONICAL_DB_USER", "canonical_owner")
	password := getenv("CANONICAL_DB_PASSWORD", env["CANONICAL_DB_PASSWORD"])
	name := getenv("CANONICAL_DB_NAME", "canonical")
	return (&url.URL{Scheme: "postgres", User: url.UserPassword(user, password), Host: host + ":" + port, Path: name, RawQuery: "sslmode=disable"}).String()
}
func staticRoot() string {
	root := getenv("EDITOR_STATIC_ROOT", "")
	if root == "" {
		root = "dist"
		if _, err := os.Stat(root); err != nil {
			root = filepath.Join("..", "editor-web", "dist")
		}
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		log.Fatal(err)
	}
	return absolute
}
func ensureSpatialIndexes(ctx context.Context, db *pgxpool.Pool) error {
	for _, statement := range []string{"CREATE INDEX IF NOT EXISTS entity_current_bbox_idx ON editor.entity_current USING gist (bbox)", "CREATE INDEX IF NOT EXISTS entity_current_visible_way_bbox_idx ON editor.entity_current USING gist (bbox) WHERE visible AND entity_type = 'way'::editor.entity_type", "CREATE INDEX IF NOT EXISTS entity_current_visible_node_bbox_idx ON editor.entity_current USING gist (bbox) WHERE visible AND entity_type = 'node'::editor.entity_type"} {
		if _, err := db.Exec(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}
