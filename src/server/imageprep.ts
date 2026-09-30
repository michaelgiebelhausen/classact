import "server-only";

/**
 * Fit a submitted image inside what the AI will accept.
 *
 * Vision models cap an image at roughly 5 MB of base64 and 8000 px a side,
 * and resample anything big down to a couple of thousand pixels anyway. A
 * retina screenshot saved as PNG blows straight past that — NB02 stalled for
 * two weeks on a 4500×3375, 17 MB one — so an oversized image is re-encoded
 * as a JPEG the model can read. Everything already within limits goes through
 * untouched: screenshot text stays as sharp as the student captured it.
 */

/** Raw bytes; base64 inflates by 4/3, which keeps this under ~4.7 MB encoded. */
const MAX_BYTES = 3_500_000;
const MAX_SIDE = 7_900;
/** Tried in order until one fits. Both keep screenshot text legible. */
const ATTEMPTS = [
  { side: 2576, quality: 85 },
  { side: 2000, quality: 72 },
];

export interface PreparedImage {
  base64: string;
  kind: "png" | "jpeg";
  resized: boolean;
}

export async function fitImageForModel(
  bytes: Buffer,
  kind: "png" | "jpeg"
): Promise<PreparedImage> {
  const untouched = { base64: bytes.toString("base64"), kind, resized: false };
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // No image library on this platform: send it as-is and let the scoring
    // retry/give-up path surface it if the model refuses.
    return untouched;
  }
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    return untouched;
  }
  if (bytes.length <= MAX_BYTES && Math.max(width, height) <= MAX_SIDE) {
    return untouched;
  }
  for (const attempt of ATTEMPTS) {
    const out = await sharp(bytes)
      .rotate()
      .resize({
        width: attempt.side,
        height: attempt.side,
        fit: "inside",
        withoutEnlargement: true,
      })
      // JPEG has no alpha: transparent screenshot regions become white, not black.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: attempt.quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= MAX_BYTES) {
      return { base64: out.toString("base64"), kind: "jpeg", resized: true };
    }
  }
  return untouched;
}
