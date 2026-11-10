package enc

import (
	"archive/zip"
	"testing"
)

func TestArchiveDirectoryValidation(t *testing.T) {
	for _, test := range []struct {
		name  string
		paths []string
		valid bool
	}{
		{"valid", []string{"ENC_ROOT/CATALOG.031", "ENC_ROOT/A/A.000", "ENC_ROOT/A/A.001", "ENC_ROOT/A/A.002"}, true},
		{"missing-base", []string{"A/A.001"}, false},
		{"update-gap", []string{"A/A.000", "A/A.002"}, false},
		{"duplicate-path", []string{"A/A.000", "a/a.000"}, false},
		{"duplicate-cell", []string{"A/A.000", "B/A.000"}, false},
		{"different-update-folder", []string{"A/A.000", "B/A.001"}, false},
		{"traversal", []string{"../A.000"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			entries := []*zip.File{}
			for _, path := range test.paths {
				entries = append(entries, &zip.File{FileHeader: zip.FileHeader{Name: path, Method: zip.Deflate}})
			}
			err := validateArchiveDirectory(entries)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v, error=%v", test.valid, err)
			}
		})
	}
	encrypted := &zip.File{FileHeader: zip.FileHeader{Name: "A.000", Flags: 1}}
	if validateArchiveDirectory([]*zip.File{encrypted}) == nil {
		t.Fatal("accepted encrypted ZIP")
	}
}
