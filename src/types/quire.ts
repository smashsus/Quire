export type MathStyle = 'latex' | 'unicode' | 'plain' | 'off';
export type FiguresMode = 'mark' | 'export' | 'off';
export type OcrEngineMode = 'tesseract' | 'mirage' | 'hybrid';

export type MirageLanguage = 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pl';
export type MirageMaskFormat = 'polygons' | 'outline' | 'bitmap' | 'none';
export type MirageSection = 'scene' | 'objects' | 'text' | 'relations' | 'events' | 'reasoning';

export interface TextBox {
  x0: number;
  x1: number;
  y: number;
  h: number;
  s: string;
  w?: number;
  m?: boolean;
  br?: boolean;
  done?: boolean;
  fig?: boolean;
}

export interface VectorBar {
  x0: number;
  x1: number;
  y: number;
}

export interface VectorRad {
  x0: number;
  x1: number;
  bx0: number;
  bx1: number;
  yb: number;
  yt: number;
}

export interface VectorVBar {
  x: number;
  y0: number;
  y1: number;
  used?: boolean;
}

export interface VectorGlyph {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface VectorHead {
  x0: number;
  x1: number;
  y: number;
}

export interface DetectedFigure {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  kind: 'graph' | 'image' | 'figure';
  n: number;
}

export interface PageShapes {
  bars: VectorBar[];
  rads: VectorRad[];
  vbars: VectorVBar[];
  glyphs: VectorGlyph[];
  figs: DetectedFigure[];
  heads: VectorHead[];
}

export interface MirageObject {
  id?: number | string;
  name: string;
  bbox?: [number, number, number, number];
  score?: number;
  mask?: number[][] | number[] | string;
  position?: string;
  description?: Record<string, string>;
  attributes?: Record<string, string>;
}

export interface MirageTextRegion {
  text?: string;
  value?: string;
  bbox?: [number, number, number, number];
  score?: number;
  confidence?: number;
}

export interface MirageRelation {
  subject?: string | number;
  predicate?: string;
  relation?: string;
  object?: string | number;
  description?: string;
}

export interface MirageResult {
  scene?: Record<string, unknown> | string;
  objects?: MirageObject[];
  regions?: Array<Record<string, unknown>>;
  text?: Array<MirageTextRegion | string>;
  relations?: Array<MirageRelation | string>;
  events?: Array<Record<string, unknown> | string>;
  reasoning?: string;
  form?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MirageDescribeOptions {
  sections?: MirageSection[];
  fields?: string[];
  conf?: number;
  text_conf?: number;
  max_objects?: number;
  max_text_lines?: number;
  max_tokens?: number;
  mask_format?: MirageMaskFormat;
  nms?: number;
  form?: Record<string, Record<string, unknown>>;
}

export interface ProcessedPageAsset {
  pageNum: number;
  dataUrl: string;
  width: number;
  height: number;
  modeUsed: 'pdf-text' | 'tesseract' | 'mirage' | 'hybrid';
  mirageResult?: MirageResult | null;
  mirageLatencyMs?: number;
  figures: Array<{
    name: string;
    kind: string;
    dataUrl?: string;
    caption?: string;
  }>;
}

export interface ConversionStats {
  pageCount: number;
  ocrPages: number;
  miragePages: number;
  figureCount: number;
  unknownGlyphs: number;
  elapsedMs: number;
  engine: OcrEngineMode;
}

export interface ConversionOptions {
  ocrScans: boolean;
  tables: boolean;
  columns: boolean;
  math: MathStyle;
  figures: FiguresMode;
  pages: string;
  engine: OcrEngineMode;
  mirageLanguage: MirageLanguage;
  mirageConf: number;
  mirageTextConf: number;
}
