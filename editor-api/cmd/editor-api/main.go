package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const maxJSONBody = 2_000_000

type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }
func fail(status int, format string, args ...any) error {
	return &apiError{status, fmt.Sprintf(format, args...)}
}

type app struct {
	db         *pgxpool.Pool
	renderDB   *pgxpool.Pool
	staticRoot string
}
type changesetInfo struct {
	ID                string `json:"id"`
	Dataset           string `json:"dataset,omitempty"`
	Status            string `json:"status"`
	BaseRevision      *int64 `json:"baseRevision,omitempty"`
	CommittedRevision *int64 `json:"committedRevision,omitempty"`
	CreatedAt         any    `json:"createdAt,omitempty"`
	ClosedAt          any    `json:"closedAt,omitempty"`
}
type member struct {
	Type     string `json:"type"`
	Ref      int64  `json:"ref"`
	Role     string `json:"role"`
	Sequence int    `json:"sequence"`
}
type normalizedChange struct {
	Operation, Type       string
	ID, SourceID          int64
	Version, LonE7, LatE7 *int64
	Tags                  map[string]string
	NodeRefs              []int64
	Members               []member
}
type entityRow struct {
	Type         string
	ID, Version  int64
	Visible      bool
	Tags         json.RawMessage
	LonE7, LatE7 *int64
	NodeRefs     []int64
	Members      json.RawMessage
}

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL())
	if err != nil {
		log.Fatalf("open Canonical DB pool: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("ping Canonical DB: %v", err)
	}
	if err := ensurePublishPipelineSchema(ctx, pool); err != nil {
		log.Printf("warn: ensure publish pipeline schema: %v", err)
	}
	if os.Getenv("EDITOR_ENSURE_INDEXES") == "1" {
		if err := ensureSpatialIndexes(ctx, pool); err != nil {
			log.Fatalf("ensure spatial indexes: %v", err)
		}
	}
	if os.Getenv("EDITOR_MODE") == "render-worker" {
		if err := runRenderWorker(ctx, pool); err != nil {
			log.Fatal(err)
		}
		return
	}
	renderPool, err := pgxpool.New(ctx, renderDatabaseURL())
	if err != nil {
		log.Fatalf("open Render DB pool: %v", err)
	}
	defer renderPool.Close()
	if err := renderPool.Ping(ctx); err != nil {
		log.Fatalf("ping Render DB: %v", err)
	}
	if err := serveEditorAPI(&app{db: pool, renderDB: renderPool, staticRoot: staticRoot()}); err != nil {
		log.Fatal(err)
	}
}

func (a *app) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	requested := strings.TrimPrefix(r.URL.Path, "/")
	if requested == "" {
		requested = "index.html"
	}
	path := filepath.Join(a.staticRoot, filepath.FromSlash(requested))
	relative, err := filepath.Rel(a.staticRoot, path)
	if err != nil || strings.HasPrefix(relative, "..") {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if filepath.Ext(path) == ".mjs" || filepath.Ext(path) == ".js" {
		contentType = "text/javascript"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, path)
}
func decodeJSON(r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return fail(400, "Request body must be valid JSON.")
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
func parseID(value, label string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fail(400, "%s must be an integer.", label)
	}
	return id, nil
}
func rawInt(raw json.RawMessage, label string) (int64, error) {
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		if value, err := number.Int64(); err == nil {
			return value, nil
		}
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return parseID(text, label)
	}
	return 0, fail(400, "%s must be an integer.", label)
}
func rawFloat(raw json.RawMessage, label string) (float64, error) {
	var value float64
	if json.Unmarshal(raw, &value) != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, fail(400, "%s must be a valid coordinate.", label)
	}
	return value, nil
}
func rawTags(raw json.RawMessage) (map[string]string, error) {
	if raw == nil {
		return map[string]string{}, nil
	}
	var tags map[string]string
	if json.Unmarshal(raw, &tags) != nil || len(tags) > 256 {
		return nil, fail(400, "Entity tags must be an object.")
	}
	for key, value := range tags {
		if key == "" || len(key) > 255 || len(value) > 255 {
			return nil, fail(400, "Tags contain an invalid key or value.")
		}
	}
	return tags, nil
}
func tagsFromJSON(raw []byte) map[string]string {
	tags := map[string]string{}
	_ = json.Unmarshal(raw, &tags)
	return tags
}
func entityPayload(row entityRow) map[string]any {
	payload := map[string]any{"type": row.Type, "id": strconv.FormatInt(row.ID, 10), "version": row.Version, "visible": row.Visible, "tags": tagsFromJSON(row.Tags)}
	if row.Type == "node" {
		payload["lon"] = float64(deref(row.LonE7)) / 1e7
		payload["lat"] = float64(deref(row.LatE7)) / 1e7
	}
	if row.Type == "way" {
		payload["nodeRefs"] = row.NodeRefs
	}
	if row.Type == "relation" {
		var members any
		_ = json.Unmarshal(row.Members, &members)
		payload["members"] = members
	}
	return payload
}
func bboxForNode(lon, lat int64) string {
	x, y, epsilon := float64(lon)/1e7, float64(lat)/1e7, .000000001
	return fmt.Sprintf("POLYGON((%.10f %.10f,%.10f %.10f,%.10f %.10f,%.10f %.10f,%.10f %.10f))", x-epsilon, y-epsilon, x+epsilon, y-epsilon, x+epsilon, y+epsilon, x-epsilon, y+epsilon, x-epsilon, y-epsilon)
}
func deref(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
func nextVersion(row entityRow, found bool) int64 {
	if found {
		return row.Version + 1
	}
	return 1
}
func sameRefs(left, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
func uniqueIDs(values []int64) []int64 {
	set := map[int64]struct{}{}
	for _, value := range values {
		set[value] = struct{}{}
	}
	result := make([]int64, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	return result
}
func parseBbox(value string) ([4]float64, bool) {
	var bbox [4]float64
	parts := strings.Split(value, ",")
	if len(parts) != 4 {
		return bbox, false
	}
	for i := range parts {
		number, err := strconv.ParseFloat(parts[i], 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return bbox, false
		}
		bbox[i] = number
	}
	return bbox, bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 && bbox[0] < bbox[2] && bbox[1] < bbox[3] && bbox[2]-bbox[0] <= .3 && bbox[3]-bbox[1] <= .3
}
func validDataset(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if !(char == '-' || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}
func boundedInt(value string, fallback, low, high int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed == 0 {
		return fallback
	}
	if parsed < low {
		return low
	}
	if parsed > high {
		return high
	}
	return parsed
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	if value := localEnv()[key]; value != "" {
		return value
	}
	return fallback
}
func localEnv() map[string]string {
	values := map[string]string{}
	for _, path := range []string{"../infra/.env", "infra/.env"} {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(content), "\n") {
			pair := strings.SplitN(strings.TrimSpace(line), "=", 2)
			if len(pair) == 2 && pair[0] != "" {
				values[pair[0]] = strings.Trim(pair[1], " '\"")
			}
		}
		break
	}
	return values
}
func databaseURL() string {
	env := localEnv()
	host := getenv("CANONICAL_DB_HOST", "127.0.0.1")
	port := getenv("CANONICAL_DB_PORT", env["POSTGRES_PORT"])
	if port == "" {
		port = "5432"
	}
	user := getenv("CANONICAL_DB_USER", "canonical_owner")
	password := getenv("CANONICAL_DB_PASSWORD", env["CANONICAL_DB_PASSWORD"])
	name := getenv("CANONICAL_DB_NAME", "canonical")
	return (&url.URL{Scheme: "postgres", User: url.UserPassword(user, password), Host: host + ":" + port, Path: name, RawQuery: "sslmode=disable"}).String()
}
func renderDatabaseURL() string {
	env := localEnv()
	host := getenv("RENDER_DB_HOST", "127.0.0.1")
	port := getenv("RENDER_DB_PORT", env["POSTGRES_PORT"])
	if port == "" {
		port = "5432"
	}
	user := getenv("RENDER_DB_USER", "render_owner")
	password := getenv("RENDER_DB_PASSWORD", env["RENDER_DB_PASSWORD"])
	name := getenv("RENDER_DB_NAME", "render")
	return (&url.URL{Scheme: "postgres", User: url.UserPassword(user, password), Host: host + ":" + port, Path: name, RawQuery: "sslmode=disable"}).String()
}
func staticRoot() string {
	root := getenv("EDITOR_STATIC_ROOT", "")
	if root == "" {
		root = "dist"
		if _, err := os.Stat(root); err != nil {
			root = filepath.Join("..", "editor-web", "dist")
		}
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		log.Fatal(err)
	}
	return absolute
}
func ensureSpatialIndexes(ctx context.Context, db *pgxpool.Pool) error {
	for _, statement := range []string{
		"CREATE INDEX IF NOT EXISTS entity_current_bbox_idx ON editor.entity_current USING gist (bbox)",
		"CREATE INDEX IF NOT EXISTS entity_current_visible_way_bbox_idx ON editor.entity_current USING gist (bbox) WHERE visible AND entity_type = 'way'::editor.entity_type",
		"CREATE INDEX IF NOT EXISTS entity_current_visible_node_bbox_idx ON editor.entity_current USING gist (bbox) WHERE visible AND entity_type = 'node'::editor.entity_type",
		"CREATE INDEX IF NOT EXISTS entity_current_relation_members_idx ON editor.entity_current USING gin (members jsonb_path_ops) WHERE visible AND entity_type = 'relation'::editor.entity_type",
	} {
		if _, err := db.Exec(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func ensurePublishPipelineSchema(ctx context.Context, db *pgxpool.Pool) error {
	statements := []string{
		`ALTER TABLE editor.outbox_event ADD COLUMN IF NOT EXISTS rendered_at timestamptz;`,
		`ALTER TABLE editor.outbox_event ADD COLUMN IF NOT EXISTS processing_at timestamptz;`,
		`ALTER TABLE editor.outbox_event ADD COLUMN IF NOT EXISTS locked_by text;`,
		`ALTER TABLE editor.outbox_event ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;`,
		`ALTER TABLE editor.outbox_event ADD COLUMN IF NOT EXISTS last_error text;`,
		`CREATE INDEX IF NOT EXISTS outbox_event_pending_idx ON editor.outbox_event (dataset_id, revision) WHERE published_at IS NULL;`,
		`CREATE TABLE IF NOT EXISTS editor.tile_dirty (
			dataset_id uuid NOT NULL REFERENCES editor.dataset(id) ON DELETE CASCADE,
			profile text NOT NULL,
			z integer NOT NULL,
			x integer NOT NULL,
			y integer NOT NULL,
			target_revision bigint NOT NULL,
			priority integer NOT NULL DEFAULT 0,
			reason text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (dataset_id, profile, z, x, y)
		);`,
		`CREATE TABLE IF NOT EXISTS editor.tile_manifest (
			dataset_id uuid NOT NULL REFERENCES editor.dataset(id) ON DELETE CASCADE,
			profile text NOT NULL,
			z integer NOT NULL,
			x integer NOT NULL,
			y integer NOT NULL,
			tile_revision bigint NOT NULL,
			style_revision bigint NOT NULL DEFAULT 1,
			artifact_key text NOT NULL,
			etag text NOT NULL,
			published_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (dataset_id, profile, z, x, y)
		);`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}
