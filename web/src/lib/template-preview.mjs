// How the full-size CV template preview fits into the modal. Kept out of the
// component so the rule is tested without React. The preview page renders at its
// true letter-page pixel size (PAGE_WIDTH x PAGE_HEIGHT) and is shrunk by a CSS
// transform; this computes that scale.

export const PAGE_WIDTH = 816;
export const PAGE_HEIGHT = 1056;

// A page scaled below this is unreadable, so on a very narrow viewport the modal
// keeps the page at this floor and lets its body scroll rather than shrink more.
export const PREVIEW_MIN_SCALE = 0.4;

/**
 * Scale for the preview iframe so an 816px-wide page fits the width the modal
 * gives it. Never upscales past the page's true size (caps at 1) and never
 * shrinks below PREVIEW_MIN_SCALE, so a phone shows a legible page instead of a
 * sliver. A non-positive or not-yet-measured width yields the full-size cap, so
 * the first paint before measurement shows true size rather than collapsing.
 * @param {number} availableWidth  content-box width in px the page may occupy
 * @param {number} [pageWidth]     true page width (defaults to PAGE_WIDTH)
 * @returns {number} scale in the range [PREVIEW_MIN_SCALE, 1]
 */
export function previewScale(availableWidth, pageWidth = PAGE_WIDTH) {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  const raw = availableWidth / pageWidth;
  if (raw >= 1) return 1;
  return Math.max(PREVIEW_MIN_SCALE, raw);
}

/**
 * The box the scaled page occupies in layout. The iframe itself stays at true
 * size with transform-origin at the top-left, so its wrapper must be sized to
 * the scaled footprint or the transform would leave blank overflow around it.
 * @param {number} scale
 * @param {{width?: number, height?: number}} [page]
 * @returns {{width: number, height: number}} rounded px dimensions
 */
export function scaledPageBox(scale, page = {}) {
  const w = page.width ?? PAGE_WIDTH;
  const h = page.height ?? PAGE_HEIGHT;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
