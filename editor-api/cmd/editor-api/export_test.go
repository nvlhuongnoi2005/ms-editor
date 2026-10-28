package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestWriteChangesetOSCStreamsEachOperation(t *testing.T) {
	lat, lon := int64(106000000), int64(105000000)
	entities := map[string][]exportEntity{
		"create": {
			{Type: "node", ID: 10, Version: 1, Visible: true, LatE7: &lat, LonE7: &lon},
			{Type: "way", ID: 20, Version: 1, Visible: true, NodeRefs: []int64{10}},
		},
		"modify": {
			{Type: "relation", ID: 30, Version: 2, Visible: true, Tags: map[string]string{"type": "route"}},
		},
		"delete": {
			{Type: "relation", ID: 40, Version: 3, Visible: false},
			{Type: "way", ID: 50, Version: 3, Visible: false, NodeRefs: []int64{10}},
			{Type: "node", ID: 60, Version: 3, Visible: false, LatE7: &lat, LonE7: &lon},
		},
	}
	var called []string
	stream := func(_ context.Context, changesetID int64, operation string, visit func(exportEntity) error) error {
		if changesetID != 42 {
			t.Fatalf("changesetID = %d, want 42", changesetID)
		}
		called = append(called, operation)
		for _, entity := range entities[operation] {
			if err := visit(entity); err != nil {
				return err
			}
		}
		return nil
	}

	var output bytes.Buffer
	if err := writeChangesetOSC(context.Background(), 42, &output, stream); err != nil {
		t.Fatalf("writeChangesetOSC() error = %v", err)
	}
	if got, want := strings.Join(called, ","), "create,modify,delete"; got != want {
		t.Fatalf("stream calls = %q, want %q", got, want)
	}

	xml := output.String()
	for _, fragment := range []string{
		"<osmChange version=\"0.6\" generator=\"Vietnam OSM Editor\">",
		"<create>",
		"<modify>",
		"<delete>",
		"<node id=\"10\"",
		"<way id=\"20\"",
		"<relation id=\"30\"",
		"<relation id=\"40\" version=\"3\" visible=\"false\"></relation>",
		"<way id=\"50\" version=\"3\" visible=\"false\">",
		"<node id=\"60\" version=\"3\" visible=\"false\"",
	} {
		if !strings.Contains(xml, fragment) {
			t.Errorf("OSC output does not contain %q:\n%s", fragment, xml)
		}
	}
	if !inOrder(xml,
		"<create>", "<node id=\"10\"", "<way id=\"20\"", "</create>",
		"<modify>", "<relation id=\"30\"", "</modify>",
		"<delete>", "<relation id=\"40\"", "<way id=\"50\"", "<node id=\"60\"", "</delete>",
	) {
		t.Errorf("OSC groups or entities are not ordered correctly:\n%s", xml)
	}
}

func TestWriteChangesetOSCPropagatesStreamError(t *testing.T) {
	want := errors.New("database stream failed")
	err := writeChangesetOSC(context.Background(), 42, &bytes.Buffer{}, func(context.Context, int64, string, func(exportEntity) error) error {
		return want
	})
	if !errors.Is(err, want) {
		t.Fatalf("writeChangesetOSC() error = %v, want %v", err, want)
	}
}

func inOrder(value string, fragments ...string) bool {
	position := 0
	for _, fragment := range fragments {
		next := strings.Index(value[position:], fragment)
		if next < 0 {
			return false
		}
		position += next + len(fragment)
	}
	return true
}
