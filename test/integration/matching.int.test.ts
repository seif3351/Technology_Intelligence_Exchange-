import type { Runtime } from '@atx/runtime';
import { createTestRuntime } from '@atx/test-utils';
import { drainJobs } from '@atx/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
  await drainJobs(runtime); // seed-time indexing
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

const search = async (text: string) => {
  const response = await http.post('/v1/matches', { text, limit: 20 });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    matches: {
      offering: { name: string };
      assessments: { description: string; status: string }[];
      gaps: { suggestedQuestion: string }[];
    }[];
    omittedWithoutEvidence: number;
    totalCandidatesEvaluated: number;
    interpretation: { constraints: { description: string }[] };
  };
};

describe('matching relevance and wording (expert review A2, A4)', () => {
  it('lists only offerings with some evidence on the request and reports the rest', async () => {
    const result = await search(
      'I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.',
    );
    expect(result.matches[0]?.offering.name).toBe('VectorForge Adaptive Middleware');
    for (const match of result.matches) {
      expect(
        match.assessments.some((a) => a.status !== 'unknown'),
        `${match.offering.name} has no information on any constraint`,
      ).toBe(true);
    }
    // Northstar Log Intelligence was retrieved by similarity only and says nothing about the request.
    expect(result.matches.map((m) => m.offering.name)).not.toContain('Northstar Log Intelligence');
    expect(result.omittedWithoutEvidence).toBeGreaterThanOrEqual(1);
    expect(result.totalCandidatesEvaluated).toBe(result.matches.length);
  });

  it('describes constraints in plain words everywhere (interpretation, assessments, questions)', async () => {
    const result = await search('ASPICE CL2 supplier with QNX support.');
    const descriptions = result.interpretation.constraints.map((c) => c.description);
    expect(descriptions).toContain('Experience with Automotive SPICE (CL2 or higher)');
    expect(descriptions).toContain('Supports QNX');
    const all = JSON.stringify(result);
    expect(all).not.toMatch(/level \\"/);
    expect(all).not.toContain('— supports');
  });
});
