const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'as', 'vs', 'via', 'per', 'with', 'from', 'into', 'than']);

const cap = (w: string): string => w.replace(/[A-Za-z]/, (c) => c.toUpperCase());

/**
 * Title case for headings, tabs and labels: every word starts with a capital, small words (a, of, to, …) stay lower
 * case unless first. Words that already have a capital inside (iPhone, AMEX, PointWise), start with a digit or
 * symbol, or are all upper case are left alone, and sentences (ending in . or ? or more than nine words) are
 * returned unchanged so body text is never altered.
 */
export function titleCase(input: string | number): string {
  const text = String(input);
  if (!text || /[.?]$/.test(text.trim()) || text.trim().split(/\s+/).length > 9) return text;
  let first = true;
  return text
    .split(/(\s+)/)
    .map((tok) => {
      if (!tok.trim()) return tok;
      const isFirst = first;
      first = false;
      const core = tok.replace(/^[("'“]+/, '');
      if (!/^[a-z]/.test(core)) return tok;
      if (/[A-Z]/.test(core.slice(1))) return tok;
      const lead = tok.slice(0, tok.length - core.length);
      const bare = core.replace(/[^a-z]/g, '');
      if (!isFirst && SMALL.has(bare)) return tok;
      return lead + core.split('-').map(cap).join('-');
    })
    .join('');
}
