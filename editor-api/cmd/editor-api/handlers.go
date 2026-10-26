package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func serveEditorAPI(handler http.Handler) error {
	if address := os.Getenv("EDITOR_API_ADDR"); address != "" {
		server := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
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
		server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
		errorsCh <- server.Serve(listener)
	}
	go serve(ipv4)
	go serve(ipv6)
	return <-errorsCh
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var err error
	switch {
	case r.URL.Path == "/healthz" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "editor-api", "runtime": "go"})
		return
	case r.URL.Path == "/api/graph" && r.Method == http.MethodGet:
		err = a.serveGraph(r.Context(), w, r)
	case r.URL.Path == "/api/publish-status" && r.Method == http.MethodGet:
		err = a.servePublishStatus(r.Context(), w, r)
	case strings.HasPrefix(r.URL.Path, "/api/mvt/") && r.Method == http.MethodGet:
		err = a.serveMVT(r.Context(), w, r)
	case r.URL.Path == "/api/export/osm" && r.Method == http.MethodGet:
		err = a.exportOSM(r.Context(), w, r)
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
	var apiErr *apiError
	if errors.As(err, &apiErr) {
		writeJSON(w, apiErr.status, map[string]string{"error": apiErr.message})
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	writeJSON(w, 500, map[string]string{"error": "Internal server error."})
}

func (a *app) serveGraph(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		dataset = "vietnam-260901"
	}
	bbox, ok := parseBbox(r.URL.Query().Get("bbox"))
	if !ok || !validDataset(dataset) {
		return fail(400, "A valid, compact bbox and dataset are required.")
	}
	limit := boundedInt(r.URL.Query().Get("limit"), 260, 1, 1200)
	var datasetID string
	var revision int64
	err := a.db.QueryRow(ctx, "SELECT id, canonical_revision FROM editor.dataset WHERE name = $1 AND state = 'ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&datasetID, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "The requested canonical dataset is not ready.")
	}
	if err != nil {
		return err
	}
	ways, err := graphWays(ctx, a.db, datasetID, bbox, limit)
	if err != nil {
		return err
	}
	points, err := graphPoints(ctx, a.db, datasetID, bbox, min(limit, 300))
	if err != nil {
		return err
	}
	relations, err := graphRelations(ctx, a.db, datasetID, bbox, min(limit, 300))
	if err != nil {
		return err
	}
	features := append(append(ways, points...), relations...)
	writeJSON(w, 200, map[string]any{"type": "FeatureCollection", "dataset": dataset, "canonicalRevision": revision, "features": features})
	return nil
}

func (a *app) servePublishStatus(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		dataset = "vietnam-260901"
	}
	if !validDataset(dataset) {
		return fail(400, "A valid dataset is required.")
	}
	var canonicalRevision, renderRevision int64
	var waiting, rendering, failed int
	var lastError *string

	query := `SELECT dataset.canonical_revision, dataset.render_revision,
		COUNT(event.id) FILTER (WHERE event.published_at IS NULL AND event.processing_at IS NULL)::int,
		COUNT(event.id) FILTER (WHERE event.published_at IS NULL AND event.processing_at IS NOT NULL)::int,
		COUNT(event.id) FILTER (WHERE event.published_at IS NULL AND event.last_error IS NOT NULL)::int,
		(ARRAY_AGG(event.last_error ORDER BY event.id DESC) FILTER (WHERE event.published_at IS NULL AND event.last_error IS NOT NULL))[1]
		FROM editor.dataset dataset
		LEFT JOIN editor.outbox_event event ON event.dataset_id=dataset.id
		WHERE dataset.name=$1 AND dataset.state='ready'
		GROUP BY dataset.id`

	err := a.db.QueryRow(ctx, query, dataset).Scan(&canonicalRevision, &renderRevision, &waiting, &rendering, &failed, &lastError)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" { // undefined_column (e.g. processing_at missing on older DB volumes)
			_ = ensurePublishPipelineSchema(ctx, a.db)
			err = a.db.QueryRow(ctx, query, dataset).Scan(&canonicalRevision, &renderRevision, &waiting, &rendering, &failed, &lastError)
			if err != nil && errors.As(err, &pgErr) && pgErr.Code == "42703" {
				fallbackQuery := `SELECT dataset.canonical_revision, dataset.render_revision,
					COUNT(event.id) FILTER (WHERE event.published_at IS NULL)::int,
					0::int, 0::int, NULL::text
					FROM editor.dataset dataset
					LEFT JOIN editor.outbox_event event ON event.dataset_id=dataset.id
					WHERE dataset.name=$1 AND dataset.state='ready'
					GROUP BY dataset.id`
				err = a.db.QueryRow(ctx, fallbackQuery, dataset).Scan(&canonicalRevision, &renderRevision, &waiting, &rendering, &failed, &lastError)
			}
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(404, "Dataset was not found or is not ready.")
	}
	if err != nil {
		return err
	}
	status := "published"
	if failed > 0 {
		status = "failed"
	} else if rendering > 0 {
		status = "rendering"
	} else if waiting > 0 || renderRevision < canonicalRevision {
		status = "pending"
	}
	writeJSON(w, 200, map[string]any{
		"dataset": dataset, "status": status, "canonicalRevision": canonicalRevision,
		"renderRevision": renderRevision, "pendingEvents": waiting + rendering, "lastError": lastError,
	})
	return nil
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
	var renderRevision int64
	if err := a.db.QueryRow(ctx, "SELECT render_revision FROM editor.dataset WHERE name=$1 AND state='ready' ORDER BY created_at DESC LIMIT 1", dataset).Scan(&renderRevision); errors.Is(err, pgx.ErrNoRows) {
		return fail(409, "The requested canonical dataset is not ready.")
	} else if err != nil {
		return err
	}
	etag := fmt.Sprintf("\"render-r%d\"", renderRevision)
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	var tile []byte
	if err := a.renderDB.QueryRow(ctx, renderMVTSQL, z, x, y).Scan(&tile); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	w.Header().Set("Cache-Control", "public, max-age=30, must-revalidate")
	w.Header().Set("ETag", etag)
	_, err = w.Write(tile)
	return err
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
   ST_AsMVTGeom(point.way,tile.geom_3857,4096,64,true) AS geom
 FROM render.planet_osm_point point CROSS JOIN tile
 WHERE point.way && tile.geom_3857 AND point.tags <> ''::hstore
)
SELECT COALESCE((SELECT ST_AsMVT(ways,'ways',4096,'geom') FROM ways),''::bytea) || COALESCE((SELECT ST_AsMVT(points,'points',4096,'geom') FROM points),''::bytea)`
