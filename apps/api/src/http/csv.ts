import type { MatchView } from '@atx/application';

/**
 * CSV cells are quoted, and values a spreadsheet would execute as a formula
 * (leading = + - @ tab CR) are neutralised with a leading apostrophe: supplier
 * names and statements are untrusted (CSV/formula injection).
 */
export const csvCell = (value: string | number | boolean | null): string => {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/** Byte-order mark so spreadsheet tools detect UTF-8 (built from its code point to keep the source ASCII). */
const UTF8_BOM = String.fromCharCode(0xfeff);

const row = (cells: readonly (string | number | boolean | null)[]): string => cells.map(csvCell).join(',');

/** Shortlist export: one row per candidate, one column per constraint with status and evidence basis. */
export const shortlistCsv = (matches: readonly MatchView[], offeringUrl: (id: string) => string): string => {
  const constraints =
    matches[0]?.assessments.map((a) => ({ id: a.constraintId, label: `${a.description} [${a.priority}]` })) ??
    [];
  const header = [
    'Rank',
    'Offering',
    'Supplier',
    'Supplier verification',
    'Synthetic demo data',
    'Maturity',
    'Hard constraints',
    'Confidence',
    'Score (ordering only)',
    ...constraints.map((c) => c.label),
    'Open questions',
    'Link',
  ];
  const lines = matches.map((match) => {
    const byId = new Map(match.assessments.map((a) => [a.constraintId, a]));
    return row([
      match.rank,
      match.offering.name,
      match.offering.organization.name,
      match.offering.organization.verificationState,
      match.offering.isDemo,
      match.offering.maturity,
      match.hardConstraintStatus,
      match.confidence,
      match.score,
      ...constraints.map((c) => {
        const assessment = byId.get(c.id);
        if (!assessment) return '';
        return assessment.strongestTrustLabel
          ? `${assessment.status} — ${assessment.strongestTrustLabel}`
          : assessment.status;
      }),
      match.gaps.map((gap) => gap.suggestedQuestion).join(' | '),
      offeringUrl(match.offering.id),
    ]);
  });
  return `${UTF8_BOM}${row(header)}\r\n${lines.join('\r\n')}\r\n`;
};
