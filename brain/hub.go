package main

import (
	"encoding/json"
	"log"
	"sync"
)

// Event is one message sent to the UI. Every event has a "type" key;
// the full list lives in docs/PROTOCOL.md.
type Event map[string]any

// Hub fans events out to every connected UI (usually exactly one).
// It is the "publish/subscribe" pattern: producers (the Claude reader,
// the reminder poller) don't know who is listening.
type Hub struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

func NewHub() *Hub { return &Hub{subs: make(map[chan []byte]struct{})} }

// Publish never blocks: a subscriber whose buffer is full misses the
// event instead of freezing the whole brain (back-pressure by dropping).
func (h *Hub) Publish(ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		log.Printf("hub: cannot encode %v: %v", ev["type"], err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.subs {
		select {
		case c <- b:
		default:
			log.Printf("hub: subscriber slow, dropped %v", ev["type"])
		}
	}
}

// Subscribe returns a channel of encoded events and a function that
// unsubscribes; callers `defer` it so a closed browser tab cleans up.
func (h *Hub) Subscribe() (<-chan []byte, func()) {
	c := make(chan []byte, 256)
	h.mu.Lock()
	h.subs[c] = struct{}{}
	h.mu.Unlock()
	return c, func() {
		h.mu.Lock()
		delete(h.subs, c)
		h.mu.Unlock()
	}
}
