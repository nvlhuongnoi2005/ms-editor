package main

import (
	"bytes"
	"encoding/binary"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func pbfHeaderForTest() []byte {
	header := append([]byte{10, 9}, []byte("OSMHeader")...)
	header = append(header, 24, 10)
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(header)))
	return append(size[:], header...)
}

func TestPBFHeaderValidation(t *testing.T) {
	valid := pbfHeaderForTest()
	if err := validatePBFHeader(bytes.NewReader(valid)); err != nil {
		t.Fatal(err)
	}
	for _, body := range [][]byte{nil, []byte("not a pbf"), {0, 0, 0, 0}, {255, 255, 255, 255}, valid[:len(valid)-1], {0, 0, 0, 1, 255}, {0, 0, 0, 2, 10, 255}} {
		if err := validatePBFHeader(bytes.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid header %v", body)
		}
	}
}

func TestImportAuthorization(t *testing.T) {
	t.Setenv("EDITOR_IMPORT_TOKEN", "test-import-token")
	request := httptest.NewRequest("POST", "http://localhost:4173/api/imports", nil)
	request.Header.Set("X-Editor-Import", "1")
	if err := authorizeImport(request); err == nil {
		t.Fatal("accepted missing token")
	}
	request.Header.Set("X-Import-Token", "test-import-token")
	if err := authorizeImport(request); err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "https://untrusted.invalid")
	if err := authorizeImport(request); err == nil {
		t.Fatal("accepted cross-origin upload")
	}
	request.Header.Set("Origin", "http://localhost:4173")
	if err := authorizeImport(request); err != nil {
		t.Fatal(err)
	}
	request.Header.Del("X-Editor-Import")
	if err := authorizeImport(request); err == nil {
		t.Fatal("accepted a simple form upload without custom header")
	}
}

func TestImportLocalOnlyWithoutToken(t *testing.T) {
	t.Setenv("EDITOR_IMPORT_TOKEN", "")
	// Getenv can also use the local .env; an explicit isolated cwd avoids that.
	t.Chdir(t.TempDir())
	request := httptest.NewRequest("GET", "http://localhost/api/imports", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	if err := authorizeImport(request); err != nil {
		t.Fatal(err)
	}
	request.Host = "rebound.invalid"
	if err := authorizeImport(request); err == nil {
		t.Fatal("accepted a non-local Host in tokenless mode")
	}
	request.Host = "localhost"
	request.RemoteAddr = "192.0.2.5:1234"
	request.Header.Set("X-Forwarded-For", "127.0.0.1")
	if err := authorizeImport(request); err == nil {
		t.Fatal("trusted a forwarded client address")
	}
}

func TestImportRejectsInvalidFilesBeforeDatabase(t *testing.T) {
	t.Setenv("EDITOR_IMPORT_TOKEN", "test-token")
	t.Setenv("EDITOR_IMPORT_DIR", t.TempDir())
	t.Setenv("EDITOR_IMPORT_MAX_BYTES", "1024")
	for _, test := range []struct {
		name, filename string
		data           []byte
		expected       int
	}{
		{"valid-name", "bad.txt", pbfHeaderForTest(), 400},
		{"valid-name", "bad.osm.pbf", []byte("invalid"), 400},
		{"valid-name", "history.osh.pbf", pbfHeaderForTest(), 400},
		{"bad_name", "a.osm.pbf", pbfHeaderForTest(), 400},
		{"valid-name", "big.osm.pbf", bytes.Repeat([]byte{1}, 1025), 413},
	} {
		t.Run(test.filename+test.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file", test.filename)
			if err != nil {
				t.Fatal(err)
			}
			part.Write(test.data)
			writer.Close()
			request := httptest.NewRequest("POST", "http://localhost/api/imports?dataset="+test.name, &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			request.Header.Set("X-Editor-Import", "1")
			request.Header.Set("X-Import-Token", "test-token")
			response := httptest.NewRecorder()
			(&app{}).ServeHTTP(response, request)
			if response.Code != test.expected {
				t.Fatalf("status=%d: %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestRenderSchemaIsolation(t *testing.T) {
	query := renderMVTQuery("import_1234")
	if strings.Contains(query, "FROM render.") || !strings.Contains(query, `FROM "import_1234".planet_osm_line`) || !strings.Contains(query, `FROM "import_1234".planet_osm_point`) {
		t.Fatal("MVT did not isolate both output tables")
	}
	quoted := renderMVTQuery(`bad";DROP SCHEMA render;--`)
	if !strings.Contains(quoted, `"bad"";DROP SCHEMA render;--".planet_osm_line`) {
		t.Fatal("schema identifier was not escaped")
	}
}

func FuzzPBFHeader(f *testing.F) {
	f.Add(pbfHeaderForTest())
	f.Add([]byte{0, 0, 0, 1, 255})
	f.Fuzz(func(t *testing.T, data []byte) { _ = validatePBFHeader(bytes.NewReader(data)) })
}

// Preparing checks the actual PostgreSQL UPDATE/RETURNING query without
// claiming any of the developer's pending publish events.
func TestRenderClaimPrepareIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	connection, err := db.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Release()
	statement, err := connection.Conn().Prepare(ctx, "test_render_claim", claimRenderEventSQL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Conn().Deallocate(ctx, "test_render_claim")
	if len(statement.Fields) != 7 {
		t.Fatalf("unexpected claim result fields: %d", len(statement.Fields))
	}
}

func TestImportListsReadIntegration(t *testing.T) {
	ctx, db := integrationDB(t)
	t.Setenv("EDITOR_IMPORT_TOKEN", "test-token")
	for _, path := range []string{"/api/datasets", "/api/imports"} {
		request := httptest.NewRequest("GET", path, nil).WithContext(ctx)
		request.Header.Set("X-Import-Token", "test-token")
		response := httptest.NewRecorder()
		(&app{db: db}).ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("%s: status=%d: %s", path, response.Code, response.Body.String())
		}
	}
}
