package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed exports_schema.sql
var exportsSchemaSQL string

func ensureExportsSchema(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, exportsSchemaSQL)
	return err
}

func exportDir() string { return getenv("EDITOR_EXPORT_DIR", "../data/exports") }

func (a *app) serveExports(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	if r.URL.Path == "/api/exports" {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			return fail(405, "Method not allowed.")
		}
		if r.Method == http.MethodPost {
			if err := authorizeImport(r); err != nil {
				return err
			}
		}
		datasetID, _, err := a.exportDataset(ctx, r)
		if err != nil {
			return err
		}
		if r.Method == http.MethodPost {
			return a.createExport(ctx, w, datasetID)
		}
		var jobs json.RawMessage
		err = a.db.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC),'[]'::jsonb)
   FROM (SELECT id::text,state,revision,entity_count AS "entityCount",total_count AS "totalCount",phase,cancel_requested AS "cancelRequested",pause_requested AS "pauseRequested",bytes,sha256,error,created_at,finished_at
    FROM editor.export_job WHERE dataset_id=$1 ORDER BY created_at DESC LIMIT 20) j`, datasetID).Scan(&jobs)
		if err != nil {
			return err
		}
		var online bool
		if err := a.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM editor.export_worker_status WHERE heartbeat_at>now()-interval '30 seconds')`).Scan(&online); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"jobs": jobs, "workerOnline": online})
		return nil
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/exports/")
	if !strings.Contains(id, "/") {
		if _, err := parseUUID(id); err != nil {
			return fail(400, "Invalid export id.")
		}
		if r.Method != http.MethodGet {
			return fail(405, "Method not allowed.")
		}
		var job json.RawMessage
		err := a.db.QueryRow(ctx, `SELECT to_jsonb(j) FROM (
		 SELECT id::text,state,revision,entity_count AS "entityCount",total_count AS "totalCount",
		 phase,cancel_requested AS "cancelRequested",pause_requested AS "pauseRequested",bytes,sha256,created_at
		 FROM editor.export_job WHERE id=$1) j`, id).Scan(&job)
		if isNoRows(err) {
			return fail(404, "Export was not found.")
		}
		if err != nil {
			return err
		}
		writeJSON(w, 200, job)
		return nil
	}
	if strings.HasSuffix(id, "/pause") || strings.HasSuffix(id, "/resume") {
		paused := strings.HasSuffix(id, "/pause")
		suffix := "/resume"
		if paused {
			suffix = "/pause"
		}
		id = strings.TrimSuffix(id, suffix)
		if _, err := parseUUID(id); err != nil {
			return fail(400, "Invalid export id.")
		}
		if r.Method != http.MethodPost {
			return fail(405, "Method not allowed.")
		}
		if err := authorizeImport(r); err != nil {
			return err
		}
		var state string
		err := a.db.QueryRow(ctx, `UPDATE editor.export_job SET pause_requested=$2,
		 phase=CASE WHEN state='queued' THEN CASE WHEN $2 THEN 'paused' ELSE 'queued' END ELSE phase END
		 WHERE id=$1 AND state IN ('queued','running') AND NOT cancel_requested RETURNING state`, id, paused).Scan(&state)
		if isNoRows(err) {
			return fail(409, "Export is no longer active. Refresh its status.")
		}
		if err != nil {
			return err
		}
		writeJSON(w, 202, map[string]any{"state": state, "pauseRequested": paused})
		return nil
	}
	if strings.HasSuffix(id, "/cancel") {
		id = strings.TrimSuffix(id, "/cancel")
		if _, err := parseUUID(id); err != nil {
			return fail(400, "Invalid export id.")
		}
		if r.Method != http.MethodPost {
			return fail(405, "Method not allowed.")
		}
		if err := authorizeImport(r); err != nil {
			return err
		}
		var state string
		err := a.db.QueryRow(ctx, `UPDATE editor.export_job SET cancel_requested=true,
		 phase=CASE WHEN state='queued' THEN 'cancelled' ELSE phase END,
		 finished_at=CASE WHEN state='queued' THEN now() ELSE finished_at END,
		 state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END
		 WHERE id=$1 AND state IN ('queued','running','cancelled') RETURNING state`, id).Scan(&state)
		if isNoRows(err) {
			return fail(409, "Export has already finished or was not found. Refresh the export list.")
		}
		if err != nil {
			return err
		}
		writeJSON(w, 202, map[string]string{"state": state})
		return nil
	}
	if !strings.HasSuffix(id, "/file") {
		return fail(404, "Export route was not found.")
	}
	id = strings.TrimSuffix(id, "/file")
	if _, err := parseUUID(id); err != nil {
		return fail(400, "Invalid export id.")
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return fail(405, "Method not allowed.")
	}
	var state, name string
	var digest *string
	var revision *int64
	err := a.db.QueryRow(ctx, `SELECT job.state,dataset.name,job.revision,job.sha256
  FROM editor.export_job job JOIN editor.dataset dataset ON dataset.id=job.dataset_id WHERE job.id=$1`, id).Scan(&state, &name, &revision, &digest)
	if isNoRows(err) {
		return fail(404, "Export was not found.")
	}
	if err != nil {
		return err
	}
	if state != "ready" || revision == nil || digest == nil {
		return fail(409, "Export file is not ready.")
	}
	return servePBFFile(w, r, filepath.Join(exportDir(), strings.ToLower(id)+".osm.pbf"), fmt.Sprintf("%s-r%d.osm.pbf", name, *revision), *digest)
}

func (a *app) createExport(ctx context.Context, w http.ResponseWriter, datasetID string) error {
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serialize duplicate clicks without locking the dataset against editor saves.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "export:"+datasetID); err != nil {
		return err
	}
	var id string
	err = tx.QueryRow(ctx, `SELECT id::text FROM editor.export_job WHERE dataset_id=$1 AND state IN ('queued','running') LIMIT 1`, datasetID).Scan(&id)
	if err != nil && !isNoRows(err) {
		return err
	}
	if id == "" {
		var cached string
		err = tx.QueryRow(ctx, `SELECT job.id::text FROM editor.export_job job JOIN editor.dataset dataset ON dataset.id=job.dataset_id
   WHERE job.dataset_id=$1 AND job.state='ready' AND job.revision=dataset.canonical_revision ORDER BY job.created_at DESC LIMIT 1`, datasetID).Scan(&cached)
		if err != nil && !isNoRows(err) {
			return err
		}
		if cached != "" {
			if info, err := os.Stat(filepath.Join(exportDir(), cached+".osm.pbf")); err == nil && info.Mode().IsRegular() {
				id = cached
			}
		}
	}
	if id == "" {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('export-queue-capacity'))`); err != nil {
			return err
		}
		var queued int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM editor.export_job WHERE state IN ('queued','running')`).Scan(&queued); err != nil {
			return err
		}
		if queued >= intEnv("EDITOR_EXPORT_MAX_PENDING", 16, 1, 1000) {
			return fail(503, "Export queue is full. Please retry later.")
		}
		var value [16]byte
		if _, err := rand.Read(value[:]); err != nil {
			return err
		}
		value[6] = (value[6] & 15) | 64
		value[8] = (value[8] & 63) | 128
		id = fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:])
		if _, err := tx.Exec(ctx, `INSERT INTO editor.export_job(id,dataset_id,state) VALUES($1,$2,'queued')`, id, datasetID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 202, map[string]string{"id": id})
	return nil
}

// ServeContent seeks in an immutable file and handles HEAD, Range and If-Range.
// Never read the PBF into a byte slice or regenerate it for a Range request.
func servePBFFile(w http.ResponseWriter, r *http.Request, path, filename, digest string) error {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return fail(410, "Export file is no longer available. Create a new export.")
	}
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fail(404, "Export file was not found.")
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("ETag", `"`+digest+`"`)
	w.Header().Set("X-Checksum-SHA256", digest)
	w.Header().Set("Cache-Control", "private, no-transform")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filename, info.ModTime(), file)
	return nil
}
