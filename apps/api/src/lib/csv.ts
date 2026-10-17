/** CSV writing and reading (RFC 4180), shared by exports, reports and imports. */

// Spreadsheet apps run a cell that starts with one of these as a formula, so text like
// "=HYPERLINK(...)" in a customer name could execute when someone opens the export.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** One cell: quoted when needed, and text that would run as a formula is prefixed with an apostrophe. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** A whole file with Windows line endings, which every spreadsheet app reads. */
export function toCsvText(header: string[], rows: unknown[][]): string {
  return `${[csvLine(header), ...rows.map(csvLine)].join('\r\n')}\r\n`;
}

/** Excel needs the byte-order mark to read UTF-8 (₹, names in Indian scripts) correctly. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

export interface CsvRow {
  /** 1-based line where the row starts, for error messages. */
  line: number;
  cells: string[];
}

export class CsvParseError extends Error {}

/**
 * Parses CSV text: quoted fields with doubled quotes and line breaks, CRLF or LF, and an optional
 * byte-order mark. Blank lines are skipped. Throws CsvParseError for an unclosed quote.
 */
export function parseCsv(text: string): CsvRow[] {
  const s = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new CsvParseError(`A quoted value that starts on line ${rowLine} is never closed`);
  if (cell !== '' || cells.length) endRow();
  return rows;
}

/** Undoes the apostrophe `csvCell` adds, so an exported file imports back unchanged. */
export const unguardCell = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
