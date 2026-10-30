import { describe, expect, it } from "vitest";
import { ITEM_IMAGE_MAX_BYTES, validateItemImage } from "./item-image";

describe("validateItemImage", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s up to 5 MB", (type) => {
    expect(validateItemImage({ type, size: ITEM_IMAGE_MAX_BYTES })).toBeNull();
  });

  it.each(["image/gif", "image/svg+xml", "text/plain", ""])("rejects unsupported type %s", (type) => {
    expect(validateItemImage({ type, size: 100 })).toBe("Choose a JPG, PNG, or WebP image.");
  });

  it("rejects files larger than 5 MB", () => {
    expect(validateItemImage({ type: "image/jpeg", size: ITEM_IMAGE_MAX_BYTES + 1 })).toBe("Image must be 5 MB or smaller.");
  });
});
