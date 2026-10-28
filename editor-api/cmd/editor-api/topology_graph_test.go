package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWayParentsRejectInvalidInput(t *testing.T) {
	for _, query := range []string{"dataset=vietnam-260901", "dataset=vietnam-260901&ids=-1", "dataset=vietnam-260901&ids=abc", "dataset=vietnam-260901&ids=1,2,3"} {
		t.Run(query, func(t *testing.T) {
			response := httptest.NewRecorder()
			(&app{}).ServeHTTP(response, httptest.NewRequest("GET", "/api/topology/way-parents?"+query, nil))
			if response.Code != 400 {
				t.Fatalf("status=%d, expected 400: %s", response.Code, response.Body.String())
			}
		})
	}
}

// Opt-in, read-only integration check against the developer's canonical DB.
func TestWayParentsReadIntegration(t *testing.T) {
	if os.Getenv("EDITOR_TEST_DB") != "1" {
		t.Skip("set EDITOR_TEST_DB=1 to run read-only canonical DB checks")
	}
	// go test starts inside cmd/editor-api; match the service's normal working
	// directory so localEnv can read ../infra/.env without exposing credentials.
	t.Chdir("../..")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var datasetID, datasetName string
	if err := db.QueryRow(ctx, "SELECT id,name FROM editor.dataset WHERE state='ready' ORDER BY created_at DESC LIMIT 1").Scan(&datasetID, &datasetName); err != nil {
		t.Fatal(err)
	}
	var relationID, wayID int64
	err = db.QueryRow(ctx, `SELECT relation.entity_id, item.ref FROM editor.entity_current relation
		CROSS JOIN LATERAL jsonb_to_recordset(relation.members) AS item(type text,ref bigint)
		WHERE relation.dataset_id=$1 AND relation.entity_type='relation'::editor.entity_type
		AND relation.visible AND item.type='way' LIMIT 1`, datasetID).Scan(&relationID, &wayID)
	if err != nil {
		t.Fatal(err)
	}
	query := url.Values{"dataset": {datasetName}, "ids": {strconv.FormatInt(wayID, 10)}}
	response := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/api/topology/way-parents?"+query.Encode(), nil).WithContext(ctx)
	(&app{db: db}).ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("status=%d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		WayParents map[string][]topologyParent `json:"wayParents"`
		Relations  []json.RawMessage           `json:"relations"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, parent := range payload.WayParents[strconv.FormatInt(wayID, 10)] {
		found = found || parent.ID == strconv.FormatInt(relationID, 10)
	}
	if !found || len(payload.Relations) == 0 {
		t.Fatalf("parent %d for way %d was not returned", relationID, wayID)
	}
}
