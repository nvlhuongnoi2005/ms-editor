package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func serveEditorAPI(handler http.Handler) error {
	if address := os.Getenv("EDITOR_API_ADDR"); address != "" {
		server := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
		log.Printf("Map Service Editor (Go): http://%s", server.Addr)
		return server.ListenAndServe()
	}

	// Browsers on Windows may resolve localhost to ::1 before 127.0.0.1.
	// Serve both loopback families so localhost and 127.0.0.1 reach the same API.
	ipv4, err := net.Listen("tcp4", "127.0.0.1:4173")
	if err != nil {
		return fmt.Errorf("listen on IPv4 loopback: %w", err)
	}
	ipv6, err := net.Listen("tcp6", "[::1]:4173")
	if err != nil {
		_ = ipv4.Close()
		return fmt.Errorf("listen on IPv6 loopback: %w", err)
	}

	log.Printf("Map Service Editor (Go): http://localhost:4173")
	errorsCh := make(chan error, 2)
	serve := func(listener net.Listener) {
		server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
		errorsCh <- server.Serve(listener)
	}
	go serve(ipv4)
	go serve(ipv6)
	return <-errorsCh
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var err error
	switch {
	case strings.HasPrefix(r.URL.Path, "/enc/basemap/") || strings.HasPrefix(r.URL.Path, "/datas/"):
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			err = fail(405, "Method not allowed.")
			break
		}
		// System-only installations have no optional world MBTiles. An empty
		// vector tile lets ENC cells render without retrying a missing basemap.
		if strings.HasPrefix(r.URL.Path, "/enc/basemap/") && os.Getenv("ENC_BASEMAP_ENABLED") == "false" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		target, parseErr := url.Parse(getenv("ENC_BASEMAP_TILE_SERVER_URL", "http://127.0.0.1:8081"))
		if parseErr != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
			err = fail(503, "ENC basemap tile server is not configured.")
			break
		}
		if strings.HasPrefix(r.URL.Path, "/enc/basemap/") {
			r.URL.Path = "/datas/world-baselayer/" + strings.TrimPrefix(r.URL.Path, "/enc/basemap/")
		}
		r.URL.RawPath = ""
		proxy := httputil.NewSingleHostReverseProxy(target)
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "ENC basemap tile server is unavailable.", http.StatusBadGateway)
		}
		proxy.ServeHTTP(w, r)
		return
	case r.URL.Path == "/api/uploads" && r.Method == http.MethodPost:
		err = a.serveUpload(w, r)
	case strings.HasPrefix(r.URL.Path, "/enc/assets/fonts/"):
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			err = fail(405, "Method not allowed.")
			break
		}
		name := strings.TrimPrefix(r.URL.Path, "/enc/assets/fonts/")
		if name != "Roboto Bold/0-255.pbf" && name != "Roboto Bold/256-511.pbf" {
			err = fail(404, "ENC glyph range is not installed.")
			break
		}
		w.Header().Set("Content-Type", "application/x-protobuf")
		http.ServeFile(w, r, filepath.Join(a.encAssetsRoot, "fonts", filepath.FromSlash(name)))
		return
	case strings.HasPrefix(r.URL.Path, "/api/enc/"):
		if r.Method == http.MethodPost || r.Method == http.MethodDelete {
			if err = authorizeImport(r); err != nil {
				break
			}
		}
		if a.encHandler == nil {
			err = fail(503, "ENC API is not configured.")
			break
		}
		a.encHandler.ServeHTTP(w, r)
		return
	case strings.HasPrefix(r.URL.Path, "/enc/assets/sprites/"):
		err = a.serveENCSprite(w, r)
	case strings.HasPrefix(r.URL.Path, "/enc/demo/style/") && r.Method == http.MethodGet:
		err = a.serveENCDemoStyle(r.Context(), w, r)
	case r.URL.Path == "/healthz" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "editor-api", "runtime": "go"})
		return
	case r.URL.Path == "/api/graph" && r.Method == http.MethodGet:
		err = a.serveGraph(r.Context(), w, r)
	case r.URL.Path == "/api/datasets" && r.Method == http.MethodGet:
		err = a.serveDatasets(r.Context(), w, r)
	case r.URL.Path == "/api/imports" || strings.HasPrefix(r.URL.Path, "/api/imports/"):
		err = a.serveImports(r.Context(), w, r)
	case r.URL.Path == "/api/entities/snapshots" && r.Method == http.MethodPost:
		err = a.serveEntitySnapshots(r.Context(), w, r)
	case r.URL.Path == "/api/changesets/recent" && r.Method == http.MethodGet:
		err = a.serveRecentChangesets(r.Context(), w, r)
	case r.URL.Path == "/api/topology/way-parents" && r.Method == http.MethodGet:
		err = a.serveWayParents(r.Context(), w, r)
	case r.URL.Path == "/api/publish-status" && r.Method == http.MethodGet:
		err = a.servePublishStatus(r.Context(), w, r)
	case strings.HasPrefix(r.URL.Path, "/api/mvt/") && r.Method == http.MethodGet:
		err = a.serveMVT(r.Context(), w, r)
	case r.URL.Path == "/api/exports" || strings.HasPrefix(r.URL.Path, "/api/exports/"):
		err = a.serveExports(r.Context(), w, r)
	case r.URL.Path == "/api/export/osm":
		err = fail(410, "Viewport export was removed. Use the full dataset PBF export.")
	case r.URL.Path == "/api/export/osc" && r.Method == http.MethodGet:
		err = a.exportLatestOSC(r.Context(), w, r)
	case strings.HasPrefix(r.URL.Path, "/api/0.6/"):
		err = a.serveChangeset(r.Context(), w, r)
	default:
		a.serveStatic(w, r)
		return
	}
	if err == nil {
		return
	}
	if errors.Is(err, context.Canceled) {
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "The request timed out. Please retry."})
		return
	}
	var apiErr *apiError
	var conflictErr *versionConflictError
	if errors.As(err, &conflictErr) {
		writeJSON(w, http.StatusConflict, map[string]any{"error": conflictErr.Error(), "code": "version_conflict", "conflicts": conflictErr.Conflicts})
		return
	}
	if errors.As(err, &apiErr) {
		if apiErr.status == 503 {
			w.Header().Set("Retry-After", "2")
		}
		writeJSON(w, apiErr.status, map[string]string{"error": apiErr.message})
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	writeJSON(w, 500, map[string]string{"error": "Internal server error."})
}

// serveENCSprite exposes only the checked-in presentation assets.  The same
// high-density atlas is returned for a 1x request because its index explicitly
// declares pixelRatio: 2; MapLibre scales it correctly while we keep one source
// asset per theme.
func (a *app) serveENCSprite(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return fail(404, "ENC sprite route was not found.")
	}
	name := strings.TrimPrefix(r.URL.Path, "/enc/assets/sprites/")
	allowed := map[string]string{
		"day_simplified.json":      "day_simplified@2x.json",
		"day_simplified.png":       "day_simplified@2x.png",
		"day_simplified@2x.json":   "day_simplified@2x.json",
		"day_simplified@2x.png":    "day_simplified@2x.png",
		"dusk_simplified.json":     "dusk_simplified@2x.json",
		"dusk_simplified.png":      "dusk_simplified@2x.png",
		"dusk_simplified@2x.json":  "dusk_simplified@2x.json",
		"dusk_simplified@2x.png":   "dusk_simplified@2x.png",
		"night_simplified.json":    "night_simplified@2x.json",
		"night_simplified.png":     "night_simplified@2x.png",
		"night_simplified@2x.json": "night_simplified@2x.json",
		"night_simplified@2x.png":  "night_simplified@2x.png",
	}
	fileName, ok := allowed[name]
	if !ok {
		return fail(404, "ENC sprite was not found.")
	}
	path := filepath.Join(a.encAssetsRoot, "sprites", fileName)
	if _, err := os.Stat(path); err != nil {
		return fail(404, "ENC sprite assets are not installed.")
	}
	if strings.HasSuffix(fileName, ".json") {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "image/png")
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, path)
	return nil
}

// The preview deliberately uses OpenENC only as a visual fixture.  It proves
// the MapLibre/S-52-like presentation contract before a local ENC has passed
// the GDAL import pipeline.  Published local ENC styles will replace this route.
func (a *app) serveENCDemoStyle(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	profile := strings.TrimPrefix(r.URL.Path, "/enc/demo/style/")
	if profile != "day" && profile != "dusk" && profile != "night" {
		return fail(404, "ENC preview profile was not found.")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openenc.com/v1/style/meters/"+profile, nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fail(502, "ENC preview style is temporarily unavailable.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fail(502, "ENC preview style is temporarily unavailable.")
	}
	var style map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 5<<20)).Decode(&style); err != nil {
		return fail(502, "ENC preview returned an invalid style.")
	}
	style["sprite"] = "/enc/assets/sprites/" + profile + "_simplified"
	writeJSON(w, http.StatusOK, style)
	return nil
}

func (a *app) serveGraph(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	part := r.URL.Query().Get("part")
	if part != "" && part != "all" && part != "geometry" && part != "relations" {
		return fail(400, "Graph part must be all, geometry or relations.")
	}
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		dataset = "vietnam-260901"
	}
	// Bound graph requests independently of whole-dataset exports.
	bbox, ok := parseBboxWithMaxSpan(r.URL.Query().Get("bbox"), 2)
	if !ok || !validDataset(dataset) {
		return fail(400, "A valid, compact bbox and dataset are required.")
	}
	limit := boundedInt(r.URL.Query().Get("limit"), 260, 1, 1200)
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var datasetID string
	var revision int64
	err = tx.QueryRow(ctx, "SELECT id, canonical_revision FROM editor.dataset WHERE name = $1 AND state = 'ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&datasetID, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "The requested canonical dataset is not ready.")
	}
	if err != nil {
		return err
	}
	features := []any{}
	if part != "relations" {
		ways, err := graphWays(ctx, tx, datasetID, bbox, limit)
		if err != nil {
			return err
		}
		points, err := graphPoints(ctx, tx, datasetID, bbox, min(limit, 300))
		if err != nil {
			return err
		}
		features = append(ways, points...)
	}
	if part != "geometry" {
		relations, err := graphRelations(ctx, tx, datasetID, bbox, min(limit, 300))
		if err != nil {
			return err
		}
		features = append(features, relations...)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Add("Vary", "Accept-Encoding")
	var output io.Writer = w
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		w.Header().Set("Content-Encoding", "gzip")
		compressed, _ := gzip.NewWriterLevel(w, gzip.BestSpeed)
		defer compressed.Close()
		output = compressed
	}
	return json.NewEncoder(output).Encode(map[string]any{"type": "FeatureCollection", "dataset": dataset, "canonicalRevision": revision, "features": features})
}

func (a *app) servePublishStatus(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		dataset = "vietnam-260901"
	}
	if !validDataset(dataset) {
		return fail(400, "A valid dataset is required.")
	}
	data, err := a.cachedRead(ctx, "publish:"+dataset, 2*time.Second, func(ctx context.Context) ([]byte, error) {
		var canonicalRevision, renderRevision int64
		var waiting, rendering, failed int
		var lastError *string
		// Filter at the join so the pending partial index can serve this query.
		// Historical published events never participate in aggregation.
		err := a.db.QueryRow(ctx, `SELECT dataset.canonical_revision,dataset.render_revision,
   COUNT(event.id) FILTER (WHERE event.processing_at IS NULL)::int,
   COUNT(event.id) FILTER (WHERE event.processing_at IS NOT NULL)::int,
   COUNT(event.id) FILTER (WHERE event.last_error IS NOT NULL)::int,
   (ARRAY_AGG(event.last_error ORDER BY event.id DESC) FILTER (WHERE event.last_error IS NOT NULL))[1]
   FROM editor.dataset dataset LEFT JOIN editor.outbox_event event
    ON event.dataset_id=dataset.id AND event.published_at IS NULL
   WHERE dataset.id=(SELECT id FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1)
   GROUP BY dataset.id`, dataset).Scan(&canonicalRevision, &renderRevision, &waiting, &rendering, &failed, &lastError)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fail(404, "Dataset was not found or is not ready.")
		}
		if err != nil {
			return nil, err
		}
		status := "published"
		if failed > 0 {
			status = "failed"
		} else if rendering > 0 {
			status = "rendering"
		} else if waiting > 0 || renderRevision < canonicalRevision {
			status = "pending"
		}
		return json.Marshal(map[string]any{"dataset": dataset, "status": status, "canonicalRevision": canonicalRevision,
			"renderRevision": renderRevision, "pendingEvents": waiting + rendering, "lastError": lastError})
	})
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, err = w.Write(data)
	return err
}

func (a *app) serveMVT(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		dataset = "vietnam-260901"
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/mvt/"), ".pbf"), "/")
	if len(parts) != 3 || !validDataset(dataset) {
		return fail(400, "A valid dataset and z/x/y MVT path are required.")
	}
	z, err := strconv.Atoi(parts[0])
	if err != nil || z < 0 || z > 22 {
		return fail(400, "MVT zoom must be between 0 and 22.")
	}
	x, err := strconv.Atoi(parts[1])
	if err != nil || x < 0 || x >= 1<<z {
		return fail(400, "MVT x is outside the zoom range.")
	}
	y, err := strconv.Atoi(parts[2])
	if err != nil || y < 0 || y >= 1<<z {
		return fail(400, "MVT y is outside the zoom range.")
	}
	metaBytes, err := a.cachedRead(ctx, "tile-meta:"+dataset, time.Second, func(ctx context.Context) ([]byte, error) {
		var meta struct {
			ID, Schema string
			Revision   int64
		}
		err := a.db.QueryRow(ctx, "SELECT id::text,render_revision,render_schema FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&meta.ID, &meta.Revision, &meta.Schema)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fail(409, "The requested canonical dataset is not ready.")
		}
		if err != nil {
			return nil, err
		}
		return json.Marshal(meta)
	})
	if err != nil {
		return err
	}
	var meta struct {
		ID, Schema string
		Revision   int64
	}
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		return err
	}
	etag := fmt.Sprintf("\"%s-r%d-%d-%d-%d\"", meta.ID, meta.Revision, z, x, y)
	w.Header().Set("Cache-Control", "public, max-age=30, must-revalidate")
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	key := fmt.Sprintf("mvt:%s:%s:%d:%d:%d:%d", meta.ID, meta.Schema, meta.Revision, z, x, y)
	tile, err := a.cachedRead(ctx, key, 30*time.Second, func(ctx context.Context) ([]byte, error) {
		var data []byte
		err := a.renderDB.QueryRow(ctx, renderMVTQuery(meta.Schema), z, x, y).Scan(&data)
		return data, err
	})
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	w.Header().Set("Cache-Control", "public, max-age=30, must-revalidate")
	w.Header().Set("ETag", etag)
	_, err = w.Write(tile)
	return err
}

func renderMVTQuery(schema string) string {
	return strings.ReplaceAll(renderMVTSQL, "render.", pgx.Identifier{schema}.Sanitize()+".")
}

const renderMVTSQL = `WITH tile AS (SELECT ST_TileEnvelope($1,$2,$3) AS geom_3857),
ways AS (
 SELECT line.osm_id::text AS entity_id, 'way' AS entity_type, COALESCE(line.tags->'name','') AS name,
   CASE
     WHEN line.tags ? 'waterway' OR line.tags->'natural' IN ('water','wetland') THEN '#1687c5'
     WHEN line.tags->'highway' IN ('primary','trunk') THEN '#f2c94c'
     WHEN line.tags->'highway' IN ('secondary','tertiary') THEN '#f2994a'
     WHEN line.tags ? 'highway' THEN '#f6d88b'
     WHEN line.tags ? 'railway' THEN '#64748b'
     WHEN line.tags ? 'building' THEN '#b7794b'
     WHEN line.tags->'landuse'='forest' OR line.tags->'natural'='wood' OR line.tags->'leisure'='park' THEN '#52a675'
     WHEN line.tags ? 'boundary' THEN '#a8558f'
     ELSE '#5f9fe0'
   END AS editor_color,
   CASE WHEN line.tags->'highway' IN ('primary','trunk') THEN 5 WHEN line.tags ? 'highway' THEN 3 ELSE 2 END AS editor_width,
   ST_AsMVTGeom(line.way,tile.geom_3857,4096,64,true) AS geom
 FROM render.planet_osm_line line CROSS JOIN tile
	WHERE line.way && tile.geom_3857
), points AS (
 SELECT point.osm_id::text AS entity_id, 'node' AS entity_type, COALESCE(point.tags->'name','') AS name,
   CASE
     WHEN point.tags ? 'waterway' OR point.tags->'natural' IN ('water','wetland') THEN '#1687c5'
     WHEN point.tags ? 'amenity' THEN '#8b5cf6'
     WHEN point.tags ? 'shop' THEN '#e76f51'
     WHEN point.tags ? 'tourism' THEN '#d946ef'
     ELSE '#df7950'
   END AS editor_color,
   CASE
     WHEN point.tags->'tourism' IN ('hotel','motel','guest_house','hostel') THEN 'hotel'
     WHEN point.tags->'amenity' IN ('school','college','kindergarten','university') THEN 'school'
     WHEN point.tags->'amenity' IN ('hospital','clinic','doctors','pharmacy') THEN 'hospital'
     WHEN point.tags ? 'shop' OR point.tags->'amenity'='marketplace' THEN 'shop'
     WHEN point.tags->'amenity' IN ('restaurant','cafe','fast_food','bar','pub') THEN 'food'
     WHEN point.tags->'amenity'='fuel' THEN 'fuel'
     WHEN point.tags->'amenity'='atm' THEN 'atm'
     WHEN point.tags->'amenity'='bus_station' OR point.tags->'highway'='bus_stop' THEN 'bus'
     WHEN point.tags->'natural' IN ('tree','wood') THEN 'tree'
     WHEN point.tags->'amenity' IN ('townhall','bank','place_of_worship') OR point.tags ? 'historic' THEN 'landmark'
     ELSE 'generic'
   END AS editor_icon,
   ST_AsMVTGeom(point.way,tile.geom_3857,4096,64,true) AS geom
 FROM render.planet_osm_point point CROSS JOIN tile
 WHERE point.way && tile.geom_3857 AND point.tags <> ''::hstore
)
SELECT COALESCE((SELECT ST_AsMVT(ways,'ways',4096,'geom') FROM ways),''::bytea) || COALESCE((SELECT ST_AsMVT(points,'points',4096,'geom') FROM points),''::bytea)`
