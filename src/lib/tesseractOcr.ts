import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import type { TextBox } from '../types/quire';
import { boxesToMd } from './layout';

let workerPromise: Promise<TesseractWorker> | null = null;

async function getOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  return workerPromise;
}

export async function ocrCanvasWithTesseract(
  canvas: HTMLCanvasElement,
  opts: { tables?: boolean; cols?: boolean } = {}
): Promise<string> {
  const worker = await getOcrWorker();
  const res = await worker.recognize(canvas);
  const data = res.data as unknown as {
    text?: string;
    lines?: Array<{
      bbox: { x0: number; y0: number; x1: number; y1: number };
      words?: Array<{ text: string; confidence: number; bbox: { x0: number; x1: number } }>;
    }>;
  };

  const boxes: TextBox[] = [];
  for (const ln of data.lines || []) {
    for (const w of ln.words || []) {
      if (!w.text.trim() || w.confidence < 25) continue;
      boxes.push({
        x0: w.bbox.x0,
        x1: w.bbox.x1,
        y: -ln.bbox.y1,
        h: Math.max(1, ln.bbox.y1 - ln.bbox.y0),
        s: w.text,
      });
    }
  }

  if (boxes.length) {
    return boxesToMd(boxes, {
      tables: opts.tables ?? true,
      cols: opts.cols ?? true,
      headings: false,
      math: 'off',
    });
  }

  return (data.text || '').trim();
}
