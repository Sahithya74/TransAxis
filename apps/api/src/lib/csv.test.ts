import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, toCsvText, unguardCell, UTF8_BOM } from './csv.js';

describe('csvCell', () => {
  it('quotes only when needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42.5)).toBe('42.5');
  });

  it('defuses text that a spreadsheet would run as a formula, but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csvCell('+91 98400')).toBe("'+91 98400");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-1500.00')).toBe('-1500.00');
    expect(csvCell(-3)).toBe('-3');
  });
});

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes, embedded line breaks and both line endings', () => {
    const rows = parseCsv(`${UTF8_BOM}name,notes\r\n"Kaveri, Roadlines","said ""ok"""\n"two\nlines",x\r\n`);
    expect(rows).toEqual([
      { line: 1, cells: ['name', 'notes'] },
      { line: 2, cells: ['Kaveri, Roadlines', 'said "ok"'] },
      { line: 3, cells: ['two\nlines', 'x'] },
    ]);
  });

  it('skips blank lines but keeps the real line numbers', () => {
    const rows = parseCsv('a,b\n\n1,2\n,\n3,4');
    expect(rows.map((r) => r.line)).toEqual([1, 3, 5]);
    expect(rows[2]!.cells).toEqual(['3', '4']);
  });

  it('keeps empty cells and refuses an unclosed quote', () => {
    expect(parseCsv('a,,c')[0]!.cells).toEqual(['a', '', 'c']);
    expect(() => parseCsv('a,"b\nc')).toThrow(/never closed/);
  });

  it('round-trips what toCsvText writes, including defused formulas', () => {
    const text = toCsvText(['code', 'name'], [['C-1', '=cmd'], ['C-2', 'A "quoted", name']]);
    const rows = parseCsv(text).map((r) => r.cells.map(unguardCell));
    expect(rows).toEqual([
      ['code', 'name'],
      ['C-1', '=cmd'],
      ['C-2', 'A "quoted", name'],
    ]);
  });
});
