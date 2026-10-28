package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type topologyParent struct {
	ID      string            `json:"id"`
	Version int64             `json:"version"`
	Tags    map[string]string `json:"tags"`
}

// Fetch every direct parent, including relations outside the current viewport.
// Kept separate from /api/graph so normal graph loading incurs no extra query.
func (a *app) serveWayParents(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	parts := strings.Split(r.URL.Query().Get("ids"), ",")
	if !validDataset(dataset) || len(parts) > 2 {
		return fail(400, "A valid dataset and one or two way ids are required.")
	}
	ids := make([]int64, 0, len(parts))
	parents := map[string][]topologyParent{}
	for _, value := range parts {
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return fail(400, "Way ids must be positive integers.")
		}
		ids = append(ids, id)
		parents[strconv.FormatInt(id, 10)] = []topologyParent{}
	}
	var datasetID string
	err := a.db.QueryRow(ctx, "SELECT id FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&datasetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "The requested canonical dataset is not ready.")
	}
	if err != nil {
		return err
	}
	rows, err := a.db.Query(ctx, `SELECT DISTINCT relation.entity_id, relation.version, relation.tags, relation.members,
		ST_X(ST_Centroid(COALESCE(relation.bbox, fallback.bbox))), ST_Y(ST_Centroid(COALESCE(relation.bbox, fallback.bbox)))
		FROM unnest($2::bigint[]) AS way(id)
		JOIN editor.entity_current relation ON relation.dataset_id=$1
		AND relation.entity_type='relation'::editor.entity_type AND relation.visible
		AND relation.members @> jsonb_build_array(jsonb_build_object('type','way','ref',way.id))
		CROSS JOIN (SELECT ST_Collect(bbox) AS bbox FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND entity_id=ANY($2::bigint[]) AND visible) fallback
		ORDER BY relation.entity_id`, datasetID, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	relations := []any{}
	for rows.Next() {
		var id, version int64
		var tagsJSON, membersJSON []byte
		var lon, lat *float64
		if err := rows.Scan(&id, &version, &tagsJSON, &membersJSON, &lon, &lat); err != nil {
			return err
		}
		tags := tagsFromJSON(tagsJSON)
		var members []member
		if err := json.Unmarshal(membersJSON, &members); err != nil {
			return err
		}
		if lon == nil || lat == nil {
			return fail(409, "Parent relation %d has no usable geometry. Reload the way before editing.", id)
		}
		idString := strconv.FormatInt(id, 10)
		parent := topologyParent{ID: idString, Version: version, Tags: tags}
		seen := map[string]bool{}
		memberPayloads := make([]map[string]any, 0, len(members))
		for _, item := range members {
			ref := strconv.FormatInt(item.Ref, 10)
			if _, requested := parents[ref]; item.Type == "way" && requested && !seen[ref] {
				parents[ref] = append(parents[ref], parent)
				seen[ref] = true
			}
			memberPayloads = append(memberPayloads, map[string]any{"type": item.Type, "ref": ref, "role": item.Role, "sequence": item.Sequence})
		}
		relations = append(relations, map[string]any{"type": "Feature", "id": "relation-" + idString,
			"properties": map[string]any{"entityType": "relation", "entityId": idString, "version": version,
				"name": tags["name"], "tags": tags, "members": memberPayloads},
			"geometry": map[string]any{"type": "Point", "coordinates": []float64{*lon, *lat}}})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"wayParents": parents, "relations": relations})
	return nil
}
