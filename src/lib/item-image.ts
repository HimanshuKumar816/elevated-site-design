export const ITEM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ITEM_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validateItemImage(file: Pick<File, "type" | "size">): string | null {
  if (!ITEM_IMAGE_ALLOWED_TYPES.includes(file.type as (typeof ITEM_IMAGE_ALLOWED_TYPES)[number])) {
    return "Choose a JPG, PNG, or WebP image.";
  }
  if (file.size > ITEM_IMAGE_MAX_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

/**
 * Resizes large photos and converts them to WebP in the browser before upload.
 * If the browser cannot decode or encode the image, the original validated file
 * is returned so reporting is not blocked by an optional optimisation.
 */
export async function compressItemImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const maxSide = 1440;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "campusfind-item";
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
