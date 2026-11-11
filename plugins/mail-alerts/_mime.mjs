// @ts-check
// Minimal, self-contained MIME decoder for saved job-alert emails (.eml/.txt).
//
// A `_`-prefixed file is plugin-private: the engine never discovers it as a
// plugin. This decoder is deliberately small — it handles exactly what alert
// emails use (single-part text, quoted-printable, base64, and one level of
// multipart/alternative) and nothing more. It does NOT fetch, follow links, or
// execute anything: it only turns raw bytes into { headers, body } text.
//
// Everything it returns is UNTRUSTED external data. Callers extract listings
// from it; they never treat its contents as instructions.

const MAX_BODY_CHARS = 2_000_000; // guard against a pathological saved message

/** Unfold RFC 5322 header continuation lines (a leading space/tab continues). */
function splitHeadersAndBody(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const sep = text.indexOf('\n\n');
  const headerBlock = sep === -1 ? text : text.slice(0, sep);
  const body = sep === -1 ? '' : text.slice(sep + 2);
  return { headerBlock, body };
}

/** @param {string} headerBlock @returns {Record<string,string>} */
function parseHeaders(headerBlock) {
  /** @type {Record<string,string>} */
  const headers = {};
  const unfolded = headerBlock.replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name && !(name in headers)) headers[name] = value;
  }
  return headers;
}

/** Decode a quoted-printable string (soft breaks removed, =XX hex decoded). */
function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Decode a base64 body (whitespace between lines/groups is ignored). */
function decodeBase64(text) {
  try {
    return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** Decode one part's body according to its Content-Transfer-Encoding. */
function decodeByEncoding(body, encoding) {
  const enc = (encoding || '').toLowerCase();
  if (enc.includes('base64')) return decodeBase64(body);
  if (enc.includes('quoted-printable')) return decodeQuotedPrintable(body);
  return body; // 7bit / 8bit / binary / none
}

/** Extract a parameter value from a header line, e.g. boundary="..." . */
function headerParam(headerValue, name) {
  if (!headerValue) return '';
  const quoted = new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i').exec(headerValue);
  if (quoted) return quoted[1];
  const bare = new RegExp(`${name}\\s*=\\s*([^;\\s]+)`, 'i').exec(headerValue);
  return bare ? bare[1] : '';
}

/** Split a multipart body into its parts on the MIME boundary. */
function splitParts(body, boundary) {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((p) => p.replace(/^\r?\n/, ''))
    .filter((p) => p && p.trim() !== '--' && p.trim() !== '');
}

/**
 * Decode a saved email into readable text plus its from/subject headers.
 * For multipart/alternative, every text/* part is decoded and combined so a
 * link that only appears in one alternative (plain or html) is still seen.
 *
 * @param {string} raw
 * @returns {{ headers: { from: string, subject: string, [k: string]: string }, body: string }}
 */
export function decodeMail(raw) {
  const { headerBlock, body } = splitHeadersAndBody(raw);
  const headers = parseHeaders(headerBlock);
  const contentType = headers['content-type'] || '';

  let text;
  if (/multipart\//i.test(contentType)) {
    const boundary = headerParam(contentType, 'boundary');
    const chunks = [];
    if (boundary) {
      for (const part of splitParts(body, boundary)) {
        const { headerBlock: ph, body: pb } = splitHeadersAndBody(part);
        const partHeaders = parseHeaders(ph);
        const partType = partHeaders['content-type'] || 'text/plain';
        if (!/^text\//i.test(partType) && partType !== '') continue;
        chunks.push(decodeByEncoding(pb, partHeaders['content-transfer-encoding']));
      }
    }
    text = chunks.join('\n');
  } else {
    text = decodeByEncoding(body, headers['content-transfer-encoding']);
  }

  if (text.length > MAX_BODY_CHARS) text = text.slice(0, MAX_BODY_CHARS);

  return {
    headers: {
      ...headers,
      from: headers.from || '',
      subject: headers.subject || '',
    },
    body: text,
  };
}
