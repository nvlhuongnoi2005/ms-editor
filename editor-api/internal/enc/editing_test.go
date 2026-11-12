package enc

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBasicEditingProtectsSourceSemantics(t *testing.T) {
	base := editFeature{Key: "BOYLAT/source", ObjectClass: "BOYLAT", SourceID: "source", Geometry: editGeometry{Type: "Point", Coordinates: json.RawMessage(`[105, 21]`)}, Attributes: map[string]any{"OBJNAM": "Original", "RCID": float64(12)}, CanMove: true, CanDelete: true}
	for _, test := range []struct {
		name   string
		modify func(*editFeature)
		valid  bool
	}{
		{"name", func(f *editFeature) { f.Attributes["OBJNAM"] = "Edited" }, true},
		{"position", func(f *editFeature) { f.Geometry.Coordinates = json.RawMessage(`[106,22]`) }, true},
		{"formatting", func(f *editFeature) { f.Geometry.Coordinates = json.RawMessage(`[105,21]`) }, true},
		{"identifier", func(f *editFeature) { f.Attributes["RCID"] = float64(13) }, false},
		{"unknown attribute", func(f *editFeature) { f.Attributes["DANGEROUS"] = "x" }, false},
		{"negative scale", func(f *editFeature) { f.Attributes["SCAMIN"] = float64(-1) }, false},
		{"outside world", func(f *editFeature) { f.Geometry.Coordinates = json.RawMessage(`[181,21]`) }, false},
		{"missing latitude", func(f *editFeature) { f.Geometry.Coordinates = json.RawMessage(`[105]`) }, false},
		{"discard depth", func(f *editFeature) { f.Geometry.Coordinates = json.RawMessage(`[105,21,0]`) }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, _ := json.Marshal(base)
			var after editFeature
			_ = json.Unmarshal(data, &after)
			test.modify(&after)
			err := validateEditFeature(&after, &base)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v, error=%v", test.valid, err)
			}
		})
	}
	shared := base
	shared.CanMove = false
	shared.CanDelete = false
	after := base
	after.Geometry.Coordinates = json.RawMessage(`[106,22]`)
	if validateEditFeature(&after, &shared) == nil {
		t.Fatal("shared point moved")
	}
	after = base
	after.Deleted = true
	if validateEditFeature(&after, &shared) == nil {
		t.Fatal("shared point deleted")
	}
	sounding := base
	sounding.ObjectClass = "SOUNDG"
	sounding.Key = "SOUNDG/source"
	if validateEditFeature(&sounding, &sounding) == nil {
		t.Fatal("SOUNDG editing allowed")
	}
}

func TestEditingMigrationMatchesStartupSchema(t *testing.T) {
	migration, err := os.ReadFile("../../../infra/init/10-enc-editing.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(migration), strings.TrimSpace(editingSchema)) {
		t.Fatal("ENC migration and startup schema differ")
	}
}

// Run against a disposable database only: ENC_EDITING_TEST_DB=postgres://.../enc_editing_test.
func TestEditingPersistence(t *testing.T) {
	url := os.Getenv("ENC_EDITING_TEST_DB")
	if url == "" {
		t.Skip("ENC_EDITING_TEST_DB is not configured")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err = db.QueryRow(ctx, `SELECT current_database()`).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "enc_editing_test" {
		t.Fatal("integration test requires disposable enc_editing_test database")
	}
	if _, err = db.Exec(ctx, `DROP SCHEMA IF EXISTS enc CASCADE; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='enc_owner') THEN CREATE ROLE enc_owner; END IF; END $$;`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"06-enc-canonical.sql", "07-enc-catalog.sql", "08-enc-regions.sql", "09-enc-readable-revisions.sql", "10-enc-editing.sql"} {
		contents, err := os.ReadFile(filepath.Join("../../../infra/init", file))
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(string(contents), "\n")
		filtered := []string{}
		for _, line := range lines {
			if !strings.HasPrefix(line, `\connect`) {
				filtered = append(filtered, line)
			}
		}
		if _, err = db.Exec(ctx, strings.Join(filtered, "\n")); err != nil {
			t.Fatalf("migration %s: %v", file, err)
		}
	}
	if err = EnsureEditingSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	dataset := "10000000-0000-4000-8000-000000000001"
	_, err = db.Exec(ctx, `INSERT INTO enc.dataset(id,name,state,source_filename,source_sha256) VALUES($1,'test','ready','test.000','hash');
 `, dataset)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO enc.cell(dataset_id,name,edition) VALUES($1,'TESTCELL',1)`, dataset); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO enc.cell_identity(producer,name) VALUES('test','TESTCELL')`); err != nil {
		t.Fatal(err)
	}
	var revision string
	if err = db.QueryRow(ctx, `INSERT INTO enc.cell_revision(producer,cell_name,storage_dataset_id,edition) VALUES('test','TESTCELL',$1,1) RETURNING id`, dataset).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO enc.active_cell(producer,cell_name,revision_id) VALUES('test','TESTCELL',$1)`, revision); err != nil {
		t.Fatal(err)
	}
	for _, f := range []struct{ class, id, attributes, geometry string }{
		{"BOYLAT", "one", `{"OBJNAM":"Original","NAME_RCNM":[110],"NAME_RCID":[1]}`, `{"type":"Point","coordinates":[105,21]}`},
		{"LIGHTS", "two", `{"NAME_RCNM":[110],"NAME_RCID":[2]}`, `{"type":"Point","coordinates":[105,21]}`},
		{"LNDMRK", "three", `{"NAME_RCNM":[110],"NAME_RCID":[2]}`, `{"type":"Point","coordinates":[105,21]}`},
		{"SOUNDG", "four", `{"DEPTH":5}`, `{"type":"Point","coordinates":[105,21,5]}`},
		{"LNDARE", "five", `{"OBJNAM":"Land"}`, `{"type":"Polygon","coordinates":[[[105,21],[106,21],[106,22],[105,21]]]}`},
		{"BOYLAT", "six", `{"LNAM_REFS":["missing"]}`, `{"type":"Point","coordinates":[105,21]}`},
		{"BOYLAT", "seven", `{"NAME_RCNM":[120],"NAME_RCID":[99]}`, `{"type":"Point","coordinates":[105,21]}`},
	} {
		if _, err = db.Exec(ctx, `INSERT INTO enc.feature(dataset_id,cell_name,object_class,source_id,geometry_kind,geometry,source_geometry,attributes) VALUES($1,'TESTCELL',$2,$3,'test',ST_Force2D(ST_GeomFromGeoJSON($4)),$4::jsonb,$5::jsonb)`, dataset, f.class, f.id, f.geometry, f.attributes); err != nil {
			t.Fatal(err)
		}
	}
	h := &Handler{DB: db}
	workspace := "20000000-0000-4000-8000-000000000002"
	token := strings.Repeat("a", 64)
	call := func(method, path string, body any, access string) (int, map[string]any) {
		t.Helper()
		var input bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&input).Encode(body)
		}
		r := httptest.NewRequest(method, "/api/enc/workspaces"+path, &input)
		r.Header.Set("X-ENC-Workspace-Token", access)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var result map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		return w.Code, result
	}
	create := map[string]any{"id": workspace, "token": token, "baseRevision": revision}
	if status, result := call("POST", "", create, token); status != 200 {
		t.Fatalf("create %d: %v", status, result)
	}
	if status, _ := call("POST", "", create, token); status != 200 {
		t.Fatal("create retry did not reuse workspace")
	}
	if status, _ := call("GET", "/"+workspace, nil, strings.Repeat("b", 64)); status != 403 {
		t.Fatal("workspace token not enforced")
	}
	if status, result := call("GET", "/"+workspace+"/tiles/12/3242/1803.pbf", nil, token); status != 200 {
		t.Fatalf("pinned source tile %d: %v", status, result)
	}
	one, err := h.readEditFeature(ctx, db, dataset, "TESTCELL", "BOYLAT/one")
	if err != nil || !one.CanMove {
		t.Fatalf("isolated point: %+v, %v", one, err)
	}
	for _, key := range []string{"LIGHTS/two", "LNDMRK/three", "SOUNDG/four", "BOYLAT/six", "BOYLAT/seven"} {
		f, err := h.readEditFeature(ctx, db, dataset, "TESTCELL", key)
		if err != nil || f.CanMove {
			t.Fatalf("protected %s: %+v, %v", key, f, err)
		}
	}
	one.Attributes["OBJNAM"] = "Edited"
	commit := editCommit{RequestID: "30000000-0000-4000-8000-000000000003", ExpectedVersion: 0, Changes: []editChange{{Key: one.Key, After: &one}}}
	if status, result := call("POST", "/"+workspace+"/commits", commit, token); status != 200 || result["version"] != float64(1) {
		t.Fatalf("commit %d: %v", status, result)
	}
	if status, result := call("POST", "/"+workspace+"/commits", commit, token); status != 200 || result["version"] != float64(1) {
		t.Fatalf("replay %d: %v", status, result)
	}
	// The same request ID must never accept a different payload.
	conflicting := commit
	conflicting.ExpectedVersion = 1
	if status, result := call("POST", "/"+workspace+"/commits", conflicting, token); status != 409 || result["code"] != "request_conflict" {
		t.Fatalf("reused request %d: %v", status, result)
	}
	stale := commit
	stale.RequestID = "40000000-0000-4000-8000-000000000004"
	if status, result := call("POST", "/"+workspace+"/commits", stale, token); status != 409 || result["code"] != "version_conflict" {
		t.Fatalf("stale %d: %v", status, result)
	}
	// A later invalid feature rolls back the earlier write in this same batch.
	invalid := one
	invalid.Attributes = map[string]any{"RCID": float64(999)}
	atomic := editCommit{RequestID: "50000000-0000-4000-8000-000000000005", ExpectedVersion: 1, Changes: []editChange{{Key: one.Key, After: nil}, {Key: "BOYLAT/missing", After: &invalid}}}
	if status, _ := call("POST", "/"+workspace+"/commits", atomic, token); status != 400 {
		t.Fatal("invalid batch accepted")
	}
	if status, result := call("GET", "/"+workspace, nil, token); status != 200 || result["version"] != float64(1) || len(result["features"].([]any)) != 1 {
		t.Fatalf("atomic rollback %d: %v", status, result)
	}
	var sourceName string
	if err = db.QueryRow(ctx, `SELECT attributes->>'OBJNAM' FROM enc.feature WHERE source_id='one'`).Scan(&sourceName); err != nil || sourceName != "Original" {
		t.Fatalf("canonical data modified: %s, %v", sourceName, err)
	}
	polygon, err := h.readEditFeature(ctx, db, dataset, "TESTCELL", "LNDARE/five")
	if err != nil {
		t.Fatal(err)
	}
	polygon.Attributes["OBJNAM"] = "Edited land"
	// Compact JSON from the browser must equal the whitespace-formatted Postgres geometry.
	var compact bytes.Buffer
	_ = json.Compact(&compact, polygon.Geometry.Coordinates)
	polygon.Geometry.Coordinates = compact.Bytes()
	reset := editCommit{RequestID: "60000000-0000-4000-8000-000000000006", ExpectedVersion: 1, Changes: []editChange{{Key: one.Key, After: nil}, {Key: polygon.Key, After: &polygon}}}
	if status, result := call("POST", "/"+workspace+"/commits", reset, token); status != 200 {
		t.Fatalf("reset and polygon attributes %d: %v", status, result)
	}
	var receipts int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM enc.workspace_commit WHERE workspace_id=$1`, workspace).Scan(&receipts); err != nil || receipts != 2 {
		t.Fatalf("receipt count %d: %v", receipts, err)
	}
	if _, err = db.Exec(ctx, `DELETE FROM enc.cell_revision WHERE id=$1`, revision); err == nil {
		t.Fatal("workspace source was deleted")
	}
	// Concurrent writers at the same version cannot both commit.
	var writers sync.WaitGroup
	statuses := make(chan int, 2)
	for _, requestID := range []string{"70000000-0000-4000-8000-000000000007", "80000000-0000-4000-8000-000000000008"} {
		writers.Add(1)
		go func(requestID string) {
			defer writers.Done()
			status, _ := call("POST", "/"+workspace+"/commits", editCommit{RequestID: requestID, ExpectedVersion: 2, Changes: []editChange{{Key: one.Key, After: &one}}}, token)
			statuses <- status
		}(requestID)
	}
	writers.Wait()
	first, second := <-statuses, <-statuses
	if !((first == 200 && second == 409) || (first == 409 && second == 200)) {
		t.Fatalf("concurrent writers: %d, %d", first, second)
	}
	created := editFeature{ObjectClass: "LNDMRK", SourceID: "new:90000000-0000-4000-8000-000000000009", Geometry: editGeometry{Type: "Point", Coordinates: json.RawMessage(`[105.123456789,21.987654321]`)}, Attributes: map[string]any{"OBJNAM": "New landmark"}}
	created.Key = created.ObjectClass + "/" + created.SourceID
	if status, result := call("POST", "/"+workspace+"/commits", editCommit{RequestID: "90000000-0000-4000-8000-000000000009", ExpectedVersion: 3, Changes: []editChange{{Key: created.Key, After: &created}}}, token); status != 200 {
		t.Fatalf("create point %d: %v", status, result)
	}
	if status, result := call("POST", "/"+workspace+"/commits", editCommit{RequestID: "a0000000-0000-4000-8000-00000000000a", ExpectedVersion: 4, Changes: []editChange{{Key: created.Key, After: nil}}}, token); status != 200 {
		t.Fatalf("delete created point %d: %v", status, result)
	}
	// Deleting an import removes publication, but keeps the workspace source and archive.
	h.UploadDir = t.TempDir()
	archive := filepath.Join(h.UploadDir, dataset+".zip")
	if err = os.WriteFile(archive, []byte("retained source archive"), 0600); err != nil {
		t.Fatal(err)
	}
	deleteResponse := httptest.NewRecorder()
	h.ServeHTTP(deleteResponse, httptest.NewRequest("DELETE", "/api/enc/datasets/"+dataset, nil))
	if deleteResponse.Code != 200 {
		t.Fatalf("delete import %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if _, err = os.Stat(archive); err != nil {
		t.Fatal("workspace archive removed: ", err)
	}
	if status, result := call("GET", "/"+workspace, nil, token); status != 200 || result["sourceChanged"] != true {
		t.Fatalf("retained workspace %d: %v", status, result)
	}
	if _, err = h.readEditFeature(ctx, db, dataset, "TESTCELL", one.Key); err != nil {
		t.Fatal("workspace source feature removed: ", err)
	}
	if status, result := call("GET", "/"+workspace+"/tiles/12/3242/1803.pbf", nil, token); status != 200 {
		t.Fatalf("retained pinned source tile %d: %v", status, result)
	}
}
