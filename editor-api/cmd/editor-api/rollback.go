package main

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// rollbackChangeset creates a new audited changeset. It never mutates history
// in place, so publication workers and API clients observe a normal revision.
func (a *app) rollbackChangeset(ctx context.Context, w http.ResponseWriter, r *http.Request, sourceID int64) error {
	var body struct {
		Comment string `json:"comment"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var datasetID, status string
	var sourceRevision *int64
	err = tx.QueryRow(ctx, `SELECT dataset_id, status, committed_revision
		FROM editor.changeset WHERE id=$1 FOR UPDATE`, sourceID).Scan(&datasetID, &status, &sourceRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(404, "Changeset was not found.")
	}
	if err != nil {
		return err
	}
	if (status != "committed" && status != "closed") || sourceRevision == nil {
		return fail(409, "Only a committed changeset can be rolled back.")
	}
	var currentRevision int64
	if err := tx.QueryRow(ctx, "SELECT canonical_revision FROM editor.dataset WHERE id=$1 FOR UPDATE", datasetID).Scan(&currentRevision); err != nil {
		return err
	}
	if err := requireRecentChangeset(ctx, tx, datasetID, sourceID); err != nil {
		return err
	}
	changes, err := loadInverseChanges(ctx, tx, sourceID)
	if err != nil {
		return err
	}
	if err := checkEntityVersions(ctx, tx, datasetID, changes, true); err != nil {
		return err
	}
	if err := validateChangesetTopology(ctx, tx, datasetID, changes); err != nil {
		return err
	}

	var rollbackID int64
	if body.Comment == "" {
		body.Comment = "Rollback changeset " + strconv.FormatInt(sourceID, 10)
	}
	if len(body.Comment) > 255 {
		body.Comment = body.Comment[:255]
	}
	if err := tx.QueryRow(ctx, `INSERT INTO editor.changeset (dataset_id,status,comment,author_id,base_revision)
		VALUES ($1,'open',$2,'local-admin',$3) RETURNING id`, datasetID, body.Comment, currentRevision).Scan(&rollbackID); err != nil {
		return err
	}
	revision, diff, err := commitChanges(ctx, tx, datasetID, rollbackID, changes, commitOptions{allowInvisibleExisting: true})
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"changeset":           map[string]any{"id": strconv.FormatInt(rollbackID, 10), "status": "committed", "committedRevision": revision},
		"rolledBackChangeset": strconv.FormatInt(sourceID, 10), "diffResult": diff,
	})
	return nil
}

func requireRecentChangeset(ctx context.Context, tx pgx.Tx, datasetID string, sourceID int64) error {
	var eligible bool
	if err := tx.QueryRow(ctx, `SELECT $2 IN (SELECT id FROM editor.changeset WHERE dataset_id=$1 AND status IN ('committed','closed') AND committed_revision IS NOT NULL ORDER BY committed_revision DESC,id DESC LIMIT 3)`, datasetID, sourceID).Scan(&eligible); err != nil {
		return err
	}
	if !eligible {
		return fail(409, "Only one of the latest three committed changesets can be reverted.")
	}
	return nil
}

func inverseStoredChange(operation string, before, after json.RawMessage) (normalizedChange, error) {
	afterChange, err := normalizedStoredEntity(after, "modify")
	if err != nil {
		return normalizedChange{}, err
	}
	switch operation {
	case "create":
		afterChange.Operation = "delete"
		return afterChange, nil
	case "modify", "delete":
		if operation == "modify" {
			var previous struct {
				Visible *bool `json:"visible"`
			}
			if err := json.Unmarshal(before, &previous); err != nil {
				return normalizedChange{}, err
			}
			// Reverting a restoration must put the entity back in its tombstone
			// state; a normal modify would incorrectly keep it visible.
			if previous.Visible != nil && !*previous.Visible {
				afterChange.Operation = "delete"
				return afterChange, nil
			}
		}
		change, err := normalizedStoredEntity(before, "modify")
		if err != nil {
			return normalizedChange{}, err
		}
		change.Version = afterChange.Version
		return change, nil
	default:
		return normalizedChange{}, fail(422, "Unsupported stored change operation.")
	}
}

func normalizedStoredEntity(payload json.RawMessage, operation string) (normalizedChange, error) {
	var raw struct {
		Type     string            `json:"type"`
		ID       json.RawMessage   `json:"id"`
		Version  int64             `json:"version"`
		Tags     map[string]string `json:"tags"`
		Lon      *float64          `json:"lon"`
		Lat      *float64          `json:"lat"`
		NodeRefs []int64           `json:"nodeRefs"`
		Members  []member          `json:"members"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil || raw.Type == "" || raw.Version < 1 {
		return normalizedChange{}, fail(422, "Stored entity payload is invalid.")
	}
	id, err := rawInt(raw.ID, "Stored entity id")
	if err != nil || id < 1 {
		return normalizedChange{}, fail(422, "Stored entity payload is invalid.")
	}
	version := raw.Version
	change := normalizedChange{Operation: operation, Type: raw.Type, ID: id, SourceID: id, Version: &version, Tags: raw.Tags, NodeRefs: raw.NodeRefs, Members: raw.Members}
	if raw.Type == "node" {
		if raw.Lon == nil || raw.Lat == nil {
			return normalizedChange{}, fail(422, "Stored node payload is invalid.")
		}
		lon, lat := int64(math.Round(*raw.Lon*1e7)), int64(math.Round(*raw.Lat*1e7))
		change.LonE7, change.LatE7 = &lon, &lat
	}
	return change, nil
}

func loadInverseChanges(ctx context.Context, tx pgx.Tx, sourceID int64) ([]normalizedChange, error) {
	rows, err := tx.Query(ctx, `SELECT operation,before_payload,after_payload FROM editor.entity_change WHERE changeset_id=$1 ORDER BY sequence DESC`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	changes := []normalizedChange{}
	for rows.Next() {
		var operation string
		var before, after json.RawMessage
		if err := rows.Scan(&operation, &before, &after); err != nil {
			return nil, err
		}
		inverse, err := inverseStoredChange(operation, before, after)
		if err != nil {
			return nil, err
		}
		changes = append(changes, inverse)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(changes) == 0 {
		return nil, fail(409, "Changeset has no entity changes to revert.")
	}
	sort.SliceStable(changes, func(i, j int) bool {
		if changes[i].Operation != "delete" || changes[j].Operation != "delete" {
			return changes[i].Operation == "delete" && changes[j].Operation != "delete"
		}
		return rollbackDeleteRank(nil, changes[i]) < rollbackDeleteRank(nil, changes[j])
	})
	return changes, nil
}

func rollbackDeleteRank(_ json.RawMessage, change normalizedChange) int {
	switch change.Type {
	case "relation":
		return 0
	case "way":
		return 1
	default:
		return 2
	}
}
