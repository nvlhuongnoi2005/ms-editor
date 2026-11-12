package main

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Use a disposable DB. All fixtures are rolled back and create no changesets.
func TestDependencyQueryParameterTypesIntegration(t *testing.T) {
	dsn := os.Getenv("EDITOR_TOPOLOGY_TEST_DB_URL")
	if dsn == "" {
		t.Skip("set EDITOR_TOPOLOGY_TEST_DB_URL to a disposable Canonical DB")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO editor.dataset(id,name,state) VALUES(gen_random_uuid(),'dependency-fixture','ready') RETURNING id::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,node_lon_e7,node_lat_e7) VALUES($1,'node',1,1,1050000000,210000000)`,
		`INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,node_refs) VALUES($1,'way',10,1,ARRAY[1,2]::bigint[]),($1,'way',9007199254740993,1,ARRAY[1,2]::bigint[])`,
		`INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,members) VALUES
   ($1,'relation',20,1,'[{"type":"way","ref":10,"role":"","sequence":0}]'),
   ($1,'relation',21,1,'[{"type":"relation","ref":20,"role":"","sequence":0}]'),
   ($1,'relation',22,1,'[{"type":"node","ref":1,"role":"stop","sequence":0}]'),
   ($1,'relation',23,1,'[{"type":"way","ref":9007199254740993,"role":"","sequence":0}]')`,
	} {
		if _, err := tx.Exec(ctx, query, id); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct {
		kind    string
		entity  int64
		plan    map[string]normalizedChange
		blocked bool
	}{
		{"way", 99, nil, false},
		{"way", 10, nil, true},
		{"way", 10, map[string]normalizedChange{"relation:20": {Operation: "delete"}}, false},
		{"relation", 20, nil, true},
		{"relation", 20, map[string]normalizedChange{"relation:21": {Operation: "delete"}}, false},
		{"way", 9007199254740993, nil, true},
		{"node", 1, map[string]normalizedChange{"way:10": {Operation: "delete"}, "way:9007199254740993": {Operation: "delete"}}, true},
		{"node", 1, map[string]normalizedChange{"way:10": {Operation: "delete"}, "way:9007199254740993": {Operation: "delete"}, "relation:22": {Operation: "delete"}}, false},
	} {
		err := assertNoRemainingDependencies(ctx, tx, id, check.plan, check.kind, check.entity)
		var rejection *apiError
		if check.blocked {
			if !errors.As(err, &rejection) || rejection.status != 409 {
				t.Fatalf("%s %d: expected dependency rejection, got %v", check.kind, check.entity, err)
			}
		} else if err != nil {
			t.Fatalf("%s %d: %v", check.kind, check.entity, err)
		}
	}
}
