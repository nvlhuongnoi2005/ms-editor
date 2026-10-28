package main

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

func entityBBoxWKT(ctx context.Context, tx pgx.Tx, datasetID, typeName string, id int64) (any, error) {
	var bbox *string
	err := tx.QueryRow(ctx, `SELECT ST_AsText(bbox) FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type=$2::editor.entity_type AND entity_id=$3`, datasetID, typeName, id).Scan(&bbox)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if bbox == nil {
		return nil, nil
	}
	return *bbox, nil
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
		area := closed && isAreaWayTags(tags)
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

// graphRelations returns relations with a map anchor derived from their visible
// direct members. Relations do not have an intrinsic geometry, so the anchor is
// only a selectable handle; members remain the authoritative topology.
type graphQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func graphRelations(ctx context.Context, db graphQuerier, datasetID string, bbox [4]float64, limit int) ([]any, error) {
	rows, err := db.Query(ctx, `WITH viewport AS (
		SELECT ST_MakeEnvelope($2,$3,$4,$5,4326) AS geom
	), viewport_entities AS MATERIALIZED (
		SELECT entity_type::text AS type, entity_id
		FROM editor.entity_current CROSS JOIN viewport
		WHERE dataset_id=$1 AND visible AND bbox && viewport.geom
	), candidate_ids AS MATERIALIZED (
		SELECT entity_id FROM viewport_entities WHERE type='relation'
		UNION
		SELECT relation.entity_id
		FROM viewport_entities entity
		-- Keep parameterized reverse-member probes on the partial GIN index.
		JOIN LATERAL (
			SELECT entity_id FROM editor.entity_current
			WHERE dataset_id=$1 AND entity_type='relation'::editor.entity_type AND visible
				AND members @> jsonb_build_array(jsonb_build_object('type',entity.type,'ref',entity.entity_id))
			OFFSET 0
		) relation ON TRUE
	), candidates AS MATERIALIZED (
		SELECT relation.entity_id, relation.version, relation.tags, relation.members, relation.bbox
		FROM (SELECT entity_id FROM candidate_ids ORDER BY entity_id LIMIT $6) candidate
		-- Fetch only the bounded candidate IDs, not a merge scan of all relations.
		JOIN LATERAL (
			SELECT entity_id,version,tags,members,bbox FROM editor.entity_current
			WHERE dataset_id=$1 AND entity_type='relation'::editor.entity_type AND visible
				AND entity_id=candidate.entity_id
			OFFSET 0
		) relation ON TRUE
	)
	SELECT candidate.entity_id, candidate.version, candidate.tags, candidate.members,
		ST_X(COALESCE(member_data.anchor, ST_Centroid(candidate.bbox))),
		ST_Y(COALESCE(member_data.anchor, ST_Centroid(candidate.bbox))),
		COALESCE((
			SELECT jsonb_agg(jsonb_build_object(
				'id', parent.entity_id::text, 'version', parent.version, 'tags', parent.tags
			) ORDER BY parent.entity_id)
			FROM editor.entity_current parent
			WHERE parent.dataset_id=$1 AND parent.entity_type='relation'::editor.entity_type AND parent.visible
				AND parent.members @> jsonb_build_array(jsonb_build_object('type','relation','ref',candidate.entity_id))
		), '[]'::jsonb)
	FROM candidates candidate
	LEFT JOIN LATERAL (
		SELECT ST_Centroid(ST_Collect(member_entity.bbox)) AS anchor
		FROM jsonb_to_recordset(candidate.members) AS member(type text, ref bigint)
		JOIN editor.entity_current member_entity
			ON member_entity.dataset_id=$1 AND member_entity.entity_type=member.type::editor.entity_type
			AND member_entity.entity_id=member.ref AND member_entity.visible
	) member_data ON TRUE
	ORDER BY candidate.entity_id
	`, datasetID, bbox[0], bbox[1], bbox[2], bbox[3], limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	features := []any{}
	for rows.Next() {
		var id, version int64
		var tagsJSON, membersJSON, parentsJSON []byte
		var lon, lat *float64
		if err := rows.Scan(&id, &version, &tagsJSON, &membersJSON, &lon, &lat, &parentsJSON); err != nil {
			return nil, err
		}
		// A relation linked to a visible member normally has an anchor. Skip
		// malformed/geometry-less records rather than inventing a coordinate.
		if lon == nil || lat == nil {
			continue
		}
		var members []member
		var parents any
		if err := json.Unmarshal(membersJSON, &members); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(parentsJSON, &parents); err != nil {
			return nil, err
		}
		tags := tagsFromJSON(tagsJSON)
		coordinates := []float64{*lon, *lat}
		features = append(features, map[string]any{
			"type": "Feature", "id": "relation-" + strconv.FormatInt(id, 10),
			"properties": map[string]any{
				"entityType": "relation", "entityId": strconv.FormatInt(id, 10), "version": version,
				"name": tags["name"], "tags": tags, "members": members, "parents": parents,
			},
			"geometry": map[string]any{"type": "Point", "coordinates": coordinates},
		})
	}
	return features, rows.Err()
}
