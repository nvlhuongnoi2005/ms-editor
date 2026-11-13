package enc

import (
	"encoding/json"
	"testing"
)

func TestMovementLockReasons(t *testing.T) {
	point := editFeature{ObjectClass: "LIGHTS", Geometry: editGeometry{Type: "Point", Coordinates: json.RawMessage(`[105,21]`)}, Attributes: map[string]any{}}
	cases := []struct {
		name                string
		feature             editFeature
		isolated, exclusive bool
		want                string
	}{
		{"missing primitive", point, false, true, "isolated_node_unverified"},
		{"shared reference", point, true, false, "feature_links"},
	}
	connected := point
	connected.Attributes = map[string]any{"NAME_RCNM": []any{float64(120)}}
	cases = append(cases, struct {
		name                string
		feature             editFeature
		isolated, exclusive bool
		want                string
	}{"connected node", connected, false, true, "connected_node"})
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := movementLockReason(c.feature, c.isolated, c.exclusive); got != c.want {
				t.Fatalf("got %q want %q", got, c.want)
			}
		})
	}
	point.CanMove = true
	if movementLockReason(point, false, false) != "" {
		t.Fatal("movable feature has a lock reason")
	}
	point.CanMove = false
	point.Geometry.Type = "MultiPoint"
	if movementLockReason(point, false, false) != "unsupported_geometry" {
		t.Fatal("unsupported geometry must not be described as shared links")
	}
	point.ObjectClass = "SOUNDG"
	if movementLockReason(point, false, false) != "sounding_group" {
		t.Fatal("missing SOUNDG reason")
	}
}

func TestDepthRangeValidation(t *testing.T) {
	before := editFeature{Key: "DEPARE/a", SourceID: "a", ObjectClass: "DEPARE", Attributes: map[string]any{"DRVAL1": float64(5), "DRVAL2": float64(10)}, Geometry: editGeometry{Type: "Polygon", Coordinates: json.RawMessage(`[]`)}}
	after := before
	after.Attributes = map[string]any{"DRVAL1": float64(11), "DRVAL2": float64(10)}
	if validateEditFeature(&after, &before) == nil {
		t.Fatal("accepted inverted depth range")
	}
	before = after
	after.Attributes = map[string]any{"DRVAL1": float64(11), "DRVAL2": float64(10), "INFORM": "Unchanged imported depths"}
	if err := validateEditFeature(&after, &before); err != nil {
		t.Fatal("unrelated edit of existing range:", err)
	}
}
