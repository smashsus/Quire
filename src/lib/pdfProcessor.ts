import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import type {
  ConversionOptions,
  ConversionStats,
  MirageResult,
  ProcessedPageAsset,
  TextBox,
} from '../types/quire';
import { classifyGlyph } from './glyph';
import { boxesToMd } from './layout';
import { fixText, shapesFromOps, UNKNOWN } from './math';
import { mirageClient } from './mirageClient';
import { mirageResultToMarkdown } from './mirageMarkdown';
import { ocrCanvasWithTesseract } from './tesseractOcr';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ConversionProgress {
  fraction: number;
  status: string;
}

export interface ConversionOutput {
  markdown: string;
  stats: ConversionStats;
  figuresZipBlob: Blob | null;
  pages: ProcessedPageAsset[];
}

export function parsePages(spec: string, totalPages: number): number[] {
  const s = (spec || '').trim();
  if (!s) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const set = new Set<number>();
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    let x = Number(m[1]);
    let y = Number(m[2] || m[1]);
    if (x > y) [x, y] = [y, x];
    for (let i = Math.max(1, x); i <= Math.min(totalPages, y); i++) {
      set.add(i);
    }
  }
  return [...set].sort((a, b) => a - b);
}

const canvasToBlob = (c: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))), 'image/png')
  );

async function renderPageCanvas(page: pdfjs.PDFPageProxy, scale: number) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(vp.width));
  c.height = Math.max(1, Math.ceil(vp.height));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context unavailable');
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return { c, vp };
}

export async function processImageFile(
  file: File,
  opts: ConversionOptions,
  onProgress: (p: ConversionProgress) => void
): Promise<ConversionOutput> {
  const t0 = performance.now();
  onProgress({ fraction: 0.15, status: 'Decoding image…' });

  const bmp = await createImageBitmap(file);
  const scale = opts.engine === 'tesseract' && bmp.width < 1200 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = bmp.width * scale;
  c.height = bmp.height * scale;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();

  const previewUrl = c.toDataURL('image/png');
  let markdown = '';
  let mirageResult: MirageResult | null = null;
  let mirageLatencyMs: number | undefined;

  if (opts.engine === 'tesseract') {
    onProgress({ fraction: 0.5, status: 'Running Tesseract OCR locally…' });
    const text = await ocrCanvasWithTesseract(c, { tables: opts.tables, cols: opts.columns });
    markdown = `<!-- ${file.name} (Tesseract OCR) -->\n\n${text}`;
  } else if (opts.engine === 'mirage') {
    onProgress({ fraction: 0.4, status: 'Running Cactus Mirage VLM locally…' });
    const res = await mirageClient.describeCanvas(
      c,
      {
        sections: ['scene', 'objects', 'text', 'relations', 'reasoning'],
        fields: ['bbox', 'score', 'mask'],
        mask_format: 'polygons',
        conf: opts.mirageConf,
        text_conf: opts.mirageTextConf,
      },
      opts.mirageLanguage
    );
    mirageResult = res.result;
    mirageLatencyMs = res.latencyMs;
    const body = mirageResultToMarkdown(res.result, { tables: opts.tables, cols: opts.columns });
    markdown = `<!-- ${file.name} (Mirage 22MB VLM · ${res.latencyMs}ms) -->\n\n${body}`;
  } else {
    // Hybrid on single image: run Mirage for rich scene + objects + OCR AND Tesseract for dense text, merge cleanly
    onProgress({ fraction: 0.35, status: 'Running Hybrid (Tesseract + Mirage)…' });
    const [tessText, mirageOut] = await Promise.all([
      ocrCanvasWithTesseract(c, { tables: opts.tables, cols: opts.columns }),
      mirageClient.describeCanvas(
        c,
        {
          sections: ['scene', 'objects', 'text', 'relations', 'reasoning'],
          fields: ['bbox', 'score', 'mask'],
          mask_format: 'polygons',
          conf: opts.mirageConf,
          text_conf: opts.mirageTextConf,
        },
        opts.mirageLanguage
      ),
    ]);
    mirageResult = mirageOut.result;
    mirageLatencyMs = mirageOut.latencyMs;
    const mirageSummary = mirageResultToMarkdown(mirageOut.result, {
      tables: opts.tables,
      cols: opts.columns,
      includeScene: true,
      includeObjects: true,
    });
    markdown = [
      `<!-- ${file.name} (Hybrid: Tesseract OCR + Mirage VLM) -->`,
      `## Tesseract OCR Text\n\n${tessText || '_No text detected_'}`,
      `## Mirage Visual Understanding (${mirageOut.latencyMs}ms)\n\n${mirageSummary}`,
    ].join('\n\n');
  }

  const elapsedMs = Math.round(performance.now() - t0);
  onProgress({ fraction: 1, status: 'Done' });

  return {
    markdown,
    figuresZipBlob: null,
    stats: {
      pageCount: 1,
      ocrPages: opts.engine === 'tesseract' || opts.engine === 'hybrid' ? 1 : 0,
      miragePages: opts.engine === 'mirage' || opts.engine === 'hybrid' ? 1 : 0,
      figureCount: 0,
      unknownGlyphs: 0,
      elapsedMs,
      engine: opts.engine,
    },
    pages: [
      {
        pageNum: 1,
        dataUrl: previewUrl,
        width: c.width,
        height: c.height,
        modeUsed: opts.engine === 'tesseract' ? 'tesseract' : opts.engine === 'mirage' ? 'mirage' : 'hybrid',
        mirageResult,
        mirageLatencyMs,
        figures: [],
      },
    ],
  };
}

export async function processPdfFile(
  file: File,
  opts: ConversionOptions,
  onProgress: (p: ConversionProgress) => void,
  isCancelled: () => boolean
): Promise<ConversionOutput> {
  const t0 = performance.now();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const nums = parsePages(opts.pages, pdf.numPages);
  if (!nums.length) throw new Error('No valid pages in that range');

  const mdPages: string[] = [];
  const pageAssets: ProcessedPageAsset[] = [];
  let ocrPages = 0;
  let miragePages = 0;
  let figureCount = 0;
  let unknownGlyphs = 0;
  let figZip: JSZip | null = null;

  for (let k = 0; k < nums.length && !isCancelled(); k++) {
    const n = nums[k];
    onProgress({ fraction: k / nums.length, status: `Processing page ${n} (${k + 1}/${nums.length})…` });
    const page = await pdf.getPage(n);

    // If user explicitly chose pure Mirage VLM mode for the PDF
    if (opts.engine === 'mirage') {
      const { c } = await renderPageCanvas(page, 2);
      onProgress({ fraction: k / nums.length, status: `Mirage VLM scanning page ${n} (${k + 1}/${nums.length})…` });
      const res = await mirageClient.describeCanvas(
        c,
        {
          sections: ['scene', 'objects', 'text', 'relations', 'reasoning'],
          fields: ['bbox', 'score', 'mask'],
          mask_format: 'polygons',
          conf: opts.mirageConf,
          text_conf: opts.mirageTextConf,
        },
        opts.mirageLanguage
      );
      miragePages++;
      const md = mirageResultToMarkdown(res.result, { tables: opts.tables, cols: opts.columns });
      mdPages.push(`<!-- p.${n} · Mirage VLM (${res.latencyMs}ms) -->\n${md}`);
      pageAssets.push({
        pageNum: n,
        dataUrl: c.toDataURL('image/png'),
        width: c.width,
        height: c.height,
        modeUsed: 'mirage',
        mirageResult: res.result,
        mirageLatencyMs: res.latencyMs,
        figures: [],
      });
      continue;
    }

    // Native Quire PDF text + operator shapes + glyph classification
    const tc = await page.getTextContent();
    let shapes = null;
    let fname = (_id: string) => '';
    try {
      const ol = await page.getOperatorList();
      fname = (id: string) => {
        try {
          const obj = page.commonObjs.get(id) as { name?: string } | null;
          return obj?.name || '';
        } catch {
          return '';
        }
      };
      shapes = shapesFromOps(
        ol as unknown as { fnArray: number[]; argsArray: unknown[] },
        pdfjs.OPS as unknown as Record<string, number>,
        page.view[2] - page.view[0],
        page.view[3] - page.view[1]
      );
    } catch {
      // Fallback gracefully if operator list fails
    }

    let boxes: TextBox[] = (tc.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      fontName?: string;
    }>)
      .filter((i) => i.str && (i.str.trim() || /[\uf8e0-\uf8ff]/.test(i.str)))
      .map((i) => ({
        x0: i.transform![4],
        x1: i.transform![4] + (i.width || 0),
        y: i.transform![5],
        h: Math.abs(i.transform![3]) || i.height || 10,
        s: fixText(i.str!, fname(i.fontName || '')),
        w: i.width || 0,
      }));

    const figs = opts.figures === 'off' || !shapes ? [] : shapes.figs;
    if (!figs.length && shapes) shapes.figs = [];

    // Rasterize page for preview + glyph recovery + figure crops
    const R = await renderPageCanvas(page, figs.length || boxes.some((b) => b.s === UNKNOWN) ? 3 : 1.5);
    const unkB = boxes.filter((b) => b.s === UNKNOWN);
    if (unkB.length) {
      const ctx = R.c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        for (const b of unkB) {
          const [X0, Y0] = R.vp.convertToViewportPoint(b.x0 - 0.6, b.y + 0.95 * b.h);
          const [X1, Y1] = R.vp.convertToViewportPoint(b.x1 + 0.6, b.y - 0.3 * b.h);
          const x = Math.floor(Math.min(X0, X1));
          const y = Math.floor(Math.min(Y0, Y1));
          const w = Math.ceil(Math.abs(X1 - X0));
          const h = Math.ceil(Math.abs(Y1 - Y0));
          if (w < 3 || h < 3) continue;
          const d = ctx.getImageData(Math.max(0, x), Math.max(0, y), w, h);
          const r = classifyGlyph(d.data, d.width, d.height);
          if (r) b.s = r;
        }
      }
    }

    const pageFigures: ProcessedPageAsset['figures'] = [];
    for (const [fi, g] of figs.entries()) {
      const inside = boxes.filter(
        (b) =>
          b.s.length <= 14 &&
          (b.x0 + b.x1) / 2 >= g.x0 &&
          (b.x0 + b.x1) / 2 <= g.x1 &&
          b.y >= g.y0 - 2 &&
          b.y <= g.y1 + 2
      );
      const set = new Set(inside);
      boxes = boxes.filter((b) => !set.has(b));
      const name = `figure_p${n}_${fi + 1}.png`;
      let ref = '';
      let figDataUrl: string | undefined;
      let mirageCaption = '';

      const [A, B] = R.vp.convertToViewportPoint(g.x0 - 4, g.y1 + 4);
      const [C, D] = R.vp.convertToViewportPoint(g.x1 + 4, g.y0 - 4);
      const cw = Math.max(1, Math.ceil(C - A));
      const ch = Math.max(1, Math.ceil(D - B));
      const cc = document.createElement('canvas');
      cc.width = cw;
      cc.height = ch;
      cc.getContext('2d')?.drawImage(R.c, A, B, cw, ch, 0, 0, cw, ch);

      if (opts.figures === 'export') {
        (figZip ||= new JSZip()).file(name, await canvasToBlob(cc));
        ref = `${name} — `;
      }
      figDataUrl = cc.toDataURL('image/png');

      // In Hybrid mode, run Mirage on each detected figure/graph to extract visual caption & embedded text!
      if (opts.engine === 'hybrid') {
        onProgress({
          fraction: k / nums.length,
          status: `Mirage analyzing ${g.kind} ${fi + 1} on page ${n}…`,
        });
        try {
          const figRes = await mirageClient.describeCanvas(
            cc,
            {
              sections: ['scene', 'objects', 'text'],
              fields: ['bbox', 'score'],
              conf: opts.mirageConf,
              text_conf: opts.mirageTextConf,
            },
            opts.mirageLanguage
          );
          mirageCaption = mirageResultToMarkdown(figRes.result, {
            includeScene: true,
            includeObjects: true,
          })
            .replace(/\n+/g, ' · ')
            .slice(0, 280);
        } catch {
          // Non-fatal if Mirage fails on a tiny artifact
        }
      }

      const labels = inside
        .sort((a, b) => b.y - a.y || a.x0 - b.x0)
        .map((b) => b.s)
        .join(' ');

      const marker = mirageCaption
        ? `[${g.kind === 'graph' ? 'Graph' : g.kind === 'image' ? 'Image' : 'Figure'}: ${ref}Mirage: ${mirageCaption}${labels ? ` | PDF labels: ${labels}` : ''}]`
        : `[${g.kind === 'graph' ? 'Graph (axes detected)' : g.kind === 'image' ? 'Image' : 'Figure'}: ${ref}labels: ${labels || 'none'}]`;

      boxes.push({ x0: g.x0, x1: g.x1, y: g.y1, h: 12, s: marker, fig: true });
      pageFigures.push({
        name,
        kind: g.kind,
        dataUrl: figDataUrl,
        caption: mirageCaption || labels || undefined,
      });
    }

    let md = boxesToMd(boxes, {
      tables: opts.tables,
      cols: opts.columns,
      headings: true,
      math: opts.math,
      shapes,
    });
    unknownGlyphs += md.split(UNKNOWN).length - 1;
    figureCount += figs.length;

    let modeUsed: ProcessedPageAsset['modeUsed'] = 'pdf-text';
    let pageMirageRes: MirageResult | null = null;
    let pageMirageMs: number | undefined;

    if (md.replace(/\s/g, '').length < 20 && opts.ocrScans) {
      const scanRender = await renderPageCanvas(page, 2.5);
      if (opts.engine === 'hybrid') {
        onProgress({
          fraction: k / nums.length,
          status: `Hybrid OCR (Mirage + Tesseract) on scanned page ${n}…`,
        });
        const [tessMd, mirageOut] = await Promise.all([
          ocrCanvasWithTesseract(scanRender.c, { tables: opts.tables, cols: opts.columns }),
          mirageClient.describeCanvas(
            scanRender.c,
            {
              sections: ['scene', 'objects', 'text', 'relations'],
              fields: ['bbox', 'score', 'mask'],
              mask_format: 'polygons',
              conf: opts.mirageConf,
              text_conf: opts.mirageTextConf,
            },
            opts.mirageLanguage
          ),
        ]);
        pageMirageRes = mirageOut.result;
        pageMirageMs = mirageOut.latencyMs;
        miragePages++;
        ocrPages++;
        modeUsed = 'hybrid';
        const mSummary = mirageResultToMarkdown(mirageOut.result, { tables: opts.tables, cols: opts.columns });
        md = `${tessMd}\n\n### Mirage Visual Context (${mirageOut.latencyMs}ms)\n${mSummary}`.trim();
      } else {
        onProgress({
          fraction: k / nums.length,
          status: `Tesseract OCR on scanned page ${n} (${k + 1}/${nums.length})…`,
        });
        ocrPages++;
        modeUsed = 'tesseract';
        md = await ocrCanvasWithTesseract(scanRender.c, { tables: opts.tables, cols: opts.columns });
      }
    }

    mdPages.push(`<!-- p.${n} -->\n${md}`);
    pageAssets.push({
      pageNum: n,
      dataUrl: R.c.toDataURL('image/png'),
      width: R.c.width,
      height: R.c.height,
      modeUsed,
      mirageResult: pageMirageRes,
      mirageLatencyMs: pageMirageMs,
      figures: pageFigures,
    });
  }

  onProgress({ fraction: 1, status: isCancelled() ? 'Stopped' : 'Done' });
  const figuresZipBlob = figZip ? await figZip.generateAsync({ type: 'blob' }) : null;

  return {
    markdown: `<!-- ${file.name} -->\n\n` + mdPages.join('\n\n---\n\n'),
    figuresZipBlob,
    stats: {
      pageCount: mdPages.length,
      ocrPages,
      miragePages,
      figureCount,
      unknownGlyphs,
      elapsedMs: Math.round(performance.now() - t0),
      engine: opts.engine,
    },
    pages: pageAssets,
  };
}
