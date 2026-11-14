import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The full preview view (Gap 1, AGEN-258). The fit math is tested as behavior in
// template-preview.test.mjs; this only checks the component is wired to it and to
// the accessible <Modal> shell, since source-reading is the only harness short of
// a live server. Style follows template-editor-wiring.test.mjs.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/templates/template-preview-modal.tsx"),
  "utf8",
);

test("the accessible shell comes from <Modal>, not a hand-rolled overlay", () => {
  assert.match(src, /import\s*{[^}]*\bModal\b[^}]*}\s*from\s*"@\/components\/ui\/modal"/);
  // Modal owns focus trap, Escape, backdrop-close and focus restoration.
  assert.match(src, /<Modal\b[^>]*\bonClose=\{onClose\}/);
  assert.match(src, /<Modal\b[^>]*\blabelledBy=\{headingId\}/);
  assert.match(src, /<Modal\b[^>]*\binitialFocusRef=\{closeRef\}/);
});

test("the dialog is labelled by its own heading", () => {
  assert.match(src, /const headingId = useId\(\)/);
  assert.match(src, /<h2\b[^>]*id=\{headingId\}/);
});

test("the close control has an accessible name since its glyph is decorative", () => {
  const opening = src.match(/<button\b[^>]*onClick=\{onClose\}[^>]*>/);
  assert.ok(opening, "found the close button");
  assert.match(opening[0], /aria-label="Close preview"/);
  assert.match(opening[0], /ref=\{closeRef\}/);
});

test("the scale is computed by previewScale, not hard-coded", () => {
  assert.match(src, /import\s*{[^}]*\bpreviewScale\b[^}]*}\s*from\s*"@\/lib\/template-preview\.mjs"/);
  assert.match(src, /const scale = previewScale\(availWidth\)/);
  assert.match(src, /const box = scaledPageBox\(scale\)/);
});

test("the preview reuses the same /api/templates/preview content the thumbnail loads", () => {
  assert.match(src, /fetch\(`\/api\/templates\/preview\?kind=\$\{kind\}&name=\$\{encodeURIComponent\(name\)\}`\)/);
  assert.match(src, /srcDoc=\{html\}/);
});

test("the preview frame stays inert: sandboxed, unfocusable, and click-through", () => {
  const frame = src.match(/<iframe\b[\s\S]*?\/>/);
  assert.ok(frame, "found the iframe");
  assert.match(frame[0], /sandbox=""/);
  assert.match(frame[0], /tabIndex=\{-1\}/);
  assert.match(frame[0], /pointerEvents:\s*"none"/);
});

test("loading and failure both have a visible, non-blank state", () => {
  assert.match(src, /failed \?/);
  assert.match(src, /Preview unavailable\./);
  assert.match(src, /aria-label="Loading preview"/);
});

test('"Make default" lives in the modal and is gated on busy like the card', () => {
  const opening = src.match(/<button\b[^>]*onClick=\{\(\) => onChoose\(name\)\}[^>]*>/);
  assert.ok(opening, "found the Make default button");
  assert.match(opening[0], /disabled=\{busy !== null\}/);
  assert.match(src, /busy === name \? "Saving…" : "Make default"/);
});
