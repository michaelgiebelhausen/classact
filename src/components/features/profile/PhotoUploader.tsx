"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadProfilePhoto } from "@/server/actions/photos";
import type { PhotoKind } from "@/types/db";

const LABELS: Record<PhotoKind, { title: string; hint: string }> = {
  candid: { title: "Me in class", hint: "A quick selfie — how you actually look." },
  professional: { title: "Professional", hint: "A headshot works." },
  adventure: { title: "On an adventure", hint: "Your Instagram-style shot." },
};

/** Downscale to <=1280px and JPEG-compress before upload. */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85)
  );
}

export function PhotoUploader({
  kind,
  initialUrl,
}: {
  kind: PhotoKind;
  initialUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const { title, hint } = LABELS[kind];

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const blob = await compressImage(file);
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("file", new File([blob], `${kind}.jpg`, { type: "image/jpeg" }));
      const result = await uploadProfilePhoto(formData);
      if (result.ok) {
        setPreviewUrl(URL.createObjectURL(blob));
        toast.success(`${title} photo saved.`);
      } else {
        toast.error(result.error);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group relative h-28 w-28 overflow-hidden rounded-full border bg-muted"
        aria-label={`Upload ${title} photo`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={`${title} photo`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-3xl text-muted-foreground">
            +
          </span>
        )}
      </button>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "Uploading…" : previewUrl ? "Replace" : "Add photo"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
