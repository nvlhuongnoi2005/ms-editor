package enc

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

type attributeOption struct {
	Value int    `json:"value"`
	Label string `json:"label"`
}
type editingClassDefinition struct {
	Label      string   `json:"label"`
	Attributes []string `json:"attributes"`
	Primitives []string `json:"primitives"`
}

//go:embed editing_schema.generated.json
var editingDictionaryJSON []byte
var editingDictionary = func() struct {
	Attributes map[string]editableAttribute      `json:"attributes"`
	Classes    map[string]editingClassDefinition `json:"classes"`
} {
	var schema struct {
		Attributes map[string]editableAttribute      `json:"attributes"`
		Classes    map[string]editingClassDefinition `json:"classes"`
	}
	if err := json.Unmarshal(editingDictionaryJSON, &schema); err != nil {
		panic(err)
	}
	return schema
}()

func attributesForClass(class string) []editableAttribute {
	definitions := []editableAttribute{}
	for _, key := range editingDictionary.Classes[class].Attributes {
		definitions = append(definitions, editingDictionary.Attributes[key])
	}
	return definitions
}
func editingClassAttributes() map[string][]string {
	result := map[string][]string{}
	for class, definition := range editingDictionary.Classes {
		result[class] = definition.Attributes
	}
	return result
}
func editingClassLabels() map[string]string {
	result := map[string]string{}
	for class, definition := range editingDictionary.Classes {
		result[class] = definition.Label
	}
	return result
}
func validateAttributeValue(def editableAttribute, value any) error {
	invalid := func() error {
		return fmt.Errorf("Giá trị %s không đúng kiểu hoặc ngoài miền giá trị schema S-57.", def.Key)
	}
	member := func(value any) bool {
		n, ok := value.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) {
			return false
		}
		for _, option := range def.Options {
			if float64(option.Value) == n {
				return true
			}
		}
		return false
	}
	switch def.Kind {
	case "text":
		text, ok := value.(string)
		if !ok || len(text) > 4096 {
			return invalid()
		}
	case "enum":
		if !member(value) {
			return invalid()
		}
	case "list":
		list, ok := value.([]any)
		if !ok || len(list) == 0 || len(list) > 256 {
			return invalid()
		}
		for _, item := range list {
			if !member(item) {
				return invalid()
			}
		}
	default:
		n, ok := value.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > 1e10 {
			return invalid()
		}
		if def.Kind == "integer" && (n < 0 || n != math.Trunc(n)) {
			return invalid()
		}
		if (def.Key == "SCAMIN" || def.Key == "SCAMAX") && (n < 0 || n != math.Trunc(n)) {
			return invalid()
		}
		if def.Key == "ORIENT" && (n < 0 || n >= 360) {
			return invalid()
		}
		if (def.Key == "SECTR1" || def.Key == "SECTR2") && (n < 0 || n > 360) {
			return invalid()
		}
	}
	return nil
}
