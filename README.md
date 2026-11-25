# Quire

Quire is a browser-based PDF to Markdown converter and visual document analyzer. All PDF parsing, math reconstruction, Tesseract OCR, and Cactus Mirage vision inference run locally in your browser via WebAssembly and Web Workers.

[Download Quire Source (.zip)](./public/quire-source.zip?raw=true)

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

## How Mirage runs in the browser

Mirage runs through `/public/cactus/mirage-worker.js`, which loads `/public/cactus/cactus.js` and `/public/cactus/cactus.wasm`.

- The first time you trigger Mirage, the worker downloads `mirage.cact` (`21.6 MB`) from Hugging Face and stores it in your browser's IndexedDB (`quire-mirage-cache`).
- Later sessions mount directly from IndexedDB without hitting the network.
- If you prefer offline setup from the start, use **Load .cact** in the Mirage Vision runtime bar to supply a local weights file from disk.

## Running locally

Unzip the archive or clone the repository, then install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

The app serves on `http://localhost:3000`.

Other available scripts:

```bash
npm run lint     # TypeScript check (tsc --noEmit)
npm run build    # Production bundle into dist/
npm run preview  # Preview the production build
```

## Project structure

```text
public/
  cactus/
    cactus.js            Emscripten loader for Cactus WASM
    cactus.wasm          Compiled Cactus runtime binary
    mirage-worker.js     Web Worker managing IndexedDB cache and Mirage inference
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
    tesseractOcr.ts      Lazy Tesseract.js worker feeding word boxes into layout reconstruction
  types/
    quire.ts             Shared TypeScript types
  App.tsx                Top navigation, theme toggle, drag/paste routing, and shared state
```

## Notes and limitations

- Camera capture in Mirage Vision requires browser camera permissions and a secure context (`localhost` or HTTPS).
- Large images are downscaled to a maximum dimension of `1024px` before RGB extraction for Mirage WASM inference to keep memory usage and latency low.
- Pure scanned PDFs with many pages run faster with Tesseract or Hybrid than running full Mirage scene inference on every page.
