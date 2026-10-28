package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSnapshotsRejectInvalidRequests(t *testing.T) {
	for _, body := range []string{`{"dataset":"vietnam-260901","keys":[]}`, `{"dataset":"vietnam-260901","keys":["node/-1"]}`, `{"dataset":"vietnam-260901","keys":["invalid/1"]}`, `{"dataset":"vietnam-260901","keys":["node/1","node/1"]}`} {
		response := httptest.NewRecorder()
		(&app{}).ServeHTTP(response, httptest.NewRequest("POST", "/api/entities/snapshots", bytes.NewBufferString(body)))
		if response.Code != 400 {
			t.Fatalf("status=%d for %s", response.Code, body)
		}
	}
}

func TestInverseRestorationReturnsToDeletedState(t *testing.T) {
	before := json.RawMessage(`{"type":"node","id":"1","version":2,"visible":false,"tags":{},"lon":106.1,"lat":20.1}`)
	after := json.RawMessage(`{"type":"node","id":"1","version":3,"visible":true,"tags":{},"lon":106.1,"lat":20.1}`)
	change, err := inverseStoredChange("modify", before, after)
	if err != nil || change.Operation != "delete" || deref(change.Version) != 3 {
		t.Fatalf("incorrect inverse of restoration: %#v %v", change, err)
	}
}

func integrationDB(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	if os.Getenv("EDITOR_TEST_DB") != "1" {
		t.Skip("set EDITOR_TEST_DB=1 for local integration checks")
	}
	t.Chdir("../..")
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	db, err := pgxpool.New(ctx, databaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return ctx, db
}

func TestSnapshotsReadIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	var datasetID, name string
	if err := db.QueryRow(ctx, "SELECT id,name FROM editor.dataset WHERE state='ready' ORDER BY created_at DESC LIMIT 1").Scan(&datasetID, &name); err != nil {
		t.Fatal(err)
	}
	var wayID int64
	if err := db.QueryRow(ctx, "SELECT entity_id FROM editor.entity_current WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible AND bbox IS NOT NULL LIMIT 1", datasetID).Scan(&wayID); err != nil {
		t.Fatal(err)
	}
	keys := []string{entityKeyString("way", wayID), "node/9223372036854775807"}
	body, _ := json.Marshal(map[string]any{"dataset": name, "keys": keys})
	response := httptest.NewRecorder()
	(&app{db: db}).ServeHTTP(response, httptest.NewRequest("POST", "/api/entities/snapshots", bytes.NewReader(body)).WithContext(ctx))
	if response.Code != 200 {
		t.Fatalf("status=%d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Snapshots []struct {
			Key     string         `json:"key"`
			Visible bool           `json:"visible"`
			Feature map[string]any `json:"feature"`
		} `json:"snapshots"`
		Support []any `json:"support"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Snapshots) != 2 || !payload.Snapshots[0].Visible || payload.Snapshots[1].Visible || len(payload.Support) < 2 {
		t.Fatalf("incomplete snapshot response")
	}
	properties := payload.Snapshots[0].Feature["properties"].(map[string]any)
	if len(properties["nodeIds"].([]any)) != len(properties["nodes"].([]any)) {
		t.Fatal("way references/coordinates mismatch")
	}
}

func TestRecentChangesetsReadIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	var name string
	if err := db.QueryRow(ctx, "SELECT name FROM editor.dataset WHERE state='ready' ORDER BY created_at DESC LIMIT 1").Scan(&name); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	(&app{db: db}).ServeHTTP(response, httptest.NewRequest("GET", "/api/changesets/recent?"+url.Values{"dataset": {name}}.Encode(), nil).WithContext(ctx))
	if response.Code != 200 {
		t.Fatalf("status=%d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Changesets []recentChangeset `json:"changesets"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Changesets) > 3 {
		t.Fatal("more than three candidates returned")
	}
	for i, item := range payload.Changesets {
		if !item.CanRevert && item.Reason == "" {
			t.Fatal("disabled candidate needs a reason")
		}
		if i > 0 && payload.Changesets[i-1].Revision <= item.Revision {
			t.Fatal("history is not newest-first")
		}
	}
}

// All fixture writes are confined to one transaction and rolled back. No user
// entities, datasets, published revisions or worker events are committed.
func TestConflictRevertTransactionIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var datasetID string
	if err := tx.QueryRow(ctx, "SELECT gen_random_uuid()::text").Scan(&datasetID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO editor.dataset(id,name,state) VALUES($1,$2,'ready')", datasetID, "test-conflict-"+datasetID); err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	lon, lat := int64(1060000000), int64(200000000)
	commit := func(changes []normalizedChange, options commitOptions) int64 {
		t.Helper()
		var id int64
		if err := tx.QueryRow(ctx, "INSERT INTO editor.changeset(dataset_id,status,author_id,base_revision) VALUES($1,'open','test',0) RETURNING id", datasetID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if err := checkEntityVersions(ctx, tx, datasetID, changes, options.allowInvisibleExisting); err != nil {
			t.Fatal(err)
		}
		if err := validateChangesetTopology(ctx, tx, datasetID, changes); err != nil {
			t.Fatal(err)
		}
		if _, _, err := commitChanges(ctx, tx, datasetID, id, changes, options); err != nil {
			t.Fatal(err)
		}
		return id
	}
	ids := []int64{}
	for id := int64(1); id <= 4; id++ {
		nodeLon, nodeLat := lon+id*10000, lat+id*10000
		ids = append(ids, commit([]normalizedChange{{Operation: "create", Type: "node", ID: id, LonE7: &nodeLon, LatE7: &nodeLat, Tags: map[string]string{"name": "Node " + strconv.FormatInt(id, 10)}}}, commitOptions{}))
	}
	// A later edit overlaps candidate #3, while #4 remains independent.
	commit([]normalizedChange{{Operation: "modify", Type: "node", ID: 3, Version: &version, LonE7: &lon, LatE7: &lat, Tags: map[string]string{"name": "Changed later"}}}, commitOptions{})
	if err := requireRecentChangeset(ctx, tx, datasetID, ids[0]); err == nil {
		t.Fatal("candidate outside latest three was allowed")
	}
	if err := requireRecentChangeset(ctx, tx, datasetID, ids[2]); err != nil {
		t.Fatal(err)
	}
	overlapping, err := loadInverseChanges(ctx, tx, ids[2])
	if err != nil {
		t.Fatal(err)
	}
	err = checkEntityVersions(ctx, tx, datasetID, overlapping, true)
	var conflict *versionConflictError
	if !errors.As(err, &conflict) || len(conflict.Conflicts) != 1 || conflict.Conflicts[0].Key != "node/3" {
		t.Fatalf("expected structured version conflict, got %v", err)
	}
	if err := requireRecentChangeset(ctx, tx, datasetID, ids[3]); err != nil {
		t.Fatal(err)
	}
	independent, err := loadInverseChanges(ctx, tx, ids[3])
	if err != nil {
		t.Fatal(err)
	}
	revertID := commit(independent, commitOptions{allowInvisibleExisting: true})
	for _, id := range []int64{1, 2, 3, 4} {
		row, found, err := fetchEntity(ctx, tx, datasetID, "node", id, false)
		if err != nil || !found {
			t.Fatal("fixture entity missing")
		}
		if row.Visible != (id != 4) {
			t.Fatal("revert changed another changeset's entities")
		}
	}
	stale := []normalizedChange{{Operation: "modify", Type: "node", ID: 3, Version: &version}, {Operation: "modify", Type: "node", ID: 4, Version: &version}}
	err = checkEntityVersions(ctx, tx, datasetID, stale, false)
	if !errors.As(err, &conflict) || len(conflict.Conflicts) != 2 {
		t.Fatalf("expected both conflicts together, got %v", err)
	}
	// Tombstones are returned as deleted and are not silently resurrected.
	if !conflict.Conflicts[1].Deleted {
		t.Fatal("deleted conflict was not marked")
	}
	// Reverting a deletion restores the entity. Its own inverse must delete it
	// again, and a later dependency must prevent that inverse from being applied.
	restore, err := loadInverseChanges(ctx, tx, revertID)
	if err != nil {
		t.Fatal(err)
	}
	restoreID := commit(restore, commitOptions{allowInvisibleExisting: true})
	undoRestore, err := loadInverseChanges(ctx, tx, restoreID)
	if err != nil {
		t.Fatal(err)
	}
	if len(undoRestore) != 1 || undoRestore[0].Operation != "delete" {
		t.Fatal("restoration inverse did not return a tombstone")
	}
	if err := validateChangesetTopology(ctx, tx, datasetID, undoRestore); err != nil {
		t.Fatal(err)
	}
	commit([]normalizedChange{{Operation: "create", Type: "way", ID: 90, NodeRefs: []int64{1, 4}, Tags: map[string]string{"highway": "residential"}}}, commitOptions{})
	if err := requireRecentChangeset(ctx, tx, datasetID, restoreID); err != nil {
		t.Fatal(err)
	}
	if err := checkEntityVersions(ctx, tx, datasetID, undoRestore, true); err != nil {
		t.Fatal(err)
	}
	if err := validateChangesetTopology(ctx, tx, datasetID, undoRestore); err == nil {
		t.Fatal("revert deleted a node referenced by a later way")
	}
}
