package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
)

type exportEntity struct {
	Type     string
	ID       int64
	Version  int64
	Visible  bool
	Tags     map[string]string
	LonE7    *int64
	LatE7    *int64
	NodeRefs []int64
	Members  []member
}

type exportPayload struct {
	Type     string            `json:"type"`
	Version  int64             `json:"version"`
	Visible  bool              `json:"visible"`
	Tags     map[string]string `json:"tags"`
	Lon      *float64          `json:"lon"`
	Lat      *float64          `json:"lat"`
	NodeRefs []int64           `json:"nodeRefs"`
	Members  []member          `json:"members"`
}

// changesetEntityStream reads the entities in one OSC operation group.  The
// callback is deliberately synchronous: callers can serialize each row before
// the next one is read instead of accumulating an entire changeset in memory.
type changesetEntityStream func(context.Context, int64, string, func(exportEntity) error) error

func (a *app) exportOSM(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	datasetID, datasetName, err := a.exportDataset(ctx, r)
	if err != nil {
		return err
	}
	bbox, valid := parseBbox(r.URL.Query().Get("bbox"))
	if !valid {
		return fail(400, "Bbox must be west,south,east,north and no larger than 0.3 degrees.")
	}
	entities, err := a.loadViewportExport(ctx, datasetID, bbox, boundedInt(r.URL.Query().Get("limit"), 5000, 1, 10000))
	if err != nil {
		return err
	}

	writeExportHeaders(w, datasetName+".osm")
	encoder := xml.NewEncoder(w)
	encoder.Indent("", "  ")
	if err := writeXMLDeclaration(encoder); err != nil {
		return err
	}
	root := xml.StartElement{Name: xml.Name{Local: "osm"}, Attr: []xml.Attr{
		{Name: xml.Name{Local: "version"}, Value: "0.6"},
		{Name: xml.Name{Local: "generator"}, Value: "Vietnam OSM Editor"},
	}}
	if err := encoder.EncodeToken(root); err != nil {
		return err
	}
	for _, entity := range entities {
		if err := encodeExportEntity(encoder, entity); err != nil {
			return err
		}
	}
	if err := encoder.EncodeToken(root.End()); err != nil {
		return err
	}
	return encoder.Flush()
}

func (a *app) loadViewportExport(ctx context.Context, datasetID string, bbox [4]float64, limit int) ([]exportEntity, error) {
	wayRows, err := a.db.Query(ctx, `SELECT entity_type, entity_id, version, visible, tags, node_lon_e7, node_lat_e7, node_refs, members
		FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible
		AND bbox && ST_MakeEnvelope($2,$3,$4,$5,4326)
		ORDER BY bbox <-> ST_SetSRID(ST_MakePoint(($2+$4)/2,($3+$5)/2),4326)
		LIMIT $6`, datasetID, bbox[0], bbox[1], bbox[2], bbox[3], limit)
	if err != nil {
		return nil, err
	}
	defer wayRows.Close()
	ways := make([]exportEntity, 0)
	nodeIDs := make([]int64, 0)
	for wayRows.Next() {
		way, err := scanExportEntity(wayRows)
		if err != nil {
			return nil, err
		}
		ways = append(ways, way)
		nodeIDs = append(nodeIDs, way.NodeRefs...)
	}
	if err := wayRows.Err(); err != nil {
		return nil, err
	}

	nodes, err := a.loadExportNodes(ctx, datasetID, uniqueIDs(nodeIDs))
	if err != nil {
		return nil, err
	}
	standaloneRows, err := a.db.Query(ctx, `SELECT entity_type, entity_id, version, visible, tags, node_lon_e7, node_lat_e7, node_refs, members
		FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='node'::editor.entity_type AND visible AND tags<>'{}'::jsonb
		AND bbox && ST_MakeEnvelope($2,$3,$4,$5,4326)
		ORDER BY bbox <-> ST_SetSRID(ST_MakePoint(($2+$4)/2,($3+$5)/2),4326)
		LIMIT $6`, datasetID, bbox[0], bbox[1], bbox[2], bbox[3], limit)
	if err != nil {
		return nil, err
	}
	defer standaloneRows.Close()
	nodeByID := make(map[int64]exportEntity, len(nodes)+limit)
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	for standaloneRows.Next() {
		node, err := scanExportEntity(standaloneRows)
		if err != nil {
			return nil, err
		}
		nodeByID[node.ID] = node
	}
	if err := standaloneRows.Err(); err != nil {
		return nil, err
	}
	nodes = nodes[:0]
	for _, node := range nodeByID {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	sort.Slice(ways, func(i, j int) bool { return ways[i].ID < ways[j].ID })
	return append(nodes, ways...), nil
}

func (a *app) loadExportNodes(ctx context.Context, datasetID string, nodeIDs []int64) ([]exportEntity, error) {
	if len(nodeIDs) == 0 {
		return []exportEntity{}, nil
	}
	rows, err := a.db.Query(ctx, `SELECT entity_type, entity_id, version, visible, tags, node_lon_e7, node_lat_e7, node_refs, members
		FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='node'::editor.entity_type AND visible AND entity_id=ANY($2::bigint[])
		ORDER BY entity_id`, datasetID, nodeIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := make([]exportEntity, 0, len(nodeIDs))
	for rows.Next() {
		node, err := scanExportEntity(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (a *app) exportLatestOSC(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	datasetID, datasetName, err := a.exportDataset(ctx, r)
	if err != nil {
		return err
	}
	var changesetID int64
	err = a.db.QueryRow(ctx, `SELECT changeset.id
		FROM editor.changeset changeset
		WHERE changeset.dataset_id=$1 AND changeset.status IN ('committed', 'closed')
		ORDER BY changeset.committed_revision DESC NULLS LAST, changeset.id DESC
		LIMIT 1`, datasetID).Scan(&changesetID)
	if err != nil {
		if isNoRows(err) {
			return fail(404, "Dataset does not have a committed changeset to export.")
		}
		return err
	}
	writeExportHeaders(w, fmt.Sprintf("%s-changeset-%d.osc", datasetName, changesetID))
	return a.writeChangesetOSC(ctx, changesetID, w)
}

// writeChangesetOSC serializes exactly one committed changeset.  The render
// worker uses the same writer as the download endpoint so the Render DB sees
// the identical, ordered OSM change document that an operator can inspect.
func (a *app) writeChangesetOSC(ctx context.Context, changesetID int64, output io.Writer) error {
	return writeChangesetOSC(ctx, changesetID, output, a.streamChangesetExport)
}

func writeChangesetOSC(ctx context.Context, changesetID int64, output io.Writer, stream changesetEntityStream) error {
	encoder := xml.NewEncoder(output)
	encoder.Indent("", "  ")
	if err := writeXMLDeclaration(encoder); err != nil {
		return err
	}
	root := xml.StartElement{Name: xml.Name{Local: "osmChange"}, Attr: []xml.Attr{
		{Name: xml.Name{Local: "version"}, Value: "0.6"},
		{Name: xml.Name{Local: "generator"}, Value: "Vietnam OSM Editor"},
	}}
	if err := encoder.EncodeToken(root); err != nil {
		return err
	}
	for _, operation := range []string{"create", "modify", "delete"} {
		group := xml.StartElement{Name: xml.Name{Local: operation}}
		if err := encoder.EncodeToken(group); err != nil {
			return err
		}
		if err := stream(ctx, changesetID, operation, func(entity exportEntity) error {
			return encodeExportEntity(encoder, entity)
		}); err != nil {
			return err
		}
		if err := encoder.EncodeToken(group.End()); err != nil {
			return err
		}
	}
	if err := encoder.EncodeToken(root.End()); err != nil {
		return err
	}
	return encoder.Flush()
}

func (a *app) exportDataset(ctx context.Context, r *http.Request) (string, string, error) {
	datasetName := r.URL.Query().Get("dataset")
	if !validDataset(datasetName) {
		return "", "", fail(400, "A valid dataset name is required.")
	}
	var datasetID string
	err := a.db.QueryRow(ctx, `SELECT id FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1`, datasetName).Scan(&datasetID)
	if err != nil {
		if isNoRows(err) {
			return "", "", fail(404, "Dataset was not found or is not ready.")
		}
		return "", "", err
	}
	return datasetID, datasetName, nil
}

func (a *app) streamChangesetExport(ctx context.Context, changesetID int64, operation string, visit func(exportEntity) error) error {
	rows, err := a.db.Query(ctx, `SELECT entity_type, entity_id, before_payload, after_payload
		FROM editor.entity_change
		WHERE changeset_id=$1 AND operation=$2
		ORDER BY CASE
			WHEN $2='delete' AND entity_type='relation'::editor.entity_type THEN 1
			WHEN $2='delete' AND entity_type='way'::editor.entity_type THEN 2
			WHEN $2='delete' AND entity_type='node'::editor.entity_type THEN 3
			WHEN $2<>'delete' AND entity_type='node'::editor.entity_type THEN 1
			WHEN $2<>'delete' AND entity_type='way'::editor.entity_type THEN 2
			WHEN $2<>'delete' AND entity_type='relation'::editor.entity_type THEN 3
		END, sequence`, changesetID, operation)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var entityType string
		var entityID int64
		var before, after []byte
		if err := rows.Scan(&entityType, &entityID, &before, &after); err != nil {
			return err
		}
		payload := after
		if operation == "delete" {
			payload = before
		}
		entity, err := parseExportPayload(payload, entityType, entityID)
		if err != nil {
			return err
		}
		if err := visit(entity); err != nil {
			return err
		}
	}
	return rows.Err()
}

func scanExportEntity(rows interface{ Scan(...any) error }) (exportEntity, error) {
	var entity exportEntity
	var tagsJSON, membersJSON []byte
	if err := rows.Scan(&entity.Type, &entity.ID, &entity.Version, &entity.Visible, &tagsJSON, &entity.LonE7, &entity.LatE7, &entity.NodeRefs, &membersJSON); err != nil {
		return exportEntity{}, err
	}
	entity.Tags = tagsFromJSON(tagsJSON)
	if len(membersJSON) > 0 && json.Unmarshal(membersJSON, &entity.Members) != nil {
		return exportEntity{}, fail(500, "Stored relation members are invalid.")
	}
	return entity, nil
}

func parseExportPayload(raw []byte, entityType string, entityID int64) (exportEntity, error) {
	var payload exportPayload
	if len(raw) == 0 || json.Unmarshal(raw, &payload) != nil {
		return exportEntity{}, fail(500, "Stored changeset payload is invalid.")
	}
	if payload.Type != entityType {
		return exportEntity{}, fail(500, "Stored changeset entity type is invalid.")
	}
	entity := exportEntity{Type: entityType, ID: entityID, Version: payload.Version, Visible: payload.Visible, Tags: payload.Tags, NodeRefs: payload.NodeRefs, Members: payload.Members}
	if entity.Tags == nil {
		entity.Tags = map[string]string{}
	}
	if payload.Lon != nil {
		lon := int64(math.Round(*payload.Lon * 1e7))
		entity.LonE7 = &lon
	}
	if payload.Lat != nil {
		lat := int64(math.Round(*payload.Lat * 1e7))
		entity.LatE7 = &lat
	}
	return entity, nil
}

func encodeExportEntity(encoder *xml.Encoder, entity exportEntity) error {
	attributes := []xml.Attr{
		{Name: xml.Name{Local: "id"}, Value: strconv.FormatInt(entity.ID, 10)},
		{Name: xml.Name{Local: "version"}, Value: strconv.FormatInt(entity.Version, 10)},
	}
	if !entity.Visible {
		attributes = append(attributes, xml.Attr{Name: xml.Name{Local: "visible"}, Value: "false"})
	}
	if entity.Type == "node" {
		if entity.LonE7 == nil || entity.LatE7 == nil {
			return fail(500, "Node %d has no coordinates.", entity.ID)
		}
		attributes = append(attributes,
			xml.Attr{Name: xml.Name{Local: "lat"}, Value: coordinateString(*entity.LatE7)},
			xml.Attr{Name: xml.Name{Local: "lon"}, Value: coordinateString(*entity.LonE7)},
		)
	}
	start := xml.StartElement{Name: xml.Name{Local: entity.Type}, Attr: attributes}
	if err := encoder.EncodeToken(start); err != nil {
		return err
	}
	if entity.Type == "way" {
		for _, ref := range entity.NodeRefs {
			if err := encoder.EncodeToken(xml.StartElement{Name: xml.Name{Local: "nd"}, Attr: []xml.Attr{{Name: xml.Name{Local: "ref"}, Value: strconv.FormatInt(ref, 10)}}}); err != nil {
				return err
			}
			if err := encoder.EncodeToken(xml.EndElement{Name: xml.Name{Local: "nd"}}); err != nil {
				return err
			}
		}
	}
	if entity.Type == "relation" {
		sort.SliceStable(entity.Members, func(i, j int) bool { return entity.Members[i].Sequence < entity.Members[j].Sequence })
		for _, item := range entity.Members {
			memberStart := xml.StartElement{Name: xml.Name{Local: "member"}, Attr: []xml.Attr{
				{Name: xml.Name{Local: "type"}, Value: item.Type},
				{Name: xml.Name{Local: "ref"}, Value: strconv.FormatInt(item.Ref, 10)},
				{Name: xml.Name{Local: "role"}, Value: item.Role},
			}}
			if err := encoder.EncodeToken(memberStart); err != nil {
				return err
			}
			if err := encoder.EncodeToken(memberStart.End()); err != nil {
				return err
			}
		}
	}
	keys := make([]string, 0, len(entity.Tags))
	for key := range entity.Tags {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		tag := xml.StartElement{Name: xml.Name{Local: "tag"}, Attr: []xml.Attr{
			{Name: xml.Name{Local: "k"}, Value: key},
			{Name: xml.Name{Local: "v"}, Value: entity.Tags[key]},
		}}
		if err := encoder.EncodeToken(tag); err != nil {
			return err
		}
		if err := encoder.EncodeToken(tag.End()); err != nil {
			return err
		}
	}
	return encoder.EncodeToken(start.End())
}

func coordinateString(value int64) string {
	return strconv.FormatFloat(float64(value)/1e7, 'f', 7, 64)
}

func writeXMLDeclaration(encoder *xml.Encoder) error {
	return encoder.EncodeToken(xml.ProcInst{Target: "xml", Inst: []byte(`version="1.0" encoding="UTF-8"`)})
}

func writeExportHeaders(w http.ResponseWriter, filename string) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Cache-Control", "no-store")
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
