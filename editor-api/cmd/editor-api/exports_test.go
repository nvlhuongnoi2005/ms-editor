package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPBFDownloadResumeAndValidators(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.osm.pbf")
	if err := os.WriteFile(path, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, method, byteRange, ifRange string
		code                             int
		body, contentRange               string
	}{
		{"full", "GET", "", "", 200, "0123456789", ""},
		{"resume", "GET", "bytes=4-", `"checksum"`, 206, "456789", "bytes 4-9/10"},
		{"part", "GET", "bytes=2-4", "", 206, "234", "bytes 2-4/10"},
		{"changed file", "GET", "bytes=4-", `"other"`, 200, "0123456789", ""},
		{"head", "HEAD", "", "", 200, "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "/download", nil)
			request.Header.Set("Range", test.byteRange)
			request.Header.Set("If-Range", test.ifRange)
			response := httptest.NewRecorder()
			if err := servePBFFile(response, request, path, "dataset-r4.osm.pbf", "checksum"); err != nil {
				t.Fatal(err)
			}
			if response.Code != test.code || response.Body.String() != test.body || response.Header().Get("Content-Range") != test.contentRange {
				t.Fatalf("status=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
			}
			if response.Header().Get("Accept-Ranges") != "bytes" || response.Header().Get("ETag") != `"checksum"` {
				t.Fatal(response.Header())
			}
		})
	}
	request := httptest.NewRequest("GET", "/download", nil)
	request.Header.Set("Range", "bytes=10-")
	response := httptest.NewRecorder()
	if err := servePBFFile(response, request, path, "dataset.osm.pbf", "checksum"); err != nil {
		t.Fatal(err)
	}
	if response.Code != 416 {
		t.Fatalf("status=%d, want 416", response.Code)
	}
}

func TestPBFDownloadBeyondFourGiB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.osm.pbf")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	const offset int64 = 5 << 30
	if _, err = file.WriteAt([]byte("pbf-tail"), offset); err != nil {
		file.Close()
		t.Fatal(err)
	}
	file.Close()
	request := httptest.NewRequest("GET", "/download", nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	response := httptest.NewRecorder()
	if err := servePBFFile(response, request, path, "large.osm.pbf", "checksum"); err != nil {
		t.Fatal(err)
	}
	if response.Code != 206 || response.Body.String() != "pbf-tail" || response.Header().Get("Content-Length") != "8" {
		t.Fatalf("status=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
}

func TestViewportExportRemoved(t *testing.T) {
	response := httptest.NewRecorder()
	(&app{}).ServeHTTP(response, httptest.NewRequest("GET", "/api/export/osm?bbox=1,2,3,4", nil))
	if response.Code != 410 {
		t.Fatalf("status=%d, want 410", response.Code)
	}
}

func TestFullExportQueueIntegration(t *testing.T) {
	url := os.Getenv("EDITOR_EXPORT_TEST_DB_URL")
	if url == "" {
		t.Skip("set EDITOR_EXPORT_TEST_DB_URL to a disposable Canonical database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := ensureExportsSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	const datasetID = "a1111111-2222-4333-8444-555555555555"
	if _, err := db.Exec(ctx, `INSERT INTO editor.dataset(id,name,state,canonical_revision) VALUES($1,'export-api-verification','ready',8)`, datasetID); err != nil {
		t.Fatal(err)
	}
	// Remove only the disposable dataset before closing the pool.
	defer func() {
		db.Exec(ctx, `DELETE FROM editor.export_job WHERE dataset_id=$1`, datasetID)
		db.Exec(ctx, `DELETE FROM editor.dataset WHERE id=$1`, datasetID)
	}()
	t.Setenv("EDITOR_EXPORT_DIR", t.TempDir())
	a := &app{db: db}
	create := func() string {
		t.Helper()
		r := httptest.NewRequest("POST", "/api/exports?dataset=export-api-verification", nil)
		r.Header.Set("X-Editor-Import", "1")
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != 202 {
			t.Fatalf("create status=%d body=%s", w.Code, w.Body.String())
		}
		var value struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		return value.ID
	}
	id := create()
	if duplicate := create(); duplicate != id {
		t.Fatalf("duplicate=%s want %s", duplicate, id)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, httptest.NewRequest("GET", "/api/exports?dataset=export-api-verification", nil))
	var listing struct {
		Jobs         []struct{ ID, State string }
		WorkerOnline bool
	}
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil || len(listing.Jobs) != 1 || listing.Jobs[0].State != "queued" {
		t.Fatalf("listing=%s error=%v", w.Body.String(), err)
	}
	w = httptest.NewRecorder()
	a.ServeHTTP(w, httptest.NewRequest("GET", "/api/exports/"+id+"/file", nil))
	if w.Code != 409 {
		t.Fatalf("pending download status=%d", w.Code)
	}
	if err := os.WriteFile(filepath.Join(exportDir(), id+".osm.pbf"), []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE editor.export_job SET state='ready',revision=8,bytes=10,sha256='checksum' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if cached := create(); cached != id {
		t.Fatalf("cached=%s want %s", cached, id)
	}
	r := httptest.NewRequest("GET", "/api/exports/"+id+"/file", nil)
	r.Header.Set("Range", "bytes=5-")
	w = httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "56789" {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, err := db.Exec(ctx, `UPDATE editor.dataset SET canonical_revision=9 WHERE id=$1`, datasetID); err != nil {
		t.Fatal(err)
	}
	if next := create(); next == id {
		t.Fatal("new revision reused old export")
	}
}
