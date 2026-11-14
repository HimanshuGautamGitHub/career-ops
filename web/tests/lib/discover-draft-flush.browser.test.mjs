// Run with DISCOVER_DRAFT_FLUSH_TEST_URL=http://127.0.0.1:35424 against disposable data.
// Regression guard for Gap 4 (AGEN-261): a "Roles to find" keyword typed but not
// committed (no Enter / blur / separator) must still reach /api/explore as
// filters.positive when Discover (free) fires. The PE (AGEN-256) pinned the bug
// to the KeywordField draft never flushing before discover() reads the filters ref.
//
// Why a dispatched click, not a real mouse click: a real click on the Discover
// button first moves focus to it, which blurs the Roles field and fires its
// onBlur → commit(draft) → setFilters, populating filters.positive BEFORE
// discover() runs. That blur-commit masks the flush, so a real-click test stays
// green even with the fix removed. Dispatching a `click` event directly on the
// button fires its React onClick WITHOUT moving focus, so the field never blurs
// and ONLY explore-provider discover()'s draftFlushRef.current?.() can carry the
// uncommitted draft into filters.positive. Remove that call → this goes RED.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const base = process.env.DISCOVER_DRAFT_FLUSH_TEST_URL;

test(
  "Discover (free) flushes an uncommitted Roles-to-find keyword into the scan request",
  { skip: liveServerSkip("DISCOVER_DRAFT_FLUSH_TEST_URL"), timeout: 90_000 },
  async (t) => {
    const origin = new URL(base);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();

    const requests = [];
    await page.route("**/api/explore", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: "application/x-ndjson",
        body:
          [
            { kind: "summary", companiesScanned: 0, unreachable: 0, matches: 0 },
            { kind: "done", count: 0, offers: [] },
          ]
            .map((e) => JSON.stringify(e))
            .join("\n") + "\n",
      });
    });

    await page.goto(`${origin.origin}/explore`);

    // Default state is the "Public ATS network" preset, which enables Discover
    // immediately (all ATS sources seeded) with no employer selection.
    const preset = page.getByRole("radio", {
      name: "Public ATS network",
      exact: true,
    });
    await preset.waitFor();
    assert.equal(await preset.isChecked(), true);

    const roles = page.getByRole("textbox", {
      name: "Roles to find",
      exact: true,
    });
    const discover = page.getByRole("button", {
      name: "Discover (free)",
      exact: true,
    });
    await discover.waitFor();
    assert.equal(await discover.isDisabled(), false);

    // The PE scenario: type the keyword and go straight to Discover. No Enter,
    // no blur, no separator — the draft is still uncommitted in the field.
    await roles.focus();
    await page.keyboard.type("Talent Management");
    assert.equal(await roles.inputValue(), "Talent Management");

    // Discover fires while the Roles field still holds focus: the draft is only
    // in the input, never committed to a chip. A dispatched click keeps focus
    // where it is (see the header) so onBlur never commits for us — the flush
    // in discover() is the only thing that can carry the draft into the POST.
    assert.equal(
      await roles.evaluate((el) => el === document.activeElement),
      true,
      "the Roles field must still hold focus when Discover fires",
    );

    // Dispatch the click rather than mouse-click it: this fires onClick without
    // moving focus, so no onBlur commit runs. discover() then transitions the
    // view to the scanning phase and unmounts the field (React fires no blur on
    // unmount), so after this point filters.positive can only have been set by
    // the flush inside discover().
    const posted = page.waitForRequest("**/api/explore", { timeout: 15_000 });
    await discover.dispatchEvent("click");
    await assert.doesNotReject(
      posted,
      "Discover (free) must POST to /api/explore",
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests[0].positive,
      ["Talent Management"],
      "the uncommitted Roles-to-find keyword must flush into filters.positive",
    );
  },
);
