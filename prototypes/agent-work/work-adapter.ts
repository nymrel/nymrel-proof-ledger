/** A pure fixture adapter: compares at most ten saved fictional page records. */
import { canonicalize } from '../../src/core/canonical.js';
import type { Listing } from './contracts.js';

export function releasePacket(listing: Listing): string {
  if (listing.pages.length > 10 || listing.manifest.length > 10) throw Error('Page limit');
  const findings = listing.manifest.map(expected => {
    const observed = listing.pages.find(p => p.pageId === expected.pageId);
    const failures: string[] = [];
    if (!observed) failures.push('MISSING_PAGE');
    else {
      if (observed.status !== expected.status) failures.push('STATUS');
      if (observed.title !== expected.title) failures.push('TITLE');
      if (observed.canonical !== expected.canonical) failures.push('CANONICAL');
      for (const link of expected.requiredLinks) if (!observed.links.includes(link)) failures.push(`REQUIRED_LINK:${link}`);
    }
    return { pageId: expected.pageId, failures, observed: observed ?? null };
  });
  return canonicalize({ schema: 'nymrel.fictional-release-packet/0.1', workId: listing.id,
    criteriaRevision: listing.criteriaRevision, observedAt: listing.observedAt,
    evidenceSource: 'SAVED_FICTIONAL_PAGES', networkAccess: false, findings,
    claims: 'Comparison with the supplied manifest only; no security, SEO or live-site certification.' });
}
