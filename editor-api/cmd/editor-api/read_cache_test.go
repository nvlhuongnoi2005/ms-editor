package main

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadCacheCoalescesAndSurvivesRequestCancellation(t *testing.T) {
	cache := newReadCache(4096)
	ctx, cancel := context.WithCancel(context.Background())
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	loader := func(ctx context.Context) ([]byte, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return []byte("tile"), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	leader := make(chan error, 1)
	go func() { _, err := cache.get(ctx, "tile", time.Minute, loader); leader <- err }()
	<-started
	cancel()
	if err := <-leader; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	for range 40 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			data, err := cache.get(context.Background(), "tile", time.Minute, loader)
			if err != nil || string(data) != "tile" {
				t.Errorf("data=%q err=%v", data, err)
			}
		}()
	}
	close(release)
	wait.Wait()
	if calls.Load() != 1 {
		t.Fatalf("loads=%d", calls.Load())
	}
}

func TestReadCacheBoundsStorageExpiryAndFailures(t *testing.T) {
	cache := newReadCache(400)
	calls := 0
	loader := func(context.Context) ([]byte, error) { calls++; return make([]byte, 100), nil }
	for _, key := range []string{"a", "b", "a", "c", "b"} {
		if _, err := cache.get(context.Background(), key, time.Hour, loader); err != nil {
			t.Fatal(err)
		}
	}
	if cache.bytes > 400 || len(cache.entries) > 1 {
		t.Fatalf("bytes=%d entries=%d", cache.bytes, len(cache.entries))
	}
	before := calls
	cache.get(context.Background(), "expired", -time.Second, loader)
	cache.get(context.Background(), "expired", time.Hour, loader)
	if calls != before+2 {
		t.Fatal("expired value reused")
	}
	fail := func(context.Context) ([]byte, error) { return nil, errors.New("database offline") }
	if _, err := cache.get(context.Background(), "error", time.Hour, fail); err == nil {
		t.Fatal("error swallowed")
	}
	if data, err := cache.get(context.Background(), "error", time.Hour, loader); err != nil || len(data) != 100 {
		t.Fatal("failed load cached")
	}
}
