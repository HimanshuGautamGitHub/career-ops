package data

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ApprovalItem is one parked human-in-the-loop decision, exactly as projected
// by `agent-inbox.mjs list --grouped --json`. The dashboard RENDERS these; it
// never resolves, submits, or sends one — actions route back through the CLI
// (the Ethical-Use boundary). Fields mirror the JSON one-to-one; a JSON null
// (id/ref with no value) unmarshals to the empty string.
type ApprovalItem struct {
	Num      int    `json:"num"`
	Done     bool   `json:"done"`
	Category string `json:"category"`
	Label    string `json:"label"`
	Headline string `json:"headline"`
	ID       string `json:"id"`
	Ref      string `json:"ref"`
	Sink     string `json:"sink"`
}

// ApprovalGroup is one category lane. Weight/Batchable/Decision/Sink come from
// the backend's frozen approval-categories.yml, so the SUBMIT invariant
// (Batchable==false) reaches the reader as data, not a re-implemented rule.
type ApprovalGroup struct {
	Category  string         `json:"category"`
	Label     string         `json:"label"`
	Weight    int            `json:"weight"`
	Batchable bool           `json:"batchable"`
	Decision  string         `json:"decision"`
	Sink      string         `json:"sink"`
	Items     []ApprovalItem `json:"items"`
}

// ApprovalQueue is the full grouped+ordered projection. Groups are already in
// the CLI's category-weight order; items within a group are already in the
// CLI's priority order (orderApprovals / lib/inbox-rank.mjs). The dashboard
// does not re-sort either.
type ApprovalQueue struct {
	Schema   string          `json:"schema"`
	All      bool            `json:"all"`
	Category string          `json:"category"`
	Pending  int             `json:"pending"`
	Total    int             `json:"total"`
	Groups   []ApprovalGroup `json:"groups"`
}

// ParseApprovalQueue decodes the `--json` payload. Pure and I/O-free so the
// grouping/ordering contract can be tested without spawning node.
func ParseApprovalQueue(raw []byte) (ApprovalQueue, error) {
	var q ApprovalQueue
	if err := json.Unmarshal(raw, &q); err != nil {
		return ApprovalQueue{}, fmt.Errorf("parsing approval-queue JSON: %w", err)
	}
	return q, nil
}

// LoadApprovalQueue shells out to the checkout's agent-inbox.mjs and returns
// its grouped+ordered pending queue. It consumes the Stage-2 helper's own
// output — it never re-parses data/agent-inbox.md or re-implements the ranker.
//
// agent-inbox.mjs reads data/agent-inbox.md relative to its working directory
// (not CAREER_OPS_ROOT), so the child runs from the resolved data root.
func LoadApprovalQueue(careerOpsPath string) (ApprovalQueue, error) {
	script, err := CheckoutScriptPath("agent-inbox.mjs")
	if err != nil {
		return ApprovalQueue{}, err
	}
	root, err := filepath.Abs(careerOpsPath)
	if err != nil {
		return ApprovalQueue{}, fmt.Errorf("resolving data root %q: %w", careerOpsPath, err)
	}

	cmd := exec.Command("node", script, "list", "--grouped", "--json")
	cmd.Dir = root
	cmd.Env = append(cmd.Environ(), "CAREER_OPS_ROOT="+root)
	// Honor an explicit inbox override, resolved to an absolute path so it
	// survives the working-directory change.
	if inbox := strings.TrimSpace(os.Getenv("CAREER_OPS_INBOX")); inbox != "" {
		if abs, absErr := filepath.Abs(inbox); absErr == nil {
			inbox = abs
		}
		cmd.Env = append(cmd.Env, "CAREER_OPS_INBOX="+inbox)
	}

	out, err := cmd.Output()
	if err != nil {
		return ApprovalQueue{}, fmt.Errorf("running agent-inbox.mjs: %w", decorateExecErr(err))
	}
	return ParseApprovalQueue(out)
}

// decorateExecErr folds a child process's stderr into the returned error so a
// node failure surfaces something actionable instead of a bare "exit status 1".
func decorateExecErr(err error) error {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		if msg := strings.TrimSpace(string(ee.Stderr)); msg != "" {
			// Keep it to the last line — node stack traces are noise in a help bar.
			if lines := strings.Split(msg, "\n"); len(lines) > 0 {
				return fmt.Errorf("%s", strings.TrimSpace(lines[len(lines)-1]))
			}
		}
	}
	return err
}
