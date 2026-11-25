import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Layers,
  Play,
  RefreshCw,
  ScanText,
  Sliders,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { MirageLanguage, MirageMaskFormat, MirageResult, ProcessedPageAsset } from '../types/quire';
import { mirageClient, type MirageProgressEvent } from '../lib/mirageClient';
import { mirageResultToMarkdown, normalizeMirageText } from '../lib/mirageMarkdown';
import { createSampleDocumentFile } from '../lib/sampleAssets';
import { MirageOverlayCanvas } from './MirageOverlayCanvas';

interface FormFieldDraft {
  id: string;
  key: string;
  kind: 'enum' | 'integer' | 'string';
  enumValues: string;
  min: number;
  max: number;
}

const FORM_PRESETS: Record<string, { label: string; fields: Omit<FormFieldDraft, 'id'>[] }> = {
  document: {
    label: 'Document Triage',
    fields: [
      { key: 'document_type', kind: 'enum', enumValues: 'invoice, receipt, schematic, form, letter, photo', min: 0, max: 10 },
      { key: 'payment_status', kind: 'enum', enumValues: 'paid, unpaid, unknown', min: 0, max: 10 },
      { key: 'total_amount', kind: 'string', enumValues: '', min: 0, max: 10 },
    ],
  },
  scene: {
    label: 'Scene & Safety',
    fields: [
      { key: 'setting', kind: 'enum', enumValues: 'indoor, outdoor, desk, laboratory, street', min: 0, max: 10 },
      { key: 'object_count', kind: 'integer', enumValues: '', min: 0, max: 25 },
      { key: 'primary_subject', kind: 'string', enumValues: '', min: 0, max: 10 },
    ],
  },
  sign: {
    label: 'Signage & Label',
    fields: [
      { key: 'sign_category', kind: 'enum', enumValues: 'stop, yield, speed limit, warning, label, other', min: 0, max: 10 },
      { key: 'legible_text', kind: 'string', enumValues: '', min: 0, max: 10 },
    ],
  },
};

interface MirageVisionLabProps {
  mirageReady: boolean;
  mirageCached: boolean;
  mirageLoading: boolean;
  mirageProgress: MirageProgressEvent | null;
  onInitMirage: (customFile?: File, forceRedownload?: boolean) => Promise<void>;
  onClearMirageCache: () => Promise<void>;
  availablePages: ProcessedPageAsset[];
  onSendMarkdown: (md: string) => void;
  externalImageFile?: File | null;
  onClearExternalImage?: () => void;
}

type InspectorTab = 'overview' | 'objects' | 'relations' | 'form' | 'json';

export const MirageVisionLab: React.FC<MirageVisionLabProps> = ({
  mirageReady,
  mirageCached,
  mirageLoading,
  mirageProgress,
  onInitMirage,
  onClearMirageCache,
  availablePages,
  onSendMarkdown,
  externalImageFile,
  onClearExternalImage,
}) => {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageName, setImageName] = useState<string>('');
  const [imageDims, setImageDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [activeBlob, setActiveBlob] = useState<Blob | null>(null);

  const [language, setLanguage] = useState<MirageLanguage>('en');
  const [conf, setConf] = useState<number>(0.35);
  const [textConf, setTextConf] = useState<number>(0.3);
  const [maskFormat, setMaskFormat] = useState<MirageMaskFormat>('polygons');
  const [keywords, setKeywords] = useState<string>('');

  const [showObjects, setShowObjects] = useState(true);
  const [showMasks, setShowMasks] = useState(true);
  const [showText, setShowText] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MirageResult | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ kind: 'object' | 'text'; index: number } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Form extractor state
  const [formFields, setFormFields] = useState<FormFieldDraft[]>(() =>
    FORM_PRESETS.document.fields.map((f, i) => ({ ...f, id: `f-${i}` }))
  );
  const [formResult, setFormResult] = useState<Record<string, unknown> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const weightsInputRef = useRef<HTMLInputElement | null>(null);

  const loadBlob = async (blob: Blob, name: string) => {
    stopCamera();
    const url = URL.createObjectURL(blob);
    const bmp = await createImageBitmap(blob);
    setImageDims({ w: bmp.width, h: bmp.height });
    bmp.close();
    setImageSrc((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return url;
    });
    setActiveBlob(blob);
    setImageName(name);
    setResult(null);
    setFormResult(null);
    setSelected(null);
    setError(null);
  };

  useEffect(() => {
    if (externalImageFile) {
      void loadBlob(externalImageFile, externalImageFile.name);
      onClearExternalImage?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalImageFile]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera permission unavailable');
    }
  };

  const captureCameraFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/png')
    );
    await loadBlob(blob, 'camera_frame.png');
    await runDescribeOnBlob(blob);
  };

  const runDescribeOnBlob = async (blobToUse?: Blob) => {
    const target = blobToUse || activeBlob;
    if (!target) {
      setError('Select an image, sample, or camera frame first.');
      return;
    }
    setError(null);
    setRunning(true);
    try {
      if (!mirageReady) {
        await onInitMirage();
      }
      const kwList = keywords
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const { result: res, latencyMs: ms } = await mirageClient.describeImageSource(
        target,
        {
          sections: ['scene', 'objects', 'text', 'relations', 'events', 'reasoning'],
          fields: ['bbox', 'score', 'mask'],
          mask_format: maskFormat,
          conf,
          text_conf: textConf,
        },
        language,
        kwList.length ? kwList : undefined
      );
      setResult(res);
      setLatencyMs(ms);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const runFormExtract = async () => {
    if (!activeBlob) {
      setError('Select an image first before running form extraction.');
      return;
    }
    const formObj: Record<string, Record<string, unknown>> = {};
    for (const f of formFields) {
      const k = f.key.trim();
      if (!k) continue;
      if (f.kind === 'enum') {
        const vals = f.enumValues
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (vals.length) formObj[k] = { enum: vals };
      } else if (f.kind === 'integer') {
        formObj[k] = { type: 'integer', minimum: f.min, maximum: f.max };
      } else {
        formObj[k] = { type: 'string' };
      }
    }
    if (!Object.keys(formObj).length) {
      setError('Add at least one valid form field.');
      return;
    }

    setError(null);
    setRunning(true);
    try {
      if (!mirageReady) {
        await onInitMirage();
      }
      const { result: res, latencyMs: ms } = await mirageClient.describeImageSource(
        activeBlob,
        {
          form: formObj,
          conf,
          text_conf: textConf,
        },
        language
      );
      setFormResult(res.form || (res as Record<string, unknown>));
      setLatencyMs(ms);
      setInspectorTab('form');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleLoadSample = async (kind: 'invoice' | 'diagram') => {
    const file = await createSampleDocumentFile(kind);
    await loadBlob(file, file.name);
  };

  const handleLoadPdfPage = async (page: ProcessedPageAsset) => {
    const res = await fetch(page.dataUrl);
    const blob = await res.blob();
    await loadBlob(blob, `page_${page.pageNum}.png`);
    if (page.mirageResult) {
      setResult(page.mirageResult);
      setLatencyMs(page.mirageLatencyMs || null);
    }
  };

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(imageName || 'mirage').replace(/\.[^.]+$/, '')}_mirage.json`;
    a.click();
  };

  const textItems = result ? normalizeMirageText(result) : [];
  const objects = Array.isArray(result?.objects) ? result!.objects : [];
  const relations = Array.isArray(result?.relations) ? result!.relations : [];
  const events = Array.isArray(result?.events) ? result!.events : [];

  const downloadPct =
    mirageProgress?.stage === 'download' && mirageProgress.total
      ? Math.min(100, Math.round(((mirageProgress.received || 0) / mirageProgress.total) * 100))
      : null;

  return (
    <div className="space-y-6">
      {/* Model Runtime Bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Cactus Mirage Vision Runtime
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              51.3M params · 21.6 MB 2-bit quantized (.cact) ·{' '}
              {mirageReady
                ? 'Loaded in WASM memory'
                : mirageCached
                  ? 'Cached in browser IndexedDB'
                  : 'Downloads once from Hugging Face and caches locally'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onInitMirage()}
              disabled={mirageLoading}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${mirageLoading ? 'animate-spin' : ''}`} />
              {mirageLoading
                ? 'Loading Runtime…'
                : mirageReady
                  ? 'Runtime Ready'
                  : mirageCached
                    ? 'Mount Cached Model'
                    : 'Download & Load (21.6 MB)'}
            </button>

            <button
              type="button"
              onClick={() => weightsInputRef.current?.click()}
              disabled={mirageLoading}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="h-4 w-4" />
              Load .cact
            </button>
            <input
              ref={weightsInputRef}
              type="file"
              accept=".cact"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onInitMirage(f);
                e.target.value = '';
              }}
            />

            {mirageCached && (
              <button
                type="button"
                onClick={() => void onClearMirageCache()}
                disabled={mirageLoading}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-rose-400 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Cache
              </button>
            )}
          </div>
        </div>

        {mirageLoading && mirageProgress && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 tabular-nums">
              <span>{mirageProgress.message || 'Preparing Mirage WASM…'}</span>
              {downloadPct !== null && (
                <span>
                  {((mirageProgress.received || 0) / 1048576).toFixed(1)} /{' '}
                  {((mirageProgress.total || 21611043) / 1048576).toFixed(1)} MB ({downloadPct}%)
                </span>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-teal-600 transition-all duration-150"
                style={{ width: `${downloadPct ?? 35}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Main Split Workbench */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Image Input + Overlay Viewport */}
        <div className="space-y-4 lg:col-span-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            {/* Source Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-4 w-4" />
                  Upload Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadBlob(f, f.name);
                    e.target.value = '';
                  }}
                />

                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Camera className="h-4 w-4" />
                    Camera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3.5 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 whitespace-nowrap shrink-0"
                  >
                    <Square className="h-4 w-4" />
                    Stop Camera
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleLoadSample('invoice')}
                  className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  Sample Invoice
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadSample('diagram')}
                  className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  Sample Diagram
                </button>
              </div>

              <button
                type="button"
                onClick={() => (cameraActive ? void captureCameraFrame() : void runDescribeOnBlob())}
                disabled={running || (!activeBlob && !cameraActive)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" />
                {running ? 'Running…' : cameraActive ? 'Snap & Analyze' : 'Run Mirage'}
              </button>
            </div>

            {/* PDF pages quick switcher if Document Studio processed pages */}
            {availablePages.length > 0 && (
              <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                  From Document Studio:
                </span>
                {availablePages.map((p) => (
                  <button
                    key={p.pageNum}
                    type="button"
                    onClick={() => void handleLoadPdfPage(p)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap shrink-0 tabular-nums"
                  >
                    Page {p.pageNum}
                  </button>
                ))}
              </div>
            )}

            {/* Canvas / Camera / Empty State */}
            <div className="mt-3">
              {cameraActive ? (
                <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-black dark:border-slate-800">
                  <video ref={videoRef} playsInline muted className="max-h-[480px] w-full object-contain" />
                </div>
              ) : imageSrc ? (
                <MirageOverlayCanvas
                  imageSrc={imageSrc}
                  imageWidth={imageDims.w}
                  imageHeight={imageDims.h}
                  result={result}
                  showObjects={showObjects}
                  showMasks={showMasks}
                  showText={showText}
                  showLabels={showLabels}
                  selectedIndex={selected}
                  onSelect={setSelected}
                />
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-80 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-6 text-center transition-colors hover:border-teal-500 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <Eye className="mb-3 h-8 w-8 text-slate-400" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Upload an image, paste from clipboard, or start live camera
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Runs scene description, object detection, polygon masks, OCR, and form extraction locally
                  </p>
                </div>
              )}
            </div>

            {/* Overlay Layer Toggles + Metadata */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <Layers className="h-3.5 w-3.5" /> Layers:
                </span>
                {[
                  { label: 'Objects', on: showObjects, set: setShowObjects },
                  { label: 'Masks', on: showMasks, set: setShowMasks },
                  { label: 'OCR Text', on: showText, set: setShowText },
                  { label: 'Labels', on: showLabels, set: setShowLabels },
                ].map((layer) => (
                  <button
                    key={layer.label}
                    type="button"
                    onClick={() => layer.set(!layer.on)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      layer.on
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                    }`}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>

              {imageName && (
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {imageName} · {imageDims.w}×{imageDims.h}px
                  {latencyMs !== null ? ` · ${latencyMs} ms` : ''}
                </div>
              )}
            </div>

            {/* Inference Parameters */}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4 dark:border-slate-800">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as MirageLanguage)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
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
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Masks</span>
                <select
                  value={maskFormat}
                  onChange={(e) => setMaskFormat(e.target.value as MirageMaskFormat)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="polygons">Polygons</option>
                  <option value="outline">Outline</option>
                  <option value="none">None</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums">
                  <span>Obj Conf</span>
                  <span>{conf.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={conf}
                  onChange={(e) => setConf(Number(e.target.value))}
                  className="mt-2 w-full accent-teal-600"
                />
              </label>

              <label className="block space-y-1">
                <span className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums">
                  <span>OCR Conf</span>
                  <span>{textConf.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={textConf}
                  onChange={(e) => setTextConf(Number(e.target.value))}
                  className="mt-2 w-full accent-teal-600"
                />
              </label>
            </div>

            <div className="mt-3">
              <label className="block space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <Sliders className="h-3.5 w-3.5" /> Keywords Boost (optional, comma-separated)
                </span>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. invoice, serial number, sensor, PAID"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
              </label>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Structured Mirage Inspector & Form Extraction */}
        <div className="space-y-4 lg:col-span-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            {/* Inspector Navigation + Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'overview', label: `Overview & OCR (${textItems.length})` },
                    { id: 'objects', label: `Objects (${objects.length})` },
                    { id: 'relations', label: 'Relations & Trace' },
                    { id: 'form', label: 'Form Extract' },
                    { id: 'json', label: 'Raw JSON' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setInspectorTab(tab.id)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      inspectorTab === tab.id
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {result && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSendMarkdown(mirageResultToMarkdown(result))}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Send to Studio
                  </button>
                  <button
                    type="button"
                    onClick={downloadJson}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    JSON
                  </button>
                </div>
              )}
            </div>

            {/* Tab Body */}
            <div className="mt-4 min-h-[440px]">
              {inspectorTab === 'form' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Presets:</span>
                      {Object.entries(FORM_PRESETS).map(([k, p]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() =>
                            setFormFields(p.fields.map((f, idx) => ({ ...f, id: `${k}-${idx}-${Date.now()}` })))
                          }
                          className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap shrink-0"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setFormFields((prev) => [
                          ...prev,
                          { id: `f-${Date.now()}`, key: '', kind: 'string', enumValues: '', min: 0, max: 10 },
                        ])
                      }
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      + Add Field
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {formFields.map((field) => (
                      <div
                        key={field.id}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:grid-cols-12 dark:border-slate-800 dark:bg-slate-950"
                      >
                        <input
                          type="text"
                          value={field.key}
                          onChange={(e) =>
                            setFormFields((prev) =>
                              prev.map((x) => (x.id === field.id ? { ...x, key: e.target.value } : x))
                            )
                          }
                          placeholder="field_name"
                          className="h-9 rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-800 sm:col-span-4 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        />
                        <select
                          value={field.kind}
                          onChange={(e) =>
                            setFormFields((prev) =>
                              prev.map((x) =>
                                x.id === field.id ? { ...x, kind: e.target.value as FormFieldDraft['kind'] } : x
                              )
                            )
                          }
                          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 sm:col-span-3 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <option value="enum">enum</option>
                          <option value="integer">integer</option>
                          <option value="string">string</option>
                        </select>

                        {field.kind === 'enum' ? (
                          <input
                            type="text"
                            value={field.enumValues}
                            onChange={(e) =>
                              setFormFields((prev) =>
                                prev.map((x) => (x.id === field.id ? { ...x, enumValues: e.target.value } : x))
                              )
                            }
                            placeholder="choice1, choice2, choice3"
                            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 sm:col-span-4 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          />
                        ) : field.kind === 'integer' ? (
                          <div className="flex items-center gap-1.5 sm:col-span-4">
                            <input
                              type="number"
                              value={field.min}
                              onChange={(e) =>
                                setFormFields((prev) =>
                                  prev.map((x) => (x.id === field.id ? { ...x, min: Number(e.target.value) } : x))
                                )
                              }
                              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                              aria-label="Min"
                            />
                            <span className="text-xs text-slate-400">to</span>
                            <input
                              type="number"
                              value={field.max}
                              onChange={(e) =>
                                setFormFields((prev) =>
                                  prev.map((x) => (x.id === field.id ? { ...x, max: Number(e.target.value) } : x))
                                )
                              }
                              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                              aria-label="Max"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center px-2 text-xs text-slate-400 sm:col-span-4">
                            Free short text
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setFormFields((prev) => prev.filter((x) => x.id !== field.id))}
                          className="inline-flex h-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/60 hover:text-rose-600 sm:col-span-1 dark:hover:bg-slate-800"
                          aria-label="Remove field"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => void runFormExtract()}
                    disabled={running || !activeBlob}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    <ScanText className="h-4 w-4" />
                    {running ? 'Extracting…' : 'Run Constrained Form Extract'}
                  </button>

                  {formResult && (
                    <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Extracted Structured Form
                        </h3>
                        <button
                          type="button"
                          onClick={() => void copyText('form', JSON.stringify(formResult, null, 2))}
                          className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
                        >
                          {copiedId === 'form' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedId === 'form' ? 'Copied' : 'Copy JSON'}
                        </button>
                      </div>
                      <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                        {JSON.stringify(formResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : !result ? (
                <div className="flex h-96 flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400">
                  <ScanText className="mb-2 h-7 w-7 text-slate-400" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    No Mirage inference output yet
                  </p>
                  <p className="mt-1 max-w-sm text-xs">
                    Choose an image or load one of the sample scenes, then click Run Mirage to inspect scene understanding,
                    OCR text, bounding boxes, and masks.
                  </p>
                </div>
              ) : inspectorTab === 'overview' ? (
                <div className="space-y-5">
                  {/* Scene Description */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">Scene Properties</h3>
                    {result.scene && typeof result.scene === 'object' ? (
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-2.5 text-sm dark:border-slate-800">
                        {Object.entries(result.scene).map(([k, v]) => (
                          <div key={k} className="flex flex-col">
                            <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
                            <dd className="font-medium text-slate-900 dark:text-slate-100">
                              {Array.isArray(v) ? v.join(', ') : String(v)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-1.5 text-sm text-slate-800 dark:text-slate-200">
                        {String(result.scene || 'No scene metadata returned')}
                      </p>
                    )}
                  </div>

                  {/* Mirage OCR Text */}
                  <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Mirage OCR Text Regions (Latin CTC Reader)
                      </h3>
                      {textItems.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void copyText('ocr', textItems.map((t) => t.text).join('\n'))}
                          className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
                        >
                          {copiedId === 'ocr' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedId === 'ocr' ? 'Copied' : 'Copy Text'}
                        </button>
                      )}
                    </div>

                    {textItems.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        No text regions detected above the current OCR confidence threshold ({textConf.toFixed(2)}).
                      </p>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                        {textItems.map((item, idx) => {
                          const isSel = selected?.kind === 'text' && selected.index === idx;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setSelected({ kind: 'text', index: idx })}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                isSel
                                  ? 'bg-amber-50 dark:bg-amber-950/30'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                              }`}
                            >
                              <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                                {item.text}
                              </span>
                              <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                {typeof item.score === 'number' ? `${Math.round(item.score * 100)}%` : 'OCR'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : inspectorTab === 'objects' ? (
                <div className="space-y-2">
                  {objects.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No objects detected above confidence {conf.toFixed(2)}.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {objects.map((obj, idx) => {
                        const isSel = selected?.kind === 'object' && selected.index === idx;
                        const attrs = obj.description || obj.attributes;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setSelected({ kind: 'object', index: idx })}
                            className={`w-full px-3.5 py-2.5 text-left transition-colors ${
                              isSel
                                ? 'bg-teal-50/70 dark:bg-teal-950/30'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                                {obj.name}
                              </span>
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                {obj.id !== undefined ? `id:${obj.id} · ` : ''}
                                {typeof obj.score === 'number' ? `${(obj.score * 100).toFixed(1)}%` : ''}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                              {obj.position && <span>pos: {obj.position}</span>}
                              {attrs &&
                                Object.entries(attrs).map(([k, v]) => (
                                  <span key={k}>
                                    {k}: {String(v)}
                                  </span>
                                ))}
                              {obj.bbox && <span>box: [{obj.bbox.join(', ')}]</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : inspectorTab === 'relations' ? (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Spatial Relations ({relations.length})
                    </h3>
                    {relations.length === 0 ? (
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                        No explicit spatial relations returned for this scene.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5 text-sm text-slate-800 dark:text-slate-200">
                        {relations.map((rel, idx) => (
                          <li
                            key={idx}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
                          >
                            {typeof rel === 'string'
                              ? rel
                              : rel.description ||
                                `${String(rel.subject ?? '')} ${String(rel.predicate || rel.relation || '→')} ${String(rel.object ?? '')}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {events.length > 0 && (
                    <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Events ({events.length})
                      </h3>
                      <pre className="mt-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                        {JSON.stringify(events, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">Reasoning Trace</h3>
                    <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      {result.reasoning || 'No reasoning trace included.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void copyText('json', JSON.stringify(result, null, 2))}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
                    >
                      {copiedId === 'json' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === 'json' ? 'Copied JSON' : 'Copy JSON'}
                    </button>
                  </div>
                  <pre className="max-h-[440px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
