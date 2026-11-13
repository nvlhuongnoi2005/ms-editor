package enc

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
)

// Accept only a uniform Mercator scale and translation. The browser cannot
// turn a resize into an arbitrary vertex edit, discard holes or alter Z values.
func validateGeometryTransform(after, before editGeometry) error {
	if after.Type != before.Type {
		return fmt.Errorf("Không được đổi loại hình học khi biến đổi.")
	}
	switch before.Type {
	case "LineString", "MultiLineString", "Polygon", "MultiPolygon":
	default:
		return fmt.Errorf("Loại hình học chưa hỗ trợ biến đổi.")
	}
	var a, b any
	if json.Unmarshal(after.Coordinates, &a) != nil || json.Unmarshal(before.Coordinates, &b) != nil {
		return fmt.Errorf("Tọa độ không hợp lệ.")
	}
	var original, result [][2]float64
	var walk func(any, any) bool
	walk = func(av, bv any) bool {
		aa, ok := av.([]any)
		bb, bok := bv.([]any)
		if !ok || !bok || len(aa) != len(bb) || len(aa) == 0 {
			return false
		}
		if _, ok := bb[0].(float64); !ok {
			if reflect.DeepEqual(bb[0], bb[len(bb)-1]) && !reflect.DeepEqual(aa[0], aa[len(aa)-1]) {
				return false
			}
			for i := range aa {
				if !walk(aa[i], bb[i]) {
					return false
				}
			}
			return true
		}
		if len(aa) < 2 {
			return false
		}
		var pa, pb [2]float64
		for i := range aa {
			x, xok := aa[i].(float64)
			y, yok := bb[i].(float64)
			if !xok || !yok || math.IsNaN(x) || math.IsInf(x, 0) || i > 1 && x != y {
				return false
			}
			if i < 2 {
				pa[i] = x
				pb[i] = y
			}
		}
		if math.Abs(pa[0]) > 180 || math.Abs(pb[0]) > 180 || math.Abs(pa[1]) > 85.0511287798 || math.Abs(pb[1]) > 85.0511287798 {
			return false
		}
		project := func(p [2]float64) [2]float64 {
			return [2]float64{p[0] * math.Pi / 180, math.Log(math.Tan(math.Pi/4 + p[1]*math.Pi/360))}
		}
		original = append(original, project(pb))
		result = append(result, project(pa))
		return true
	}
	if !walk(a, b) || len(original) < 2 {
		return fmt.Errorf("Biến đổi phải giữ các đỉnh, vòng khép kín và chiều sâu nguồn.")
	}
	scale := 1.0
	found := false
	for i := 1; i < len(original) && !found; i++ {
		for axis := 0; axis < 2; axis++ {
			d := original[i][axis] - original[0][axis]
			if math.Abs(d) > 1e-12 {
				scale = (result[i][axis] - result[0][axis]) / d
				found = true
				break
			}
		}
	}
	if !found || scale <= 0 || math.IsNaN(scale) || math.IsInf(scale, 0) {
		return fmt.Errorf("Không được làm suy biến hoặc đảo chiều hình học.")
	}
	for i, p := range original {
		for axis := 0; axis < 2; axis++ {
			expected := result[0][axis] + (p[axis]-original[0][axis])*scale
			if math.Abs(result[i][axis]-expected) > 1e-10 {
				return fmt.Errorf("Chỉ hỗ trợ di chuyển và đổi tỷ lệ đồng đều của toàn bộ đối tượng.")
			}
		}
	}
	return nil
}

// A feature may own its edges yet share their endpoints through other edges.
// Require complete primitive records and exclude both kinds of shared links.
const exclusiveEdgesSQL = `WITH owner AS (
 SELECT attributes FROM enc.feature WHERE dataset_id=$1 AND cell_name=$2 AND object_class=$3 AND source_id=$4
), links AS (
 SELECT x.id, o.attributes->'NAME_RCNM'->>(x.n::integer-1) AS kind FROM owner o,
 jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.attributes->'NAME_RCID')='array' THEN o.attributes->'NAME_RCID' ELSE '[]'::jsonb END) WITH ORDINALITY x(id,n)
), edges AS (
 SELECT s.attributes FROM enc.spatial_record s JOIN links l ON s.attributes->>'RCID'=l.id AND l.kind='130'
 WHERE s.dataset_id=$1 AND s.cell_name=$2 AND s.record_type='Edge'
), nodes AS (
 SELECT attributes->>'NAME_RCID_0' AS id FROM edges UNION SELECT attributes->>'NAME_RCID_1' FROM edges
)
SELECT EXISTS(SELECT 1 FROM links) AND NOT EXISTS(SELECT 1 FROM links WHERE kind IS DISTINCT FROM '130')
 AND (SELECT count(DISTINCT id) FROM links)=(SELECT count(DISTINCT attributes->>'RCID') FROM edges)
 AND NOT EXISTS(SELECT 1 FROM nodes WHERE id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM edges WHERE attributes->>'NAME_RCNM_0' IS DISTINCT FROM '120' OR attributes->>'NAME_RCNM_1' IS DISTINCT FROM '120')
 AND NOT EXISTS(SELECT 1 FROM nodes n WHERE NOT EXISTS(SELECT 1 FROM enc.spatial_record s WHERE s.dataset_id=$1 AND s.cell_name=$2 AND s.record_type='ConnectedNode' AND s.attributes->>'RCID'=n.id))
 AND NOT EXISTS(SELECT 1 FROM enc.spatial_record s WHERE s.dataset_id=$1 AND s.cell_name=$2 AND s.record_type='Face')
 AND NOT EXISTS(SELECT 1 FROM enc.spatial_record s WHERE s.dataset_id=$1 AND s.cell_name=$2 AND s.record_type='Edge'
 AND NOT EXISTS(SELECT 1 FROM links l WHERE l.id=s.attributes->>'RCID')
 AND (s.attributes->>'NAME_RCID_0' IN(SELECT id FROM nodes) OR s.attributes->>'NAME_RCID_1' IN(SELECT id FROM nodes)))
 AND NOT EXISTS(SELECT 1 FROM enc.feature f WHERE f.dataset_id=$1 AND f.cell_name=$2
 AND (f.object_class,f.source_id)<>($3,$4) AND EXISTS(
 SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.attributes->'NAME_RCID')='array' THEN f.attributes->'NAME_RCID' ELSE '[]'::jsonb END) WITH ORDINALITY x(id,n)
 WHERE x.id IN(SELECT id FROM nodes) AND f.attributes->'NAME_RCNM'->>(x.n::integer-1)='120'))`
