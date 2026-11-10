package enc

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

func TestUploadRejectsInvalidArchivesBeforeEnqueue(t *testing.T) {
	for _, test := range []struct {
		name    string
		entries []string
	}{
		{"no-base", []string{"ENC_ROOT/CATALOG.031"}},
		{"traversal", []string{"../cell.000"}},
		{"windows-drive", []string{"C:/cell.000"}},
		{"wrong-base-content", []string{"ENC_ROOT/US5TEST1.000"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var archive bytes.Buffer
			writer := zip.NewWriter(&archive)
			for _, entry := range test.entries {
				file, err := writer.Create(entry)
				if err != nil {
					t.Fatal(err)
				}
				_, _ = file.Write([]byte("not ISO 8211"))
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			file, err := form.CreateFormFile("file", "charts.zip")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = file.Write(archive.Bytes())
			_ = form.Close()
			request := httptest.NewRequest("POST", "/api/enc/imports?dataset=test", &body)
			request.Header.Set("Content-Type", form.FormDataContentType())
			response := httptest.NewRecorder()
			handler := Handler{UploadDir: t.TempDir()}
			if err := handler.upload(response, request); err != nil {
				t.Fatal(err)
			}
			if response.Code != 400 {
				t.Fatalf("status %d, expected 400: %s", response.Code, response.Body.String())
			}
		})
	}
}
