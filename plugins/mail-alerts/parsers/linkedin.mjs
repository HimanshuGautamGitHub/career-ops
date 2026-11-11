// @ts-check
// LinkedIn job-alert parser. Delegates to the project's existing, battle-tested
// lib/linkedin-import.mjs (id extraction + lines-above title/company/location
// heuristic) so there is one source of truth for LinkedIn parsing, and maps its
// output to the plugin ingest Job shape.
//
// The emitted URL is the canonical LinkedIn posting URL
// (https://www.linkedin.com/jobs/view/{id}) — an AGGREGATOR URL, UNCONFIRMED by
// design (AGENTS.md "Aggregator Listings — Confirm at the Employer"). This
// parser never resolves to the employer's own careers page.
import { senderDomain } from './_common.mjs';
import { linkedInJobsFromText, linkedInOffers } from '../../../lib/linkedin-import.mjs';

const FROM_DOMAIN = /(^|\.)linkedin\.com$/;

/** @type {{ id: string, matches: (e: any) => boolean, parse: (e: any) => any[] }} */
const parser = {
  id: 'linkedin',
  matches({ headers }) {
    return FROM_DOMAIN.test(senderDomain(headers));
  },
  parse({ body }) {
    const text = body || '';
    const jobs = linkedInJobsFromText(text);
    if (!jobs.length) return [];
    const seen = new Set();
    const out = [];
    for (const offer of linkedInOffers(jobs, text)) {
      if (!offer.url || seen.has(offer.url)) continue;
      seen.add(offer.url);
      out.push({
        title: offer.title || 'Job alert',
        url: offer.url,
        company: offer.company || '',
        location: offer.location || '',
      });
    }
    return out;
  },
};

export default parser;
