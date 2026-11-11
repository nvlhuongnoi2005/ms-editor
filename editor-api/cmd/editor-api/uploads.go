package main

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
)

// detectUpload peeks into the multipart file content and replays every consumed
// byte to the domain handler. Nationwide PBF uploads remain streamed to disk.
func detectUpload(r *http.Request) (string, error) {
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "multipart/form-data" || params["boundary"] == "" {
		return "", fail(400, "Expected multipart upload.")
	}
	original := r.Body
	var prefix bytes.Buffer
	reader := multipart.NewReader(io.TeeReader(io.LimitReader(original, 128<<10), &prefix), params["boundary"])
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" {
		return "", fail(400, "Expected the file field first.")
	}
	var signature [4]byte
	if _, err := io.ReadFull(part, signature[:]); err != nil {
		return "", fail(400, "Uploaded file is truncated.")
	}
	domain := "osm"
	if bytes.Equal(signature[:], []byte{'P', 'K', 3, 4}) {
		domain = "enc"
	} else if strings.EqualFold(filepath.Ext(part.FileName()), ".000") {
		// A standalone S-57 cell has an ISO 8211 leader, not a ZIP signature.
		// Replay the peeked bytes below so the ENC handler receives the full file.
		var leader [24]byte
		copy(leader[:], signature[:])
		if _, err := io.ReadFull(part, leader[len(signature):]); err != nil || leader[6] != 'L' {
			return "", fail(400, "Base cell is not an ISO 8211 S-57 file.")
		}
		domain = "enc"
	} else if err := validatePBFHeader(io.MultiReader(bytes.NewReader(signature[:]), part)); err != nil {
		return "", fail(400, "Upload an OSM snapshot PBF, S-57 ENC ZIP, or S-57 .000 base cell.")
	}
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(prefix.Bytes()), original), original}
	return domain, nil
}

func (a *app) serveUpload(w http.ResponseWriter, r *http.Request) error {
	if err := authorizeImport(r); err != nil {
		return err
	}
	domain, err := detectUpload(r)
	if err != nil {
		return err
	}
	if domain == "osm" {
		return a.createImport(r.Context(), w, r)
	}
	if a.encHandler == nil {
		return fail(503, "ENC API is not configured.")
	}
	forwarded := r.Clone(r.Context())
	forwarded.URL.Path = "/api/enc/imports"
	a.encHandler.ServeHTTP(w, forwarded)
	return nil
}
