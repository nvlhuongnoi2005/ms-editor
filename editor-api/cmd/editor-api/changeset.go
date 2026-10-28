package main

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

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
	if len(parts) == 2 && parts[1] == "rollback" && r.Method == http.MethodPost {
		return a.rollbackChangeset(ctx, w, r, id)
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
	if err := checkEntityVersions(ctx, tx, datasetID, changes, false); err != nil {
		return err
	}
	if err := validateChangesetTopology(ctx, tx, datasetID, changes); err != nil {
		return err
	}
	revision, diff, err := commitChanges(ctx, tx, datasetID, changesetID, changes, commitOptions{})
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"changeset": changesetInfo{ID: strconv.FormatInt(changesetID, 10), Status: "committed", CommittedRevision: &revision}, "diffResult": diff})
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
			if mapped, ok := idMap[item.Type+":"+strconv.FormatInt(item.Ref, 10)]; ok {
				item.Ref = mapped
			}
			if (item.Type != "node" && item.Type != "way" && item.Type != "relation") || item.Ref < 1 {
				return change, fail(400, "Relation member is invalid.")
			}
			item.Sequence = i
		}
	}
	return change, nil
}
