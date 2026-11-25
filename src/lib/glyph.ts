// Shape classifier for glyphs the PDF has no Unicode for (custom-encoded Symbol subsets).
// Input: RGBA pixels of a tight crop around ONE glyph. Output: "−" "=" "+" "(" ")" "[" "]" or null.
export function classifyGlyph(px: Uint8ClampedArray, W: number, H: number): string | null {
  const ink = new Uint8Array(W * H);
  let x0 = W,
    x1 = -1,
    y0 = H,
    y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if ((px[i] + px[i + 1] + px[i + 2]) / 3 < 150 && px[i + 3] > 80) {
        ink[y * W + x] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;

  {
    const seen = new Uint8Array(W * H);
    const comps: Array<{ pts: number[]; edge: boolean }> = [];
    for (let sy = 0; sy < H; sy++) {
      for (let sx = 0; sx < W; sx++) {
        if (!ink[sy * W + sx] || seen[sy * W + sx]) continue;
        const st: Array<[number, number]> = [[sx, sy]];
        const pts: number[] = [];
        seen[sy * W + sx] = 1;
        let edge = false,
          cx0 = W,
          cx1 = -1;
        while (st.length) {
          const [x, y] = st.pop()!;
          pts.push(y * W + x);
          if (x < cx0) cx0 = x;
          if (x > cx1) cx1 = x;
          if (x === 0 || x === W - 1) edge = true;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx,
                ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < W && ny < H && ink[ny * W + nx] && !seen[ny * W + nx]) {
                seen[ny * W + nx] = 1;
                st.push([nx, ny]);
              }
            }
          }
        }
        comps.push({ pts, edge: edge && cx1 - cx0 + 1 < 0.6 * W });
      }
    }
    if (comps.some((c) => !c.edge)) {
      for (const c of comps) if (c.edge) for (const p of c.pts) ink[p] = 0;
      x0 = W;
      x1 = -1;
      y0 = H;
      y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (ink[y * W + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    }
    if (x1 < 0) return null;
  }

  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const rows: number[] = [],
    cols: number[] = [];
  for (let y = y0; y <= y1; y++) {
    let c = 0;
    for (let x = x0; x <= x1; x++) c += ink[y * W + x];
    rows.push(c);
  }
  for (let x = x0; x <= x1; x++) {
    let c = 0;
    for (let y = y0; y <= y1; y++) c += ink[y * W + x];
    cols.push(c);
  }
  const runs = (a: number[], thr: number) => {
    let n = 0,
      on = false;
    for (const v of a) {
      if (v >= thr && !on) {
        n++;
        on = true;
      } else if (v < thr) {
        on = false;
      }
    }
    return n;
  };
  const bands = runs(rows, 0.5 * w);
  if (bands >= 2 && h <= 1.1 * w) return '=';
  if (h <= 0.45 * w && bands >= 1) return '−';
  const vstroke = Math.max(...cols) >= 0.7 * h;
  const hstroke = Math.max(...rows) >= 0.7 * w;
  if (bands === 1 && hstroke && vstroke && h <= 1.3 * w && h >= 0.6 * w) return '+';
  if (h >= 2 * w) {
    const cx = (y: number) => {
      let s = 0,
        n = 0;
      for (let x = x0; x <= x1; x++) {
        if (ink[y * W + x]) {
          s += x;
          n++;
        }
      }
      return n ? s / n : null;
    };
    const top = cx(y0 + Math.floor(h * 0.1));
    const mid = cx(y0 + (h >> 1));
    const bot = cx(y1 - Math.floor(h * 0.1));
    if (top == null || mid == null || bot == null) return null;
    const edge = (top + bot) / 2;
    const straight = Math.abs(mid - edge) < 0.12 * w;
    const corner = rows[0] >= 0.5 * w && rows[rows.length - 1] >= 0.5 * w;
    if (corner) return top < x0 + w / 2 && Math.min(...cols.slice(0, 2)) >= 0.7 * h ? '[' : ']';
    if (straight) return null;
    return mid < edge ? '(' : ')';
  }
  return null;
}
