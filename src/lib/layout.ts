import type { MathStyle, PageShapes, TextBox } from '../types/quire';
import { structure, tidy, toTex } from './math';

export interface LayoutOptions {
  tables?: boolean;
  cols?: boolean;
  headings?: boolean;
  math?: MathStyle;
  shapes?: PageShapes | null;
}

const SUP_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
};
const SUB_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

function median(nums: number[]): number {
  if (!nums.length) return 12;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 12;
}

function mathify(bs: TextBox[], style: MathStyle, wrap = true): TextBox[] {
  if (style === 'off' || !bs.length) return bs;
  const sorted = [...bs].sort((a, b) => a.x0 - b.x0);
  const med = median(sorted.filter((b) => !b.fig).map((b) => b.h));
  const out: TextBox[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = { ...sorted[i] };
    if (cur.fig) {
      out.push(cur);
      continue;
    }

    // Attach adjacent superscript / subscript tokens
    while (i + 1 < sorted.length) {
      const nxt = sorted[i + 1];
      if (nxt.fig || nxt.x0 - cur.x1 > 0.65 * med) break;
      const dy = nxt.y - cur.y;
      const small = nxt.h <= 0.85 * Math.max(cur.h, med);
      if (small && dy > 0.25 * med && dy < 1.15 * med) {
        const txt = nxt.s.trim();
        if (style === 'latex') {
          const base = cur.m ? cur.s : toTex(cur.s);
          const sup = toTex(txt).trim();
          cur.s = `${base}^{${sup}}`;
          cur.m = true;
        } else if (style === 'unicode') {
          const uni = [...txt].map((c) => SUP_MAP[c] || c).join('');
          cur.s = `${cur.s}${uni}`;
        } else {
          cur.s = `${cur.s}^${txt.length > 1 ? `(${txt})` : txt}`;
        }
        cur.x1 = Math.max(cur.x1, nxt.x1);
        i++;
        continue;
      }
      if (small && dy < -0.18 * med && dy > -0.75 * med) {
        const txt = nxt.s.trim();
        if (style === 'latex') {
          const base = cur.m ? cur.s : toTex(cur.s);
          const sub = toTex(txt).trim();
          cur.s = `${base}_{${sub}}`;
          cur.m = true;
        } else if (style === 'unicode') {
          const uni = [...txt].map((c) => SUB_MAP[c] || c).join('');
          cur.s = `${cur.s}${uni}`;
        } else {
          cur.s = `${cur.s}_${txt.length > 1 ? `(${txt})` : txt}`;
        }
        cur.x1 = Math.max(cur.x1, nxt.x1);
        i++;
        continue;
      }
      break;
    }

    if (wrap && style === 'latex' && cur.m && !cur.s.startsWith('$')) {
      cur.s = `$${cur.s}$`;
    }
    out.push(cur);
  }
  return out;
}

function splitColumns(boxes: TextBox[], med: number): TextBox[][] {
  if (boxes.length < 16) return [boxes];
  const minX = Math.min(...boxes.map((b) => b.x0));
  const maxX = Math.max(...boxes.map((b) => b.x1));
  const width = maxX - minX;
  if (width < 220) return [boxes];

  const midLo = minX + width * 0.35;
  const midHi = minX + width * 0.65;
  const bins = 40;
  const step = (midHi - midLo) / bins;
  let bestX = -1;
  let bestCrossings = Infinity;

  for (let i = 0; i <= bins; i++) {
    const gx = midLo + i * step;
    const crossings = boxes.filter((b) => !b.fig && b.x0 < gx && b.x1 > gx).length;
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      bestX = gx;
    }
  }

  if (bestX < 0 || bestCrossings > Math.max(2, Math.floor(boxes.length * 0.04))) {
    return [boxes];
  }

  const left = boxes.filter((b) => (b.x0 + b.x1) / 2 < bestX);
  const right = boxes.filter((b) => (b.x0 + b.x1) / 2 >= bestX);
  if (left.length < 5 || right.length < 5) return [boxes];

  // Ensure meaningful vertical overlap between columns
  const lyMin = Math.min(...left.map((b) => b.y));
  const lyMax = Math.max(...left.map((b) => b.y));
  const ryMin = Math.min(...right.map((b) => b.y));
  const ryMax = Math.max(...right.map((b) => b.y));
  const overlap = Math.min(lyMax, ryMax) - Math.max(lyMin, ryMin);
  if (overlap < med * 4) return [boxes];

  return [left, right];
}

interface Row {
  y: number;
  h: number;
  cells: Array<{ x0: number; x1: number; text: string; isFig?: boolean }>;
  rawBoxes: TextBox[];
}

function groupRows(boxes: TextBox[], med: number, style: MathStyle): Row[] {
  const sorted = [...boxes].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: TextBox[][] = [];
  for (const b of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - b.y) <= Math.max(3, 0.55 * med)) {
      last.push(b);
    } else {
      lines.push([b]);
    }
  }

  return lines.map((ln) => {
    const processed = style !== 'off' ? mathify(ln, style, true) : [...ln].sort((a, b) => a.x0 - b.x0);
    const cells: Row['cells'] = [];
    for (const b of processed) {
      const text = b.s.trim();
      if (!text) continue;
      const prev = cells[cells.length - 1];
      const gap = prev ? b.x0 - prev.x1 : 0;
      if (prev && !prev.isFig && !b.fig && gap < Math.max(8, 1.35 * med)) {
        prev.text += (gap > 0.2 * med ? ' ' : '') + text;
        prev.x1 = Math.max(prev.x1, b.x1);
      } else {
        cells.push({ x0: b.x0, x1: b.x1, text, isFig: b.fig });
      }
    }
    return {
      y: ln[0].y,
      h: median(ln.filter((b) => !b.fig).map((b) => b.h)),
      cells,
      rawBoxes: ln,
    };
  }).filter((r) => r.cells.length > 0);
}

function formatTableBlock(rows: Row[]): string {
  const colPositions: number[] = [];
  for (const r of rows) {
    for (const c of r.cells) {
      const existing = colPositions.find((x) => Math.abs(x - c.x0) < 24);
      if (existing === undefined) colPositions.push(c.x0);
    }
  }
  colPositions.sort((a, b) => a - b);
  if (colPositions.length < 2) return rows.map((r) => r.cells.map((c) => c.text).join(' ')).join('\n');

  const grid = rows.map((r) => {
    const rowArr = Array(colPositions.length).fill('');
    for (const c of r.cells) {
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < colPositions.length; i++) {
        const d = Math.abs(colPositions[i] - c.x0);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      rowArr[bestIdx] = rowArr[bestIdx] ? `${rowArr[bestIdx]} ${c.text}` : c.text;
    }
    return rowArr.map((cell) => cell.replace(/\|/g, '\\|'));
  });

  const header = `| ${grid[0].join(' | ')} |`;
  const sep = `| ${colPositions.map(() => '---').join(' | ')} |`;
  const body = grid.slice(1).map((r) => `| ${r.join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

export function boxesToMd(boxes: TextBox[], opts: LayoutOptions = {}): string {
  const clean = boxes.filter((b) => b.s && b.s.trim().length > 0);
  if (!clean.length) return '';

  const style: MathStyle = opts.math || 'off';
  const med = median(clean.filter((b) => !b.fig).map((b) => b.h));

  const structured =
    style !== 'off'
      ? structure(clean, opts.shapes || null, { style, med, mathify })
      : clean;

  const chunks = opts.cols ? splitColumns(structured, med) : [structured];
  const mdBlocks: string[] = [];

  for (const chunk of chunks) {
    const rows = groupRows(chunk, med, style);
    let i = 0;
    while (i < rows.length) {
      // Detect table runs (>= 2 consecutive rows with >= 2 separated cells)
      if (opts.tables && rows[i].cells.length >= 2 && !rows[i].cells.some((c) => c.isFig)) {
        let j = i + 1;
        while (
          j < rows.length &&
          rows[j].cells.length >= 2 &&
          !rows[j].cells.some((c) => c.isFig) &&
          Math.abs(rows[j - 1].y - rows[j].y) < med * 3.2
        ) {
          j++;
        }
        if (j - i >= 2) {
          mdBlocks.push(formatTableBlock(rows.slice(i, j)));
          i = j;
          continue;
        }
      }

      const r = rows[i];
      let lineText = r.cells.map((c) => c.text).join(' ').replace(/\s{2,}/g, ' ').trim();
      if (style === 'latex') lineText = tidy(lineText);

      if (opts.headings && !r.cells.some((c) => c.isFig) && lineText.length < 110) {
        if (r.h >= med * 1.55) {
          lineText = `# ${lineText}`;
        } else if (r.h >= med * 1.25) {
          lineText = `## ${lineText}`;
        }
      }

      // Paragraph break detection using vertical gap
      if (i > 0 && mdBlocks.length > 0) {
        const gap = rows[i - 1].y - r.y;
        const prevLine = mdBlocks[mdBlocks.length - 1];
        if (
          gap < med * 1.7 &&
          !lineText.startsWith('#') &&
          !lineText.startsWith('|') &&
          !prevLine.startsWith('#') &&
          !prevLine.startsWith('|') &&
          !prevLine.startsWith('[') &&
          !lineText.startsWith('[') &&
          !/[.:!?]$/.test(prevLine)
        ) {
          mdBlocks[mdBlocks.length - 1] = `${prevLine} ${lineText}`;
          i++;
          continue;
        }
      }

      mdBlocks.push(lineText);
      i++;
    }
  }

  return mdBlocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
