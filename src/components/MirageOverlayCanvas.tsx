import React from 'react';
import type { MirageObject, MirageResult } from '../types/quire';
import { normalizeMirageText } from '../lib/mirageMarkdown';

interface MirageOverlayCanvasProps {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  result: MirageResult | null;
  showObjects: boolean;
  showMasks: boolean;
  showText: boolean;
  showLabels: boolean;
  selectedIndex: { kind: 'object' | 'text'; index: number } | null;
  onSelect: (sel: { kind: 'object' | 'text'; index: number } | null) => void;
}

const PALETTE = [
  '#0d9488', // teal-600
  '#2563eb', // blue-600
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#e11d48', // rose-600
  '#059669', // emerald-600
];

function extractPolygons(mask: MirageObject['mask']): string[] {
  if (!mask || !Array.isArray(mask)) return [];
  // Case 1: Array of flat coordinate arrays [[x0, y0, x1, y1, ...], ...]
  if (mask.length > 0 && Array.isArray(mask[0])) {
    return (mask as number[][])
      .filter((poly) => poly.length >= 6)
      .map((poly) => {
        const pts: string[] = [];
        for (let i = 0; i + 1 < poly.length; i += 2) {
          pts.push(`${poly[i]},${poly[i + 1]}`);
        }
        return pts.join(' ');
      });
  }
  // Case 2: Single flat coordinate array [x0, y0, x1, y1, ...]
  if (mask.length >= 6 && typeof mask[0] === 'number') {
    const flat = mask as number[];
    const pts: string[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      pts.push(`${flat[i]},${flat[i + 1]}`);
    }
    return [pts.join(' ')];
  }
  return [];
}

export const MirageOverlayCanvas: React.FC<MirageOverlayCanvasProps> = ({
  imageSrc,
  imageWidth,
  imageHeight,
  result,
  showObjects,
  showMasks,
  showText,
  showLabels,
  selectedIndex,
  onSelect,
}) => {
  const objects = Array.isArray(result?.objects) ? result!.objects : [];
  const textItems = result ? normalizeMirageText(result) : [];

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
      <div
        className="relative mx-auto w-full"
        style={{
          aspectRatio: imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : undefined,
          maxHeight: '520px',
        }}
      >
        <img
          src={imageSrc}
          alt="Analyzed visual input"
          referrerPolicy="no-referrer"
          className="block h-full w-full object-contain select-none"
        />

        {result && (
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            onClick={() => onSelect(null)}
          >
            {/* Segmentation polygon masks */}
            {showMasks &&
              objects.map((obj, idx) => {
                const color = PALETTE[idx % PALETTE.length];
                const polys = extractPolygons(obj.mask);
                const isSel = selectedIndex?.kind === 'object' && selectedIndex.index === idx;
                return polys.map((points, pIdx) => (
                  <polygon
                    key={`mask-${idx}-${pIdx}`}
                    points={points}
                    fill={color}
                    fillOpacity={isSel ? 0.34 : 0.18}
                    stroke={color}
                    strokeWidth={isSel ? 4 : 2}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect({ kind: 'object', index: idx });
                    }}
                  />
                ));
              })}

            {/* Object bounding boxes */}
            {showObjects &&
              objects.map((obj, idx) => {
                if (!obj.bbox || obj.bbox.length !== 4) return null;
                const [x0, y0, x1, y1] = obj.bbox;
                const color = PALETTE[idx % PALETTE.length];
                const isSel = selectedIndex?.kind === 'object' && selectedIndex.index === idx;
                const w = Math.max(4, x1 - x0);
                const h = Math.max(4, y1 - y0);
                const labelText = `${obj.name}${typeof obj.score === 'number' ? ` ${Math.round(obj.score * 100)}%` : ''}`;
                return (
                  <g
                    key={`obj-${idx}`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect({ kind: 'object', index: idx });
                    }}
                  >
                    <rect
                      x={x0}
                      y={y0}
                      width={w}
                      height={h}
                      fill={isSel ? color : 'transparent'}
                      fillOpacity={isSel ? 0.12 : 0}
                      stroke={color}
                      strokeWidth={isSel ? 3.5 : 2}
                      vectorEffect="non-scaling-stroke"
                    />
                    {showLabels && (
                      <g transform={`translate(${x0}, ${Math.max(22, y0)})`}>
                        <rect
                          x={0}
                          y={-22}
                          width={Math.min(340, labelText.length * 10.5 + 14)}
                          height={22}
                          rx={3}
                          fill={color}
                        />
                        <text
                          x={7}
                          y={-6}
                          fill="#ffffff"
                          fontSize="14"
                          fontWeight="600"
                          fontFamily="system-ui, sans-serif"
                        >
                          {labelText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* OCR text region boxes */}
            {showText &&
              textItems.map((item, idx) => {
                if (!item.bbox || item.bbox.length !== 4) return null;
                const [x0, y0, x1, y1] = item.bbox;
                const isSel = selectedIndex?.kind === 'text' && selectedIndex.index === idx;
                return (
                  <g
                    key={`txt-${idx}`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect({ kind: 'text', index: idx });
                    }}
                  >
                    <rect
                      x={x0}
                      y={y0}
                      width={Math.max(4, x1 - x0)}
                      height={Math.max(4, y1 - y0)}
                      fill="#f59e0b"
                      fillOpacity={isSel ? 0.25 : 0.08}
                      stroke="#d97706"
                      strokeDasharray={isSel ? undefined : '4 3'}
                      strokeWidth={isSel ? 3 : 1.75}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
          </svg>
        )}
      </div>
    </div>
  );
};
