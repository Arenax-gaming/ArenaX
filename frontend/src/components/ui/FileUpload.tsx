'use client';

import React, { useCallback, useState, useRef } from 'react';
import { useDropzone, FileRejection, Accept } from 'react-dropzone';
import { UploadCloud, File as FileIcon, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import NextImage from 'next/image';

interface FileUploadProps {
  onFileAccepted: (file: File) => void;
  onFileRejected?: (rejections: FileRejection[]) => void;
  onRemove: () => void;
  accept?: Accept;
  maxSize?: number;
  file: File | null;
  preview: string | null;
  uploading?: boolean;
  uploadProgress?: number;
  className?: string;
  disabled?: boolean;
  /** Optional uploader function receives the file and a progress callback (0-100) */
  uploader?: (file: File, onProgress: (p: number) => void) => Promise<any>;
  /** Enable client-side image compression before upload */
  enableCompression?: boolean;
  /** Compression options */
  compression?: { maxDimension?: number; quality?: number };
  /** Analytics hook for upload events */
  onUploadAnalytics?: (event: { type: string; payload?: any }) => void;
}

export function FileUpload({
  onFileAccepted,
  onFileRejected,
  onRemove,
  accept = { 'image/*': ['.jpeg', '.png', '.webp', '.gif'] },
  maxSize = 5 * 1024 * 1024, // 5MB
  file,
  preview,
  uploading = false,
  uploadProgress = 0,
  className,
  disabled = false,
  uploader,
  enableCompression = true,
  compression = { maxDimension: 1280, quality: 0.8 },
  onUploadAnalytics,
}: FileUploadProps) {
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const [internalUploading, setInternalUploading] = useState(false);
  const [internalProgress, setInternalProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setRejectionError(null);
      setUploadError(null);
      if (fileRejections.length > 0) {
        const error = fileRejections[0].errors[0];
        setRejectionError(error.message);
        if (onFileRejected) {
          onFileRejected(fileRejections);
        }
        return;
      }

      if (acceptedFiles.length > 0) {
        const original = acceptedFiles[0];
        lastFileRef.current = original;

        const processAndMaybeUpload = async (fileToSend: File) => {
          try {
            onFileAccepted(fileToSend);

            // If uploader provided, handle upload here and emit progress
            if (uploader) {
              setInternalUploading(true);
              setInternalProgress(0);
              onUploadAnalytics?.({ type: 'upload_start', payload: { name: fileToSend.name, size: fileToSend.size } });
              await uploader(fileToSend, (p: number) => {
                setInternalProgress(p);
                onUploadAnalytics?.({ type: 'upload_progress', payload: { progress: p } });
              });
              setInternalProgress(100);
              onUploadAnalytics?.({ type: 'upload_complete', payload: { name: fileToSend.name } });
            }
          } catch (err: any) {
            const msg = err?.message ?? 'Upload failed';
            setUploadError(msg);
            onUploadAnalytics?.({ type: 'upload_error', payload: { error: msg } });
          } finally {
            setInternalUploading(false);
          }
        };

        // If it's an image and compression enabled, compress first
        if (enableCompression && original.type.startsWith('image/')) {
          compressImage(original, compression)
            .then((compressed) => processAndMaybeUpload(compressed))
            .catch(() => processAndMaybeUpload(original));
        } else {
          processAndMaybeUpload(original);
        }
      }
    },
    [onFileAccepted, onFileRejected, uploader, enableCompression, compression, onUploadAnalytics]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxSize,
    onDrop: handleDrop,
    multiple: false,
    disabled,
    onDragEnter: undefined,
    onDragLeave: undefined,
    onDragOver: undefined,
  });

  // displayed uploading/progress prefer external props but fall back to internal
  const displayedUploading = uploading ?? internalUploading;
  const displayedProgress = uploadProgress ?? internalProgress;

  const handleKeyDownRoot = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const handleRetry = () => {
    if (lastFileRef.current) {
      // re-run drop handling with the last file
      handleDrop([lastFileRef.current], []);
    }
  };

  const handleRemove = () => {
    setUploadError(null);
    setRejectionError(null);
    setInternalProgress(0);
    setInternalUploading(false);
    lastFileRef.current = null;
    onRemove();
  };

  // attach input ref to file input
  const inputProps = getInputProps() as any;
  inputProps.ref = (el: HTMLInputElement) => {
    inputRef.current = el;
    const { ref } = getInputProps() as any;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  return (
    <div className={cn('space-y-2', className)}>
      {preview && file ? (
        <div className="relative group w-32 h-32 rounded-full overflow-hidden border-2 border-muted-foreground/20">
          <NextImage src={preview} alt="File preview" fill style={{ objectFit: 'cover' }} />
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="destructive"
              size="icon"
              onClick={handleRemove}
              className="rounded-full"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div
          {...getRootProps()}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleKeyDownRoot}
          aria-disabled={disabled}
          aria-label="File upload. Press Enter to open file dialog or drag and drop."
          className={cn(
            'relative flex flex-col items-center justify-center w-full p-6 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors',
            isDragActive && 'border-primary bg-primary/10',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <input {...inputProps} />
          {displayedUploading ? (
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-2 text-sm font-medium">Uploading...</p>
              <div className="w-full bg-muted rounded-full h-2.5 mt-2">
                <div
                  className="bg-primary h-2.5 rounded-full"
                  style={{ width: `${displayedProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{displayedProgress}%</p>
            </div>
          ) : (
            <div className="text-center">
              <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-semibold text-primary">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                {Object.values(accept)
                  .flat()
                  .join(', ')
                  .toUpperCase()}{' '}
                (max. {maxSize / 1024 / 1024}MB)
              </p>
            </div>
          )}
        </div>
      )}
      {rejectionError && <p className="text-sm text-destructive" role="alert">{rejectionError}</p>}
      {uploadError && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-destructive" role="alert">{uploadError}</p>
          <Button size="sm" onClick={handleRetry}>Retry</Button>
        </div>
      )}
      {/* ARIA live region for progress and errors */}
      <div aria-live="polite" className="sr-only">
        {displayedUploading ? `Uploading: ${displayedProgress}%` : rejectionError || uploadError || ''}
      </div>
    </div>
  );
}

export default FileUpload;

// Simple image compression using canvas. Returns a new File or the original on failure.
async function compressImage(file: File, options: { maxDimension?: number; quality?: number }): Promise<File> {
  const { maxDimension = 1280, quality = 0.8 } = options || {};
  try {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const { width, height } = img;
    let targetWidth = width;
    let targetHeight = height;
    if (width > height && width > maxDimension) {
      targetWidth = maxDimension;
      targetHeight = Math.round((height * maxDimension) / width);
    } else if (height > width && height > maxDimension) {
      targetHeight = maxDimension;
      targetWidth = Math.round((width * maxDimension) / height);
    } else if (width === height && width > maxDimension) {
      targetWidth = targetHeight = maxDimension;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob: Blob | null = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), file.type, quality);
    });
    if (!blob) return file;
    const compressed = new File([blob], file.name, { type: file.type });
    return compressed;
  } catch (e) {
    return file;
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}