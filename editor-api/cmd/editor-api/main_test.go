package main

import (
	"encoding/json"
	"testing"
)

func TestNormalizeRelationMapsCreatedMembers(t *testing.T) {
	raw := json.RawMessage(`{
		"operation":"create",
		"entity":{"type":"relation","id":-10,"tags":{"type":"route"},"members":[
			{"type":"node","ref":-1,"role":"stop","sequence":0},
			{"type":"way","ref":-2,"role":"","sequence":1}
		]}
	}`)
	change, err := normalizeChange(raw, map[string]int64{
		"relation:-10": 300,
		"node:-1":      100,
		"way:-2":       200,
	})
	if err != nil {
		t.Fatalf("normalizeChange returned error: %v", err)
	}
	if change.Type != "relation" || change.ID != 300 || len(change.Members) != 2 {
		t.Fatalf("unexpected relation change: %#v", change)
	}
	if change.Members[0].Ref != 100 || change.Members[1].Ref != 200 {
		t.Fatalf("created member IDs were not mapped: %#v", change.Members)
	}
}

func TestNormalizedStoredEntityRestoresRelation(t *testing.T) {
	payload := json.RawMessage(`{"type":"relation","id":"7","version":4,"visible":true,"tags":{"type":"multipolygon"},"members":[{"type":"way","ref":12,"role":"outer","sequence":0}]}`)
	change, err := normalizedStoredEntity(payload, "modify")
	if err != nil {
		t.Fatalf("normalizedStoredEntity returned error: %v", err)
	}
	if change.Operation != "modify" || change.Type != "relation" || change.ID != 7 || deref(change.Version) != 4 {
		t.Fatalf("unexpected restored change: %#v", change)
	}
	if len(change.Members) != 1 || change.Members[0].Type != "way" || change.Members[0].Ref != 12 {
		t.Fatalf("members were not preserved: %#v", change.Members)
	}
}

func TestDependencyRemovedInPlan(t *testing.T) {
	planned := map[string]normalizedChange{
		topologyKey("way", 20):      {Operation: "modify", Type: "way", ID: 20, NodeRefs: []int64{2, 3}},
		topologyKey("relation", 30): {Operation: "modify", Type: "relation", ID: 30, Members: []member{{Type: "way", Ref: 21, Role: "", Sequence: 0}}},
	}
	if !dependencyRemovedInPlan(planned, "way", 20, "node", 1) {
		t.Fatal("way no longer referencing node should permit the delete")
	}
	if dependencyRemovedInPlan(planned, "relation", 30, "way", 21) {
		t.Fatal("relation still referencing way must block the delete")
	}
	if dependencyRemovedInPlan(planned, "way", 99, "node", 1) {
		t.Fatal("unchanged dependent must block the delete")
	}
}

func TestRollbackDeleteRankOrdersDependantsFirst(t *testing.T) {
	created := json.RawMessage("null")
	if rollbackDeleteRank(created, normalizedChange{Type: "relation"}) >= rollbackDeleteRank(created, normalizedChange{Type: "way"}) {
		t.Fatal("relation must be deleted before a way")
	}
	if rollbackDeleteRank(created, normalizedChange{Type: "way"}) >= rollbackDeleteRank(created, normalizedChange{Type: "node"}) {
		t.Fatal("way must be deleted before a node")
	}
}
