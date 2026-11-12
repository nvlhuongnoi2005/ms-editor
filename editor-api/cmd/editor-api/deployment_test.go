package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPackagedBasemapsShareApplicationOrigin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "%s %s", r.Host, r.URL.RequestURI())
	}))
	defer upstream.Close()
	t.Setenv("ENC_BASEMAP_TILE_SERVER_URL", upstream.URL)
	t.Setenv("ENC_BASEMAP_ENABLED", "true")
	for _, tc := range []struct{ request, upstream string }{
		{"/datas/satellite2.json", "/datas/satellite2.json"},
		{"/datas/satellite2/3/4/5.jpg?test=1", "/datas/satellite2/3/4/5.jpg?test=1"},
		{"/enc/basemap/3/4/5.pbf", "/datas/world-baselayer/3/4/5.pbf"},
	} {
		t.Run(tc.request, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:4187"+tc.request, nil)
			response := httptest.NewRecorder()
			(&app{}).ServeHTTP(response, request)
			if response.Code != http.StatusOK || response.Body.String() != "127.0.0.1:4187 "+tc.upstream {
				t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
			}
		})
	}
}

func TestSystemOnlyInstallHasOptionalEncBasemap(t *testing.T) {
	t.Setenv("ENC_BASEMAP_ENABLED", "false")
	t.Setenv("ENC_BASEMAP_TILE_SERVER_URL", "http://unavailable.invalid")
	response := httptest.NewRecorder()
	(&app{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/enc/basemap/0/0/0.pbf", nil))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}
