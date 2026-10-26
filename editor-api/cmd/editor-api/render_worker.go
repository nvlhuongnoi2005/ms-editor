package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultWorkerPoll      = 2 * time.Second
	defaultRenderTimeout   = 20 * time.Minute
	defaultLockTimeout     = 30 * time.Minute
	defaultMinDirtyZoom    = 14
	defaultMaxDirtyZoom    = 18
	defaultMaxDirtyTiles   = 5_000
	globalInvalidationZoom = -1
)

type renderEvent struct {
	ID          int64
	DatasetID   string
	DatasetName string
	Revision    int64
	ChangesetID int64
	RenderedAt  *time.Time
}

func runRenderWorker(ctx context.Context, db *pgxpool.Pool) error {
	workerID, err := os.Hostname()
	if err != nil || workerID == "" {
		workerID = "render-worker"
	}
	poll := durationEnv("RENDER_WORKER_POLL_INTERVAL", defaultWorkerPoll)
	lockTimeout := durationEnv("RENDER_WORKER_LOCK_TIMEOUT", defaultLockTimeout)
	log.Printf("render worker %s started (poll=%s)", workerID, poll)

	for {
		event, found, err := claimRenderEvent(ctx, db, workerID, lockTimeout)
		if err != nil {
			return fmt.Errorf("claim render event: %w", err)
		}
		if !found {
			if err := waitForContext(ctx, poll); err != nil {
				return nil
			}
			continue
		}

		if err := processRenderEvent(ctx, db, event); err != nil {
			log.Printf("render event %d (dataset=%s revision=%d) failed: %v", event.ID, event.DatasetName, event.Revision, err)
			if markErr := markRenderFailure(ctx, db, event.ID, err); markErr != nil {
				return fmt.Errorf("record render event %d failure: %w", event.ID, markErr)
			}
			continue
		}
		log.Printf("published dataset=%s revision=%d", event.DatasetName, event.Revision)
	}
}

func claimRenderEvent(ctx context.Context, db *pgxpool.Pool, workerID string, lockTimeout time.Duration) (renderEvent, bool, error) {
	const query = `WITH candidate AS (
		SELECT event.id
		FROM editor.outbox_event event
		WHERE event.type='canonical.changeset.committed'
		  AND event.published_at IS NULL
		  AND (event.next_attempt_at IS NULL OR event.next_attempt_at <= now())
		  AND (event.processing_at IS NULL OR event.processing_at < now() - ($2 * interval '1 second'))
		  AND NOT EXISTS (
			SELECT 1 FROM editor.outbox_event previous
			WHERE previous.dataset_id=event.dataset_id AND previous.published_at IS NULL AND previous.revision < event.revision
		  )
		ORDER BY event.created_at, event.id
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	)
	UPDATE editor.outbox_event event
	SET processing_at=now(), locked_by=$1, attempt_count=event.attempt_count+1, next_attempt_at=NULL
	FROM candidate
	JOIN editor.dataset_revision revision ON revision.dataset_id=event.dataset_id AND revision.revision=event.revision
	JOIN editor.dataset dataset ON dataset.id=event.dataset_id
	WHERE event.id=candidate.id
	RETURNING event.id, event.dataset_id::text, dataset.name, event.revision, revision.changeset_id, event.rendered_at`

	var event renderEvent
	err := db.QueryRow(ctx, query, workerID, int64(lockTimeout.Seconds())).Scan(
		&event.ID, &event.DatasetID, &event.DatasetName, &event.Revision, &event.ChangesetID, &event.RenderedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return renderEvent{}, false, nil
	}
	if err != nil {
		return renderEvent{}, false, err
	}
	return event, true, nil
}

func processRenderEvent(ctx context.Context, db *pgxpool.Pool, event renderEvent) error {
	if event.ChangesetID == 0 {
		return fmt.Errorf("revision %d has no changeset", event.Revision)
	}
	if event.RenderedAt == nil {
		oscPath, cleanup, err := writeRenderOSC(ctx, db, event)
		if err != nil {
			return err
		}
		defer cleanup()
		if err := appendOSCToRenderDB(ctx, oscPath); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `UPDATE editor.outbox_event SET rendered_at=now(), last_error=NULL WHERE id=$1`, event.ID); err != nil {
			return fmt.Errorf("record completed render: %w", err)
		}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := queueDirtyTiles(ctx, tx, event); err != nil {
		return err
	}
	if err := publishDirtyTiles(ctx, tx, event); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE editor.dataset SET render_revision=$2 WHERE id=$1 AND render_revision < $2`, event.DatasetID, event.Revision); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE editor.outbox_event
		SET published_at=now(), processing_at=NULL, locked_by=NULL, next_attempt_at=NULL, last_error=NULL
		WHERE id=$1 AND published_at IS NULL`, event.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("render event %d was no longer pending", event.ID)
	}
	return tx.Commit(ctx)
}

func writeRenderOSC(ctx context.Context, db *pgxpool.Pool, event renderEvent) (string, func(), error) {
	directory := getenv("RENDER_OSC_DIR", filepath.Join(os.TempDir(), "map-service-render"))
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return "", nil, fmt.Errorf("create OSC directory: %w", err)
	}
	file, err := os.CreateTemp(directory, fmt.Sprintf("%s-r%d-*.osc", event.DatasetName, event.Revision))
	if err != nil {
		return "", nil, fmt.Errorf("create OSC file: %w", err)
	}
	path := file.Name()
	cleanup := func() { _ = os.Remove(path) }
	app := &app{db: db}
	if err := app.writeChangesetOSC(ctx, event.ChangesetID, file); err != nil {
		_ = file.Close()
		cleanup()
		return "", nil, fmt.Errorf("write changeset OSC: %w", err)
	}
	if err := file.Close(); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("close OSC file: %w", err)
	}
	return path, cleanup, nil
}

func appendOSCToRenderDB(parent context.Context, oscPath string) error {
	if getenv("RENDER_SYNC_DRY_RUN", "") == "1" {
		log.Printf("RENDER_SYNC_DRY_RUN=1: skipped osm2pgsql --append for %s", oscPath)
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, durationEnv("RENDER_SYNC_TIMEOUT", defaultRenderTimeout))
	defer cancel()
	args := []string{
		"--append", "--slim", "--hstore", "--schema", getenv("RENDER_DB_SCHEMA", "render"),
		"-H", getenv("RENDER_DB_HOST", "127.0.0.1"),
		"-P", getenv("RENDER_DB_PORT", "5432"),
		"-U", getenv("RENDER_DB_USER", "render_owner"),
		"-d", getenv("RENDER_DB_NAME", "render"),
		oscPath,
	}
	cmd := exec.CommandContext(ctx, getenv("OSM2PGSQL_BIN", "osm2pgsql"), args...)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+getenv("RENDER_DB_PASSWORD", ""))
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("osm2pgsql timed out after %s", durationEnv("RENDER_SYNC_TIMEOUT", defaultRenderTimeout))
		}
		return fmt.Errorf("osm2pgsql --append: %w: %s", err, trimWorkerOutput(output.String()))
	}
	return nil
}

func queueDirtyTiles(ctx context.Context, tx pgx.Tx, event renderEvent) error {
	rows, err := tx.Query(ctx, `SELECT DISTINCT ST_XMin(box), ST_YMin(box), ST_XMax(box), ST_YMax(box)
		FROM (
			SELECT ST_Envelope(bbox_before) AS box FROM editor.entity_change WHERE changeset_id=$1 AND bbox_before IS NOT NULL
			UNION
			SELECT ST_Envelope(bbox_after) AS box FROM editor.entity_change WHERE changeset_id=$1 AND bbox_after IS NOT NULL
		) changed`, event.ChangesetID)
	if err != nil {
		return err
	}
	defer rows.Close()
	boxes := make([][4]float64, 0)
	for rows.Next() {
		var box [4]float64
		if err := rows.Scan(&box[0], &box[1], &box[2], &box[3]); err != nil {
			return err
		}
		boxes = append(boxes, box)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	minZoom := boundedInt(getenv("TILE_DIRTY_MIN_ZOOM", ""), defaultMinDirtyZoom, 0, 22)
	maxZoom := boundedInt(getenv("TILE_DIRTY_MAX_ZOOM", ""), defaultMaxDirtyZoom, minZoom, 22)
	maxTiles := boundedInt(getenv("TILE_DIRTY_MAX_TILES", ""), defaultMaxDirtyTiles, 1, 100_000)
	tiles := make(map[[3]int]struct{})
	for _, box := range boxes {
		for zoom := minZoom; zoom <= maxZoom; zoom++ {
			minX, maxY := lonLatTile(box[0], box[3], zoom)
			maxX, minY := lonLatTile(box[2], box[1], zoom)
			for x := minX; x <= maxX; x++ {
				for y := minY; y <= maxY; y++ {
					tiles[[3]int{zoom, x, y}] = struct{}{}
					if len(tiles) > maxTiles {
						return queueGlobalInvalidation(ctx, tx, event, "affected area exceeds tile safety limit")
					}
				}
			}
		}
	}
	if len(tiles) == 0 {
		return queueGlobalInvalidation(ctx, tx, event, "change has no usable geometry extent")
	}
	for tile := range tiles {
		if _, err := tx.Exec(ctx, `INSERT INTO editor.tile_dirty (dataset_id,profile,z,x,y,target_revision,priority,reason)
			VALUES ($1,'vector',$2,$3,$4,$5,0,'canonical changeset')
			ON CONFLICT (dataset_id,profile,z,x,y) DO UPDATE
			SET target_revision=GREATEST(editor.tile_dirty.target_revision,EXCLUDED.target_revision), reason=EXCLUDED.reason, created_at=now()`,
			event.DatasetID, tile[0], tile[1], tile[2], event.Revision); err != nil {
			return err
		}
	}
	return nil
}

func queueGlobalInvalidation(ctx context.Context, tx pgx.Tx, event renderEvent, reason string) error {
	_, err := tx.Exec(ctx, `INSERT INTO editor.tile_dirty (dataset_id,profile,z,x,y,target_revision,priority,reason)
		VALUES ($1,'vector',$2,0,0,$3,100,$4)
		ON CONFLICT (dataset_id,profile,z,x,y) DO UPDATE
		SET target_revision=GREATEST(editor.tile_dirty.target_revision,EXCLUDED.target_revision), priority=100, reason=EXCLUDED.reason, created_at=now()`,
		event.DatasetID, globalInvalidationZoom, event.Revision, reason)
	return err
}

func publishDirtyTiles(ctx context.Context, tx pgx.Tx, event renderEvent) error {
	_, err := tx.Exec(ctx, `INSERT INTO editor.tile_manifest (dataset_id,profile,z,x,y,tile_revision,style_revision,artifact_key,etag,published_at)
		SELECT dataset_id, profile, z, x, y, target_revision, 1,
			format('dynamic/%s/%s/%s/%s/%s',dataset_id,profile,z,x,y),
			format('r%s-s1',target_revision), now()
		FROM editor.tile_dirty
		WHERE dataset_id=$1 AND target_revision <= $2
		ON CONFLICT (dataset_id,profile,z,x,y) DO UPDATE
		SET tile_revision=GREATEST(editor.tile_manifest.tile_revision,EXCLUDED.tile_revision),
			artifact_key=EXCLUDED.artifact_key, etag=EXCLUDED.etag, published_at=EXCLUDED.published_at`, event.DatasetID, event.Revision)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM editor.tile_dirty WHERE dataset_id=$1 AND target_revision <= $2`, event.DatasetID, event.Revision)
	return err
}

func markRenderFailure(ctx context.Context, db *pgxpool.Pool, eventID int64, cause error) error {
	var attempts int
	if err := db.QueryRow(ctx, `SELECT attempt_count FROM editor.outbox_event WHERE id=$1`, eventID).Scan(&attempts); err != nil {
		return err
	}
	delay := retryDelay(attempts)
	_, err := db.Exec(ctx, `UPDATE editor.outbox_event
		SET processing_at=NULL, locked_by=NULL, next_attempt_at=now()+($2 * interval '1 second'), last_error=$3
		WHERE id=$1 AND published_at IS NULL`, eventID, int64(delay.Seconds()), trimWorkerOutput(cause.Error()))
	return err
}

func retryDelay(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	if attempts > 8 {
		attempts = 8
	}
	return time.Duration(1<<(attempts-1)) * 5 * time.Second
}

func lonLatTile(lon, lat float64, zoom int) (int, int) {
	lat = math.Max(-85.05112878, math.Min(85.05112878, lat))
	scale := float64(int64(1) << zoom)
	x := int(math.Floor((lon + 180) / 360 * scale))
	y := int(math.Floor((1 - math.Asinh(math.Tan(lat*math.Pi/180))/math.Pi) / 2 * scale))
	limit := int(scale) - 1
	return maxInt(0, minInt(limit, x)), maxInt(0, minInt(limit, y))
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := getenv(key, "")
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func trimWorkerOutput(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 2_000 {
		return value[len(value)-2_000:]
	}
	return value
}

func waitForContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
