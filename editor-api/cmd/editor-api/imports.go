package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed imports_schema.sql
var importsSchemaSQL string

func ensureImportsSchema(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, importsSchemaSQL)
	return err
}

func importUploadLimit() int64 {
	value, err := strconv.ParseInt(getenv("EDITOR_IMPORT_MAX_BYTES", "10737418240"), 10, 64)
	if err != nil || value < 1024 || value > 1<<40 {
		return 10 << 30
	}
	return value
}

func importUploadDir() string { return getenv("EDITOR_IMPORT_DIR", "../data/imports") }

// No authentication is implied by the application's development identity.
// Remote deployments must set a token. Never trust forwarded address headers.
func authorizeImport(r *http.Request) error {
	if token := getenv("EDITOR_IMPORT_TOKEN", ""); token != "" {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Import-Token")), []byte(token)) != 1 {
			return fail(403, "Import admin token is required.")
		}
	} else {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || !net.ParseIP(host).IsLoopback() {
			return fail(403, "Remote import requires EDITOR_IMPORT_TOKEN.")
		}
		// A loopback peer alone does not prevent DNS rebinding against a local API.
		requestHost := r.Host
		if parsed, _, err := net.SplitHostPort(requestHost); err == nil {
			requestHost = parsed
		}
		requestHost = strings.Trim(requestHost, "[]")
		if !strings.EqualFold(requestHost, "localhost") && !net.ParseIP(requestHost).IsLoopback() {
			return fail(403, "Non-local hostnames require EDITOR_IMPORT_TOKEN.")
		}
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host != r.Host || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return fail(403, "Cross-origin import is not allowed.")
		}
	}
	if r.Method != http.MethodGet && r.Header.Get("X-Editor-Import") != "1" {
		return fail(403, "Import request header is required.")
	}
	return nil
}

func (a *app) serveDatasets(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	var rows json.RawMessage
	err := a.db.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(jsonb_build_object(
		'id',id::text,'name',name,'state',state,'bounds',bounds,
		'canonicalRevision',canonical_revision,'renderRevision',render_revision
	) ORDER BY created_at DESC),'[]'::jsonb) FROM (
		SELECT DISTINCT ON (name) * FROM editor.dataset WHERE state='ready'
		ORDER BY name,created_at DESC
	) visible`).Scan(&rows)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"datasets": rows})
	return nil
}

func (a *app) serveImports(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	if err := authorizeImport(r); err != nil {
		return err
	}
	if r.Method == http.MethodPost && r.URL.Path == "/api/imports" {
		return a.createImport(ctx, w, r)
	}
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/retry") {
		return a.retryImport(ctx, w, r)
	}
	if r.Method != http.MethodGet || r.URL.Path != "/api/imports" {
		return fail(404, "Import route was not found.")
	}
	var jobs json.RawMessage
	err := a.db.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC),'[]'::jsonb) FROM (
		SELECT job.created_at,jsonb_build_object('id',job.id::text,'dataset',dataset.name,'filename',filename,
		'bytes',bytes,'state',job.state,'nodes',node_count,'ways',way_count,'relations',relation_count,
		'attempts',attempts,'error',error,'createdAt',job.created_at,'startedAt',started_at,'finishedAt',finished_at) item
		FROM editor.import_job job JOIN editor.dataset dataset ON dataset.id=job.id ORDER BY job.created_at DESC LIMIT 100
	) recent`).Scan(&jobs)
	if err != nil {
		return err
	}
	var online bool
	if err := a.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM editor.import_worker_status WHERE heartbeat_at > now()-interval '30 seconds')").Scan(&online); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"jobs": jobs, "workerOnline": online, "maxUploadBytes": importUploadLimit()})
	return nil
}

// Check the actual first protobuf BlobHeader rather than trusting an extension.
// Full parsing/required-feature checks happen in pyosmium in the isolated worker.
func validatePBFHeader(reader io.Reader) error {
	var size [4]byte
	if _, err := io.ReadFull(reader, size[:]); err != nil {
		return fail(400, "File is not an OSM PBF.")
	}
	n := binary.BigEndian.Uint32(size[:])
	if n == 0 || n > 64*1024 {
		return fail(400, "Invalid PBF header size.")
	}
	data := make([]byte, n)
	if _, err := io.ReadFull(reader, data); err != nil {
		return fail(400, "Truncated PBF header.")
	}
	var headerType string
	var blobSize uint64
	for len(data) > 0 {
		tag, n := binary.Uvarint(data)
		if n <= 0 {
			return fail(400, "Invalid PBF header.")
		}
		data = data[n:]
		switch tag & 7 {
		case 0:
			value, n := binary.Uvarint(data)
			if n <= 0 {
				return fail(400, "Invalid PBF header.")
			}
			data = data[n:]
			if tag>>3 == 3 {
				blobSize = value
			}
		case 2:
			length, n := binary.Uvarint(data)
			if n <= 0 || length > uint64(len(data)-n) {
				return fail(400, "Invalid PBF header.")
			}
			data = data[n:]
			if tag>>3 == 1 {
				headerType = string(data[:length])
			}
			data = data[length:]
		default:
			return fail(400, "Unsupported PBF header.")
		}
	}
	if headerType != "OSMHeader" || blobSize == 0 || blobSize > 32<<20 {
		return fail(400, "File must contain an OSMHeader block.")
	}
	return nil
}

func (a *app) createImport(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	name := strings.TrimSpace(r.URL.Query().Get("dataset"))
	if !validDataset(name) || len(name) > 80 {
		return fail(400, "Dataset name must be 1-80 ASCII letters, digits or hyphens.")
	}
	r.Body = http.MaxBytesReader(w, r.Body, importUploadLimit()+(1<<20))
	multipart, err := r.MultipartReader()
	if err != nil {
		return fail(400, "Expected multipart PBF upload.")
	}
	part, err := multipart.NextPart()
	if err != nil || part.FormName() != "file" {
		return fail(400, "Expected the file field first.")
	}
	filename := filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
	if !strings.HasSuffix(strings.ToLower(filename), ".pbf") || len(filename) > 255 || strings.Contains(strings.ToLower(filename), ".osh.") {
		return fail(400, "Upload an OSM snapshot .osm.pbf file.")
	}
	if err := os.MkdirAll(importUploadDir(), 0o750); err != nil {
		return err
	}
	file, err := os.CreateTemp(importUploadDir(), "upload-*.partial")
	if err != nil {
		return err
	}
	path := file.Name()
	defer func() { file.Close(); os.Remove(path) }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(part, importUploadLimit()+1))
	var tooLarge *http.MaxBytesError
	if n > importUploadLimit() || errors.As(err, &tooLarge) {
		return fail(413, "PBF exceeds the configured upload limit.")
	}
	if err != nil {
		return fail(400, "Upload interrupted.")
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if err := validatePBFHeader(file); err != nil {
		return err
	}
	if _, err = multipart.NextPart(); err != io.EOF {
		return fail(400, "Upload exactly one PBF file.")
	}
	if err := file.Close(); err != nil {
		return err
	}
	var uuid [16]byte
	if _, err := rand.Read(uuid[:]); err != nil {
		return err
	}
	uuid[6] = (uuid[6] & 15) | 64
	uuid[8] = (uuid[8] & 63) | 128
	id := fmt.Sprintf("%x-%x-%x-%x-%x", uuid[:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:])
	finalPath := filepath.Join(importUploadDir(), id+".osm.pbf")
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "import-name:"+name); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM editor.dataset WHERE name=$1)", name).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return fail(409, "Dataset name already exists. Choose a new name; existing data is never overwritten.")
	}
	if _, err := tx.Exec(ctx, "INSERT INTO editor.dataset(id,name,state,render_schema) VALUES($1,$2,'importing',$3)", id, name, "import_"+hex.EncodeToString(uuid[:])); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO editor.import_job(id,filename,bytes,sha256,state) VALUES($1,$2,$3,$4,'queued')", id, filename, n, hex.EncodeToString(hash.Sum(nil))); err != nil {
		return err
	}
	if err := os.Rename(path, finalPath); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		// The commit result can be ambiguous after a lost connection. Retain the
		// UUID-named file rather than leaving a committed queue item without data.
		return err
	}
	writeJSON(w, 202, map[string]any{"id": id, "dataset": name, "state": "queued"})
	return nil
}

func (a *app) retryImport(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/imports/"), "/retry")
	if _, err := parseUUID(id); err != nil {
		return fail(400, "Invalid import id.")
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var state string
	if err := tx.QueryRow(ctx, "SELECT state FROM editor.import_job WHERE id=$1 FOR UPDATE", id).Scan(&state); errors.Is(err, pgx.ErrNoRows) {
		return fail(404, "Import not found.")
	} else if err != nil {
		return err
	}
	if state != "failed" {
		return fail(409, "Only failed imports can be retried.")
	}
	result, err := tx.Exec(ctx, "UPDATE editor.dataset SET state='importing' WHERE id=$1 AND state='failed'", id)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fail(409, "Dataset is already active and cannot be replaced.")
	}
	if _, err := tx.Exec(ctx, "UPDATE editor.import_job SET state='queued',error=NULL,finished_at=NULL WHERE id=$1", id); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 202, map[string]string{"id": id, "state": "queued"})
	return nil
}

func parseUUID(id string) (string, error) {
	if len(id) != 36 || id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		return "", fmt.Errorf("invalid UUID")
	}
	decoded, err := hex.DecodeString(strings.ReplaceAll(id, "-", ""))
	if err != nil || len(decoded) != 16 {
		return "", fmt.Errorf("invalid UUID")
	}
	return id, nil
}
