import { describe, expect, it } from 'vitest';
import { csvCell } from '../src/http/csv';

describe('CSV cells', () => {
  it('quotes values and escapes quotes', () => {
    expect(csvCell('Say "hi", world')).toBe('"Say ""hi"", world"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3)).toBe('"3"');
  });

  it('neutralises spreadsheet formulas in untrusted supplier text', () => {
    for (const payload of ['=HYPERLINK("http://evil")', '+1+1', '-2', '@SUM(A1)', '\tx', '\rx'])
      expect(csvCell(payload).startsWith(`"'`)).toBe(true);
  });
});
