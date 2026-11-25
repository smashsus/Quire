import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Moon, Sun } from 'lucide-react';
import { DocumentStudio } from './components/DocumentStudio';
import { MirageVisionLab } from './components/MirageVisionLab';
import { PromptChunker } from './components/PromptChunker';
import { mirageClient, type MirageProgressEvent } from './lib/mirageClient';
import { processImageFile, processPdfFile } from './lib/pdfProcessor';
import type {
  ConversionOptions,
  ConversionStats,
  ProcessedPageAsset,
} from './types/quire';

type ActiveTab = 'studio' | 'mirage' | 'chunker';

const SETTINGS_KEY = 'quire.v2';
const THEME_KEY = 'quire.theme';

const DEFAULT_OPTIONS: ConversionOptions = {
  ocrScans: true,
  tables: true,
  columns: true,
  math: 'latex',
  figures: 'mark',
  pages: '',
  engine: 'tesseract',
  mirageLanguage: 'en',
  mirageConf: 0.35,
  mirageTextConf: 0.3,
};

function loadSavedOptions(): ConversionOptions {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_OPTIONS;
    return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function loadSavedTheme(): boolean {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [darkMode, setDarkMode] = useState<boolean>(loadSavedTheme);
  const [options, setOptions] = useState<ConversionOptions>(loadSavedOptions);

  const [markdown, setMarkdown] = useState('');
  const [stats, setStats] = useState<ConversionStats | null>(null);
  const [pages, setPages] = useState<ProcessedPageAsset[]>([]);
  const [figuresZipBlob, setFiguresZipBlob] = useState<Blob | null>(null);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; status: string } | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [chunkSize, setChunkSize] = useState(15000);

  const [mirageReady, setMirageReady] = useState(false);
  const [mirageCached, setMirageCached] = useState(false);
  const [mirageLoading, setMirageLoading] = useState(false);
  const [mirageProgress, setMirageProgress] = useState<MirageProgressEvent | null>(null);
  const [externalImageFile, setExternalImageFile] = useState<File | null>(null);

  const cancelRef = useRef(false);
  const headerFileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  // Persist conversion preferences
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(options));
    } catch {
      // ignore storage errors
    }
  }, [options]);

  const refreshMirageCacheState = useCallback(async () => {
    try {
      const info = await mirageClient.checkCache();
      setMirageCached(info.cached);
      setMirageReady(info.loaded);
    } catch {
      // worker init errors handled on explicit actions
    }
  }, []);

  useEffect(() => {
    void refreshMirageCacheState();
    const unsub = mirageClient.subscribe((ev) => {
      setMirageProgress(ev);
      if (ev.stage === 'download' && ev.total) {
        const pct = Math.min(100, Math.round(((ev.received || 0) / ev.total) * 100));
        setProgress((prev) =>
          prev
            ? {
                fraction: prev.fraction,
                status: `Downloading Mirage 22MB weights (${pct}%)…`,
              }
            : null
        );
      }
    });
    return unsub;
  }, [refreshMirageCacheState]);

  const handleInitMirage = useCallback(
    async (customFile?: File, forceRedownload = false) => {
      setMirageLoading(true);
      setMirageProgress({ stage: 'wasm', message: 'Initializing Mirage WASM runtime…' });
      try {
        await mirageClient.init(customFile, forceRedownload);
        await refreshMirageCacheState();
      } finally {
        setMirageLoading(false);
        setMirageProgress(null);
      }
    },
    [refreshMirageCacheState]
  );

  const handleClearMirageCache = useCallback(async () => {
    setMirageLoading(true);
    try {
      await mirageClient.clearCache();
      await refreshMirageCacheState();
    } finally {
      setMirageLoading(false);
    }
  }, [refreshMirageCacheState]);

  const handleProcessFile = useCallback(
    async (file: File) => {
      const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

      if (!isImage && !isPdf) {
        setStudioError('Unsupported file format. Choose a PDF or image file.');
        return;
      }

      if (activeTab === 'mirage' && isImage) {
        setExternalImageFile(file);
        return;
      }

      setActiveTab('studio');
      setStudioError(null);
      setConverting(true);
      cancelRef.current = false;
      setProgress({ fraction: 0.05, status: `Opening ${file.name}…` });

      try {
        if (options.engine !== 'tesseract' && !mirageReady) {
          setMirageLoading(true);
          try {
            await mirageClient.init();
            await refreshMirageCacheState();
          } finally {
            setMirageLoading(false);
            setMirageProgress(null);
          }
        }

        const out = isImage
          ? await processImageFile(file, options, (p) => setProgress(p))
          : await processPdfFile(file, options, (p) => setProgress(p), () => cancelRef.current);

        setMarkdown(out.markdown);
        setStats(out.stats);
        setPages(out.pages);
        setFiguresZipBlob(out.figuresZipBlob);

        if (options.engine !== 'tesseract') {
          await refreshMirageCacheState();
        }
      } catch (err) {
        setStudioError(err instanceof Error ? err.message : String(err));
      } finally {
        setConverting(false);
      }
    },
    [activeTab, mirageReady, options, refreshMirageCacheState]
  );

  // Global drag-drop and clipboard paste routing
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void handleProcessFile(f);
    };
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f) void handleProcessFile(f);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [handleProcessFile]);

  const handleOpenInMirage = useCallback(async (page: ProcessedPageAsset) => {
    try {
      const res = await fetch(page.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `page_${page.pageNum}.png`, { type: 'image/png' });
      setExternalImageFile(file);
      setActiveTab('mirage');
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : 'Unable to send page to Mirage');
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* 3-Zone Top Header Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Quire
          </span>

          {/* Zone 2: Single-line Primary Navigation */}
          <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary">
            {(
              [
                { id: 'studio', label: 'Document Studio' },
                { id: 'mirage', label: 'Mirage Vision' },
                { id: 'chunker', label: 'Prompt Chunker' },
              ] as Array<{ id: ActiveTab; label: string }>
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative h-16 border-b-2 px-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300'
                      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary CTA */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => headerFileInputRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-700 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="h-4 w-4" />
              Open File
            </button>
            <input
              ref={headerFileInputRef}
              type="file"
              accept=".pdf,application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleProcessFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {/* Clean Unboxed Sub-header Utility Row */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            On-device WASM · PDF math &amp; tables · Tesseract OCR · Cactus Mirage 21.6 MB VLM
            {mirageReady ? ' · Mirage loaded' : mirageCached ? ' · Mirage cached' : ''}
          </p>

          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {darkMode ? 'Light' : 'Dark'}
          </button>
        </div>

        {activeTab === 'studio' && (
          <DocumentStudio
            options={options}
            onChangeOptions={setOptions}
            markdown={markdown}
            onChangeMarkdown={setMarkdown}
            stats={stats}
            pages={pages}
            figuresZipBlob={figuresZipBlob}
            converting={converting}
            progress={progress}
            error={studioError}
            onProcessFile={(f) => void handleProcessFile(f)}
            onCancel={() => {
              cancelRef.current = true;
            }}
            onOpenInMirage={(page) => void handleOpenInMirage(page)}
            onOpenInChunker={() => setActiveTab('chunker')}
            mirageReady={mirageReady}
            mirageCached={mirageCached}
          />
        )}

        {activeTab === 'mirage' && (
          <MirageVisionLab
            mirageReady={mirageReady}
            mirageCached={mirageCached}
            mirageLoading={mirageLoading}
            mirageProgress={mirageProgress}
            onInitMirage={handleInitMirage}
            onClearMirageCache={handleClearMirageCache}
            availablePages={pages}
            onSendMarkdown={(md) => {
              setMarkdown(md);
              setActiveTab('studio');
            }}
            externalImageFile={externalImageFile}
            onClearExternalImage={() => setExternalImageFile(null)}
          />
        )}

        {activeTab === 'chunker' && (
          <PromptChunker
            text={markdown}
            chunkSize={chunkSize}
            onChangeChunkSize={setChunkSize}
          />
        )}
      </main>
    </div>
  );
}

export default App;
