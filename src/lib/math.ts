import type {
  DetectedFigure,
  MathStyle,
  PageShapes,
  TextBox,
  VectorBar,
  VectorGlyph,
  VectorHead,
  VectorRad,
  VectorVBar,
} from '../types/quire';

const SYM: Record<string, string> = {
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', j: 'ϕ', k: 'κ', l: 'λ', m: 'μ', n: 'ν',
  o: 'ο', p: 'π', q: 'θ', r: 'ρ', s: 'σ', t: 'τ', u: 'υ', v: 'ϖ', w: 'ω', x: 'ξ', y: 'ψ', z: 'ζ',
  D: 'Δ', F: 'Φ', G: 'Γ', J: 'ϑ', L: 'Λ', P: 'Π', Q: 'Θ', S: 'Σ', W: 'Ω', X: 'Ξ', Y: 'Ψ',
};

export const BRK: Record<string, string> = {
  '\uf8eb': '(', '\uf8ec': '(', '\uf8ed': '(', '\uf8f6': ')', '\uf8f7': ')', '\uf8f8': ')',
  '\uf8ee': '[', '\uf8ef': '[', '\uf8f0': '[', '\uf8f9': ']', '\uf8fa': ']', '\uf8fb': ']',
  '\uf8f1': '{', '\uf8f2': '{', '\uf8f3': '{', '\uf8fc': '}', '\uf8fd': '}', '\uf8fe': '}',
};

export const UNKNOWN = '⟨?⟩';

export function fixText(s: string, fontName?: string): string {
  const f = fontName || '';
  if (/symbol/i.test(f)) s = s.replace(/[A-Za-z]/g, (c) => SYM[c] || c);
  else if (/wingdings|zapf|dingbats/i.test(f)) s = s.replace(/[\uf000-\uf0ff]/g, '•');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, UNKNOWN);
  return s;
}

const mul = (a: number[], b: number[]): number[] => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

interface Prim {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  k: 'img' | 'h' | 'v' | 'c' | 'f';
  pts?: number;
}

export function shapesFromOps(
  ol: { fnArray: number[]; argsArray: unknown[] },
  OPS: Record<string, number>,
  pageW = 600,
  pageH = 800
): PageShapes {
  const bars: VectorBar[] = [];
  const rads: VectorRad[] = [];
  const vbars: VectorVBar[] = [];
  const glyphs: VectorGlyph[] = [];
  const heads: VectorHead[] = [];
  const prims: Prim[] = [];
  const st: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];

  const PAINT = new Set([
    OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
    OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.endPath, OPS.clip, OPS.eoClip,
  ]);
  const FILL = new Set([
    OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  ]);
  const STROKE = new Set([
    OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  ]);

  const { fnArray: fn, argsArray: ar } = ol;
  for (let i = 0; i < fn.length; i++) {
    const f = fn[i];
    const a = ar[i] as unknown[];
    if (f === OPS.save) st.push(ctm);
    else if (f === OPS.restore) ctm = st.pop() || ctm;
    else if (f === OPS.transform) ctm = mul(ctm, a as number[]);
    else if (f === OPS.paintFormXObjectBegin) {
      st.push(ctm);
      if (a && a[0]) ctm = mul(ctm, a[0] as number[]);
    } else if (f === OPS.paintFormXObjectEnd) ctm = st.pop() || ctm;
    else if (
      f === OPS.paintImageXObject ||
      f === OPS.paintInlineImageXObject ||
      f === OPS.paintImageMaskXObject
    ) {
      const q = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [
        ctm[0] * x + ctm[2] * y + ctm[4],
        ctm[1] * x + ctm[3] * y + ctm[5],
      ]);
      const xs = q.map((p) => p[0]);
      const ys = q.map((p) => p[1]);
      prims.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), k: 'img' });
    } else if (f === OPS.constructPath) {
      let paint = -1;
      for (let k = i + 1; k < Math.min(fn.length, i + 4); k++) {
        if (PAINT.has(fn[k])) {
          paint = fn[k];
          break;
        }
      }
      if (paint < 0 || paint === OPS.endPath || paint === OPS.clip || paint === OPS.eoClip) continue;
      if (!Array.isArray(a) || a.length < 2) continue;
      const ops = a[0] as number[];
      const co = a[1] as number[];
      if (!ops || !co) continue;
      const pts: Array<[number, number]> = [];
      const subs: Array<Array<[number, number]>> = [];
      let c = 0;
      let onlyLines = true;
      for (const op of ops) {
        if (op === OPS.moveTo || op === OPS.lineTo) {
          if (op === OPS.moveTo) subs.push([]);
          subs[subs.length - 1]?.push([co[c], co[c + 1]]);
          pts.push([co[c], co[c + 1]]);
          c += 2;
        } else if (op === OPS.rectangle) {
          const x = co[c], y = co[c + 1], w = co[c + 2], h = co[c + 3];
          pts.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
          c += 4;
          onlyLines = false;
        } else if (op === OPS.curveTo) {
          c += 6;
          onlyLines = false;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          c += 4;
          onlyLines = false;
        }
      }
      if (!pts.length) continue;

      if (STROKE.has(paint) && subs.length > 1 && subs.every((sp) => sp.length === 2)) {
        for (const sp of subs) {
          const q = sp.map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
          const w = Math.abs(q[1][0] - q[0][0]);
          if (w > 3 && w < pageW * 0.6 && Math.abs(q[1][1] - q[0][1]) < 0.4) {
            bars.push({
              x0: Math.min(q[0][0], q[1][0]),
              x1: Math.max(q[0][0], q[1][0]),
              y: (q[0][1] + q[1][1]) / 2,
            });
          }
        }
        continue;
      }

      const P = pts.map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = P.map((p) => p[0]);
      const ys = P.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w = x1 - x0, h = y1 - y0;

      if (w > 3 && w < pageW * 0.6 && ((STROKE.has(paint) && P.length <= 2 && h < 0.4) || (FILL.has(paint) && h < 1.5 && h >= 0))) {
        bars.push({ x0, x1, y: (y0 + y1) / 2 });
        prims.push({ x0, x1, y0, y1, k: 'h' });
        continue;
      }
      if (w < 0.5 && h > 14 && h < 200 && ((STROKE.has(paint) && P.length <= 2) || (FILL.has(paint) && P.length <= 4))) {
        vbars.push({ x: (x0 + x1) / 2, y0, y1 });
        prims.push({ x0, x1, y0, y1, k: 'v' });
        continue;
      }
      if (FILL.has(paint) && w < 1.5 && h > 14 && h < 200 && onlyLines) {
        vbars.push({ x: (x0 + x1) / 2, y0, y1 });
        prims.push({ x0, x1, y0, y1, k: 'v' });
        continue;
      }
      if (FILL.has(paint) && onlyLines && P.length >= 6 && w > 4 && w < 250 && h > 5 && h < 45) {
        const top = P.filter((p) => y1 - p[1] < 0.35);
        if (top.length < 2) continue;
        const bx0 = Math.min(...top.map((p) => p[0]));
        const bx1 = Math.max(...top.map((p) => p[0]));
        if (bx1 - bx0 < 2 || x0 > bx0 - 1) continue;
        rads.push({ x0, x1, bx0, bx1, yb: y0, yt: y1 });
        continue;
      }
      if (FILL.has(paint) && onlyLines && P.length >= 3 && P.length <= 5 && w < 9 && h < 9) {
        heads.push({ x0, x1, y: (y0 + y1) / 2 });
        continue;
      }
      if (FILL.has(paint) && !onlyLines && w < 22 && h < 22) {
        glyphs.push({ x0, x1, y0, y1 });
        continue;
      }
      if (w > 2 || h > 2) {
        prims.push({
          x0, x1, y0, y1,
          k: STROKE.has(paint) ? (!onlyLines || P.length > 2 ? 'c' : w >= h ? 'h' : 'v') : 'f',
          pts: P.length,
        });
      }
    }
  }

  const figs = clusterFigs(prims, pageW, pageH);
  const inFig = (x: number, y: number) => figs.some((g) => x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1);
  const dup = (b: VectorBar) => rads.some((r) => Math.abs(b.y - r.yt) < 1.5 && b.x0 < r.bx1 + 1 && b.x1 > r.bx0 - 1);

  return {
    bars: bars.filter((b) => !dup(b) && !inFig((b.x0 + b.x1) / 2, b.y)),
    rads: rads.filter((r) => !inFig((r.bx0 + r.bx1) / 2, r.yb)),
    vbars: vbars.filter((v) => !inFig(v.x, (v.y0 + v.y1) / 2)),
    glyphs: glyphs.filter((g) => !inFig((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2)),
    figs,
    heads,
  };
}

function clusterFigs(prims: Prim[], pageW: number, pageH: number): DetectedFigure[] {
  const M = 5;
  const P = prims.filter(
    (p) =>
      !(p.k === 'h' && p.x1 - p.x0 > pageW * 0.6) &&
      !(p.x1 - p.x0 > pageW * 0.9 && p.y1 - p.y0 > pageH * 0.6) &&
      (p.k !== 'f' || (p.x1 - p.x0 > 3 && p.y1 - p.y0 > 3) || (p.pts || 0) > 4)
  );
  const par = P.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  const ov = (a: Prim, b: Prim) =>
    a.x0 - M < b.x1 && b.x0 - M < a.x1 && a.y0 - M < b.y1 && b.y0 - M < a.y1;
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      if (ov(P[i], P[j])) par[find(i)] = find(j);
    }
  }
  const cl = new Map<number, Prim[]>();
  P.forEach((p, i) => {
    const r = find(i);
    if (!cl.has(r)) cl.set(r, []);
    cl.get(r)!.push(p);
  });
  const out: DetectedFigure[] = [];
  for (const g of cl.values()) {
    const x0 = Math.min(...g.map((p) => p.x0));
    const x1 = Math.max(...g.map((p) => p.x1));
    const y0 = Math.min(...g.map((p) => p.y0));
    const y1 = Math.max(...g.map((p) => p.y1));
    const w = x1 - x0, h = y1 - y0;
    if (w < 45 || h < 45 || (w > pageW * 0.95 && h > pageH * 0.85)) continue;
    const img = g.some((p) => p.k === 'img' && p.x1 - p.x0 > 45 && p.y1 - p.y0 > 45);
    const curves = g.filter((p) => p.k === 'c' || p.k === 'f').length;
    const hl = g.some((p) => p.k === 'h' && p.x1 - p.x0 > 0.5 * w);
    const vl = g.some((p) => p.k === 'v' && p.y1 - p.y0 > 0.5 * h);
    const longH = g.filter((p) => p.k === 'h' && p.x1 - p.x0 > 0.6 * w).length;
    if (longH >= 3 && curves < 3 && !img) continue;
    if (!(img || curves >= 3 || (hl && vl))) continue;
    out.push({ x0, x1, y0, y1, kind: hl && vl ? 'graph' : img ? 'image' : 'figure', n: g.length });
  }
  return out;
}

const TEXG: Record<string, string> = {
  'π': '\\pi ', 'θ': '\\theta ', 'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
  'Δ': '\\Delta ', 'φ': '\\phi ', 'ϕ': '\\phi ', 'ω': '\\omega ', 'Ω': '\\Omega ', 'λ': '\\lambda ',
  'μ': '\\mu ', 'σ': '\\sigma ', 'ρ': '\\rho ', 'τ': '\\tau ', 'ε': '\\epsilon ', 'η': '\\eta ',
  'Σ': '\\Sigma ', 'Π': '\\Pi ', 'Γ': '\\Gamma ', 'Θ': '\\Theta ', '≤': '\\le ', '≥': '\\ge ',
  '≠': '\\ne ', '∈': '\\in ', '±': '\\pm ', '×': '\\times ', '÷': '\\div ', '−': '-', '–': '-',
  '∗': '*', 'º': '^{\\circ}', '°': '^{\\circ}', '∠': '\\angle ', '∞': '\\infty ', '∴': '\\therefore ',
  '→': '\\to ', '∫': '\\int ', '∬': '\\iint ', '∭': '\\iiint ', '∮': '\\oint ', '∑': '\\sum ',
  '∏': '\\prod ', '∂': '\\partial ', '∇': '\\nabla ', '·': '\\cdot ', '⋅': '\\cdot ', '≈': '\\approx ',
  '≡': '\\equiv ', '∝': '\\propto ', '⊥': '\\perp ', '∥': '\\parallel ', '′': "'", '″': "''",
  '∪': '\\cup ', '∩': '\\cap ', '⊂': '\\subset ', '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ',
  '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ', '∉': '\\notin ',
};

export function toTex(s: string): string {
  s = s.replace(/[πθαβγδΔφϕωΩλμσρτεηΣΠΓΘ≤≥≠∈±×÷−–∗º°∠∞∴→∫∬∭∮∑∏∂∇·⋅≈≡∝⊥∥′″∪∩⊂∅∀∃⇒⇔∉]/g, (c) => TEXG[c] || c);
  s = s
    .replace(/(?<![\\A-Za-z])(sin|cos|tan|cot|sec|log|ln)(?![A-Za-z])/g, '\\$1 ')
    .replace(/(?<![\\A-Za-z])cosec(?![A-Za-z])/g, '\\operatorname{cosec} ');
  return s;
}

const simple = (t: string) =>
  /^[A-Za-z0-9.πθαβγδΔφω⟨?⟩⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ₀-₉^_]+$/.test(t) || (/^\(.*\)$/.test(t) && !/\)\s*[^)]*\(/.test(t));

const plainFrac = (n: string, d: string) =>
  `${simple(n) ? n : `(${n})`}/${simple(d) ? d : `(${d})`}`;

function splitAt(b: TextBox, x: number): [TextBox, TextBox] | null {
  const s = b.s, n = s.length;
  if (n < 3 || !(x > b.x0 + 1 && x < b.x1 - 1)) return null;
  let best = -1, bd = 1e9;
  for (let i = 1; i < n - 1; i++) {
    if (/\s/.test(s[i])) {
      const px = b.x0 + ((b.x1 - b.x0) * (i + 0.5)) / n;
      const d = Math.abs(px - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  if (best < 0 || bd > (b.x1 - b.x0) * 0.3) return null;
  const px = b.x0 + ((b.x1 - b.x0) * (best + 0.5)) / n;
  const L = s.slice(0, best).trimEnd();
  const R = s.slice(best + 1).trimStart();
  if (!L || !R) return null;
  return [{ ...b, s: L, x1: px - 0.5 }, { ...b, s: R, x0: px + 0.5 }];
}

export function structure(
  boxes: TextBox[],
  shapes: PageShapes | null | undefined,
  o: {
    style: MathStyle;
    med?: number;
    mathify: (bs: TextBox[], style: MathStyle, wrap?: boolean) => TextBox[];
  }
): TextBox[] {
  const style = o.style, med = o.med || 12, mathify = o.mathify, tex = style === 'latex';
  let items: TextBox[] = boxes.map((b) => ({ ...b }));
  if (tex) {
    items = items.map((b) =>
      /[∫∬∭∮∑∏∂∇]/.test(b.s) && !b.m ? { ...b, s: toTex(b.s).trim(), m: true } : b
    );
  }

  const join = (bs: TextBox[]) => {
    const sorted = mathify(bs, tex ? 'latex' : style, false).sort((a, b) => a.x0 - b.x0);
    let out = '', end: number | null = null;
    for (const b of sorted) {
      const t = b.m || !tex ? b.s : toTex(b.s);
      out += (end !== null && b.x0 - end > 0.2 * med ? ' ' : '') + t;
      end = b.x1;
    }
    return out.trim();
  };

  const pcs = items.filter((b) => b.s.length === 1 && BRK[b.s]);
  items = items.filter((b) => !(b.s.length === 1 && BRK[b.s]));
  const brs: Array<{ ch: string; x0: number; x1: number; ymax: number; ymin: number; used?: boolean }> = [];
  pcs.sort((a, b) => a.x0 - b.x0 || b.y - a.y);
  for (const p of pcs) {
    const ch = BRK[p.s];
    const c = brs.find(
      (c) => c.ch === ch && Math.abs(c.x0 - p.x0) < 1.5 && (p.y > c.ymax ? p.y - c.ymax : c.ymin - p.y) < 1.25 * med
    );
    if (c) {
      c.ymax = Math.max(c.ymax, p.y);
      c.ymin = Math.min(c.ymin, p.y);
    } else {
      brs.push({ ch, x0: p.x0, x1: p.x1, ymax: p.y, ymin: p.y });
    }
  }

  const ACC: Record<string, string> = {
    '→': 'vec', '\u20d7': 'vec', '\u20d1': 'vec', '¯': 'bar', '‾': 'bar', 'ˉ': 'bar',
    'ˆ': 'hat', '^': 'hat', '˜': 'tilde', '˙': 'dot', '¨': 'ddot',
  };
  const COMB: Record<string, string> = {
    vec: '\u20d7', bar: '\u0304', hat: '\u0302', tilde: '\u0303', dot: '\u0307', ddot: '\u0308',
  };

  for (const a of items.filter((b) => !b.m && b.s.length === 1 && ACC[b.s] && b.x1 - b.x0 <= 1.4 * med)) {
    const L = items.find(
      (b) =>
        b !== a && !b.m && !b.br && /^[A-Za-zα-ωΑ-Ω]{1,3}$/.test(b.s) &&
        (a.x0 + a.x1) / 2 >= b.x0 - 2 && (a.x0 + a.x1) / 2 <= b.x1 + 2 &&
        a.y - b.y > 0.45 * med && a.y - b.y < 1.7 * med
    );
    if (!L) continue;
    const k = ACC[a.s];
    items = items.filter((b) => b !== a && b !== L);
    items.push({
      ...L,
      s: tex ? `\\${k}{${L.s}}` : style === 'unicode' ? [...L.s].map((c) => c + COMB[k]).join('') : `${k}(${L.s})`,
      m: tex,
    });
  }

  const BIGSYM = /^(?:[∫∬∭∮∑∏]|\\(?:int|iint|iiint|oint|sum|prod))$/;
  for (const O of items.filter((b) => BIGSYM.test(b.s.trim()) && !b.done)) {
    const near = items.filter(
      (b) => b !== O && !b.br && b.h <= 0.9 * med && b.x0 >= O.x0 - 2 && b.x0 <= O.x1 + 0.6 * med
    );
    const grab = (seed: TextBox[]) => {
      const g = [...seed];
      let grew = true;
      while (grew && g.length) {
        grew = false;
        for (const b of items) {
          if (
            !g.includes(b) && !b.br && b.h <= 0.9 * med &&
            Math.abs(b.y - g[0].y) < 0.4 * med &&
            b.x0 - Math.max(...g.map((q) => q.x1)) < 0.5 * med &&
            b.x0 >= g[0].x0 - 1 && b.x0 > Math.min(...g.map((q) => q.x0))
          ) {
            g.push(b);
            grew = true;
          }
        }
      }
      return g;
    };
    const hi = grab(near.filter((b) => b.y >= O.y + 0.55 * O.h));
    const lo = grab(near.filter((b) => b.y + 0.7 * b.h <= O.y + 0.35 * O.h));
    const used = new Set([...hi, ...lo]);
    items = items.filter((b) => !used.has(b));
    const sym = O.s.trim();
    const J = (g: TextBox[]) => (g.length ? join(g) : '');
    const H = J(hi), L = J(lo);
    const sm = (t: string) => (simple(t) ? t : `(${t})`);
    O.s = tex
      ? `${sym.startsWith('\\') ? sym : toTex(sym).trim()}${L ? `_{${L}}` : ''}${H ? `^{${H}}` : ''}`
      : `${sym}${L ? `_${sm(L)}` : ''}${H ? `^${sm(H)}` : ''}`;
    O.m = tex;
    O.done = true;
    O.y = O.y + 0.25 * O.h;
    O.h = med;
    O.x1 = Math.max(O.x1, ...hi.map((b) => b.x1), ...lo.map((b) => b.x1));
  }

  if (shapes && (shapes.bars.length || shapes.rads.length)) {
    const structs = [
      ...shapes.bars.map((b) => ({ t: 'f' as const, x0: b.x0, x1: b.x1, y: b.y, px0: b.x0, yb: 0, yt: 0 })),
      ...shapes.rads.map((r) => ({ t: 'r' as const, x0: r.bx0, x1: r.bx1, y: 0, px0: r.x0, yb: r.yb, yt: r.yt })),
    ];
    for (const s of structs) {
      for (const e of [s.x0, s.x1]) {
        const out: TextBox[] = [];
        for (const b of items) {
          const near = s.t === 'f' ? b.y > s.y - 1.7 * med && b.y < s.y + 1.3 * med : b.y > s.yb - 3 && b.y < s.yt + 3;
          const sp = near && b.x0 < e - 1 && b.x1 > e + 1 ? splitAt(b, e) : null;
          if (sp) out.push(...sp);
          else out.push(b);
        }
        items = out;
      }
    }
    structs.sort((a, b) => (a.x1 - a.x0) - (b.x1 - b.x0));
    const cx = (b: TextBox) => (b.x0 + b.x1) / 2;
    const inX = (b: TextBox, s: { x0: number; x1: number }) => cx(b) >= s.x0 - 1.5 && cx(b) <= s.x1 + 1.5;

    for (const s of structs) {
      if (s.t === 'f') {
        const num = items.filter((b) => inX(b, s) && b.y >= s.y + 1.5 && b.y <= s.y + 1.25 * med);
        const den = items.filter((b) => inX(b, s) && b.y + 0.7 * b.h <= s.y + 1 && b.y + 0.7 * b.h >= s.y - 1.7 * med);
        if (!num.length && den.length) {
          const mem = den.filter((b) => b.y + 0.7 * b.h >= s.y - 0.5 * med);
          const wM = mem.length ? Math.max(...mem.map((b) => b.x1)) - Math.min(...mem.map((b) => b.x0)) : 0;
          if (mem.length && s.x1 - s.x0 <= 1.4 * wM + 4) {
            const R = join(mem);
            const arrow = (shapes.heads || []).some((h) => Math.abs(h.y - s.y) < 3 && h.x0 > s.x1 - 4 && h.x0 < s.x1 + 5);
            const set = new Set(mem);
            items = items.filter((b) => !set.has(b));
            items.push({
              x0: s.x0, x1: s.x1, y: Math.min(...mem.map((b) => b.y)), h: med, m: tex,
              s: tex
                ? arrow ? `\\vec{${R}}` : `\\overline{${R}}`
                : style === 'unicode'
                  ? [...R].map((c) => c + (arrow ? '⃗' : '̅')).join('')
                  : `${arrow ? 'vec' : 'bar'}(${R})`,
            });
          }
          continue;
        }
        if (!num.length || !den.length) continue;
        const ext = (bs: TextBox[]) => Math.max(...bs.map((b) => b.x1)) - Math.min(...bs.map((b) => b.x0));
        const wN = ext(num), wD = ext(den), bw = s.x1 - s.x0;
        const cN = (Math.min(...num.map((b) => b.x0)) + Math.max(...num.map((b) => b.x1))) / 2;
        const cD = (Math.min(...den.map((b) => b.x0)) + Math.max(...den.map((b) => b.x1))) / 2;
        const cB = (s.x0 + s.x1) / 2;
        if (bw > 1.3 * Math.max(wN, wD) + 6 || Math.abs(cN - cB) > 0.3 * bw + 3 || Math.abs(cD - cB) > 0.3 * bw + 3) continue;
        const N = join(num), D = join(den);
        const set = new Set([...num, ...den]);
        items = items.filter((b) => !set.has(b));
        items.push({ x0: s.x0, x1: s.x1, y: s.y - 0.22 * med, h: med, s: tex ? `\\frac{${N}}{${D}}` : plainFrac(N, D), m: true });
      } else {
        const mem = items.filter(
          (b) => inX(b, { x0: s.x0 - 0.5, x1: s.x1 + 0.5 }) && b.y + 0.35 * b.h > s.yb - 0.5 && b.y + 0.35 * b.h < s.yt + 0.5
        );
        if (!mem.length) continue;
        const R = join(mem);
        const set = new Set(mem);
        const base = Math.min(...mem.map((b) => b.y));
        items = items.filter((b) => !set.has(b));
        items.push({
          x0: s.px0, x1: s.x1, y: base, h: med,
          s: tex ? `\\sqrt{${R}}` : simple(R) ? '√' + R : `√(${R})`,
          m: true,
        });
      }
    }
  }

  if (shapes && shapes.glyphs && shapes.glyphs.length) {
    const gl = [...shapes.glyphs].sort((a, b) => a.x0 - b.x0);
    const groups: Array<{ x0: number; x1: number; y: number }> = [];
    for (const g of gl) {
      if (
        g.y1 - g.y0 > 1.1 * med || g.y1 - g.y0 < 0.25 * med || g.x1 - g.x0 > 1.1 * med ||
        !items.some((b) => !b.br && /[A-Za-z0-9]/.test(b.s) && Math.abs(b.y - g.y0) < 0.35 * med && g.x0 - b.x1 < 1.5 * med && b.x0 - g.x1 < 1.5 * med)
      ) continue;
      const q = groups.find((q) => Math.abs(q.y - g.y0) < 0.5 * med && g.x0 - q.x1 < 0.5 * med);
      if (q) q.x1 = Math.max(q.x1, g.x1);
      else groups.push({ x0: g.x0, x1: g.x1, y: g.y0 });
    }
    for (const q of groups) items.push({ x0: q.x0, x1: q.x1, y: q.y + 0.2, h: med, s: UNKNOWN });
  }

  const rowsOf = (bs: TextBox[]) => {
    const rs: Array<{ y: number; bs: TextBox[] }> = [];
    for (const b of [...bs].sort((a, c) => c.y - a.y)) {
      const r = rs.find((r) => Math.abs(r.y - b.y) < 0.45 * med);
      if (r) r.bs.push(b);
      else rs.push({ y: b.y, bs: [b] });
    }
    return rs;
  };
  const cellsOf = (r: { y: number; bs: TextBox[] }) => {
    const cs: Array<{ bs: TextBox[]; x0: number; x1: number }> = [];
    for (const b of r.bs.sort((a, c) => a.x0 - c.x0)) {
      const c = cs[cs.length - 1];
      if (c && b.x0 - c.x1 < 0.9 * med) {
        c.bs.push(b);
        c.x1 = Math.max(c.x1, b.x1);
      } else {
        cs.push({ bs: [b], x0: b.x0, x1: b.x1 });
      }
    }
    return cs;
  };
  const gridOf = (bs: TextBox[]) => {
    const rs = rowsOf(bs);
    if (rs.length < 2) return null;
    const g = rs.map((r) => cellsOf(r));
    const nc = g[0].length;
    if (g.some((r) => r.length !== nc)) return null;
    return g.map((r) => r.map((c) => join(c.bs)));
  };
  const fmtGrid = (grid: string[][], env: string) =>
    tex
      ? `\\begin{${env}}${grid.map((r) => r.join(' & ')).join(' \\\\ ')}\\end{${env}}`
      : (env === 'vmatrix' ? '|' : env === 'pmatrix' ? '(' : '[') +
        grid.map((r) => r.join(' ')).join('; ') +
        (env === 'vmatrix' ? '|' : env === 'pmatrix' ? ')' : ']');

  const take = (bs: TextBox[], x0: number, x1: number, ylo: number, yhi: number) =>
    bs.filter(
      (b) => !b.br && (b.x0 + b.x1) / 2 > x0 && (b.x0 + b.x1) / 2 < x1 && b.y + 0.35 * b.h >= ylo && b.y + 0.35 * b.h <= yhi
    );
  const asBox = (x0: number, x1: number, ylo: number, yhi: number, str: string): TextBox => ({
    x0, x1, y: (ylo + yhi) / 2 - 0.35 * med, h: med, s: str, m: true,
  });

  for (const o of brs.filter((c) => '(['.includes(c.ch)).sort((a, b) => (b.ymax - b.ymin) - (a.ymax - a.ymin))) {
    const cc = o.ch === '(' ? ')' : ']';
    const c = brs.find(
      (c) => c.ch === cc && c.x0 > o.x1 && Math.abs(c.ymax - o.ymax) < 3 && Math.abs(c.ymin - o.ymin) < 3 && !c.used
    );
    if (!c || o.used) continue;
    const ylo = o.ymin - 3, yhi = o.ymax + 0.9 * med + 3;
    const mem = take(items, o.x1 - 1, c.x0 + 1, ylo, yhi);
    const grid = mem.length >= 2 ? gridOf(mem) : null;
    if (!grid) continue;
    o.used = c.used = true;
    const set = new Set(mem);
    items = items.filter((b) => !set.has(b));
    items.push(asBox(o.x0, c.x1, o.ymin, o.ymax + med, fmtGrid(grid, o.ch === '(' ? 'pmatrix' : 'bmatrix')));
  }

  if (shapes && shapes.vbars) {
    const vs = [...shapes.vbars].sort((a, b) => a.x - b.x);
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i], b = vs[j];
        if (
          a.used || b.used || b.x - a.x < 1.5 * med || b.x - a.x > 400 ||
          Math.abs(a.y0 - b.y0) > 3 || Math.abs(a.y1 - b.y1) > 3
        ) continue;
        const mem = take(items, a.x, b.x, a.y0, a.y1);
        if (mem.length < 4) continue;
        const g = gridOf(mem);
        if (!g || g[0].length < 2) continue;
        if (Math.min(...mem.map((m) => m.x0)) - a.x > 2.5 * med || b.x - Math.max(...mem.map((m) => m.x1)) > 2.5 * med) continue;
        a.used = b.used = true;
        const set = new Set(mem);
        items = items.filter((m) => !set.has(m));
        items.push(asBox(a.x, b.x, a.y0, a.y1, fmtGrid(g, 'vmatrix')));
        break;
      }
    }
  }

  for (const c of brs) {
    if (c.used) continue;
    const open = '([{'.includes(c.ch);
    const cand = items.filter(
      (b) =>
        !b.br &&
        (open ? b.x0 >= c.x0 - 1 : b.x1 <= c.x1 + 1) &&
        b.y + 0.35 * b.h >= c.ymin - 4 &&
        b.y + 0.35 * b.h <= c.ymax + 14
    );
    if (!cand.length) continue;
    const t = cand.reduce(
      (m, b) => {
        const d = open ? b.x0 - c.x0 : c.x1 - b.x1;
        return d < m.d ? { d, b } : m;
      },
      { d: 1e9, b: null as TextBox | null }
    ).b;
    if (t) items.push({ x0: c.x0, x1: c.x1, y: t.y, h: med, s: c.ch, br: true });
  }

  return items;
}

export function tidy(t: string): string {
  if (!t.includes('$')) return t;
  t = t
    .replace(/([(\[]+\s*)\$([^$]*)\$/g, (_, a, b) => `$${a.replace(/\s+/g, '')}${b}$`)
    .replace(/\$([^$]*)\$(\s*[)\]]+)/g, (_, a, b) => `$${a}${b.replace(/\s+/g, '')}$`);
  t = t.replace(/(^|[^\\A-Za-z])(sin|cos|tan|cot|sec|cosec|log|ln)(?=\s*\$)/g, (_, p, f) => `${p}$${toTex(f).trim()}$`);
  t = t.replace(/\$([^$]*)\$((?:[A-Za-z0-9]{1,2})?\))(?![A-Za-z0-9])/g, (_, a, b) => `$${a}${b}$`);
  const OPS_ = String.raw`(?:\s*[=+\-−–<>≤≥≠±×÷·,.:;(\[\]∈∉⊂∪∩]|\s*\)(?!\s*[A-Za-z]?\))|\s+\d+(?:\.\d+)?|\s*[A-Za-zθαβγδπφω](?![A-Za-z)]))*\s*`;
  const RE = new RegExp(String.raw`\$([^$]+)\$(${OPS_})\$([^$]+)\$`, 'g');
  for (let k = 0; k < 10; k++) {
    const n = t.replace(RE, (_, a, op, b) => `$${a} ${toTex(op).trim()} ${b}$`);
    if (n === t) break;
    t = n;
  }
  t = t.replace(/\$([^$]*\\(?:int|iint|oint)[^$]*)\$(\s*)(d[a-zA-Zθ])(?![A-Za-z])/g, '$$$1\\,$3$$');
  return t.replace(/\$([^$]*)\$/g, (_, a) => '$' + a.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s{2,}/g, ' ').trim() + '$');
}
