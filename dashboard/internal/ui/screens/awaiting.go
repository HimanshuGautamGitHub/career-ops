package screens

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// AwaitingClosedMsg is emitted when the awaiting-you panel is dismissed.
type AwaitingClosedMsg struct{}

// AwaitingModel renders the read-only "Awaiting you" panel: the Stage-2
// human-in-the-loop approval queue, grouped and ordered exactly as the CLI
// projects it (agent-inbox.mjs list --grouped --json → orderApprovals →
// lib/inbox-rank.mjs). It RENDERS only. No key in this screen submits, sends,
// approves, or edits anything — those route back through the terminal CLI, the
// Ethical-Use boundary. An optional loadErr renders in place of the queue.
type AwaitingModel struct {
	queue        data.ApprovalQueue
	loadErr      string
	scrollOffset int
	width        int
	height       int
	theme        theme.Theme
}

// NewAwaitingModel builds the panel from an already-loaded queue.
func NewAwaitingModel(t theme.Theme, queue data.ApprovalQueue, width, height int) AwaitingModel {
	return AwaitingModel{
		queue:  queue,
		width:  width,
		height: height,
		theme:  t,
	}
}

// NewAwaitingErrorModel builds the panel in its error state (the queue could
// not be loaded). The message is shown instead of a broken table.
func NewAwaitingErrorModel(t theme.Theme, loadErr string, width, height int) AwaitingModel {
	return AwaitingModel{
		loadErr: loadErr,
		width:   width,
		height:  height,
		theme:   t,
	}
}

// Init implements tea.Model.
func (m AwaitingModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *AwaitingModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Update handles input. It only navigates and dismisses; it never mutates the
// queue or triggers any outward action.
func (m AwaitingModel) Update(msg tea.Msg) (AwaitingModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "a":
			return m, func() tea.Msg { return AwaitingClosedMsg{} }
		case "down", "j":
			m.scrollOffset++
		case "up", "k":
			if m.scrollOffset > 0 {
				m.scrollOffset--
			}
		case "pgdown", "ctrl+d":
			m.scrollOffset += m.height / 2
		case "pgup", "ctrl+u":
			m.scrollOffset -= m.height / 2
			if m.scrollOffset < 0 {
				m.scrollOffset = 0
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the panel.
func (m AwaitingModel) View() string {
	header := m.renderHeader()
	help := m.renderHelp()

	var body string
	switch {
	case m.loadErr != "":
		body = m.renderError()
	case m.queue.Pending == 0:
		body = m.renderEmpty()
	default:
		body = m.renderGroups()
	}

	// Apply scroll
	bodyLines := strings.Split(body, "\n")
	offset := m.scrollOffset
	if offset >= len(bodyLines) {
		offset = len(bodyLines) - 1
	}
	if offset < 0 {
		offset = 0
	}
	if offset > 0 {
		bodyLines = bodyLines[offset:]
	}

	// Clamp to available height
	availHeight := m.height - 4 // header + help + padding
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}
	body = strings.Join(bodyLines, "\n")

	return lipgloss.JoinVertical(lipgloss.Left, header, body, help)
}

func (m AwaitingModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Mauve).Render(i18n.Current.AwaitingTitle)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	info := right.Render(fmt.Sprintf(i18n.Current.AwaitingSummary, m.queue.Pending))
	return oneLine(m.width, style, fitTitleBar(m.width, title, info))
}

func (m AwaitingModel) renderError() string {
	padStyle := lipgloss.NewStyle().Padding(1, 2)
	errStyle := lipgloss.NewStyle().Foreground(m.theme.Red)
	return padStyle.Render(errStyle.Render(fmt.Sprintf(i18n.Current.AwaitingLoadError, m.loadErr)))
}

func (m AwaitingModel) renderEmpty() string {
	padStyle := lipgloss.NewStyle().Padding(2, 2)
	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Green)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	return padStyle.Render(lipgloss.JoinVertical(lipgloss.Left,
		titleStyle.Render(i18n.Current.AwaitingEmpty),
		"",
		hintStyle.Render(i18n.Current.AwaitingEmptyHint),
	))
}

func (m AwaitingModel) renderGroups() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var lines []string
	for i, group := range m.queue.Groups {
		pending := pendingItems(group.Items)
		if len(pending) == 0 {
			continue
		}
		if i > 0 && len(lines) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, padStyle.Render(m.renderGroupHeader(group, len(pending))))
		for _, item := range pending {
			lines = append(lines, padStyle.Render(m.renderItem(item)))
		}
	}

	// Standing footnotes: the read-only boundary and the SUBMIT rule. These are
	// part of the panel body (not the one-line help bar) so the reader always
	// sees why no action key exists here.
	lines = append(lines, "")
	lines = append(lines, padStyle.Render(hintStyle.Render(i18n.Current.AwaitingActionHint)))
	lines = append(lines, padStyle.Render(hintStyle.Render(i18n.Current.AwaitingSubmitNote)))

	return strings.Join(lines, "\n")
}

func (m AwaitingModel) renderGroupHeader(group data.ApprovalGroup, count int) string {
	badge := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Base).
		Background(m.categoryColor(group.Category)).
		Padding(0, 1).
		Render(badgeLabel(group.Label))
	countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	out := badge + countStyle.Render(fmt.Sprintf("  %d", count))

	// SUBMIT (and any non-batchable lane) is confirmed one item at a time; make
	// that visible rather than implied, so the reader never expects a batch.
	if !group.Batchable {
		lockStyle := lipgloss.NewStyle().Foreground(m.theme.Peach)
		out += lockStyle.Render("  ⚠ one at a time")
	}
	return out
}

func (m AwaitingModel) renderItem(item data.ApprovalItem) string {
	whyStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	refStyle := lipgloss.NewStyle().Foreground(m.theme.Blue)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	headline := strings.TrimSpace(item.Headline)
	if headline == "" {
		headline = item.Label
	}

	ref := strings.TrimSpace(item.Ref)
	var refText string
	if ref == "" {
		refText = dimStyle.Render(i18n.Current.AwaitingNoRef)
	} else {
		refText = refStyle.Render(ref)
	}

	// "  • " bullet keeps rows scannable under the group badge.
	return "  " + dimStyle.Render("•") + " " + whyStyle.Render(headline) + "  " + refText
}

func (m AwaitingModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	noteStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)
	brandPlain := i18n.Current.AwaitingReadOnly
	brand := noteStyle.Render(brandPlain)
	budget := m.width - 2
	if budget < 1 {
		budget = 1
	}
	keys := joinHelp(budget, []helpPiece{
		{keyStyle.Render("↑↓") + descStyle.Render(i18n.Current.HelpScroll), false},
		{keyStyle.Render("PgUp/Dn") + descStyle.Render(i18n.Current.HelpPage), false},
		{keyStyle.Render("Esc") + descStyle.Render(i18n.Current.HelpBack), true},
	}, brandPlain, brand)
	return oneLine(m.width, style, keys)
}

// categoryColor maps a category id to a theme color for its badge. Color is a
// secondary cue only — the badge always carries the text label too, so the
// panel never relies on color alone to convey the category.
func (m AwaitingModel) categoryColor(category string) lipgloss.Color {
	switch category {
	case "submit":
		return m.theme.Red
	case "borderline":
		return m.theme.Peach
	case "message":
		return m.theme.Yellow
	case "resume":
		return m.theme.Green
	case "profile":
		return m.theme.Sky
	case "targeting":
		return m.theme.Blue
	default: // general
		return m.theme.Mauve
	}
}

// pendingItems returns the not-done items of a group, preserving the CLI's
// order (the dashboard never re-sorts).
func pendingItems(items []data.ApprovalItem) []data.ApprovalItem {
	out := make([]data.ApprovalItem, 0, len(items))
	for _, it := range items {
		if !it.Done {
			out = append(out, it)
		}
	}
	return out
}

// badgeLabel falls back to a non-empty tag so a malformed group still renders a
// visible badge rather than an empty box.
func badgeLabel(label string) string {
	l := strings.TrimSpace(label)
	if l == "" {
		return "GENERAL"
	}
	return l
}
