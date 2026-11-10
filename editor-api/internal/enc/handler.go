// Package enc serves the independent, read-only ENC import and map domain.
package enc

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB        *pgxpool.Pool
	UploadDir string
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.DB == nil {
		respond(w, 503, map[string]string{"error": "ENC database is unavailable. Apply the ENC migration and check ENC_DB settings."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	var err error
	switch {
	case r.URL.Path == "/api/enc/datasets" && r.Method == http.MethodGet:
		err = h.datasets(ctx, w, r)
	case strings.HasPrefix(r.URL.Path, "/api/enc/datasets/") && r.Method == http.MethodDelete:
		err = h.deleteDataset(ctx, w, r)
	case r.URL.Path == "/api/enc/cells" && r.Method == http.MethodGet:
		err = h.cells(ctx, w, r)
	case r.URL.Path == "/api/enc/regions" && r.Method == http.MethodGet:
		err = h.regions(ctx, w, r)
	case r.URL.Path == "/api/enc/imports" && r.Method == http.MethodPost:
		err = h.upload(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/enc/tiles/") && r.Method == http.MethodGet:
		err = h.tile(ctx, w, r)
	default:
		respond(w, 404, map[string]string{"error": "ENC route was not found."})
		return
	}
	if err != nil {
		log.Printf("ENC %s: %v", r.URL.Path, err)
		respond(w, 500, map[string]string{"error": "ENC request failed. Check the ENC database migration and server logs."})
	}
}

const boundsSQL = `CASE WHEN bounds IS NULL THEN NULL ELSE jsonb_build_array(ST_XMin(bounds),ST_YMin(bounds),ST_XMax(bounds),ST_YMax(bounds)) END`

func (h *Handler) datasets(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	rows, err := h.DB.Query(ctx, `SELECT d.id::text,d.name,d.state,d.feature_count,`+strings.ReplaceAll(boundsSQL, "bounds", "d.bounds")+`,COALESCE(j.state,d.state),j.error,COALESCE((SELECT jsonb_object_agg(s.outcome,s.n) FROM (SELECT i.outcome,count(*) AS n FROM enc.import_item i WHERE i.batch_id=d.id GROUP BY i.outcome) s),'{}'::jsonb),d.source_filename,d.created_at FROM enc.dataset d LEFT JOIN enc.import_job j ON j.id=d.id WHERE d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 100`)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var id, name, state, jobState, filename string
		var createdAt time.Time
		var count int64
		var bounds, outcomes json.RawMessage
		var message *string
		if err := rows.Scan(&id, &name, &state, &count, &bounds, &jobState, &message, &outcomes, &filename, &createdAt); err != nil {
			return err
		}
		items = append(items, map[string]any{"id": id, "name": name, "state": state, "featureCount": count, "bounds": bounds, "jobState": jobState, "error": message, "outcomes": outcomes, "sourceFilename": filename, "createdAt": createdAt})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var revision int64
	if err := h.DB.QueryRow(ctx, `SELECT revision FROM enc.catalog_state`).Scan(&revision); err != nil {
		return err
	}
	respond(w, 200, map[string]any{"datasets": items, "catalogRevision": revision})
	return nil
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,79}$`)

var datasetUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (h *Handler) deleteDataset(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	id := strings.TrimPrefix(r.URL.Path, "/api/enc/datasets/")
	if !datasetUUID.MatchString(id) {
		respond(w, 400, map[string]string{"error": "Invalid ENC dataset ID."})
		return nil
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(713480192)`); err != nil {
		return err
	}
	var state string
	err = tx.QueryRow(ctx, `SELECT state FROM enc.dataset WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		respond(w, 404, map[string]string{"error": "ENC dataset was not found."})
		return nil
	}
	if err != nil {
		return err
	}
	if state == "importing" {
		respond(w, 409, map[string]string{"error": "Dataset is being imported. Wait for the worker to finish before deleting it."})
		return nil
	}
	// Remove this batch's provenance. Shared revisions remain available through other batches.
	if _, err = tx.Exec(ctx, `UPDATE enc.dataset SET deleted_at=now() WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM enc.import_item WHERE batch_id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `SELECT enc.refresh_active_catalog()`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM enc.cell_revision r WHERE NOT EXISTS(SELECT 1 FROM enc.import_item i WHERE i.revision_id=r.id)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM enc.cell c USING enc.dataset d WHERE c.dataset_id=d.id AND d.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM enc.cell_revision r WHERE r.storage_dataset_id=c.dataset_id AND r.cell_name=c.name)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM enc.dataset d WHERE d.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM enc.cell_revision r WHERE r.storage_dataset_id=d.id)`); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	result := map[string]string{"id": id, "state": "deleted"}
	// Only remove artifacts generated by the HTTP uploader, never arbitrary CLI paths.
	if h.UploadDir != "" {
		if err := os.Remove(filepath.Join(h.UploadDir, strings.ToLower(id)+".zip")); err != nil && !os.IsNotExist(err) {
			log.Printf("ENC dataset %s deleted; archive cleanup failed: %v", id, err)
			result["warning"] = "Dataset deleted, but its uploaded ZIP could not be removed. Check server logs."
		}
	}
	respond(w, 200, result)
	return nil
}

func (h *Handler) cells(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	if value := r.URL.Query().Get("dataset"); value != "" && !datasetUUID.MatchString(value) {
		respond(w, 400, map[string]string{"error": "A valid ENC dataset is required."})
		return nil
	}
	rows, err := h.DB.Query(ctx, `SELECT c.name,r.edition,r.update_number,r.description,r.id::text,r.producer,`+strings.ReplaceAll(boundsSQL, "bounds", "c.bounds")+`,
 CASE WHEN water.point IS NULL THEN NULL ELSE jsonb_build_array(ST_X(water.point),ST_Y(water.point)) END
 FROM enc.cell_revision r JOIN enc.cell c ON c.dataset_id=r.storage_dataset_id AND c.name=r.cell_name
 LEFT JOIN LATERAL (
  SELECT ST_PointOnSurface(ST_MakeValid(f.geometry)) AS point FROM enc.feature f
  WHERE f.dataset_id=c.dataset_id AND f.cell_name=c.name
  AND f.object_class IN ('DEPARE','DRGARE','LAKARE','RIVERS','DOCARE')
  AND ST_Dimension(f.geometry)=2
  ORDER BY ST_Area(f.geometry) DESC,f.object_class,f.source_id LIMIT 1
 ) water ON true
 WHERE (($1='' AND EXISTS(SELECT 1 FROM enc.active_cell a WHERE a.revision_id=r.id))
 OR ($1<>'' AND EXISTS(SELECT 1 FROM enc.import_item i JOIN enc.dataset d ON d.id=i.batch_id WHERE i.revision_id=r.id AND d.id::text=$1 AND d.state='ready' AND d.deleted_at IS NULL))) ORDER BY c.name,r.producer`, r.URL.Query().Get("dataset"))
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var name, description, revisionID, producer string
		var edition *int
		var update int
		var bounds json.RawMessage
		var focus json.RawMessage
		if err := rows.Scan(&name, &edition, &update, &description, &revisionID, &producer, &bounds, &focus); err != nil {
			return err
		}
		items = append(items, map[string]any{"name": name, "edition": edition, "updateNumber": update, "bounds": bounds, "focus": focus, "description": description, "revisionId": revisionID, "producer": producer})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	respond(w, 200, map[string]any{"cells": items})
	return nil
}

//go:embed tile.sql
var tileSQL string

//go:embed regions.sql
var regionsSQL string

func (h *Handler) regions(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if dataset != "" && !datasetUUID.MatchString(dataset) {
		respond(w, 400, map[string]string{"error": "Invalid ENC import filter."})
		return nil
	}
	var collection json.RawMessage
	if err := h.DB.QueryRow(ctx, regionsSQL, dataset).Scan(&collection); err != nil {
		return err
	}
	respond(w, 200, collection)
	return nil
}

func (h *Handler) tile(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	cell := r.URL.Query().Get("cell")
	parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/enc/tiles/"), ".pbf"), "/")
	if len(parts) != 3 || (dataset != "" && !datasetUUID.MatchString(dataset)) || cell != "" && !identifier.MatchString(cell) {
		respond(w, 400, map[string]string{"error": "Invalid ENC tile path or dataset."})
		return nil
	}
	z, e1 := strconv.Atoi(parts[0])
	x, e2 := strconv.Atoi(parts[1])
	y, e3 := strconv.Atoi(parts[2])
	if e1 != nil || e2 != nil || e3 != nil || z < 0 || z > 22 || x < 0 || y < 0 || x >= 1<<z || y >= 1<<z {
		respond(w, 400, map[string]string{"error": "ENC tile coordinates are outside the zoom range."})
		return nil
	}
	ready := dataset == ""
	if dataset != "" {
		if err := h.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM enc.dataset WHERE id::text=$1 AND state='ready' AND deleted_at IS NULL)`, dataset).Scan(&ready); err != nil {
			return err
		}
	}
	if !ready {
		respond(w, 404, map[string]string{"error": "ENC dataset is not ready."})
		return nil
	}
	var body []byte
	err := h.DB.QueryRow(ctx, tileSQL, z, x, y, dataset, cell).Scan(&body)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	w.Header().Set("Cache-Control", "no-store")
	_, err = w.Write(body)
	return err
}

const maxArchive = 100 << 20

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) error {
	name := r.URL.Query().Get("dataset")
	if !identifier.MatchString(name) {
		respond(w, 400, map[string]string{"error": "Dataset name must be 1-80 ASCII letters, digits or hyphens."})
		return nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxArchive+(1<<20))
	multipart, err := r.MultipartReader()
	if err != nil {
		respond(w, 400, map[string]string{"error": "Expected multipart ZIP upload."})
		return nil
	}
	part, err := multipart.NextPart()
	if err != nil || part.FormName() != "file" {
		respond(w, 400, map[string]string{"error": "Expected the file field first."})
		return nil
	}
	filename := filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
	if !strings.EqualFold(filepath.Ext(filename), ".zip") {
		respond(w, 400, map[string]string{"error": "Upload an ENC .zip containing .000 base cells."})
		return nil
	}
	if err := os.MkdirAll(h.UploadDir, 0750); err != nil {
		return err
	}
	file, err := os.CreateTemp(h.UploadDir, "enc-*.partial")
	if err != nil {
		return err
	}
	defer func() { file.Close(); os.Remove(file.Name()) }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(part, maxArchive+1))
	if n > maxArchive {
		respond(w, 413, map[string]string{"error": "ENC ZIP exceeds 100 MiB."})
		return nil
	}
	if err != nil {
		respond(w, 400, map[string]string{"error": "ENC upload interrupted."})
		return nil
	}
	if _, err := multipart.NextPart(); err != io.EOF {
		respond(w, 400, map[string]string{"error": "Upload exactly one ZIP."})
		return nil
	}
	archive, err := zip.NewReader(file, n)
	if err != nil || len(archive.File) > 100000 {
		respond(w, 400, map[string]string{"error": "Invalid ENC ZIP archive."})
		return nil
	}
	if err := validateArchiveDirectory(archive.File); err != nil {
		respond(w, 400, map[string]string{"error": err.Error()})
		return nil
	}
	baseCount := 0
	var unpacked uint64
	for _, entry := range archive.File {
		if entry.UncompressedSize64 > (2<<30)-unpacked {
			respond(w, 400, map[string]string{"error": "ENC ZIP exceeds 2 GiB unpacked."})
			return nil
		}
		unpacked += entry.UncompressedSize64
		path := strings.ReplaceAll(entry.Name, "\\", "/")
		if unpacked > 2<<30 || strings.HasPrefix(path, "/") || strings.Contains(path, ":") || strings.Contains("/"+path+"/", "/../") || entry.Mode()&os.ModeSymlink != 0 {
			respond(w, 400, map[string]string{"error": "ENC ZIP contains unsafe paths or exceeds 2 GiB unpacked."})
			return nil
		}
		if strings.HasSuffix(strings.ToLower(path), ".000") {
			stream, err := entry.Open()
			if err != nil {
				return err
			}
			header := make([]byte, 24)
			_, readErr := io.ReadFull(stream, header)
			stream.Close()
			if readErr != nil || header[6] != 'L' {
				respond(w, 400, map[string]string{"error": "Base cell is not an ISO 8211 S-57 file."})
				return nil
			}
			baseCount++
		}
	}
	if baseCount == 0 {
		respond(w, 400, map[string]string{"error": "ENC ZIP has no .000 base cell."})
		return nil
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	random[6] = (random[6] & 15) | 64
	random[8] = (random[8] & 63) | 128
	id := fmt.Sprintf("%x-%x-%x-%x-%x", random[:4], random[4:6], random[6:8], random[8:10], random[10:])
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `INSERT INTO enc.dataset(id,name,state,source_filename,source_sha256) VALUES($1,$2,'importing',$3,$4)`, id, name, filename, hex.EncodeToString(hash.Sum(nil))); err != nil {
		var exists bool
		_ = h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM enc.dataset WHERE name=$1)`, name).Scan(&exists)
		if exists {
			respond(w, 409, map[string]string{"error": "Dataset name already exists. Choose another name."})
			return nil
		}
		return err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO enc.import_job(id,source_path,state) VALUES($1,$2,'queued')`, id, id+".zip"); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), filepath.Join(h.UploadDir, id+".zip")); err != nil {
		return err
	}
	// Retain the UUID artifact if commit is ambiguous; a committed job must always
	// have a source file. Uncommitted orphan artifacts can be removed by operators.
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	respond(w, 202, map[string]string{"id": id, "dataset": name, "state": "queued", "domain": "enc"})
	return nil
}
