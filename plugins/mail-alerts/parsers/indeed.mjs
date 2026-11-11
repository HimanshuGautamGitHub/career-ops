// @ts-check
// Indeed job-alert parser. Indeed identifies a posting by its `jk` key, and the
// same requisition appears in an alert under several tracking wrappers
// (/rc/clk, /pagead/clk), so the canonical URL folds every wrapper to
// https://www.indeed.com/viewjob?jk={jk}. That is an AGGREGATOR URL and is
// UNCONFIRMED until an evaluating mode confirms the opening at the employer
// (AGENTS.md "Aggregator Listings — Confirm at the Employer").
import { senderDomain, extractListings, cleanTrackingParams } from './_common.mjs';

const FROM_DOMAIN = /(^|\.)indeed\.[a-z.]+$/;
const JOB_PATH = /^\/(viewjob|job|rc\/clk|pagead\/clk|cmp)/i;

/** @param {URL} u */
function canonicalize(u) {
  const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
  if (jk && /^[a-z0-9]+$/i.test(jk)) return `https://www.indeed.com/viewjob?jk=${jk}`;
  if (JOB_PATH.test(u.pathname)) return cleanTrackingParams(u);
  return null;
}

/** @type {{ id: string, matches: (e: any) => boolean, parse: (e: any) => any[] }} */
const parser = {
  id: 'indeed',
  matches({ headers }) {
    return FROM_DOMAIN.test(senderDomain(headers));
  },
  parse(email) {
    return extractListings(email, {
      hostTest: (h) => FROM_DOMAIN.test(h),
      canonicalize,
      slugTitle: false, // a /viewjob?jk= URL has no title slug
    });
  },
};

export default parser;
