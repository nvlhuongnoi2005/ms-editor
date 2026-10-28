package main

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/jackc/pgx/v5"
)

type commitOptions struct {
	allowInvisibleExisting bool
}

type entityAudit struct {
	operation  string
	before     any
	beforeBBox any
	after      entityRow
}

// commitChanges is the sole write/finalization path for normal uploads and
// rollback changesets. Keeping audit rows, revisions, and outbox events here
// prevents their transactional behavior from drifting apart.
func commitChanges(ctx context.Context, tx pgx.Tx, datasetID string, changesetID int64, changes []normalizedChange, options commitOptions) (int64, []map[string]any, error) {
	changedWays, changedNodes := []int64{}, []int64{}
	audit := make([]entityAudit, 0, len(changes))
	diff := make([]map[string]any, 0, len(changes))
	for _, change := range changes {
		existing, found, err := fetchEntity(ctx, tx, datasetID, change.Type, change.ID, true)
		if err != nil {
			return 0, nil, err
		}
		if change.Operation == "create" && found {
			return 0, nil, fail(409, "Entity id already exists.")
		}
		if change.Operation != "create" && !found {
			return 0, nil, fail(404, "Entity was not found.")
		}
		var bboxBefore any
		if found {
			bboxBefore, err = entityBBoxWKT(ctx, tx, datasetID, change.Type, change.ID)
			if err != nil {
				return 0, nil, err
			}
		}
		if found && (existing.Version != deref(change.Version) || (!existing.Visible && !options.allowInvisibleExisting)) {
			return 0, nil, &versionConflictError{[]versionConflict{{entityKeyString(change.Type, change.ID), deref(change.Version), existing.Version, !existing.Visible}}}
		}
		effective := change
		if change.Operation == "delete" {
			effective = deletionChange(change, existing)
		}
		after, err := writeEntity(ctx, tx, datasetID, changesetID, effective, existing, found)
		if err != nil {
			return 0, nil, err
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
		audit = append(audit, entityAudit{change.Operation, before, bboxBefore, after})
		oldID := change.SourceID
		if oldID == 0 {
			oldID = change.ID
		}
		diff = append(diff, map[string]any{"type": change.Type, "oldId": strconv.FormatInt(oldID, 10), "newId": strconv.FormatInt(change.ID, 10), "newVersion": after.Version})
	}
	if len(changedWays) > 0 || len(changedNodes) > 0 {
		if _, err := tx.Exec(ctx, rebuildBboxSQL, datasetID, changedWays, changedNodes); err != nil {
			return 0, nil, err
		}
	}
	var revision int64
	if err := tx.QueryRow(ctx, "UPDATE editor.dataset SET canonical_revision = canonical_revision + 1 WHERE id = $1 RETURNING canonical_revision", datasetID).Scan(&revision); err != nil {
		return 0, nil, err
	}
	for sequence, item := range audit {
		before, _ := json.Marshal(item.before)
		after, _ := json.Marshal(entityPayload(item.after))
		if _, err := tx.Exec(ctx, "INSERT INTO editor.entity_change (changeset_id, sequence, entity_type, entity_id, operation, before_payload, after_payload, bbox_before) VALUES ($1, $2, $3::editor.entity_type, $4, $5, $6, $7, ST_GeomFromText($8,4326))", changesetID, sequence, item.after.Type, item.after.ID, item.operation, before, after, item.beforeBBox); err != nil {
			return 0, nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE editor.entity_change change
		SET bbox_after=current.bbox
		FROM editor.entity_current current
		WHERE change.changeset_id=$1 AND current.dataset_id=$2
		  AND current.entity_type=change.entity_type AND current.entity_id=change.entity_id`, changesetID, datasetID); err != nil {
		return 0, nil, err
	}
	if _, err := tx.Exec(ctx, "UPDATE editor.changeset SET status = 'committed', committed_revision = $2 WHERE id = $1", changesetID, revision); err != nil {
		return 0, nil, err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO editor.dataset_revision (dataset_id, revision, changeset_id) VALUES ($1,$2,$3)", datasetID, revision, changesetID); err != nil {
		return 0, nil, err
	}
	diffJSON, _ := json.Marshal(diff)
	if _, err := tx.Exec(ctx, "INSERT INTO editor.outbox_event (dataset_id, revision, type, payload) VALUES ($1,$2,'canonical.changeset.committed',$3)", datasetID, revision, diffJSON); err != nil {
		return 0, nil, err
	}
	return revision, diff, nil
}
