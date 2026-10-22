"use client";

/**
 * Square crop preview for avatar uploads (Issue #1396).
 *
 * Drag (mouse / touch / pen) or use the arrow keys to position the image,
 * and the slider or +/- keys to zoom. "Save avatar" renders the visible
 * square to a 512×512 image in the source format.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsModal } from "./SettingsModal";
import {
  initialCrop,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  renderCrop,
  sourceRect,
  zoomAroundCenter,
  type CropState,
} from "@/lib/avatarCrop";
import { AVATAR_OUTPUT_SIZE, type AvatarMimeType } from "@/api/profileSettings";

const VIEWPORT = 256;
const KEY_STEP = 10;
const ZOOM_STEP = 0.1;

interface AvatarCropModalProps {
  isOpen: boolean;
  /** Object URL of the selected file. */
  imageUrl: string | null;
  mimeType: AvatarMimeType;
  isSaving?: boolean;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}

export function AvatarCropModal({
  isOpen,
  imageUrl,
  mimeType,
  isSaving = false,
  onCancel,
  onCropped,
}: AvatarCropModalProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNatural(null);
    setError(null);
  }, [imageUrl]);

  const handleLoad = () => {
    const img = imageRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setCrop(initialCrop(img.naturalWidth, img.naturalHeight, VIEWPORT));
  };

  const applyPan = useCallback(
    (dx: number, dy: number) => {
      if (!natural) return;
      setCrop((c) => pan(c, dx, dy, natural.w, natural.h, VIEWPORT));
    },
    [natural]
  );

  const applyZoom = useCallback(
    (zoom: number) => {
      if (!natural) return;
      setCrop((c) => zoomAroundCenter(c, zoom, natural.w, natural.h, VIEWPORT));
    },
    [natural]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    applyPan(e.clientX - drag.x, e.clientY - drag.y);
    dragRef.current = { ...drag, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      // Arrows move the image, matching the drag direction.
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    if (moves[e.key]) {
      e.preventDefault();
      applyPan(...moves[e.key]!);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      applyZoom(crop.zoom + ZOOM_STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      applyZoom(crop.zoom - ZOOM_STEP);
    }
  };

  const handleSave = async () => {
    const img = imageRef.current;
    if (!img || !natural) return;
    try {
      setError(null);
      const rect = sourceRect(crop, natural.w, natural.h, VIEWPORT);
      onCropped(await renderCrop(img, rect, AVATAR_OUTPUT_SIZE, mimeType));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop the image");
    }
  };

  const scale = natural ? (VIEWPORT / Math.min(natural.w, natural.h)) * crop.zoom : 1;

  return (
    <SettingsModal
      isOpen={isOpen}
      onClose={onCancel}
      title="Crop your avatar"
      description="Drag or use the arrow keys to position your photo. Use the slider or + / − to zoom."
      dismissible={!isSaving}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!natural || isSaving} aria-busy={isSaving}>
            {isSaving ? "Uploading…" : "Save avatar"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div
          ref={viewportRef}
          role="group"
          tabIndex={0}
          aria-label="Avatar crop area. Use arrow keys to move the image, plus and minus to zoom."
          aria-roledescription="image cropper"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          style={{ width: VIEWPORT, height: VIEWPORT }}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL, not optimisable
            <img
              ref={imageRef}
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={handleLoad}
              className="absolute left-0 top-0 max-w-none select-none"
              style={
                natural
                  ? {
                      width: natural.w * scale,
                      height: natural.h * scale,
                      transform: `translate(${crop.offsetX}px, ${crop.offsetY}px)`,
                    }
                  : { opacity: 0 }
              }
            />
          )}
          {/* Circular guide: avatars are shown round elsewhere in the app */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full ring-[999px] ring-black/40"
          />
        </div>

        <div className="flex w-full flex-col items-center gap-4">
          <p className="text-sm font-medium text-foreground">Preview</p>
          <PreviewCircle imageUrl={imageUrl} natural={natural} crop={crop} />

          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => applyZoom(crop.zoom - ZOOM_STEP)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Zoom out"
              disabled={!natural || crop.zoom <= MIN_ZOOM}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onChange={(e) => applyZoom(Number(e.target.value))}
              disabled={!natural}
              aria-label="Zoom"
              aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
              className="flex-1 accent-primary"
            />
            <button
              type="button"
              onClick={() => applyZoom(crop.zoom + ZOOM_STEP)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Zoom in"
              disabled={!natural || crop.zoom >= MAX_ZOOM}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </SettingsModal>
  );
}

/** Small round preview of exactly what will be uploaded. */
function PreviewCircle({
  imageUrl,
  natural,
  crop,
}: {
  imageUrl: string | null;
  natural: { w: number; h: number } | null;
  crop: CropState;
}) {
  const size = 96;
  if (!imageUrl || !natural) {
    return <div className="h-24 w-24 rounded-full bg-muted" aria-hidden="true" />;
  }
  const ratio = size / VIEWPORT;
  const scale = (VIEWPORT / Math.min(natural.w, natural.h)) * crop.zoom * ratio;
  return (
    <div
      className="relative overflow-hidden rounded-full border bg-muted"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
      <img
        src={imageUrl}
        alt=""
        className="absolute left-0 top-0 max-w-none"
        style={{
          width: natural.w * scale,
          height: natural.h * scale,
          transform: `translate(${crop.offsetX * ratio}px, ${crop.offsetY * ratio}px)`,
        }}
      />
    </div>
  );
}
