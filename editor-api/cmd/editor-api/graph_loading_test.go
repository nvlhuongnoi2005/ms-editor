package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestGraphRejectsUnknownPart(t *testing.T) {
	response := httptest.NewRecorder()
	(&app{}).ServeHTTP(response, httptest.NewRequest("GET", "/api/graph?part=invalid", nil))
	if response.Code != 400 {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

// Fixture writes are rolled back; they never affect the user's graph or revisions.
func TestGraphRelationsCandidatesIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var datasetID, otherID string
	if err := tx.QueryRow(ctx, "SELECT gen_random_uuid()::text,gen_random_uuid()::text").Scan(&datasetID, &otherID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{datasetID, otherID} {
		if _, err := tx.Exec(ctx, "INSERT INTO editor.dataset(id,name,state) VALUES($1,$2,'ready')", id, "test-graph-"+id); err != nil {
			t.Fatal(err)
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,visible,tags,node_lon_e7,node_lat_e7,bbox)
		VALUES ($1,'node',1,1,true,'{}',1060000000,200000000,ST_SetSRID(ST_MakePoint(106,20),4326)),
		($1,'node',2,1,true,'{}',1070000000,210000000,ST_SetSRID(ST_MakePoint(107,21),4326)),
		($1,'node',3,1,false,'{}',1060000000,200000000,ST_SetSRID(ST_MakePoint(106,20),4326));
		`, datasetID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,node_refs,bbox)
		VALUES ($1,'way',10,1,ARRAY[1,2]::bigint[],ST_MakeEnvelope(105.9,19.9,106.1,20.1,4326))`, datasetID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,visible,tags,members,bbox)
		VALUES
		($1,'relation',100,1,true,'{}','[]',ST_MakeEnvelope(105.9,19.9,106.1,20.1,4326)),
		($1,'relation',101,2,true,'{}','[{"type":"node","ref":1,"role":"stop","sequence":0},{"type":"way","ref":10,"role":"forward","sequence":1}]',NULL),
		($1,'relation',102,1,true,'{}','[{"type":"way","ref":10,"role":"","sequence":0}]',ST_MakeEnvelope(107,21,108,22,4326)),
		($1,'relation',103,1,true,'{}','[{"type":"node","ref":2,"role":"","sequence":0}]',NULL),
		($1,'relation',104,1,false,'{}','[{"type":"node","ref":1,"role":"","sequence":0}]',NULL),
		($1,'relation',105,1,true,'{}','[{"type":"node","ref":3,"role":"","sequence":0}]',NULL),
		($1,'relation',106,1,true,'{}','[{"type":"node","ref":999,"role":"","sequence":0}]',NULL),
		($1,'relation',107,1,true,'{}','[{"type":"relation","ref":100,"role":"","sequence":0}]',NULL),
		($1,'relation',108,3,true,'{"name":"Outside parent"}','[{"type":"relation","ref":101,"role":"","sequence":0}]',NULL),
		($2,'relation',101,1,true,'{}','[{"type":"node","ref":1,"role":"","sequence":0}]',ST_MakeEnvelope(105.9,19.9,106.1,20.1,4326))`, datasetID, otherID)
	if err != nil {
		t.Fatal(err)
	}
	features, err := graphRelations(ctx, tx, datasetID, [4]float64{105.95, 19.95, 106.05, 20.05}, 300)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, item := range features {
		properties := item.(map[string]any)["properties"].(map[string]any)
		ids = append(ids, properties["entityId"].(string))
		if properties["entityId"] == "101" {
			members := properties["members"].([]member)
			parents := properties["parents"].([]any)
			if len(members) != 2 || members[0].Role != "stop" || members[1].Sequence != 1 || len(parents) != 1 || parents[0].(map[string]any)["id"] != "108" {
				t.Fatalf("lost member/parent topology: %#v", properties)
			}
		}
	}
	if !reflect.DeepEqual(ids, []string{"100", "101", "102", "107"}) {
		t.Fatalf("wrong viewport candidates: %v", ids)
	}
	limited, err := graphRelations(ctx, tx, datasetID, [4]float64{105.95, 19.95, 106.05, 20.05}, 2)
	if err != nil || len(limited) != 2 {
		t.Fatalf("limit not respected: %v %v", limited, err)
	}
}

func TestProgressiveGraphReadIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	var name string
	if err := db.QueryRow(ctx, "SELECT name FROM editor.dataset WHERE name='vietnam-260901' AND state='ready' ORDER BY created_at DESC LIMIT 1").Scan(&name); err != nil {
		t.Fatal(err)
	}
	keys := func(features []json.RawMessage) []string {
		result := []string{}
		for _, feature := range features {
			var value struct {
				Properties struct {
					Type string `json:"entityType"`
					ID   string `json:"entityId"`
				} `json:"properties"`
			}
			if err := json.Unmarshal(feature, &value); err != nil {
				t.Fatal(err)
			}
			result = append(result, value.Properties.Type+"/"+value.Properties.ID)
		}
		sort.Strings(result)
		return result
	}
	results := map[string][]json.RawMessage{}
	for _, part := range []string{"geometry", "relations", "all"} {
		query := url.Values{"dataset": {name}, "bbox": {"106.175,20.388,106.185,20.397"}, "limit": {"1200"}, "part": {part}}
		response := httptest.NewRecorder()
		start := time.Now()
		(&app{db: db}).ServeHTTP(response, httptest.NewRequest("GET", "/api/graph?"+query.Encode(), nil).WithContext(ctx))
		if response.Code != 200 {
			t.Fatalf("%s: %d %s", part, response.Code, response.Body.String())
		}
		var payload struct {
			Features []json.RawMessage `json:"features"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		results[part] = payload.Features
		t.Logf("%s: %s, %d features, %d bytes", part, time.Since(start), len(payload.Features), response.Body.Len())
		for _, key := range keys(payload.Features) {
			if part == "geometry" && strings.HasPrefix(key, "relation/") {
				t.Fatal("geometry includes relations")
			}
			if part == "relations" && !strings.HasPrefix(key, "relation/") {
				t.Fatal("relations includes geometry")
			}
		}
	}
	combined := append(append([]json.RawMessage{}, results["geometry"]...), results["relations"]...)
	if !reflect.DeepEqual(keys(combined), keys(results["all"])) {
		t.Fatal("progressive load lost or duplicated entities")
	}
}
