import React, { useMemo, useState } from 'react';
import { Check, Copy, Play, RotateCcw } from 'lucide-react';

interface PromptChunkerProps {
  text: string;
  chunkSize: number;
  onChangeChunkSize: (size: number) => void;
}

function splitText(s: string, size: number): string[] {
  if (!s.trim()) return [];
  const out: string[] = [];
  let cur = '';
  for (const p of s.split('\n\n')) {
    if (cur && cur.length + p.length + 2 > size) {
      out.push(cur);
      cur = '';
    }
    let q = p;
    while (q.length > size) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(q.slice(0, size));
      q = q.slice(size);
    }
    cur = cur ? `${cur}\n\n${q}` : q;
  }
  if (cur) out.push(cur);
  return out;
}

export const PromptChunker: React.FC<PromptChunkerProps> = ({
  text,
  chunkSize,
  onChangeChunkSize,
}) => {
  const [draftSize, setDraftSize] = useState(chunkSize);
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());
  const [nextIdx, setNextIdx] = useState(0);
  const [justCopied, setJustCopied] = useState<number | null>(null);

  const chunks = useMemo(() => splitText(text, Math.max(1000, chunkSize || 15000)), [text, chunkSize]);

  const applyResplit = () => {
    onChangeChunkSize(Math.max(1000, draftSize || 15000));
    setDoneSet(new Set());
    setNextIdx(0);
  };

  const copyChunk = async (idx: number) => {
    const content = chunks[idx];
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setDoneSet((prev) => new Set(prev).add(idx));
    setNextIdx(idx + 1);
    setJustCopied(idx);
    setTimeout(() => setJustCopied(null), 1500);
  };

  const handleCopyNext = async () => {
    if (!chunks.length) return;
    if (nextIdx >= chunks.length) {
      setDoneSet(new Set());
      await copyChunk(0);
      return;
    }
    await copyChunk(nextIdx);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Prompt Chunker
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {chunks.length > 0
              ? `${chunks.length} chunk${chunks.length === 1 ? '' : 's'} · ${text.length.toLocaleString()} total chars`
              : 'Convert a PDF or analyze an image first to split output into prompt-ready chunks'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>Max chars</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={draftSize}
              onChange={(e) => setDraftSize(Number(e.target.value))}
              className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2.5 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <button
            type="button"
            onClick={applyResplit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Re-split
          </button>
          <button
            type="button"
            onClick={() => void handleCopyNext()}
            disabled={!chunks.length}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-45 whitespace-nowrap shrink-0 tabular-nums"
          >
            <Play className="h-3.5 w-3.5" />
            {!chunks.length
              ? 'Copy Next'
              : nextIdx >= chunks.length
                ? 'All Copied · Restart'
                : `Copy Next (${nextIdx + 1}/${chunks.length})`}
          </button>
        </div>
      </div>

      {chunks.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
          No converted Markdown available yet. Process a file in Document Studio or Mirage Vision.
        </div>
      ) : (
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {chunks.map((chunk, idx) => {
            const isDone = doneSet.has(idx);
            return (
              <div
                key={idx}
                className={`flex items-center justify-between gap-4 py-3 transition-opacity ${
                  isDone ? 'opacity-55' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                    <span>
                      Part {idx + 1}/{chunks.length}
                    </span>
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                      {chunk.length.toLocaleString()} chars · ≈{Math.round(chunk.length / 4).toLocaleString()} tokens
                    </span>
                    {isDone && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" /> Copied
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {chunk.replace(/\s+/g, ' ').slice(0, 120)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void copyChunk(idx)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {justCopied === idx ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {justCopied === idx ? 'Copied' : 'Copy'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
