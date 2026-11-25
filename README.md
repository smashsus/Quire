# Quire

Quire is a browser extension and web application for converting PDFs to Markdown and analyzing images locally. All PDF parsing, math reconstruction, Tesseract OCR, and Cactus Mirage vision inference run on your device via WebAssembly and Web Workers.

- [Download Browser Extension (.zip)](./public/quire-extension.zip?raw=true) (ready for Chrome, Edge, and Brave Load Unpacked)
- [Download Source Code (.zip)](./public/quire-source.zip?raw=true)

## Install as a Browser Extension (Manifest V3)

You do not need Node.js or a build step to install the extension:

1. Download [quire-extension.zip](./public/quire-extension.zip?raw=true) and unzip it into a folder on your computer.
2. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge, `brave://extensions` in Brave).
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the unzipped folder containing `manifest.json`.
5. Click the Quire icon in your browser toolbar to open the workspace in a full tab (or open it from the Side Panel menu).

## What is inside

Quire combines a structured PDF extraction pipeline with two client-side vision and OCR options:

1. **Document Studio**
   - **Typical OCR**: Uses PDF.js for native PDF text, vector math reconstruction (fractions, radicals, matrices, superscripts, subscripts), unknown glyph classification, multi-column splitting, and Markdown table formatting. Falls back to Tesseract.js (`eng`) when a page is scanned or when an image file is opened.
   - **Mirage VLM**: Runs the Cactus Compute Mirage model (`51.3M` parameters, `21.6 MB` 2-bit quantized `.cact` weights) directly inside a Web Worker over WebAssembly to produce scene summaries, object detections, OCR text regions, and Markdown output.
   - **Hybrid**: Keeps native PDF vector text, math, and table layout while sending detected figures, graphs, and scanned pages to Mirage for visual captions and OCR.
   - **Figure extraction**: Detects embedded images and vector plots on PDF pages and lets you download cropped PNGs bundled as `figures.zip`.

2. **Mirage Vision**
   - Inspect uploaded images, live camera captures, built-in sample documents (invoice or diagram), or individual pages sent over from Document Studio.
   - Toggle interactive SVG overlays for object bounding boxes, polygon segmentation masks, OCR text regions, and labels.
   - Configure language (`en`, `de`, `fr`, `es`, `it`, `nl`, `pl`), detection thresholds, mask format, and optional keyword boosting.
   - Define typed schemas (`enum`, `integer`, `string`) under **Form Extract** to pull structured JSON fields out of an image.

3. **Prompt Chunker**
   - Splits long Markdown output by paragraph boundaries to fit a configurable character budget, with approximate token counts and a sequential "Copy Next" tracker.

## How Mirage and OCR run locally

- **Cactus Mirage**: Runs through `cactus/mirage-worker.js`, loading `cactus/cactus.js` and `cactus/cactus.wasm`. On first run, it downloads `mirage.cact` (`21.6 MB`) from Hugging Face and stores it in browser IndexedDB (`quire-mirage-cache`). Subsequent sessions mount from IndexedDB, or you can load a `.cact` file from disk using **Load .cact**.
- **Tesseract.js**: Bundles `tesseract/worker.min.js` and `tesseract/tesseract-core-simd-lstm.wasm.js` locally inside the extension package to satisfy Manifest V3 `script-src 'self' 'wasm-unsafe-eval'` CSP rules without remote script imports.

## Building from source

To modify the source or rebuild the extension bundle yourself:

```bash
npm install
npm run dev       # Local Vite dev server on http://localhost:3000
npm run lint      # TypeScript check (tsc --noEmit)
npm run build     # Builds the loadable extension into dist/
```

After running `npm run build`, the `dist/` folder contains `manifest.json`, `background.js`, compiled assets, icons, and WASM workers ready to load via **Load unpacked**.

## Project structure

```text
public/
  manifest.json          Chrome/Edge/Brave Manifest V3 configuration
  background.js          Service worker opening Quire on toolbar click
  icons/                 Extension icons (16px, 48px, 128px)
  cactus/
    cactus.js            Emscripten loader for Cactus WASM
    cactus.wasm          Compiled Cactus runtime binary
    mirage-worker.js     Web Worker managing IndexedDB cache and Mirage inference
  tesseract/
    worker.min.js        Local Tesseract worker script for MV3 CSP compliance
    tesseract-core-simd-lstm.wasm.js  Bundled Tesseract SIMD LSTM WASM core
src/
  components/
    DocumentStudio.tsx   PDF/image dropzone, engine switcher, page/figure preview, Markdown editor
    MirageOverlayCanvas.tsx  Normalized 0..1000 SVG overlay for boxes, masks, and OCR regions
    MirageVisionLab.tsx  Model controls, camera capture, inspector tabs, and form extractor
    PromptChunker.tsx    Character-bounded Markdown splitter with copy tracking
  lib/
    glyph.ts             Bitmap glyph classifier for unmapped PDF font symbols
    layout.ts            Column splitting, heading detection, tables, and Markdown assembly
    math.ts              PDF operator shape detection and TeX/Unicode math reconstruction
    mirageClient.ts      Typed Promise client over the Mirage Web Worker
    mirageMarkdown.ts    Converts Mirage JSON responses into readable Markdown
    pdfProcessor.ts      Orchestrates PDF.js, Tesseract.js, JSZip figure exports, and Mirage
    sampleAssets.ts      Canvas generators for sample invoice and diagram inputs
    tesseractOcr.ts      Local Tesseract.js worker feeding word boxes into layout reconstruction
  types/
    quire.ts             Shared TypeScript types
  App.tsx                Top navigation, theme toggle, drag/paste routing, and shared state
```

## Notes and limitations

- Camera capture in Mirage Vision requires browser camera permissions and works best when opened in a full extension tab via the toolbar icon.
- Large images are downscaled to a maximum dimension of `1024px` before RGB extraction for Mirage WASM inference to keep memory usage and latency low.
- Pure scanned PDFs with many pages run faster with Tesseract or Hybrid than running full Mirage scene inference on every page.
