package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type performanceQueries struct{ status, tile atomic.Int32 }

func (q *performanceQueries) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "FROM editor.dataset dataset LEFT JOIN") {
		q.status.Add(1)
	}
	if strings.Contains(data.SQL, "ST_AsMVT(") {
		q.tile.Add(1)
	}
	return ctx
}
func (*performanceQueries) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestPerformanceReadsAndBatchCommitIntegration(t *testing.T) {
	dsn := os.Getenv("EDITOR_PERFORMANCE_TEST_DB_URL")
	if dsn == "" {
		t.Skip("set EDITOR_PERFORMANCE_TEST_DB_URL to a disposable Canonical DB")
	}
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	queries := &performanceQueries{}
	config.ConnConfig.Tracer = queries
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := ensurePublishPipelineSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := ensureImportsSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	var datasetID string
	if err := db.QueryRow(ctx, `INSERT INTO editor.dataset(id,name,state,canonical_revision,render_revision,render_schema)
  VALUES(gen_random_uuid(),'performance-fixture','ready',6001,6000,'performance_render') RETURNING id::text`).Scan(&datasetID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		db.Exec(ctx, `DELETE FROM editor.entity_change WHERE changeset_id IN (SELECT id FROM editor.changeset WHERE dataset_id=$1)`, datasetID)
		for _, table := range []string{"tile_manifest", "tile_dirty", "outbox_event", "dataset_revision", "entity_current", "changeset", "dataset"} {
			column := "dataset_id"
			if table == "dataset" {
				column = "id"
			}
			db.Exec(ctx, `DELETE FROM editor.`+table+` WHERE `+column+`=$1`, datasetID)
		}
		db.Exec(ctx, `DROP SCHEMA IF EXISTS performance_render CASCADE`)
	}()
	for _, query := range []string{
		`CREATE SCHEMA performance_render`,
		`CREATE TABLE performance_render.planet_osm_line(osm_id bigint,tags hstore,way geometry(LineString,3857))`,
		`CREATE TABLE performance_render.planet_osm_point(osm_id bigint,tags hstore,way geometry(Point,3857))`,
		`INSERT INTO performance_render.planet_osm_line VALUES(10,hstore('highway','service'),ST_Transform(ST_GeomFromText('LINESTRING(10 10,120 40)',4326),3857))`,
	} {
		if _, err := db.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(ctx, `INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,tags,node_lon_e7,node_lat_e7,bbox)
  SELECT $1,'node',n,1,jsonb_build_object('name','Node '||n),1050000000+n,210000000,ST_SetSRID(ST_MakePoint(105+n/1e7,21),4326)
  FROM generate_series(1,1000) n`, datasetID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO editor.outbox_event(dataset_id,revision,type,payload,published_at,last_error)
  SELECT $1,n,'canonical.changeset.committed','{}',now(),'old failure' FROM generate_series(1,5000) n`, datasetID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO editor.outbox_event(dataset_id,revision,type,payload) VALUES($1,6001,'canonical.changeset.committed','{}')`, datasetID); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db, renderDB: db}
	var wait sync.WaitGroup
	for range 50 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			w := httptest.NewRecorder()
			a.ServeHTTP(w, httptest.NewRequest("GET", "/api/publish-status?dataset=performance-fixture", nil))
			var value struct {
				Status        string
				PendingEvents int
			}
			if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil || w.Code != 200 || value.Status != "pending" || value.PendingEvents != 1 {
				t.Errorf("status=%d body=%s err=%v", w.Code, w.Body.String(), err)
			}
		}()
	}
	wait.Wait()
	if queries.status.Load() != 1 {
		t.Fatalf("publish SQL count=%d, want 1", queries.status.Load())
	}
	for range 50 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			w := httptest.NewRecorder()
			a.ServeHTTP(w, httptest.NewRequest("GET", "/api/mvt/0/0/0.pbf?dataset=performance-fixture", nil))
			if w.Code != 200 || w.Body.Len() == 0 {
				t.Errorf("tile status=%d body=%s", w.Code, w.Body.String())
			}
		}()
	}
	wait.Wait()
	if queries.tile.Load() != 1 {
		t.Fatalf("MVT SQL count=%d, want 1", queries.tile.Load())
	}
	r := httptest.NewRequest("GET", "/api/graph?dataset=performance-fixture&bbox=104.99,20.99,105.01,21.01&part=geometry", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal(w.Code, w.Body.String())
	}
	compressed, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(compressed)
	compressed.Close()
	if err != nil {
		t.Fatal(err)
	}
	var graph struct {
		CanonicalRevision int
		Features          []json.RawMessage
	}
	if err := json.Unmarshal(body, &graph); err != nil || graph.CanonicalRevision != 6001 || len(graph.Features) != 260 {
		t.Fatalf("graph revision=%d count=%d err=%v", graph.CanonicalRevision, len(graph.Features), err)
	}
	// Exercise the actual batched audit INSERTs in a transaction and roll back.
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var changesetID int64
	if err := tx.QueryRow(ctx, `INSERT INTO editor.changeset(dataset_id,status,author_id,base_revision) VALUES($1,'open','test',6001) RETURNING id`, datasetID).Scan(&changesetID); err != nil {
		t.Fatal(err)
	}
	version, lon, lat := int64(1), int64(1050000001), int64(210000000)
	changes := []normalizedChange{{Operation: "modify", Type: "node", ID: 1, Version: &version, LonE7: &lon, LatE7: &lat, Tags: map[string]string{"name": "edited"}}, {Operation: "modify", Type: "node", ID: 2, Version: &version, LonE7: &lon, LatE7: &lat, Tags: map[string]string{"name": "edited"}}}
	revision, _, err := commitChanges(ctx, tx, datasetID, changesetID, changes, commitOptions{})
	if err != nil || revision != 6002 {
		t.Fatalf("commit revision=%d err=%v", revision, err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM editor.entity_change WHERE changeset_id=$1`, changesetID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("audit count=%d err=%v", count, err)
	}
	t.Log("50 concurrent publish reads -> 1 status query; 50 identical tile reads -> 1 MVT query; gzip graph and batched audit verified")
}
