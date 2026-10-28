package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type versionConflict struct {
	Key             string `json:"key"`
	ExpectedVersion int64  `json:"expectedVersion"`
	ServerVersion   int64  `json:"serverVersion"`
	Deleted         bool   `json:"deleted"`
}
type versionConflictError struct{ Conflicts []versionConflict }

func (e *versionConflictError) Error() string {
	return "Entity versions changed. Resolve conflicts before saving."
}

func entityKeyString(kind string, id int64) string { return kind + "/" + strconv.FormatInt(id, 10) }

func readCurrentEntities(ctx context.Context, tx pgx.Tx, datasetID string, types []string, ids []int64) (map[string]entityRow, error) {
	rows, err := tx.Query(ctx, `SELECT entity.entity_type,entity.entity_id,entity.version,entity.visible,entity.tags,
		entity.node_lon_e7,entity.node_lat_e7,entity.node_refs,entity.members
		FROM unnest($2::text[],$3::bigint[]) AS requested(type,id)
		JOIN editor.entity_current entity ON entity.dataset_id=$1 AND entity.entity_type=requested.type::editor.entity_type AND entity.entity_id=requested.id`, datasetID, types, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]entityRow{}
	for rows.Next() {
		var row entityRow
		if err := rows.Scan(&row.Type, &row.ID, &row.Version, &row.Visible, &row.Tags, &row.LonE7, &row.LatE7, &row.NodeRefs, &row.Members); err != nil {
			return nil, err
		}
		result[entityKeyString(row.Type, row.ID)] = row
	}
	return result, rows.Err()
}

// Batch detection happens before topology validation or any entity writes, so
// clients can resolve all stale entities in one pass rather than one per upload.
func checkEntityVersions(ctx context.Context, tx pgx.Tx, datasetID string, changes []normalizedChange, allowInvisible bool) error {
	types, ids := []string{}, []int64{}
	for _, change := range changes {
		if change.Operation != "create" {
			types = append(types, change.Type)
			ids = append(ids, change.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	current, err := readCurrentEntities(ctx, tx, datasetID, types, ids)
	if err != nil {
		return err
	}
	conflicts := []versionConflict{}
	for _, change := range changes {
		if change.Operation == "create" {
			continue
		}
		key := entityKeyString(change.Type, change.ID)
		row, found := current[key]
		if !found || row.Version != deref(change.Version) || (!row.Visible && !allowInvisible) {
			conflicts = append(conflicts, versionConflict{key, deref(change.Version), row.Version, !found || !row.Visible})
		}
	}
	if len(conflicts) > 0 {
		return &versionConflictError{conflicts}
	}
	return nil
}

// A read-only, consistent canonical snapshot by entity ID, independent of bbox
// limits and Render DB lag. Included way nodes let the client rebuild preview.
func (a *app) serveEntitySnapshots(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Dataset string   `json:"dataset"`
		Keys    []string `json:"keys"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if !validDataset(body.Dataset) || len(body.Keys) == 0 || len(body.Keys) > 500 {
		return fail(400, "A dataset and 1–500 entity keys are required.")
	}
	types, ids := []string{}, []int64{}
	seen := map[string]bool{}
	for _, key := range body.Keys {
		parts := strings.Split(key, "/")
		if len(parts) != 2 || (parts[0] != "node" && parts[0] != "way" && parts[0] != "relation") {
			return fail(400, "Invalid entity key.")
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || id <= 0 {
			return fail(400, "Snapshot entity IDs must be positive.")
		}
		if seen[key] {
			return fail(400, "Duplicate entity key.")
		}
		seen[key] = true
		types = append(types, parts[0])
		ids = append(ids, id)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var datasetID string
	if err := tx.QueryRow(ctx, "SELECT id FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1", body.Dataset).Scan(&datasetID); err != nil {
		return err
	}
	current, err := readCurrentEntities(ctx, tx, datasetID, types, ids)
	if err != nil {
		return err
	}
	nodeIDs := []int64{}
	for _, row := range current {
		if row.Type == "way" && row.Visible {
			nodeIDs = append(nodeIDs, row.NodeRefs...)
		}
	}
	nodeIDs = uniqueIDs(nodeIDs)
	nodeTypes := make([]string, len(nodeIDs))
	for i := range nodeTypes {
		nodeTypes[i] = "node"
	}
	nodes := map[string]entityRow{}
	if len(nodeIDs) > 0 {
		nodes, err = readCurrentEntities(ctx, tx, datasetID, nodeTypes, nodeIDs)
		if err != nil {
			return err
		}
	}
	snapshots := []any{}
	for i, key := range body.Keys {
		row, found := current[entityKeyString(types[i], ids[i])]
		var feature any
		if found && row.Visible {
			feature, err = snapshotFeature(ctx, tx, datasetID, row, nodes)
			if err != nil {
				return err
			}
		}
		snapshots = append(snapshots, map[string]any{"key": key, "version": row.Version, "visible": found && row.Visible, "feature": feature})
	}
	support := []any{}
	for _, node := range nodes {
		if node.Visible {
			feature, err := snapshotFeature(ctx, tx, datasetID, node, nil)
			if err != nil {
				return err
			}
			support = append(support, feature)
		}
	}
	writeJSON(w, 200, map[string]any{"snapshots": snapshots, "support": support})
	return nil
}

func snapshotFeature(ctx context.Context, tx pgx.Tx, datasetID string, row entityRow, nodes map[string]entityRow) (any, error) {
	tags := tagsFromJSON(row.Tags)
	properties := map[string]any{"entityType": row.Type, "entityId": strconv.FormatInt(row.ID, 10), "version": row.Version, "tags": tags, "name": tags["name"]}
	geometry := map[string]any{}
	switch row.Type {
	case "node":
		coordinate := []float64{float64(deref(row.LonE7)) / 1e7, float64(deref(row.LatE7)) / 1e7}
		geometry = map[string]any{"type": "Point", "coordinates": coordinate}
		properties["coordinates"] = coordinate
		properties["topologyNode"] = len(tags) == 0
	case "way":
		coordinates := [][]float64{}
		refs := []string{}
		wayNodes := []any{}
		for _, id := range row.NodeRefs {
			node, found := nodes[entityKeyString("node", id)]
			if !found || !node.Visible {
				return nil, fail(409, "Way %d has missing node %d.", row.ID, id)
			}
			coordinate := []float64{float64(deref(node.LonE7)) / 1e7, float64(deref(node.LatE7)) / 1e7}
			ref := strconv.FormatInt(id, 10)
			coordinates = append(coordinates, coordinate)
			refs = append(refs, ref)
			wayNodes = append(wayNodes, map[string]any{"id": ref, "version": node.Version, "tags": tagsFromJSON(node.Tags), "coordinates": coordinate})
		}
		geometry = map[string]any{"type": "LineString", "coordinates": coordinates}
		if len(refs) > 3 && refs[0] == refs[len(refs)-1] && isAreaWayTags(tags) {
			geometry = map[string]any{"type": "Polygon", "coordinates": [][][]float64{coordinates}}
		}
		properties["nodeIds"] = refs
		properties["nodes"] = wayNodes
	case "relation":
		var members []member
		if err := json.Unmarshal(row.Members, &members); err != nil {
			return nil, err
		}
		payload := []any{}
		for _, item := range members {
			payload = append(payload, map[string]any{"type": item.Type, "ref": strconv.FormatInt(item.Ref, 10), "role": item.Role, "sequence": item.Sequence})
		}
		properties["members"] = payload
		var lon, lat *float64
		err := tx.QueryRow(ctx, `SELECT ST_X(anchor),ST_Y(anchor) FROM (
			SELECT ST_Centroid(COALESCE(relation.bbox,(SELECT ST_Collect(child.bbox)
			FROM jsonb_to_recordset(relation.members) AS member(type text,ref bigint)
			JOIN editor.entity_current child ON child.dataset_id=relation.dataset_id AND child.entity_type=member.type::editor.entity_type AND child.entity_id=member.ref AND child.visible))) anchor
			FROM editor.entity_current relation WHERE dataset_id=$1 AND entity_type='relation'::editor.entity_type AND entity_id=$2) geometry`, datasetID, row.ID).Scan(&lon, &lat)
		if err != nil {
			return nil, err
		}
		if lon == nil || lat == nil {
			return nil, fail(409, "Relation %d has no usable geometry.", row.ID)
		}
		geometry = map[string]any{"type": "Point", "coordinates": []float64{*lon, *lat}}
	}
	return map[string]any{"type": "Feature", "id": row.Type + "-" + strconv.FormatInt(row.ID, 10), "properties": properties, "geometry": geometry}, nil
}
