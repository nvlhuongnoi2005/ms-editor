package enc

import (
	"encoding/json"
	"fmt"
	"strings"
	"math"
)

// This permits a feature-level workspace overlay, never a primitive/topology update.
func canOverridePointPosition(f editFeature) bool {
 if f.Geometry.Type!="Point" || !movablePointClass(f.ObjectClass) { return false }
 var p []float64
 return json.Unmarshal(f.Geometry.Coordinates,&p)==nil && len(p)==2 && !math.IsNaN(p[0]) && !math.IsNaN(p[1]) && !math.IsInf(p[0],0) && !math.IsInf(p[1],0) && math.Abs(p[0])<=180 && math.Abs(p[1])<=90
}

// Explain only what the ownership checks established; never infer a shared edge
// from a failed completeness check. These codes do not grant permissions.
func movementLockReason(f editFeature, isolated, exclusive bool) string {
	if f.CanMove {
		return ""
	}
	if f.ObjectClass == "SOUNDG" {
		return "sounding_group"
	}
	if strings.HasPrefix(f.ObjectClass, "M_") {
		return "metadata_class"
	}
	switch f.Geometry.Type {
	case "Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon":
	default:
		return "unsupported_geometry"
	}
	if f.Geometry.Type == "Point" {
		var coordinates []float64
		if json.Unmarshal(f.Geometry.Coordinates, &coordinates) != nil || len(coordinates) != 2 {
			return "point_dimensions"
		}
		if !movablePointClass(f.ObjectClass) {
			return "unsupported_class"
		}
		if kinds, ok := f.Attributes["NAME_RCNM"].([]any); ok {
			for _, kind := range kinds {
				if fmt.Sprint(kind) == "120" {
					return "connected_node"
				}
			}
		}
		if !isolated {
			return "isolated_node_unverified"
		}
	}
	if !exclusive {
		return "feature_links"
	}
	return "edge_ownership_unverified"
}
