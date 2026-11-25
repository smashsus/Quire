/* Web Worker for on-device Cactus Mirage WASM inference */
/* global importScripts, createCactus */

const MIRAGE_WEIGHTS_URL =
  'https://huggingface.co/Cactus-Compute/mirage/resolve/main/mirage.cact';
const DB_NAME = 'quire-mirage-cache';
const STORE_NAME = 'weights';
const WEIGHTS_KEY = 'mirage-v1.cact';

let wasmModule = null;
let loadedModel = false;
let initPromise = null;

function openWeightsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedWeights() {
  try {
    const db = await openWeightsDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(WEIGHTS_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function putCachedWeights(bytes) {
  try {
    const db = await openWeightsDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(bytes, WEIGHTS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal if IndexedDB quota is restricted
  }
}

async function clearCachedWeights() {
  try {
    const db = await openWeightsDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(WEIGHTS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

async function ensureWasmRuntime() {
  if (wasmModule) return wasmModule;
  const cactusJsUrl = new URL('./cactus.js', self.location.href).href;
  const cactusWasmUrl = new URL('./cactus.wasm', self.location.href).href;
  importScripts(cactusJsUrl);
  const wasmRes = await fetch(cactusWasmUrl);
  if (!wasmRes.ok) {
    throw new Error(`Failed to fetch cactus.wasm (${wasmRes.status})`);
  }
  const wasmBinary = await wasmRes.arrayBuffer();
  wasmModule = await createCactus({
    wasmBinary,
    locateFile: (path) => new URL(`./${path}`, self.location.href).href,
  });
  return wasmModule;
}

async function downloadWeights(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Mirage weights (${res.status})`);
  }
  const total = Number(res.headers.get('content-length')) || 21611043;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function allocCString(mod, str) {
  const encoded = new TextEncoder().encode(str);
  const ptr = mod._malloc(encoded.length + 1);
  mod.HEAPU8.set(encoded, ptr);
  mod.HEAPU8[ptr + encoded.length] = 0;
  return ptr;
}

function loadWeightsIntoWasm(mod, weightsBytes) {
  const ptr = mod._malloc(weightsBytes.length);
  try {
    mod.HEAPU8.set(weightsBytes, ptr);
    const rc = mod._cactus_load(ptr, BigInt(weightsBytes.length));
    if (rc < 0) {
      const err = mod.UTF8ToString(mod._cactus_last_error());
      throw new Error(err || 'Failed to load Mirage weights into WASM');
    }
    const modelsMask = mod._cactus_models();
    if ((modelsMask & 4) === 0) {
      throw new Error('Loaded archive is not a Mirage vision model');
    }
    loadedModel = true;
  } finally {
    mod._free(ptr);
  }
}

async function initEngine({ customBytes, weightsUrl, forceRedownload } = {}) {
  if (loadedModel && !customBytes && !forceRedownload) {
    return { cached: true, bytes: 0 };
  }
  if (initPromise && !customBytes && !forceRedownload) {
    return initPromise;
  }

  initPromise = (async () => {
    self.postMessage({ type: 'status', stage: 'wasm', message: 'Loading Cactus WASM runtime' });
    const mod = await ensureWasmRuntime();

    let weights = null;
    let source = 'network';

    if (customBytes) {
      weights = new Uint8Array(customBytes);
      source = 'local-file';
      await putCachedWeights(weights);
    } else {
      if (!forceRedownload) {
        self.postMessage({ type: 'status', stage: 'cache', message: 'Checking local IndexedDB cache' });
        const cached = await getCachedWeights();
        if (cached && cached.byteLength > 1000000) {
          weights = cached instanceof Uint8Array ? cached : new Uint8Array(cached);
          source = 'indexeddb';
        }
      }
      if (!weights) {
        self.postMessage({
          type: 'status',
          stage: 'download',
          message: 'Downloading Mirage 22MB weights',
          received: 0,
          total: 21611043,
        });
        weights = await downloadWeights(weightsUrl || MIRAGE_WEIGHTS_URL, (received, total) => {
          self.postMessage({
            type: 'progress',
            stage: 'download',
            received,
            total,
          });
        });
        await putCachedWeights(weights);
      }
    }

    self.postMessage({ type: 'status', stage: 'mount', message: 'Mounting quantized model in WASM' });
    loadWeightsIntoWasm(mod, weights);
    return { source, bytes: weights.byteLength };
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

function runDescribe({ rgb, width, height, options, language, keywords }) {
  if (!wasmModule || !loadedModel) {
    throw new Error('Mirage model is not loaded yet');
  }
  const t0 = performance.now();
  const rgbBytes = rgb instanceof Uint8Array ? rgb : new Uint8Array(rgb);
  const expectedLen = width * height * 3;
  if (rgbBytes.length !== expectedLen) {
    throw new Error(`Invalid RGB buffer size: got ${rgbBytes.length}, expected ${expectedLen}`);
  }

  const outCapacity = 4 * 1024 * 1024;
  const rgbPtr = wasmModule._malloc(rgbBytes.length);
  const optsPtr = allocCString(wasmModule, JSON.stringify(options || {}));
  const langPtr = language ? allocCString(wasmModule, language) : 0;
  const kwStr = Array.isArray(keywords)
    ? keywords.filter(Boolean).join('\n')
    : typeof keywords === 'string'
      ? keywords.trim()
      : '';
  const kwPtr = kwStr ? allocCString(wasmModule, kwStr) : 0;
  const outPtr = wasmModule._malloc(outCapacity);

  try {
    wasmModule.HEAPU8.set(rgbBytes, rgbPtr);
    const code = wasmModule._cactus_describe(
      rgbPtr,
      width,
      height,
      optsPtr,
      langPtr,
      kwPtr,
      outPtr,
      outCapacity
    );
    if (code < 0) {
      const errMsg = wasmModule.UTF8ToString(wasmModule._cactus_last_error());
      throw new Error(errMsg || 'Mirage inference failed');
    }
    const rawJson = wasmModule.UTF8ToString(outPtr);
    const parsed = JSON.parse(rawJson);
    const latencyMs = Math.round(performance.now() - t0);
    return { result: parsed, latencyMs };
  } finally {
    wasmModule._free(rgbPtr);
    wasmModule._free(optsPtr);
    if (langPtr) wasmModule._free(langPtr);
    if (kwPtr) wasmModule._free(kwPtr);
    wasmModule._free(outPtr);
  }
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === 'check-cache') {
      const cached = await getCachedWeights();
      self.postMessage({
        id,
        ok: true,
        data: {
          cached: Boolean(cached && cached.byteLength > 1000000),
          bytes: cached ? cached.byteLength : 0,
          loaded: loadedModel,
        },
      });
      return;
    }

    if (type === 'clear-cache') {
      await clearCachedWeights();
      loadedModel = false;
      self.postMessage({ id, ok: true, data: { cleared: true } });
      return;
    }

    if (type === 'init') {
      const info = await initEngine(payload || {});
      self.postMessage({ id, ok: true, data: info });
      return;
    }

    if (type === 'describe') {
      if (!loadedModel) {
        await initEngine();
      }
      const res = runDescribe(payload);
      self.postMessage({ id, ok: true, data: res });
      return;
    }

    throw new Error(`Unknown worker action: ${type}`);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
