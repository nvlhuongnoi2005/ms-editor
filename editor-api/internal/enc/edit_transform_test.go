package enc

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"testing"
)

func testExclusiveGeometry(t *testing.T, db *pgxpool.Pool, dataset string) {
	t.Helper()
	ctx := context.Background()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	h := &Handler{}
	for _, f := range []struct{ class, id, attrs, geometry string }{
		{"CBLOHD", "transform-line", `{"NAME_RCNM":[130],"NAME_RCID":[7001]}`, `{"type":"LineString","coordinates":[[105,21],[105.01,21.01]]}`},
		{"LNDARE", "transform-area", `{"NAME_RCNM":[130],"NAME_RCID":[7002]}`, `{"type":"Polygon","coordinates":[[[105,21],[105.01,21],[105.01,21.01],[105,21]]]}`},
	} {
		_, err = tx.Exec(ctx, `INSERT INTO enc.feature(dataset_id,cell_name,object_class,source_id,attributes,geometry_kind,geometry,source_geometry) VALUES($1,'TESTCELL',$2,$3,$4::jsonb,'test',ST_GeomFromGeoJSON($5),$5::jsonb)`, dataset, f.class, f.id, f.attrs, f.geometry)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, s := range []struct{ kind, id, attrs string }{
		{"Edge", "transform-edge1", `{"RCID":7001,"NAME_RCNM_0":120,"NAME_RCNM_1":120,"NAME_RCID_0":7101,"NAME_RCID_1":7102}`},
		{"Edge", "transform-edge2", `{"RCID":7002,"NAME_RCNM_0":120,"NAME_RCNM_1":120,"NAME_RCID_0":7201,"NAME_RCID_1":7201}`},
		{"ConnectedNode", "transform-node1", `{"RCID":7101}`}, {"ConnectedNode", "transform-node2", `{"RCID":7102}`}, {"ConnectedNode", "transform-node3", `{"RCID":7201}`},
	} {
		_, err = tx.Exec(ctx, `INSERT INTO enc.spatial_record(dataset_id,cell_name,record_type,source_id,attributes) VALUES($1,'TESTCELL',$2,$3,$4::jsonb)`, dataset, s.kind, s.id, s.attrs)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range []string{"CBLOHD/transform-line", "LNDARE/transform-area"} {
		f, err := h.readEditFeature(ctx, tx, dataset, "TESTCELL", key)
		if err != nil || !f.CanMove || f.CanDelete {
			t.Fatalf("exclusive geometry %s: %+v %v", key, f, err)
		}
	}
	// An unreferenced neighbouring edge still owns a shared endpoint: block move.
	_, err = tx.Exec(ctx, `INSERT INTO enc.spatial_record(dataset_id,cell_name,record_type,source_id,attributes) VALUES($1,'TESTCELL','Edge','foreign-edge','{"RCID":7999,"NAME_RCID_0":7102,"NAME_RCID_1":7999}')`, dataset)
	if err != nil {
		t.Fatal(err)
	}
	f, err := h.readEditFeature(ctx, tx, dataset, "TESTCELL", "CBLOHD/transform-line")
	if err != nil || f.CanMove {
		t.Fatalf("shared endpoint allowed: %+v %v", f, err)
	}
}
func TestGeometryTransformPreservesShape(t *testing.T) {
	before := editGeometry{Type: "Polygon", Coordinates: json.RawMessage(`[[[0,0,7],[1,0,7],[1,1,7],[0,0,7]],[[0.2,0.1,3],[0.4,0.1,3],[0.4,0.3,3],[0.2,0.1,3]]]`)}
	for _, c := range []struct {
		coords string
		valid  bool
	}{
		{string(before.Coordinates), true},
		{`[[[2,0,7],[3,0,7],[3,1,7],[2,0,7]],[[2.2,0.1,3],[2.4,0.1,3],[2.4,0.3,3],[2.2,0.1,3]]]`, true},
		{`[[[0,0,7],[2,0,7],[1,1,7],[0,0,7]],[[0.2,0.1,3],[0.4,0.1,3],[0.4,0.3,3],[0.2,0.1,3]]]`, false},
		{`[[[0,0,7],[1,0,7],[1,1,7],[0,0,7]]]`, false},
		{`[[[0,0,8],[1,0,7],[1,1,7],[0,0,8]],[[0.2,0.1,3],[0.4,0.1,3],[0.4,0.3,3],[0.2,0.1,3]]]`, false},
	} {
		after := editGeometry{Type: "Polygon", Coordinates: json.RawMessage(c.coords)}
		if err := validateGeometryTransform(after, before); (err == nil) != c.valid {
			t.Fatalf("valid=%v: %v", c.valid, err)
		}
	}
}
func TestSymbolScaleValidation(t *testing.T) {
	base := editFeature{Key: "BOYLAT/one", ObjectClass: "BOYLAT", SourceID: "one", Geometry: editGeometry{Type: "Point", Coordinates: json.RawMessage(`[105,21]`)}, Attributes: map[string]any{}}
	for _, scale := range []float64{.5, 1, 4} {
		after := base
		after.SymbolScale = scale
		if err := validateEditFeature(&after, &base); err != nil {
			t.Fatal(err)
		}
	}
	for _, scale := range []float64{-.1, .49, 4.01} {
		after := base
		after.SymbolScale = scale
		if validateEditFeature(&after, &base) == nil {
			t.Fatalf("invalid scale accepted: %v", scale)
		}
	}
}
