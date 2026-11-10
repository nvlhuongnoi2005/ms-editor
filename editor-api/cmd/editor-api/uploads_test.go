package main

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

func TestUploadDetectionReplaysBody(t *testing.T) {
	// Valid protobuf BlobHeader: type=OSMHeader and nonzero datasize.
	header := append([]byte{10, 9}, []byte("OSMHeader")...)
	header = append(header, 24, 1)
	pbf := append([]byte{0, 0, 0, byte(len(header))}, header...)
	for _, test := range []struct {
		domain  string
		content []byte
	}{{"enc", []byte{'P', 'K', 3, 4, 0, 1, 2}}, {"osm", pbf}} {
		t.Run(test.domain, func(t *testing.T) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			part, err := form.CreateFormFile("file", "extension-is-not-used-for-detection")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = part.Write(test.content)
			_ = form.Close()
			before := append([]byte(nil), body.Bytes()...)
			request := httptest.NewRequest("POST", "/api/uploads", &body)
			request.Header.Set("Content-Type", form.FormDataContentType())
			domain, err := detectUpload(request)
			if err != nil {
				t.Fatal(err)
			}
			if domain != test.domain {
				t.Fatalf("detected %s", domain)
			}
			after, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("multipart bytes were not replayed exactly")
			}
		})
	}
}
