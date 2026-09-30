import { describe, expect, it } from 'vitest';
import {
  type Requirement,
  asId,
  assertNoConfidentialLeak,
  checkExternalUrl,
  findConfidentialLeaks,
  normalizeConfidentialTerms,
  toSupplierFacingRequirement,
} from '../src';

const requirement: Requirement = {
  id: asId('00000000-0000-4000-8000-000000000010'),
  organizationId: asId('00000000-0000-4000-8000-000000000011'),
  title: 'Project Falcon ADAS integration testing',
  description: 'For vehicle program VP-2031 with customer Contoso Motors',
  constraints: [],
  confidentialTerms: normalizeConfidentialTerms(['Project Falcon', 'VP-2031', 'Contoso Motors', 'Contoso Motors']),
  visibility: 'private',
  status: 'draft',
  createdBy: asId('00000000-0000-4000-8000-000000000012'),
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('confidential requirement handling', () => {
  it('deduplicates confidential terms', () => {
    expect(requirement.confidentialTerms).toEqual(['Project Falcon', 'VP-2031', 'Contoso Motors']);
  });

  it('detects leaks regardless of case, punctuation and spacing', () => {
    expect(findConfidentialLeaks('Our PROJECT-FALCON needs...', requirement.confidentialTerms)).toEqual(['Project Falcon']);
    expect(findConfidentialLeaks('program vp 2031', requirement.confidentialTerms)).toEqual(['VP-2031']);
    expect(findConfidentialLeaks('for contosomotors', requirement.confidentialTerms)).toEqual(['Contoso Motors']);
    expect(findConfidentialLeaks('Generic ADAS integration testing', requirement.confidentialTerms)).toEqual([]);
  });

  it('refuses supplier-facing summaries that contain confidential terms without echoing them', () => {
    expect(() => assertNoConfidentialLeak('Project Falcon', requirement.confidentialTerms)).toThrow(
      /1 confidential term/,
    );
    try {
      toSupplierFacingRequirement(requirement, 'Integration testing for Contoso Motors', 'REQ-1');
    } catch (error) {
      expect(String(error)).not.toContain('Contoso');
    }
  });

  it('builds supplier-facing views from an allow-list of fields', () => {
    const view = toSupplierFacingRequirement(requirement, 'ADAS integration testing on QNX', 'REQ-1');
    expect(Object.keys(view).sort()).toEqual(['constraints', 'disclosedSummary', 'reference']);
    expect(JSON.stringify(view)).not.toMatch(/Falcon|VP-2031|Contoso/);
  });
});

describe('external URL policy', () => {
  it.each([
    ['http://example.com', 'https'],
    ['https://localhost/x', 'private'],
    ['https://127.0.0.1/', 'private'],
    ['https://169.254.169.254/latest/meta-data', 'private'],
    ['https://10.1.2.3/', 'private'],
    ['https://[::1]/', 'private'],
    ['https://user:pw@example.com', 'credentials'],
    // The WHATWG URL parser canonicalizes decimal IPv4 hosts to 127.0.0.1.
    ['https://2130706433/', 'private'],
    ['https://0x7f.1/', 'private'],
    ['javascript:alert(1)', 'https'],
  ])('rejects %s', (url, reason) => {
    const result = checkExternalUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it('accepts public https URLs', () => {
    expect(checkExternalUrl('https://docs.example.com/whitepaper.pdf').ok).toBe(true);
  });
});
