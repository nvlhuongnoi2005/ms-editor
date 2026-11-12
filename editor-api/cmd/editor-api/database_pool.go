package main

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func intEnv(name string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil || value < minimum || value > maximum {
		return fallback
	}
	return value
}

// Keep the connection budget explicit when deploying multiple API processes.
func openDatabasePool(ctx context.Context, dsn, prefix string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	maximum := 16
	if prefix == "ENC_DB" || os.Getenv("EDITOR_MODE") == "render-worker" {
		maximum = 4
	}
	config.MaxConns = int32(intEnv(prefix+"_POOL_MAX_CONNS", maximum, 1, 200))
	config.MinConns = int32(intEnv(prefix+"_POOL_MIN_CONNS", 0, 0, int(config.MaxConns)))
	config.MaxConnIdleTime = 5 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnLifetimeJitter = 5 * time.Minute
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	return pgxpool.NewWithConfig(ctx, config)
}
