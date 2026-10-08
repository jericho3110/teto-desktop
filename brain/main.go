// Command brain is Teto's "brain" daemon: it runs Claude Code headless,
// streams replies to the UI, and links the side services together.
//
//	go run . -workdir C:\some\folder
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"time"
)

// persona is appended to Claude Code's own system prompt, so she keeps
// all of Claude Code's skills but talks like a desktop mascot.
const persona = `You are Teto, a cheerful chibi desktop assistant living on the user's screen.
Your replies appear in a small speech bubble: keep them short (1-4 sentences) unless the user asks for detail,
and put long output (code, lists) in files instead of the bubble when it helps.
Personality: upbeat, a little smug, playful. You love French bread (baguettes) and occasionally mention it.
You insist you are "31 years old" if anyone asks your age. Never let the quirks get in the way of doing the task well.`

func main() {
	addr := flag.String("addr", "127.0.0.1:47800", "listen address (keep it on 127.0.0.1)")
	workdir := flag.String("workdir", homeDir(), "folder Claude Code works in")
	claudeBin := flag.String("claude", "claude", "Claude Code executable")
	model := flag.String("model", "", "model override (empty = your Claude Code default)")
	python := flag.String("python", "python", "Python interpreter for the mood engine")
	moodScript := flag.String("mood", "", "path to mood/mood.py (empty = no mood engine)")
	remindersURL := flag.String("reminders", "http://127.0.0.1:47801", "Java reminder service URL")
	pipe := flag.String("companion-pipe", `\\.\pipe\teto-companion`, "C# companion named pipe")
	speak := flag.Bool("speak", true, "read replies aloud through the companion")
	flag.Parse()

	// The token is shared by whoever launched us (normally the Rust shell)
	// through an environment variable, never on the command line, because
	// other programs can read a process's command line.
	token := os.Getenv("TETO_TOKEN")
	if token == "" {
		token = newID() + newID()
		log.Printf("TETO_TOKEN not set; generated one for this run: %s", token)
	}

	hub := NewHub()
	mood := StartMood(*python, *moodScript)
	companion := Companion{Pipe: *pipe}
	reminders := &Reminders{Base: *remindersURL}

	claude := &Claude{Bin: *claudeBin, Workdir: *workdir, Model: *model, Persona: persona, Hub: hub}
	claude.OnReply = func(text string) {
		m := mood.Analyze(text)
		hub.Publish(Event{"type": "mood", "emotion": m.Emotion, "intensity": m.Intensity})
		if *speak {
			companion.Speak(truncate(text, 300))
		}
	}

	go reminders.Poll(15*time.Second, func(r Reminder) {
		hub.Publish(Event{"type": "reminder", "text": r.Text})
		companion.Notify("Teto reminder", r.Text)
	})

	srv := &Server{Token: token, Hub: hub, Claude: claude, Reminders: reminders, Now: time.Now}
	log.Printf("brain listening on http://%s (Claude works in %s)", *addr, *workdir)
	log.Fatal(http.ListenAndServe(*addr, srv.Routes()))
}

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return "."
}
