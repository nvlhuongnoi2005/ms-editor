package main

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type recentChangeset struct {
	ID        string    `json:"id"`
	Revision  int64     `json:"revision"`
	Comment   string    `json:"comment"`
	Author    string    `json:"author"`
	CreatedAt time.Time `json:"createdAt"`
	Creates   int       `json:"creates"`
	Modifies  int       `json:"modifies"`
	Deletes   int       `json:"deletes"`
	CanRevert bool      `json:"canRevert"`
	Reason    string    `json:"reason,omitempty"`
}

func (a *app) serveRecentChangesets(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if !validDataset(dataset) {
		return fail(400, "A valid dataset is required.")
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var datasetID string
	if err := tx.QueryRow(ctx, "SELECT id FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&datasetID); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT changeset.id,changeset.committed_revision,COALESCE(changeset.comment,''),changeset.author_id,changeset.created_at,
		COUNT(change.sequence) FILTER(WHERE operation='create'),COUNT(change.sequence) FILTER(WHERE operation='modify'),COUNT(change.sequence) FILTER(WHERE operation='delete')
		FROM (SELECT * FROM editor.changeset WHERE dataset_id=$1 AND status IN ('committed','closed') AND committed_revision IS NOT NULL ORDER BY committed_revision DESC,id DESC LIMIT 3) changeset
		LEFT JOIN editor.entity_change change ON change.changeset_id=changeset.id
		GROUP BY changeset.id,changeset.committed_revision,changeset.comment,changeset.author_id,changeset.created_at
		ORDER BY changeset.committed_revision DESC,changeset.id DESC`, datasetID)
	if err != nil {
		return err
	}
	items := []recentChangeset{}
	for rows.Next() {
		var item recentChangeset
		var id int64
		if err := rows.Scan(&id, &item.Revision, &item.Comment, &item.Author, &item.CreatedAt, &item.Creates, &item.Modifies, &item.Deletes); err != nil {
			rows.Close()
			return err
		}
		item.ID = strconv.FormatInt(id, 10)
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range items {
		id, _ := strconv.ParseInt(items[index].ID, 10, 64)
		changes, validationErr := loadInverseChanges(ctx, tx, id)
		if validationErr == nil {
			validationErr = checkEntityVersions(ctx, tx, datasetID, changes, true)
		}
		if validationErr == nil {
			validationErr = validateChangesetTopology(ctx, tx, datasetID, changes)
		}
		items[index].CanRevert = validationErr == nil
		if validationErr != nil {
			var versionErr *versionConflictError
			var apiErr *apiError
			if errors.As(validationErr, &versionErr) {
				items[index].Reason = "Đối tượng đã được sửa tiếp sau changeset này."
			} else if errors.As(validationErr, &apiErr) {
				items[index].Reason = apiErr.message
			} else {
				return validationErr
			}
		}
	}
	writeJSON(w, 200, map[string]any{"changesets": items})
	return nil
}
