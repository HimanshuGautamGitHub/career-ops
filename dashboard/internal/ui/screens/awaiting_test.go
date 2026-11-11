package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// fixtureQueue builds a grouped+ordered queue the way the CLI projects it:
// SUBMIT (non-batchable) first, then MESSAGE, then a done item that must not
// be counted or rendered.
func fixtureQueue() data.ApprovalQueue {
	return data.ApprovalQueue{
		Schema:  "career-ops/approval-queue@1",
		Pending: 2,
		Total:   3,
		Groups: []data.ApprovalGroup{
			{
				Category:  "submit",
				Label:     "SUBMIT",
				Weight:    100,
				Batchable: false,
				Sink:      "form-submit",
				Items: []data.ApprovalItem{
					{Num: 1, Category: "submit", Label: "SUBMIT", Headline: "Acme — Senior ML Engineer", ID: "apr_1a2b3c4d", Ref: "042"},
				},
			},
			{
				Category:  "message",
				Label:     "MESSAGE",
				Weight:    70,
				Batchable: true,
				Sink:      "email",
				Items: []data.ApprovalItem{
					{Num: 2, Category: "message", Label: "MESSAGE", Headline: "Cover letter — Initech", ID: "apr_99aabbcc", Ref: "output/cover-initech.md"},
					{Num: 3, Done: true, Category: "message", Label: "MESSAGE", Headline: "Already cleared", ID: "apr_deadbeef", Ref: "x"},
				},
			},
		},
	}
}

func newTestTheme() theme.Theme { return theme.NewTheme("catppuccin-mocha") }

func TestAwaitingRendersGroupedInCLIOrder(t *testing.T) {
	i18n.Current = &i18n.En
	m := NewAwaitingModel(newTestTheme(), fixtureQueue(), 100, 40)
	view := m.View()

	for _, want := range []string{"SUBMIT", "MESSAGE", "Acme — Senior ML Engineer", "Cover letter — Initech", "042"} {
		if !strings.Contains(view, want) {
			t.Errorf("view missing %q\n---\n%s", want, view)
		}
	}

	// Group order is the CLI's weight order; the dashboard does not re-sort, so
	// the SUBMIT badge must appear before the MESSAGE badge.
	if iSubmit, iMsg := strings.Index(view, "SUBMIT"), strings.Index(view, "MESSAGE"); iSubmit >= iMsg {
		t.Errorf("SUBMIT (idx %d) should render before MESSAGE (idx %d)", iSubmit, iMsg)
	}
}

func TestAwaitingHidesDoneItems(t *testing.T) {
	i18n.Current = &i18n.En
	m := NewAwaitingModel(newTestTheme(), fixtureQueue(), 100, 40)
	view := m.View()
	if strings.Contains(view, "Already cleared") {
		t.Errorf("done item leaked into the panel:\n%s", view)
	}
}

func TestAwaitingShowsEthicalBoundaryNotes(t *testing.T) {
	i18n.Current = &i18n.En
	m := NewAwaitingModel(newTestTheme(), fixtureQueue(), 100, 40)
	view := m.View()

	// The SUBMIT lane must advertise the one-at-a-time rule, and the panel must
	// state its read-only boundary — these are the Ethical-Use guarantees.
	if !strings.Contains(view, i18n.En.AwaitingSubmitNote) {
		t.Errorf("missing SUBMIT one-at-a-time note:\n%s", view)
	}
	if !strings.Contains(view, i18n.En.AwaitingActionHint) {
		t.Errorf("missing CLI action hint:\n%s", view)
	}
	if !strings.Contains(view, "one at a time") {
		t.Errorf("SUBMIT group header should mark the non-batchable lane:\n%s", view)
	}
}

func TestAwaitingEmptyStateRenders(t *testing.T) {
	i18n.Current = &i18n.En
	empty := data.ApprovalQueue{Schema: "career-ops/approval-queue@1", Pending: 0, Total: 0}
	m := NewAwaitingModel(newTestTheme(), empty, 100, 40)
	view := m.View()

	if !strings.Contains(view, i18n.En.AwaitingEmpty) {
		t.Errorf("empty queue did not render the empty-state headline:\n%s", view)
	}
	if !strings.Contains(view, i18n.En.AwaitingEmptyHint) {
		t.Errorf("empty queue did not render the empty-state hint:\n%s", view)
	}
	// The empty state is a real message, not a broken table — no stray badges.
	if strings.Contains(view, "SUBMIT") {
		t.Errorf("empty state should not render any category badge:\n%s", view)
	}
}

func TestAwaitingErrorStateRenders(t *testing.T) {
	i18n.Current = &i18n.En
	m := NewAwaitingErrorModel(newTestTheme(), "node not found", 100, 40)
	view := m.View()
	if !strings.Contains(view, "node not found") {
		t.Errorf("error state did not surface the load error:\n%s", view)
	}
}

func TestAwaitingNoRefShowsSentinel(t *testing.T) {
	i18n.Current = &i18n.En
	q := data.ApprovalQueue{
		Schema:  "career-ops/approval-queue@1",
		Pending: 1,
		Total:   1,
		Groups: []data.ApprovalGroup{{
			Category: "borderline", Label: "BORDERLINE", Weight: 90, Batchable: true,
			Items: []data.ApprovalItem{{Num: 1, Category: "borderline", Label: "BORDERLINE", Headline: "Globex — Staff Engineer (fit 3.9/5)", Ref: ""}},
		}},
	}
	m := NewAwaitingModel(newTestTheme(), q, 100, 40)
	view := m.View()
	if !strings.Contains(view, i18n.En.AwaitingNoRef) {
		t.Errorf("a ref-less item should render the no-ref sentinel %q:\n%s", i18n.En.AwaitingNoRef, view)
	}
}

func TestAwaitingEscClosesPanel(t *testing.T) {
	i18n.Current = &i18n.En
	m := NewAwaitingModel(newTestTheme(), fixtureQueue(), 100, 40)
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if cmd == nil {
		t.Fatal("Esc should emit a close command")
	}
	if _, ok := cmd().(AwaitingClosedMsg); !ok {
		t.Errorf("Esc should emit AwaitingClosedMsg, got %T", cmd())
	}
}

// TestAwaitingUpdateNeverEmitsAction is the ethical guardrail in test form: no
// key routed to the panel may produce anything other than a close command or a
// no-op. The panel is read-only; it must never originate an approve/submit/send.
func TestAwaitingUpdateNeverEmitsAction(t *testing.T) {
	i18n.Current = &i18n.En
	m := NewAwaitingModel(newTestTheme(), fixtureQueue(), 100, 40)
	for _, key := range []string{"enter", "y", "x", "d", " ", "a"} {
		_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(key)})
		if cmd == nil {
			continue
		}
		switch cmd().(type) {
		case AwaitingClosedMsg:
			// closing is allowed
		default:
			t.Errorf("key %q produced a non-close command %T — the panel must stay read-only", key, cmd())
		}
	}
}
