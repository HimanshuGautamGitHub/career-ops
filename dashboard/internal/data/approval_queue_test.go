package data

import (
	"strings"
	"testing"
)

// fixtureQueueJSON mirrors the exact shape agent-inbox.mjs emits for
// `list --grouped --json`: groups already in category-weight order, items
// already in CLI priority order, SUBMIT carrying batchable:false, and a
// null ref on a borderline (no-artifact) item.
const fixtureQueueJSON = `{
  "schema": "career-ops/approval-queue@1",
  "all": false,
  "category": null,
  "pending": 3,
  "total": 3,
  "groups": [
    {
      "category": "submit",
      "label": "SUBMIT",
      "weight": 100,
      "batchable": false,
      "decision": "A complete application is filled and ready; I will submit it myself.",
      "sink": "form-submit",
      "items": [
        {"num": 1, "done": false, "category": "submit", "label": "SUBMIT",
         "headline": "Acme — Senior ML Engineer", "id": "apr_1a2b3c4d",
         "ref": "042", "sink": "form-submit"}
      ]
    },
    {
      "category": "borderline",
      "label": "BORDERLINE",
      "weight": 90,
      "batchable": true,
      "decision": "Pursue this grey-zone posting, or discard it.",
      "sink": "none",
      "items": [
        {"num": 2, "done": false, "category": "borderline", "label": "BORDERLINE",
         "headline": "Globex — Staff Engineer (fit 3.9/5)", "id": "apr_55667788",
         "ref": null, "sink": "none"}
      ]
    },
    {
      "category": "message",
      "label": "MESSAGE",
      "weight": 70,
      "batchable": true,
      "decision": "This outbound text is send-ready; I will send it myself.",
      "sink": "email",
      "items": [
        {"num": 3, "done": false, "category": "message", "label": "MESSAGE",
         "headline": "Cover letter — Initech", "id": "apr_99aabbcc",
         "ref": "output/cover-initech.md", "sink": "email"}
      ]
    }
  ]
}`

func TestParseApprovalQueuePreservesGroupOrderAndMetadata(t *testing.T) {
	q, err := ParseApprovalQueue([]byte(fixtureQueueJSON))
	if err != nil {
		t.Fatalf("ParseApprovalQueue returned error: %v", err)
	}

	if q.Schema != "career-ops/approval-queue@1" {
		t.Errorf("schema = %q, want career-ops/approval-queue@1", q.Schema)
	}
	if q.Pending != 3 || q.Total != 3 {
		t.Errorf("pending/total = %d/%d, want 3/3", q.Pending, q.Total)
	}

	// Group order is the CLI's category-weight order; the dashboard must not
	// re-sort, so assert the exact sequence.
	wantOrder := []string{"submit", "borderline", "message"}
	if len(q.Groups) != len(wantOrder) {
		t.Fatalf("got %d groups, want %d", len(q.Groups), len(wantOrder))
	}
	for i, want := range wantOrder {
		if q.Groups[i].Category != want {
			t.Errorf("group[%d].Category = %q, want %q", i, q.Groups[i].Category, want)
		}
	}
}

func TestParseApprovalQueueSubmitInvariantReachesReader(t *testing.T) {
	q, err := ParseApprovalQueue([]byte(fixtureQueueJSON))
	if err != nil {
		t.Fatalf("ParseApprovalQueue returned error: %v", err)
	}
	// The SUBMIT invariant is carried as data from the frozen taxonomy, never
	// re-implemented here. The reader must see batchable:false on SUBMIT and
	// batchable:true on the others.
	for _, g := range q.Groups {
		if g.Category == "submit" && g.Batchable {
			t.Errorf("SUBMIT group arrived batchable:true — the invariant did not reach the reader")
		}
		if g.Category != "submit" && !g.Batchable {
			t.Errorf("%s group arrived batchable:false, want true", g.Category)
		}
	}
}

func TestParseApprovalQueueNullRefUnmarshalsEmpty(t *testing.T) {
	q, err := ParseApprovalQueue([]byte(fixtureQueueJSON))
	if err != nil {
		t.Fatalf("ParseApprovalQueue returned error: %v", err)
	}
	// borderline item carried "ref": null — it must land as the empty string,
	// which the panel renders as its no-ref sentinel.
	borderline := q.Groups[1]
	if got := borderline.Items[0].Ref; got != "" {
		t.Errorf("null ref unmarshalled to %q, want empty string", got)
	}
	// A real ref survives verbatim.
	if got := q.Groups[0].Items[0].Ref; got != "042" {
		t.Errorf("submit item ref = %q, want 042", got)
	}
}

func TestParseApprovalQueueRejectsMalformedJSON(t *testing.T) {
	_, err := ParseApprovalQueue([]byte("{not json"))
	if err == nil {
		t.Fatal("expected an error for malformed JSON, got nil")
	}
	if !strings.Contains(err.Error(), "approval-queue JSON") {
		t.Errorf("error %q does not mention the approval-queue context", err.Error())
	}
}

func TestParseApprovalQueueEmptyQueue(t *testing.T) {
	const emptyJSON = `{"schema":"career-ops/approval-queue@1","all":false,"category":null,"pending":0,"total":0,"groups":[]}`
	q, err := ParseApprovalQueue([]byte(emptyJSON))
	if err != nil {
		t.Fatalf("ParseApprovalQueue returned error: %v", err)
	}
	if q.Pending != 0 || len(q.Groups) != 0 {
		t.Errorf("empty queue parsed as pending=%d groups=%d, want 0/0", q.Pending, len(q.Groups))
	}
}
