import type { MirageDescribeOptions, MirageLanguage, MirageResult } from '../types/quire';

export interface MirageProgressEvent {
  stage: 'wasm' | 'cache' | 'download' | 'mount';
  message?: string;
  received?: number;
  total?: number;
}

type PendingRequest = {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
};

class MirageWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<(ev: MirageProgressEvent) => void>();

  private getWorker(): Worker {
    if (!this.worker) {
      const workerUrl = new URL('./cactus/mirage-worker.js', window.location.href).href;
      this.worker = new Worker(workerUrl);
      this.worker.onmessage = (event) => {
        const msg = event.data;
        if (msg && !msg.id && (msg.type === 'status' || msg.type === 'progress')) {
          const ev: MirageProgressEvent = {
            stage: msg.stage,
            message: msg.message,
            received: msg.received,
            total: msg.total,
          };
          this.listeners.forEach((fn) => fn(ev));
          return;
        }
        if (msg && typeof msg.id === 'number') {
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          if (msg.ok) entry.resolve(msg.data);
          else entry.reject(new Error(msg.error || 'Mirage worker error'));
        }
      };
      this.worker.onerror = (err) => {
        const error = new Error(err.message || 'Mirage worker crashed');
        this.pending.forEach((p) => p.reject(error));
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private call<T>(type: string, payload?: unknown, transfer?: Transferable[]): Promise<T> {
    const id = this.nextId++;
    const worker = this.getWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      if (transfer && transfer.length) {
        worker.postMessage({ id, type, payload }, transfer);
      } else {
        worker.postMessage({ id, type, payload });
      }
    });
  }

  subscribe(fn: (ev: MirageProgressEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  checkCache(): Promise<{ cached: boolean; bytes: number; loaded: boolean }> {
    return this.call('check-cache');
  }

  clearCache(): Promise<{ cleared: boolean }> {
    return this.call('clear-cache');
  }

  async init(customFile?: File, forceRedownload = false): Promise<{ source: string; bytes: number }> {
    if (customFile) {
      const buf = await customFile.arrayBuffer();
      return this.call('init', { customBytes: buf }, [buf]);
    }
    return this.call('init', { forceRedownload });
  }

  async describeCanvas(
    canvas: HTMLCanvasElement,
    options: MirageDescribeOptions = {},
    language?: MirageLanguage,
    keywords?: string[]
  ): Promise<{ result: MirageResult; latencyMs: number }> {
    // Limit max inference dimension to 1024px while keeping aspect ratio for crisp fast WASM inference
    const maxDim = 1024;
    let targetCanvas = canvas;
    if (canvas.width > maxDim || canvas.height > maxDim) {
      const scale = maxDim / Math.max(canvas.width, canvas.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(canvas.width * scale));
      c.height = Math.max(1, Math.round(canvas.height * scale));
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, 0, c.width, c.height);
        targetCanvas = c;
      }
    }
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    const { width, height } = targetCanvas;
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    return this.call(
      'describe',
      { rgb, width, height, options, language, keywords },
      [rgb.buffer]
    );
  }

  async describeImageSource(
    src: string | Blob,
    options: MirageDescribeOptions = {},
    language?: MirageLanguage,
    keywords?: string[]
  ): Promise<{ result: MirageResult; latencyMs: number; width: number; height: number }> {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const out = await this.describeCanvas(c, options, language, keywords);
    return { ...out, width: c.width, height: c.height };
  }
}

export const mirageClient = new MirageWorkerClient();
