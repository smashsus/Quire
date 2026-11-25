import React, { useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  FileArchive,
  Scissors,
  Upload,
  X,
} from 'lucide-react';
import type {
  ConversionOptions,
  ConversionStats,
  FiguresMode,
  MathStyle,
  MirageLanguage,
  OcrEngineMode,
  ProcessedPageAsset,
} from '../types/quire';
import { createSampleDocumentFile } from '../lib/sampleAssets';

interface DocumentStudioProps {
  options: ConversionOptions;
  onChangeOptions: (next: ConversionOptions) => void;
  markdown: string;
  onChangeMarkdown: (val: string) => void;
  stats: ConversionStats | null;
  pages: ProcessedPageAsset[];
  figuresZipBlob: Blob | null;
  converting: boolean;
  progress: { fraction: number; status: string } | null;
  error: string | null;
  onProcessFile: (file: File) => void;
  onCancel: () => void;
  onOpenInMirage: (page: ProcessedPageAsset) => void;
  onOpenInChunker: () => void;
  mirageReady: boolean;
  mirageCached: boolean;
}

export const DocumentStudio: React.FC<DocumentStudioProps> = ({
  options,
  onChangeOptions,
  markdown,
  onChangeMarkdown,
  stats,
  pages,
  figuresZipBlob,
  converting,
  progress,
  error,
  onProcessFile,
  onCancel,
  onOpenInMirage,
  onOpenInChunker,
  mirageReady,
  mirageCached,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activePage = pages[selectedPageIdx] || pages[0] || null;
  const charCount = markdown.length;
  const tokenEst = Math.round(charCount / 4);

  const handleCopyAll = async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDownloadMd = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'output.md';
    a.click();
  };

  const handleDownloadZip = () => {
    if (!figuresZipBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(figuresZipBlob);
    a.download = 'figures.zip';
    a.click();
  };

  const handleSample = async () => {
    const f = await createSampleDocumentFile('invoice');
    onProcessFile(f);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Column: Input, Engine Selection & Extraction Options */}
      <div className="space-y-4 lg:col-span-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {/* Dropzone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) onProcessFile(f);
            }}
            className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
              dragOver
                ? 'border-teal-500 bg-teal-50/50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-teal-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300'
            }`}
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Drop, paste, or choose a PDF or image
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Processed 100% locally in your browser · Nothing is uploaded
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onProcessFile(f);
                e.target.value = '';
              }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Need a quick test document?</span>
            <button
              type="button"
              onClick={() => void handleSample()}
              className="font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
            >
              Load Sample Invoice
            </button>
          </div>

          {/* Engine Selector */}
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Vision & OCR Engine
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {options.engine === 'tesseract'
                  ? 'Tesseract WASM'
                  : mirageReady
                    ? 'Mirage Ready'
                    : mirageCached
                      ? 'Mirage Cached (21.6 MB)'
                      : 'Downloads Mirage (21.6 MB) on run'}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
              {(
                [
                  { id: 'tesseract', label: 'Typical OCR' },
                  { id: 'mirage', label: 'Mirage VLM' },
                  { id: 'hybrid', label: 'Hybrid' },
                ] as Array<{ id: OcrEngineMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeOptions({ ...options, engine: m.id })}
                  className={`h-9 rounded-md px-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    options.engine === m.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {options.engine === 'tesseract' &&
                'Quire native PDF text/math/table extraction with Tesseract.js OCR fallback for scans.'}
              {options.engine === 'mirage' &&
                'Runs Cactus Mirage (22MB VLM) on every page or image for single-pass scene, objects, masks, and OCR.'}
              {options.engine === 'hybrid' &&
                'Uses Quire PDF vector extraction for digital text + Mirage VLM to caption figures, graphs, and scans.'}
            </p>
          </div>

          {/* Extraction Options */}
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={options.ocrScans}
                  onChange={(e) => onChangeOptions({ ...options, ocrScans: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-teal-600"
                />
                OCR scans
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={options.tables}
                  onChange={(e) => onChangeOptions({ ...options, tables: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-teal-600"
                />
                Tables
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={options.columns}
                  onChange={(e) => onChangeOptions({ ...options, columns: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-teal-600"
                />
                Columns
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Math</span>
                <select
                  value={options.math}
                  onChange={(e) => onChangeOptions({ ...options, math: e.target.value as MathStyle })}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="latex">LaTeX x^{'{2}'}</option>
                  <option value="unicode">Unicode x²</option>
                  <option value="plain">Plain x^2</option>
                  <option value="off">Off</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Figures</span>
                <select
                  value={options.figures}
                  onChange={(e) => onChangeOptions({ ...options, figures: e.target.value as FiguresMode })}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="mark">Mark</option>
                  <option value="export">Mark + PNG</option>
                  <option value="off">Off</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Pages</span>
                <input
                  type="text"
                  value={options.pages}
                  onChange={(e) => onChangeOptions({ ...options, pages: e.target.value })}
                  placeholder="all · 1-5"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
              </label>
            </div>

            {options.engine !== 'tesseract' && (
              <div className="grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Mirage Language</span>
                  <select
                    value={options.mirageLanguage}
                    onChange={(e) =>
                      onChangeOptions({ ...options, mirageLanguage: e.target.value as MirageLanguage })
                    }
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <option value="en">English (en)</option>
                    <option value="de">German (de)</option>
                    <option value="fr">French (fr)</option>
                    <option value="es">Spanish (es)</option>
                    <option value="it">Italian (it)</option>
                    <option value="nl">Dutch (nl)</option>
                    <option value="pl">Polish (pl)</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="flex justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    <span>Mirage Conf</span>
                    <span>{options.mirageConf.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={0.15}
                    max={0.85}
                    step={0.05}
                    value={options.mirageConf}
                    onChange={(e) => onChangeOptions({ ...options, mirageConf: Number(e.target.value) })}
                    className="mt-2.5 w-full accent-teal-600"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {(converting || progress) && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="truncate">{progress?.status}</span>
                {converting && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                )}
              </div>
              {converting && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-teal-600 transition-all duration-150"
                    style={{ width: `${Math.round((progress?.fraction || 0) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Rendered Page Preview & Extracted Figures */}
        {activePage && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 pb-3">
              <div className="flex items-center gap-2 overflow-x-auto">
                {pages.map((p, idx) => (
                  <button
                    key={p.pageNum}
                    type="button"
                    onClick={() => setSelectedPageIdx(idx)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums whitespace-nowrap shrink-0 ${
                      idx === selectedPageIdx
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    p.{p.pageNum}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onOpenInMirage(activePage)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-teal-700 hover:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-teal-400 whitespace-nowrap shrink-0"
              >
                <Eye className="h-3.5 w-3.5" />
                Inspect in Mirage
              </button>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
              <img
                src={activePage.dataUrl}
                alt={`Rendered page ${activePage.pageNum}`}
                referrerPolicy="no-referrer"
                className="max-h-72 w-full object-contain"
              />
            </div>

            {activePage.figures.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                  Detected Figures ({activePage.figures.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {activePage.figures.map((fig) => (
                    <div
                      key={fig.name}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950"
                    >
                      {fig.dataUrl && (
                        <img
                          src={fig.dataUrl}
                          alt={fig.name}
                          referrerPolicy="no-referrer"
                          className="h-24 w-full object-contain"
                        />
                      )}
                      <p className="mt-1 truncate font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {fig.name}
                      </p>
                      {fig.caption && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {fig.caption}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Column: Markdown Output & Actions */}
      <div className="lg:col-span-7">
        <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Converted Markdown Output
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {charCount > 0
                  ? `${charCount.toLocaleString()} chars · ≈${tokenEst.toLocaleString()} tokens${
                      stats
                        ? ` · ${stats.pageCount} page${stats.pageCount === 1 ? '' : 's'} · ${(
                            stats.elapsedMs / 1000
                          ).toFixed(1)}s${stats.figureCount ? ` · ${stats.figureCount} figs` : ''}${
                            stats.unknownGlyphs ? ` · ${stats.unknownGlyphs} unknown glyphs` : ''
                          }`
                        : ''
                    }`
                  : 'Converted text appears here after dropping a PDF or image'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyAll()}
                disabled={!markdown}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy All'}
              </button>

              <button
                type="button"
                onClick={handleDownloadMd}
                disabled={!markdown}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download .md
              </button>

              {figuresZipBlob && (
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <FileArchive className="h-3.5 w-3.5" />
                  Figures .zip
                </button>
              )}

              <button
                type="button"
                onClick={onOpenInChunker}
                disabled={!markdown}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Scissors className="h-3.5 w-3.5" />
                Chunk ({Math.max(1, Math.ceil(charCount / 15000))})
              </button>
            </div>
          </div>

          <textarea
            value={markdown}
            onChange={(e) => onChangeMarkdown(e.target.value)}
            placeholder="Drop a PDF or image on the left, or switch to Mirage Vision for interactive object masks, scene graphs, and form extraction."
            className="mt-3 min-h-[520px] w-full flex-1 resize-y rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-teal-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          />
        </div>
      </div>
    </div>
  );
};
