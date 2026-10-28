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

func TestValidateWayGeometry(t *testing.T) {
	coordinates := map[int64]geometryCoordinate{
		1: {lon: 0, lat: 0},
		2: {lon: 10, lat: 0},
		3: {lon: 10, lat: 10},
		4: {lon: 0, lat: 10},
		5: {lon: 0, lat: 10},
	}
	areaTags := map[string]string{"building": "yes"}
	tests := []struct {
		name    string
		way     wayGeometry
		wantErr bool
	}{
		{
			name: "valid line",
			way:  wayGeometry{id: 10, nodeRefs: []int64{1, 2}},
		},
		{
			name:    "requires two nodes",
			way:     wayGeometry{id: 11, nodeRefs: []int64{1}},
			wantErr: true,
		},
		{
			name:    "rejects repeated adjacent node",
			way:     wayGeometry{id: 12, nodeRefs: []int64{1, 1, 2}},
			wantErr: true,
		},
		{
			name:    "area must close with same node",
			way:     wayGeometry{id: 13, tags: areaTags, nodeRefs: []int64{1, 2, 3, 4}},
			wantErr: true,
		},
		{
			name: "valid counter clockwise area",
			way:  wayGeometry{id: 14, tags: areaTags, nodeRefs: []int64{1, 2, 3, 4, 1}},
		},
		{
			name: "valid clockwise area",
			way:  wayGeometry{id: 15, tags: areaTags, nodeRefs: []int64{1, 4, 3, 2, 1}},
		},
		{
			name:    "rejects self intersection",
			way:     wayGeometry{id: 16, tags: areaTags, nodeRefs: []int64{1, 3, 2, 4, 1}},
			wantErr: true,
		},
		{
			name:    "rejects duplicate adjacent coordinate",
			way:     wayGeometry{id: 17, nodeRefs: []int64{4, 5}},
			wantErr: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateWayGeometry(test.way, coordinates)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateWayGeometry() error = %v, want error=%t", err, test.wantErr)
			}
		})
	}
}

func TestPolygonDirection(t *testing.T) {
	ccw := []geometryCoordinate{{0, 0}, {10, 0}, {10, 10}, {0, 10}, {0, 0}}
	cw := []geometryCoordinate{{0, 0}, {0, 10}, {10, 10}, {10, 0}, {0, 0}}
	if polygonDirection(ccw) != ringCounterClockwise {
		t.Fatal("expected counter-clockwise ring to be detected")
	}
	if polygonDirection(cw) != ringClockwise {
		t.Fatal("expected clockwise ring to be detected")
	}
}

func TestValidateMultipolygonRelation(t *testing.T) {
	coordinates := map[int64]geometryCoordinate{
		1: {lon: 0, lat: 0}, 2: {lon: 100, lat: 0}, 3: {lon: 100, lat: 100}, 4: {lon: 0, lat: 100},
		5: {lon: 20, lat: 20}, 6: {lon: 40, lat: 20}, 7: {lon: 40, lat: 40}, 8: {lon: 20, lat: 40},
		9: {lon: 120, lat: 20}, 10: {lon: 140, lat: 20}, 11: {lon: 140, lat: 40}, 12: {lon: 120, lat: 40},
	}
	ways := map[int64]relationWay{
		10: {id: 10, refs: []int64{1, 2, 3, 4, 1}},
		11: {id: 11, refs: []int64{5, 6, 7, 8, 5}},
		12: {id: 12, refs: []int64{9, 10, 11, 12, 9}},
	}
	valid := relationSemantic{id: 50, tags: map[string]string{"type": "multipolygon"}, members: []member{{Type: "way", Ref: 10, Role: "outer"}, {Type: "way", Ref: 11, Role: "inner"}}}
	if err := validateMultipolygonRelation(valid, ways, coordinates); err != nil {
		t.Fatalf("valid multipolygon was rejected: %v", err)
	}
	outside := valid
	outside.members = []member{{Type: "way", Ref: 10, Role: "outer"}, {Type: "way", Ref: 12, Role: "inner"}}
	if err := validateMultipolygonRelation(outside, ways, coordinates); err == nil {
		t.Fatal("inner ring outside an outer ring must be rejected")
	}
	invalidRole := valid
	invalidRole.members = []member{{Type: "way", Ref: 10, Role: "forward"}}
	if err := validateMultipolygonRelation(invalidRole, ways, coordinates); err == nil {
		t.Fatal("invalid multipolygon role must be rejected")
	}
}

func TestValidateRouteRelation(t *testing.T) {
	ways := map[int64]relationWay{
		20: {id: 20, refs: []int64{1, 2}},
		21: {id: 21, refs: []int64{2, 3}},
		22: {id: 22, refs: []int64{4, 5}},
	}
	valid := relationSemantic{id: 60, tags: map[string]string{"type": "route"}, members: []member{{Type: "node", Ref: 100, Role: "stop"}, {Type: "way", Ref: 20, Role: ""}, {Type: "way", Ref: 21, Role: "forward"}}}
	if err := validateRouteRelation(valid, ways); err != nil {
		t.Fatalf("connected route was rejected: %v", err)
	}
	disconnected := valid
	disconnected.members = []member{{Type: "way", Ref: 20, Role: ""}, {Type: "way", Ref: 22, Role: ""}}
	if err := validateRouteRelation(disconnected, ways); err == nil {
		t.Fatal("disconnected route must be rejected")
	}
	invalidRole := valid
	invalidRole.members = []member{{Type: "node", Ref: 100, Role: "outer"}}
	if err := validateRouteRelation(invalidRole, ways); err == nil {
		t.Fatal("invalid route role must be rejected")
	}
}

func TestAssembleRelationRings(t *testing.T) {
	rings, err := assembleRelationRings([]relationWay{
		{id: 30, refs: []int64{1, 2, 3}},
		{id: 31, refs: []int64{3, 4, 1}},
	})
	if err != nil || len(rings) != 1 || !sameRefs(rings[0], []int64{1, 2, 3, 4, 1}) {
		t.Fatalf("expected an assembled closed ring, got %#v (err=%v)", rings, err)
	}
	if _, err := assembleRelationRings([]relationWay{{id: 32, refs: []int64{1, 2, 3}}}); err == nil {
		t.Fatal("open way chain must be rejected")
	}
}

func TestValidateChangesetSemantics(t *testing.T) {
	closedBuilding := normalizedChange{
		Operation: "create",
		Type:      "way",
		ID:        -1,
		Tags:      map[string]string{"building": "yes", "height": "5' 6\"", "wheelchair": "limited"},
		NodeRefs:  []int64{-10, -11, -12, -10},
	}
	tests := []struct {
		name    string
		change  normalizedChange
		wantErr bool
	}{
		{name: "accepts valid closed building and non boolean wheelchair", change: closedBuilding},
		{
			name:    "rejects area tag on node",
			change:  normalizedChange{Operation: "create", Type: "node", ID: -2, Tags: map[string]string{"building": "yes"}},
			wantErr: true,
		},
		{
			name:    "rejects linear tag on node",
			change:  normalizedChange{Operation: "create", Type: "node", ID: -3, Tags: map[string]string{"waterway": "river"}},
			wantErr: true,
		},
		{
			name:    "rejects invalid oneway",
			change:  normalizedChange{Operation: "modify", Type: "way", ID: 4, Tags: map[string]string{"oneway": "maybe"}, NodeRefs: []int64{1, 2}},
			wantErr: true,
		},
		{
			name:    "rejects invalid measurement",
			change:  normalizedChange{Operation: "modify", Type: "way", ID: 5, Tags: map[string]string{"width": "wide"}, NodeRefs: []int64{1, 2}},
			wantErr: true,
		},
		{
			name:   "accepts country maxspeed code and phone extension",
			change: normalizedChange{Operation: "modify", Type: "way", ID: 6, Tags: map[string]string{"maxspeed": "VN:urban", "phone": "tel:+84 (24) 1234 5678 ext. 9"}, NodeRefs: []int64{1, 2}},
		},
		{
			name:    "requires route classifier",
			change:  normalizedChange{Operation: "modify", Type: "relation", ID: 7, Tags: map[string]string{"type": "route"}},
			wantErr: true,
		},
		{
			name:   "allows unknown OSM tag values",
			change: normalizedChange{Operation: "modify", Type: "node", ID: 8, Tags: map[string]string{"source:survey": "field-team-42", "custom:status": "awaiting_review"}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateChangesetSemantics([]normalizedChange{test.change})
			if (err != nil) != test.wantErr {
				t.Fatalf("validateChangesetSemantics() error = %v, want error=%t", err, test.wantErr)
			}
		})
	}
}
