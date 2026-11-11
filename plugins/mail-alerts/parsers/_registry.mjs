// @ts-check
// Sender registry: dispatch a decoded email to the parser that claims its From
// domain. A `_`-prefixed file is plugin-private (never discovered as a plugin).
//
// Dispatch is From-domain gated on purpose: an email from an UNKNOWN sender is
// never parsed, so links and any imperative "instructions" inside an unknown
// message produce zero jobs. Email content is untrusted external data — these
// functions only extract listings, they never act on message text.
import linkedin from './linkedin.mjs';
import indeed from './indeed.mjs';
import naukri from './naukri.mjs';
import ziprecruiter from './ziprecruiter.mjs';

export const PARSERS = [linkedin, indeed, naukri, ziprecruiter];

/**
 * The parser whose From domain matches this email, or null for an unknown
 * sender. A null result means "do not parse" — never a fallback parser.
 * @param {{ headers?: Record<string,string> }} email
 */
export function detectSender(email) {
  if (!email || !email.headers) return null;
  for (const parser of PARSERS) {
    try {
      if (parser.matches(email)) return parser;
    } catch {
      // A broken matcher must not block the others.
    }
  }
  return null;
}

/**
 * Extract Job listings from a decoded email, or [] when the sender is unknown.
 * Every returned job has a non-empty title and an http(s) URL.
 * @param {{ headers?: Record<string,string>, body?: string }} email
 * @returns {{ title: string, url: string, company?: string, location?: string }[]}
 */
export function parseEmail(email) {
  const parser = detectSender(email);
  if (!parser) return [];
  let jobs;
  try {
    jobs = parser.parse(email);
  } catch {
    return [];
  }
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((j) => j && typeof j.title === 'string' && j.title && /^https?:\/\//i.test(j.url || ''));
}
