package main

import (
	"container/list"
	"context"
	"sync"
	"time"
)

type cachedResponse struct {
	key     string
	data    []byte
	expires time.Time
}
type cacheFlight struct {
	done chan struct{}
	data []byte
	err  error
}

// A process-local LRU with a byte budget and bounded concurrent cache misses.
// Waiters share work but each request can cancel independently of the producer.
type readCache struct {
	mu            sync.Mutex
	entries       map[string]*list.Element
	flights       map[string]*cacheFlight
	order         *list.List
	bytes, budget int
}

func newReadCache(budget int) *readCache {
	return &readCache{entries: make(map[string]*list.Element), flights: make(map[string]*cacheFlight), order: list.New(), budget: budget}
}
func (c *readCache) get(ctx context.Context, key string, ttl time.Duration, load func(context.Context) ([]byte, error)) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	if entry := c.entries[key]; entry != nil {
		value := entry.Value.(cachedResponse)
		if time.Now().Before(value.expires) {
			c.order.MoveToFront(entry)
			c.mu.Unlock()
			return value.data, nil
		}
		c.remove(entry)
	}
	flight := c.flights[key]
	if flight == nil {
		if len(c.flights) >= 64 {
			c.mu.Unlock()
			return nil, fail(503, "Read capacity is busy. Please retry shortly.")
		}
		flight = &cacheFlight{done: make(chan struct{})}
		c.flights[key] = flight
		go func() {
			producer, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
			defer cancel()
			data, err := load(producer)
			c.mu.Lock()
			defer c.mu.Unlock()
			flight.data, flight.err = data, err
			// Oversized tiles can be served without monopolizing the cache budget.
			if err == nil && len(data) <= 4<<20 && c.budget > 0 {
				if old := c.entries[key]; old != nil {
					c.remove(old)
				}
				cost := len(key) + len(data) + 128
				if cost <= c.budget {
					for c.bytes+cost > c.budget {
						c.remove(c.order.Back())
					}
					c.entries[key] = c.order.PushFront(cachedResponse{key, data, time.Now().Add(ttl)})
					c.bytes += cost
				}
			}
			delete(c.flights, key)
			close(flight.done)
		}()
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-flight.done:
		return flight.data, flight.err
	}
}
func (c *readCache) remove(entry *list.Element) {
	value := entry.Value.(cachedResponse)
	c.bytes -= len(value.key) + len(value.data) + 128
	delete(c.entries, value.key)
	c.order.Remove(entry)
}
func (a *app) cachedRead(ctx context.Context, key string, ttl time.Duration, load func(context.Context) ([]byte, error)) ([]byte, error) {
	a.readCacheOnce.Do(func() { a.reads = newReadCache(intEnv("EDITOR_READ_CACHE_MIB", 64, 0, 1024) << 20) })
	return a.reads.get(ctx, key, ttl, load)
}
