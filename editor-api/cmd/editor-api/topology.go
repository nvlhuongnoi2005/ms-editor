package main

import (
	"context"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
)

func topologyKey(entityType string, id int64) string {
	return entityType + ":" + strconv.FormatInt(id, 10)
}

// validateChangesetTopology validates the final state of one changeset, not
// each operation in isolation. That allows a relation to reference an entity
// created in the same upload and allows a dependency to be removed before its
// target is deleted.
func validateChangesetTopology(ctx context.Context, tx pgx.Tx, datasetID string, changes []normalizedChange) error {
	// Dependency checks span rows that may not themselves be edited. Serializing
	// topology validation per dataset avoids a concurrent upload invalidating the
	// result between validation and commit.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "topology:"+datasetID); err != nil {
		return err
	}
	planned := make(map[string]normalizedChange, len(changes))
	for _, change := range changes {
		key := topologyKey(change.Type, change.ID)
		if _, duplicate := planned[key]; duplicate {
			return fail(400, "An entity can only be changed once per upload.")
		}
		planned[key] = change
	}
	for _, change := range changes {
		if change.Operation == "delete" {
			if err := assertNoRemainingDependencies(ctx, tx, datasetID, planned, change.Type, change.ID); err != nil {
				return err
			}
			continue
		}
		if change.Type == "way" {
			for _, nodeID := range uniqueIDs(change.NodeRefs) {
				if err := assertPlannedOrVisible(ctx, tx, datasetID, planned, "node", nodeID); err != nil {
					return fail(409, "A way references a missing or deleted node.")
				}
			}
		}
		if change.Type == "relation" {
			for _, member := range change.Members {
				if err := assertPlannedOrVisible(ctx, tx, datasetID, planned, member.Type, member.Ref); err != nil {
					return fail(409, "A relation references a missing or deleted entity.")
				}
			}
		}
	}
	if err := validateChangesetGeometry(ctx, tx, datasetID, planned, changes); err != nil {
		return err
	}
	if err := validateChangesetRelationSemantics(ctx, tx, datasetID, planned, changes); err != nil {
		return err
	}
	return validateChangesetSemantics(changes)
}

func assertPlannedOrVisible(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, entityType string, id int64) error {
	if change, exists := planned[topologyKey(entityType, id)]; exists {
		if change.Operation == "delete" {
			return fmt.Errorf("dependency is deleted in this upload")
		}
		return nil
	}
	var visible bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type=$2::editor.entity_type AND entity_id=$3 AND visible
	)`, datasetID, entityType, id).Scan(&visible); err != nil {
		return err
	}
	if !visible {
		return fmt.Errorf("dependency is missing")
	}
	return nil
}

func assertNoRemainingDependencies(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, entityType string, id int64) error {
	var rows pgx.Rows
	var err error
	switch entityType {
	case "node":
		rows, err = tx.Query(ctx, `SELECT entity_type::text, entity_id FROM editor.entity_current
			WHERE dataset_id=$1 AND visible AND entity_type='way'::editor.entity_type AND node_refs @> ARRAY[$2]::bigint[]`, datasetID, id)
	default:
		rows, err = tx.Query(ctx, `SELECT entity_type::text, entity_id FROM editor.entity_current
			WHERE dataset_id=$1 AND visible AND entity_type='relation'::editor.entity_type
			  AND members @> jsonb_build_array(jsonb_build_object('type',$2,'ref',$3))`, datasetID, entityType, id)
	}
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var dependentType string
		var dependentID int64
		if err := rows.Scan(&dependentType, &dependentID); err != nil {
			return err
		}
		if !dependencyRemovedInPlan(planned, dependentType, dependentID, entityType, id) {
			return fail(409, "Cannot delete an entity that is still referenced by %s %d.", dependentType, dependentID)
		}
	}
	return rows.Err()
}

func dependencyRemovedInPlan(planned map[string]normalizedChange, dependentType string, dependentID int64, targetType string, targetID int64) bool {
	change, exists := planned[topologyKey(dependentType, dependentID)]
	if !exists || change.Operation == "delete" {
		return exists && change.Operation == "delete"
	}
	switch dependentType {
	case "way":
		return targetType == "node" && !containsID(change.NodeRefs, targetID)
	case "relation":
		for _, member := range change.Members {
			if member.Type == targetType && member.Ref == targetID {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func containsID(ids []int64, target int64) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}
