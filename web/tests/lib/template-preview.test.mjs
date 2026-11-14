// Behavior of the preview-fit math: how the full-size CV page is scaled to fit
// the modal across viewport widths. Run: node --test tests/lib/template-preview.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  PREVIEW_MIN_SCALE,
  previewScale,
  scaledPageBox,
} from "../../src/lib/template-preview.mjs";

test("shows the page at true size when the modal is at least as wide as the page", () => {
  assert.equal(previewScale(PAGE_WIDTH), 1);
  assert.equal(previewScale(PAGE_WIDTH + 200), 1);
});

test("scales the page down to fit a viewport narrower than the page", () => {
  // A 612px content box against an 816px page -> 0.75.
  assert.equal(previewScale(612), 0.75);
});

test("never shrinks below the readable floor, even on a tiny phone", () => {
  // 816 * 0.4 = 326.4px; anything narrower would compute below the floor.
  assert.equal(previewScale(200), PREVIEW_MIN_SCALE);
  assert.equal(previewScale(326), PREVIEW_MIN_SCALE);
});

test("floor is a lower bound, not a snap: just above it is honored", () => {
  // 816 * 0.5 = 408px.
  assert.equal(previewScale(408), 0.5);
});

test("an unmeasured or invalid width falls back to full size, not collapse", () => {
  assert.equal(previewScale(0), 1);
  assert.equal(previewScale(-10), 1);
  assert.equal(previewScale(Number.NaN), 1);
  assert.equal(previewScale(Infinity), 1);
});

test("the scaled layout box matches the page times the scale, rounded", () => {
  assert.deepEqual(scaledPageBox(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
  assert.deepEqual(scaledPageBox(0.5), { width: 408, height: 528 });
  assert.deepEqual(scaledPageBox(PREVIEW_MIN_SCALE), { width: 326, height: 422 });
});
