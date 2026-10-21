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
