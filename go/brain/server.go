package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Server is the brain's HTTP API for the UI (see docs/PROTOCOL.md).
type Server struct {
	Token     string
	Hub       *Hub
	Claude    *Claude
	Reminders *Reminders
	Now       func() time.Time // injectable clock, so tests can pin "now"
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	// Go 1.22+ patterns: "METHOD /path" rejects other methods with 405.
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "ok") })
	mux.HandleFunc("GET /events", s.events)
	mux.HandleFunc("POST /prompt", s.prompt)
	mux.HandleFunc("POST /permission", s.permission)
	mux.HandleFunc("POST /cancel", s.cancel)
	// Outermost first: Host check → CORS → token → route.
	return withLocalHost(s.withCORS(s.withAuth(mux)))
}

// withLocalHost defends against DNS rebinding: a malicious site can make
// its own domain resolve to 127.0.0.1, but the browser still sends
// "Host: evil.example", so anything not addressed to localhost is refused.
// (The token already stops such requests; this is defense in depth.)
func withLocalHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndex(host, ":"); i >= 0 {
			host = host[:i]
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withAuth rejects requests without the shared secret. EventSource can't
// set headers, so only /events may pass it as ?token= instead.
func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if got == "" && r.URL.Path == "/events" {
			got = r.URL.Query().Get("token")
		}
		// An empty configured token must never mean "no auth":
		// ConstantTimeCompare("", "") would return 1.
		// Constant-time compare: no timing hints about how many chars matched.
		if s.Token == "" || subtle.ConstantTimeCompare([]byte(got), []byte(s.Token)) != 1 {
			http.Error(w, "bad token", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withCORS lets the Tauri webview (a different origin) call us.
func (s *Server) withCORS(next http.Handler) http.Handler {
	allowed := map[string]bool{
		"http://tauri.localhost": true, // Tauri v2 on Windows
		"tauri://localhost":      true, // Tauri v2 on macOS/Linux
		"http://localhost:1420":  true, // Vite dev server
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); allowed[o] {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// events streams Server-Sent Events: "data: <json>\n\n" per event.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	ch, unsubscribe := s.Hub.Subscribe()
	defer unsubscribe()
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()
	keepAlive := time.NewTicker(20 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done(): // UI closed the connection
			return
		case b := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		case <-keepAlive.C:
			fmt.Fprint(w, ": ping\n\n") // comment line, keeps proxies/timeouts happy
			flusher.Flush()
		}
	}
}

// decode reads a JSON body of at most 1 MiB. Passing w lets the server
// close the connection if a client keeps sending past the limit.
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	return json.NewDecoder(r.Body).Decode(v)
}

func (s *Server) prompt(w http.ResponseWriter, r *http.Request) {
	var body struct{ Text string }
	if err := decode(w, r, &body); err != nil || strings.TrimSpace(body.Text) == "" {
		http.Error(w, "need {\"text\": ...}", http.StatusBadRequest)
		return
	}
	text := strings.TrimSpace(body.Text)
	if strings.HasPrefix(text, "/remind") {
		s.remind(w, text)
		return
	}
	switch err := s.Claude.Prompt(text); {
	case err == ErrBusy:
		http.Error(w, err.Error(), http.StatusConflict)
	case err != nil:
		log.Printf("prompt: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	default:
		w.WriteHeader(http.StatusAccepted)
	}
}

func (s *Server) remind(w http.ResponseWriter, text string) {
	at, what, err := ParseRemind(text, s.Now())
	if err == nil {
		err = s.Reminders.Add(at, what)
	}
	if err != nil {
		s.Hub.Publish(Event{"type": "reply_done", "text": "Hmm, I couldn't set that reminder: " + err.Error(), "is_error": true})
		w.WriteHeader(http.StatusAccepted)
		return
	}
	s.Hub.Publish(Event{"type": "reply_done", "text": fmt.Sprintf("Okay! I'll remind you at %s: %s", at.Format("15:04"), what)})
	s.Hub.Publish(Event{"type": "mood", "emotion": "happy", "intensity": 0.6})
	w.WriteHeader(http.StatusAccepted)
}

var (
	remindIn = regexp.MustCompile(`^/remind\s+(\d+)\s*([mh])\s+(.+)$`)    // /remind 10m stretch
	remindAt = regexp.MustCompile(`^/remind\s+(\d{1,2}):(\d{2})\s+(.+)$`) // /remind 17:30 stretch
)

const (
	MaxReminderText  = 500                // characters; it ends up in a bubble and a toast
	MaxReminderDelay = 7 * 24 * time.Hour // also keeps n*unit far from Duration overflow
)

// ParseRemind understands "/remind 10m text", "/remind 2h text" and
// "/remind 17:30 text" (today, or tomorrow if that time has passed).
func ParseRemind(s string, now time.Time) (time.Time, string, error) {
	at, text, err := parseRemind(s, now)
	if err != nil {
		return at, text, err
	}
	if n := len([]rune(text)); n > MaxReminderText {
		return time.Time{}, "", fmt.Errorf("that's %d characters; keep reminders under %d", n, MaxReminderText)
	}
	return at, text, nil
}

func parseRemind(s string, now time.Time) (time.Time, string, error) {
	if m := remindIn.FindStringSubmatch(s); m != nil {
		n, err := strconv.Atoi(m[1]) // fails on numbers too big for an int
		unit := time.Minute
		if m[2] == "h" {
			unit = time.Hour
		}
		if err != nil || n < 1 || time.Duration(n) > MaxReminderDelay/unit {
			return time.Time{}, "", fmt.Errorf("pick a delay between 1m and 7 days")
		}
		return now.Add(time.Duration(n) * unit), m[3], nil
	}
	if m := remindAt.FindStringSubmatch(s); m != nil {
		h, _ := strconv.Atoi(m[1])
		min, _ := strconv.Atoi(m[2])
		if h > 23 || min > 59 {
			return time.Time{}, "", fmt.Errorf("%s:%s isn't a time", m[1], m[2])
		}
		at := time.Date(now.Year(), now.Month(), now.Day(), h, min, 0, 0, now.Location())
		if !at.After(now) {
			at = at.AddDate(0, 0, 1)
		}
		return at, m[3], nil
	}
	return time.Time{}, "", fmt.Errorf("try \"/remind 10m stretch\" or \"/remind 17:30 stretch\"")
}

func (s *Server) permission(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID    string
		Allow bool
	}
	if err := decode(w, r, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.Claude.AnswerPermission(body.ID, body.Allow); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) cancel(w http.ResponseWriter, r *http.Request) {
	if err := s.Claude.Interrupt(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
