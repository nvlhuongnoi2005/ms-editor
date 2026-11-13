package enc

import (
	"encoding/json"
	"testing"
)

func TestEditingAttributeSchemaValidation(t *testing.T) {
	for _, test := range []struct {
		class, attrs string
		valid        bool
	}{
		{"OBSTRN", `{"VALSOU":-1.25}`, true}, {"OBSTRN", `{"DEPTH":5}`, false},
		{"BOYLAT", `{"VALSOU":5}`, false}, {"BOYLAT", `{"COLOUR":[3,4],"BOYSHP":1}`, true},
		{"BOYLAT", `{"COLOUR":[999]}`, false}, {"BOYLAT", `{"COLOUR":[2,6,2]}`, true},
		{"BOYLAT", `{"COLOUR":"3"}`, false}, {"BOYLAT", `{"BOYSHP":1.5}`, false},
		{"LIGHTS", `{"SECTR1":359.5,"SECTR2":0,"COLOUR":[3],"CATLIT":[8]}`, true},
		{"LIGHTS", `{"SECTR1":361}`, false}, {"LNDMRK", `{"SCAMIN":1.2}`, false},
		{"LNDMRK", `{"RCID":1}`, false}, {"LNDMRK", `{"CATLMK":[17],"HEIGHT":23.5}`, true},
	} {
		var attributes map[string]any
		if err := json.Unmarshal([]byte(test.attrs), &attributes); err != nil {
			t.Fatal(err)
		}
		feature := editFeature{ObjectClass: test.class, SourceID: "new:90000000-0000-4000-8000-000000000009", Attributes: attributes, Geometry: editGeometry{Type: "Point", Coordinates: json.RawMessage(`[105,21]`)}}
		feature.Key = feature.ObjectClass + "/" + feature.SourceID
		if err := validateEditFeature(&feature, nil); (err == nil) != test.valid {
			t.Errorf("%s %s: expected valid=%v, got %v", test.class, test.attrs, test.valid, err)
		}
	}
	for _, class := range pointClasses {
		def, exists := editingDictionary.Classes[class]
		if !exists || len(def.Attributes) == 0 {
			t.Fatalf("missing schema for %s", class)
		}
	}
}
