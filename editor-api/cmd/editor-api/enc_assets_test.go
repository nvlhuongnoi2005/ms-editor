package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPresentationLibraryAssets(t *testing.T) {
	t.Setenv("EDITOR_ENC_ASSETS_ROOT", "")
	root := encAssetsRoot()
	if filepath.Base(filepath.Dir(root)) != "Presentation_Library" {
		t.Fatalf("unexpected canonical asset directory: %s", root)
	}
	handler := &app{encAssetsRoot: root}
	canonicalSQL, canonicalErr := os.ReadFile(filepath.Join(root, "..", "runtime", "tile.sql"))
	backendSQL, backendErr := os.ReadFile(filepath.Join(root, "..", "..", "editor-api", "internal", "enc", "tile.sql"))
	if canonicalErr != nil || backendErr != nil || !bytes.Equal(canonicalSQL, backendSQL) {
		t.Fatal("backend tile SQL differs from Presentation_Library; run verify.py --sync-sql after reviewing changes", canonicalErr, backendErr)
	}
	for _, theme := range []string{"day", "dusk", "night"} {
		for _, suffix := range []string{".json", "@2x.json", ".png", "@2x.png"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/enc/assets/sprites/"+theme+"_simplified"+suffix, nil))
			if response.Code != 200 {
				t.Fatalf("%s%s: HTTP %d", theme, suffix, response.Code)
			}
			if filepath.Ext(suffix) == ".json" {
				var atlas map[string]any
				if err := json.Unmarshal(response.Body.Bytes(), &atlas); err != nil || len(atlas) != 499 {
					t.Fatalf("invalid atlas: %v, images=%d", err, len(atlas))
				}
			} else if !bytes.HasPrefix(response.Body.Bytes(), []byte("\x89PNG\r\n\x1a\n")) {
				t.Fatal("invalid sprite PNG")
			}
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/enc/assets/fonts/Roboto%20Bold/0-255.pbf", nil))
	glyph, err := os.ReadFile(filepath.Join(root, "fonts", "Roboto Bold", "0-255.pbf"))
	if err != nil || response.Code != 200 || !bytes.Equal(glyph, response.Body.Bytes()) {
		t.Fatal("canonical glyph route failed", err, response.Code)
	}
	for _, path := range []string{"/enc/assets/sprites/manifest.json", "/enc/assets/sprites/../../documents/reference.pdf", "/enc/assets/fonts/../../manifest.json"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 404 {
			t.Fatalf("unexpected asset exposure: %s: %d", path, response.Code)
		}
	}
	t.Setenv("EDITOR_ENC_ASSETS_ROOT", t.TempDir())
	if encAssetsRoot() != os.Getenv("EDITOR_ENC_ASSETS_ROOT") {
		t.Fatal("asset override ignored")
	}
}
