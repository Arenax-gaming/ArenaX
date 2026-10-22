/**
 * Square avatar crop geometry (Issue #1396).
 *
 * The crop UI shows the image inside a square viewport of side `viewport`
 * (CSS px). The image is scaled to *cover* the viewport at zoom 1, and the
 * user pans it; `offset` is the image's top-left corner relative to the
 * viewport (always <= 0, so the viewport never shows empty space).
 */

export interface CropState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  size: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/** Display scale (CSS px per source px) for a given zoom. */
export function displayScale(
  naturalWidth: number,
  naturalHeight: number,
  viewport: number,
  zoom: number
): number {
  return (viewport / Math.min(naturalWidth, naturalHeight)) * zoom;
}

/** Keep the image covering the viewport: offsets in [viewport - size, 0]. */
export function clampOffset(
  offset: number,
  displayedSize: number,
  viewport: number
): number {
  return Math.min(0, Math.max(viewport - displayedSize, offset));
}

/** Centred crop at zoom 1. */
export function initialCrop(
  naturalWidth: number,
  naturalHeight: number,
  viewport: number
): CropState {
  const scale = displayScale(naturalWidth, naturalHeight, viewport, MIN_ZOOM);
  return {
    zoom: MIN_ZOOM,
    offsetX: (viewport - naturalWidth * scale) / 2,
    offsetY: (viewport - naturalHeight * scale) / 2,
  };
}

/** Change zoom while keeping the point under the viewport centre fixed. */
export function zoomAroundCenter(
  state: CropState,
  nextZoom: number,
  naturalWidth: number,
  naturalHeight: number,
  viewport: number
): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const oldScale = displayScale(naturalWidth, naturalHeight, viewport, state.zoom);
  const newScale = displayScale(naturalWidth, naturalHeight, viewport, zoom);
  const centerX = (viewport / 2 - state.offsetX) / oldScale;
  const centerY = (viewport / 2 - state.offsetY) / oldScale;
  return {
    zoom,
    offsetX: clampOffset(viewport / 2 - centerX * newScale, naturalWidth * newScale, viewport),
    offsetY: clampOffset(viewport / 2 - centerY * newScale, naturalHeight * newScale, viewport),
  };
}

/** Pan by (dx, dy) CSS px, clamped. */
export function pan(
  state: CropState,
  dx: number,
  dy: number,
  naturalWidth: number,
  naturalHeight: number,
  viewport: number
): CropState {
  const scale = displayScale(naturalWidth, naturalHeight, viewport, state.zoom);
  return {
    zoom: state.zoom,
    offsetX: clampOffset(state.offsetX + dx, naturalWidth * scale, viewport),
    offsetY: clampOffset(state.offsetY + dy, naturalHeight * scale, viewport),
  };
}

/** The square region of the source image currently visible in the viewport. */
export function sourceRect(
  state: CropState,
  naturalWidth: number,
  naturalHeight: number,
  viewport: number
): SourceRect {
  const scale = displayScale(naturalWidth, naturalHeight, viewport, state.zoom);
  const size = Math.min(viewport / scale, naturalWidth, naturalHeight);
  return {
    sx: Math.max(0, Math.min(naturalWidth - size, -state.offsetX / scale)),
    sy: Math.max(0, Math.min(naturalHeight - size, -state.offsetY / scale)),
    size,
  };
}

/** Render the crop to a square blob of `outputSize` px. Browser-only. */
export async function renderCrop(
  image: HTMLImageElement,
  rect: SourceRect,
  outputSize: number,
  type: "image/jpeg" | "image/png"
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the cropped image"))),
      type,
      type === "image/jpeg" ? 0.9 : undefined
    );
  });
}
