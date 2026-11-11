// @ts-check
// Shared, plugin-private helpers for the per-sender parsers. `_`-prefixed, so
// the engine never treats it as a plugin. Pure string/URL work — no I/O, no
// network. Email text is untrusted: these functions only extract, never act.

const TRACKING_PARAMS = [
  /^utm_/i, /^mkt_tok$/i, /^trk$/i, /^trkEmail$/i, /^midToken$/i, /^mid$/i,
  /^eBP$/i, /^refId$/i, /^lici$/i, /^lipi$/i, /^src$/i, /^tsid$/i, /^fccid$/i,
  /^vjs$/i, /^from$/i, /^campaign/i, /^utm/i, /^ref$/i, /^source$/i, /^spa$/i,
  /^rtk$/i, /^sid$/i, /^cid$/i, /^gclid$/i, /^fbclid$/i,
];

const SEPARATORS = [' at ', ' @ ', ' — ', ' – ', ' - ', ' | ', ' · '];

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#039;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/** Decode the handful of HTML entities that show up in alert-email anchor text. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#0?39);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Strip HTML tags and collapse whitespace into a single readable line. */
export function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The email sender's lowercased domain, from the From header. */
export function senderDomain(headers) {
  const from = String(headers?.from || '').toLowerCase();
  const m = /@([a-z0-9.-]+)/.exec(from);
  return m ? m[1] : '';
}

/**
 * All `<a href>` anchors in HTML, as { href, text } in document order.
 * @param {string} html
 * @returns {{ href: string, text: string }[]}
 */
export function anchors(html) {
  const out = [];
  const re = /<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (href) out.push({ href, text: stripTags(m[4]) });
  }
  return out;
}

/** Bare http(s) URLs in plain text (no surrounding anchor), in order. */
export function bareUrls(text) {
  const out = [];
  const re = /https?:\/\/[^\s"'<>)\]]+/gi;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    out.push(m[0].replace(/[),.;!?\]]+$/g, ''));
  }
  return out;
}

/** Parse a URL, returning null instead of throwing on malformed input. */
export function safeUrl(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** Drop tracking query params and the fragment; returns a cleaned URL string. */
export function cleanTrackingParams(url) {
  const u = url instanceof URL ? url : safeUrl(url);
  if (!u) return typeof url === 'string' ? url : '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.hash = '';
  let out = u.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

/**
 * Split anchor text like "Title at Company" into { title, company }.
 * When no separator is present the whole string is the title and company is ''.
 */
export function splitTitleCompany(label) {
  const text = decodeEntities(String(label || '')).replace(/\s+/g, ' ').trim();
  if (!text) return { title: '', company: '' };
  for (const sep of SEPARATORS) {
    const idx = text.indexOf(sep);
    if (idx > 0) {
      const title = text.slice(0, idx).trim();
      // Company runs to the next separator (drop a trailing "(5-8 yrs)" etc.).
      let company = text.slice(idx + sep.length).trim();
      company = company.replace(/\s*[([].*$/, '').trim();
      if (title) return { title, company };
    }
  }
  return { title: text, company: '' };
}

/** Title guessed from a URL path slug, e.g. ".../senior-sre" -> "Senior Sre". */
export function titleFromSlug(pathname) {
  const seg = String(pathname || '').split('/').filter(Boolean).pop() || '';
  const words = seg
    .replace(/\.[a-z]+$/i, '')
    .replace(/[_+]/g, '-')
    .split('-')
    .filter((w) => w && !/^\d+$/.test(w) && !/to$/i.test(w) && !/years?$/i.test(w));
  if (words.length === 0) return '';
  return words
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const MAX_FIELD = 120;
/** Clamp a field to a sane length. */
export function bounded(s) {
  const t = String(s || '').trim();
  return t.length > MAX_FIELD ? `${t.slice(0, MAX_FIELD - 1).trimEnd()}…` : t;
}

/**
 * Shared extraction for the aggregator senders (Indeed, Naukri, ZipRecruiter).
 * Walks every anchor (document order) then every bare URL, keeps the ones whose
 * host the sender claims, canonicalizes each to its stable posting URL, and
 * dedupes — so two tracking links to the same requisition collapse to one job,
 * with the first (anchor-text-bearing) hit winning the title/company.
 *
 * The emitted URL is the genuine AGGREGATOR URL on purpose: it is UNCONFIRMED
 * until an evaluating mode confirms the opening at the employer and runs
 * check-liveness.mjs (AGENTS.md "Aggregator Listings — Confirm at the Employer").
 * This helper never resolves to an employer URL and never fabricates one.
 *
 * @param {{ body: string }} email  decoded email ({ headers, body })
 * @param {{
 *   hostTest: (host: string) => boolean,
 *   canonicalize: (u: URL) => (string|null),
 *   slugTitle?: boolean,
 * }} opts
 * @returns {{ title: string, url: string, company: string, location: string }[]}
 */
export function extractListings(email, { hostTest, canonicalize, slugTitle = true }) {
  const body = email?.body || '';
  const candidates = [
    ...anchors(body),
    ...bareUrls(body).map((href) => ({ href, text: '' })),
  ];
  const out = [];
  const seen = new Set();
  for (const { href, text } of candidates) {
    const u = safeUrl(href);
    if (!u) continue;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostTest(host)) continue;
    const canon = canonicalize(u);
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    const { title: parsedTitle, company } = splitTitleCompany(text);
    let title = parsedTitle;
    if (!title && slugTitle) title = titleFromSlug(safeUrl(canon)?.pathname || '');
    if (!title) title = 'Job alert';
    out.push({ title: bounded(title), url: canon, company: bounded(company), location: '' });
  }
  return out;
}
