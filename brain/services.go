package main

// Clients for the optional side services. Each uses a different IPC
// technique on purpose (see docs/ARCHITECTURE.md, "How the languages link"):
//
//	Mood (Python)       long-lived child process, JSON lines over stdin/stdout
//	Companion (C#)      Windows named pipe, one JSON line per message
//	Reminders (Java)    HTTP: form-encoded requests, JSON responses

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sync"
	"time"
)

// ---------------------------------------------------------------- Mood

type Mood struct {
	Emotion   string  `json:"emotion"`
	Intensity float64 `json:"intensity"`
}

var neutral = Mood{Emotion: "neutral", Intensity: 0}

type MoodEngine struct {
	mu  sync.Mutex
	in  *json.Encoder
	out *bufio.Scanner
	ok  bool
}

// StartMood launches e.g. `python -u mood/mood.py`. -u = unbuffered
// stdout, otherwise Python holds replies in its buffer and we'd wait forever.
func StartMood(python, script string) *MoodEngine {
	m := &MoodEngine{}
	if script == "" {
		return m
	}
	cmd := exec.Command(python, "-u", script)
	cmd.Stderr = logWriter{prefix: "mood stderr: "}
	stdin, err1 := cmd.StdinPipe()
	stdout, err2 := cmd.StdoutPipe()
	if err1 != nil || err2 != nil {
		log.Printf("mood: pipes: %v %v", err1, err2)
		return m
	}
	if err := cmd.Start(); err != nil {
		log.Printf("mood: disabled (%v)", err)
		return m
	}
	m.in, m.out, m.ok = json.NewEncoder(stdin), bufio.NewScanner(stdout), true
	log.Printf("mood: started %s", script)
	return m
}

// Analyze is request/response over the pipe; the mutex keeps one
// request in flight so replies can't get matched to the wrong question.
func (m *MoodEngine) Analyze(text string) Mood {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ok {
		return neutral
	}
	if err := m.in.Encode(map[string]string{"text": text}); err != nil || !m.out.Scan() {
		log.Printf("mood: engine stopped, using neutral from now on")
		m.ok = false
		return neutral
	}
	var mood Mood
	if err := json.Unmarshal(m.out.Bytes(), &mood); err != nil {
		return neutral
	}
	return mood
}

// ----------------------------------------------------------- Companion

type Companion struct{ Pipe string }

// send opens the pipe, writes one line, closes it. Stateless on purpose:
// the companion can be restarted at any time without the brain noticing.
// Go's os.OpenFile can open an existing Windows named pipe as a client.
func (c Companion) send(msg map[string]string) {
	if c.Pipe == "" {
		return
	}
	f, err := os.OpenFile(c.Pipe, os.O_WRONLY, 0)
	if err != nil {
		return // companion not running: that's fine
	}
	defer f.Close()
	_ = json.NewEncoder(f).Encode(msg)
}

func (c Companion) Speak(text string) { c.send(map[string]string{"cmd": "speak", "text": text}) }
func (c Companion) Notify(title, body string) {
	c.send(map[string]string{"cmd": "notify", "title": title, "text": body})
}

// ----------------------------------------------------------- Reminders

type Reminders struct {
	Base   string
	client http.Client
}

type Reminder struct {
	ID   string `json:"id"`
	At   int64  `json:"at"` // Unix milliseconds
	Text string `json:"text"`
}

// Add sends a form-encoded POST: Java's standard library can decode
// forms (URLDecoder) but has no JSON parser, so we pick its easy side.
func (r *Reminders) Add(at time.Time, text string) error {
	r.client.Timeout = 3 * time.Second
	form := url.Values{"at": {fmt.Sprint(at.UnixMilli())}, "text": {text}}
	resp, err := r.client.PostForm(r.Base+"/reminders", form)
	if err != nil {
		return fmt.Errorf("reminder service unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("reminder service: %s", resp.Status)
	}
	return nil
}

// Poll asks for due reminders every interval and announces them.
func (r *Reminders) Poll(every time.Duration, announce func(Reminder)) {
	r.client.Timeout = 3 * time.Second
	for range time.Tick(every) {
		resp, err := r.client.Post(r.Base+"/due", "text/plain", nil)
		if err != nil {
			continue
		}
		var due []Reminder
		_ = json.NewDecoder(resp.Body).Decode(&due)
		resp.Body.Close()
		for _, d := range due {
			announce(d)
		}
	}
}
