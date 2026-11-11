// @ts-check
// Naukri job-alert parser. A real Naukri posting lives at a /job-listings-...
// path whose final numeric segment is the posting id; search and category links
// do not. The canonical URL is the posting URL with tracking params stripped.
// It is an AGGREGATOR URL and UNCONFIRMED until an evaluating mode confirms the
// opening at the employer (AGENTS.md "Aggregator Listings — Confirm at the Employer").
import { senderDomain, extractListings, cleanTrackingParams } from './_common.mjs';

const FROM_DOMAIN = /(^|\.)naukri\.com$/;
const POSTING_PATH = /\/job-listings-/i;

/** @param {URL} u */
function canonicalize(u) {
  if (!POSTING_PATH.test(u.pathname)) return null;
  return cleanTrackingParams(u);
}

/** @type {{ id: string, matches: (e: any) => boolean, parse: (e: any) => any[] }} */
const parser = {
  id: 'naukri',
  matches({ headers }) {
    return FROM_DOMAIN.test(senderDomain(headers));
  },
  parse(email) {
    return extractListings(email, {
      hostTest: (h) => FROM_DOMAIN.test(h),
      canonicalize,
    });
  },
};

export default parser;
