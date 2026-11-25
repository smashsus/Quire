import type { MirageResult, MirageTextRegion, TextBox } from '../types/quire';
import { boxesToMd } from './layout';

export function normalizeMirageText(result: MirageResult): Array<{ text: string; bbox?: [number, number, number, number]; score?: number }> {
  const items = Array.isArray(result.text) ? result.text : [];
  return items
    .map((entry) => {
      if (typeof entry === 'string') {
        return { text: entry.trim() };
      }
      const obj = entry as MirageTextRegion;
      const text = (obj.text ?? obj.value ?? '').toString().trim();
      const score = typeof obj.score === 'number' ? obj.score : typeof obj.confidence === 'number' ? obj.confidence : undefined;
      return { text, bbox: obj.bbox, score };
    })
    .filter((item) => item.text.length > 0);
}

export function mirageTextToMarkdown(
  result: MirageResult,
  opts: { tables?: boolean; cols?: boolean } = {}
): string {
  const textItems = normalizeMirageText(result);
  const boxes: TextBox[] = [];
  const plainLines: string[] = [];

  for (const item of textItems) {
    if (item.bbox && item.bbox.length === 4) {
      const [x0, y0, x1, y1] = item.bbox;
      boxes.push({
        x0,
        x1: Math.max(x0 + 1, x1),
        y: -y1,
        h: Math.max(8, y1 - y0),
        s: item.text,
      });
    } else {
      plainLines.push(item.text);
    }
  }

  if (boxes.length > 0) {
    const layoutMd = boxesToMd(boxes, {
      tables: opts.tables ?? true,
      cols: opts.cols ?? true,
      headings: false,
      math: 'off',
    });
    return plainLines.length ? `${layoutMd}\n\n${plainLines.join('\n')}`.trim() : layoutMd;
  }

  return plainLines.join('\n');
}

export function mirageResultToMarkdown(
  result: MirageResult,
  opts: { tables?: boolean; cols?: boolean; includeScene?: boolean; includeObjects?: boolean } = {}
): string {
  const sections: string[] = [];
  const includeScene = opts.includeScene ?? true;
  const includeObjects = opts.includeObjects ?? true;

  if (includeScene && result.scene) {
    if (typeof result.scene === 'string') {
      sections.push(`**Scene:** ${result.scene}`);
    } else if (typeof result.scene === 'object') {
      const pairs = Object.entries(result.scene)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
      if (pairs.length) {
        sections.push(`**Scene:** ${pairs.join(' · ')}`);
      }
    }
  }

  const ocrMd = mirageTextToMarkdown(result, opts);
  if (ocrMd) {
    sections.push(ocrMd);
  }

  if (includeObjects && Array.isArray(result.objects) && result.objects.length > 0) {
    const objLines = result.objects.slice(0, 16).map((obj) => {
      const attrs = obj.description || obj.attributes;
      const attrStr = attrs
        ? Object.entries(attrs)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')
        : '';
      const scoreStr = typeof obj.score === 'number' ? ` (${Math.round(obj.score * 100)}%)` : '';
      const posStr = obj.position ? ` — ${obj.position}` : '';
      return `- **${obj.name}**${scoreStr}${posStr}${attrStr ? ` [${attrStr}]` : ''}`;
    });
    sections.push(`### Visual Elements\n${objLines.join('\n')}`);
  }

  if (result.form && typeof result.form === 'object' && Object.keys(result.form).length > 0) {
    const formRows = Object.entries(result.form).map(([k, v]) => `- **${k}:** \`${JSON.stringify(v)}\``);
    sections.push(`### Extracted Form\n${formRows.join('\n')}`);
  }

  return sections.join('\n\n').trim();
}
