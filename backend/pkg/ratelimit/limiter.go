package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	count int
	until time.Time
}

// Limiter provides memory-bounded rate limiting per IP and account.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]bucket
}

// Allow checks if the given ip and email are allowed under account, pair, and global limits.
func (l *Limiter) Allow(ip, email string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.buckets == nil {
		l.buckets = map[string]bucket{}
	}
	for k, b := range l.buckets {
		if !now.Before(b.until) {
			delete(l.buckets, k)
		}
	}
	if len(l.buckets) > 10000 {
		return false
	}
	keys := []string{"account:" + email, "pair:" + ip + ":" + email, "global"}
	limits := []int{20, 15, 1000}
	allowed := true
	for i, k := range keys {
		b := l.buckets[k]
		if !now.Before(b.until) {
			b = bucket{until: now.Add(15 * time.Minute)}
		}
		b.count++
		l.buckets[k] = b
		if b.count > limits[i] {
			allowed = false
		}
	}
	return allowed
}

// Reset clears the rate limits for the given ip and email pair.
func (l *Limiter) Reset(ip, email string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.buckets == nil {
		return
	}
	delete(l.buckets, "account:"+email)
	delete(l.buckets, "pair:"+ip+":"+email)
}
