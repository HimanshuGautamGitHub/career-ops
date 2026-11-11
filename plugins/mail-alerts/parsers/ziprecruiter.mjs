// @ts-check
// ZipRecruiter job-alert parser. Postings live under /jobs/, /job/ or /c/ paths;
// the canonical URL is the posting URL with tracking params stripped. It is an
// AGGREGATOR URL and UNCONFIRMED until an evaluating mode confirms the opening
// at the employer (AGENTS.md "Aggregator Listings — Confirm at the Employer").
import { senderDomain, extractListings, cleanTrackingParams } from './_common.mjs';

const FROM_DOMAIN = /(^|\.)ziprecruiter\.[a-z.]+$/;
const POSTING_PATH = /^\/(jobs?|c)\//i;

/** @param {URL} u */
function canonicalize(u) {
  if (!POSTING_PATH.test(u.pathname)) return null;
  return cleanTrackingParams(u);
}

/** @type {{ id: string, matches: (e: any) => boolean, parse: (e: any) => any[] }} */
const parser = {
  id: 'ziprecruiter',
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
