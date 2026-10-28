/** File types the upload controls offer (the content is still checked by its bytes). */
export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

/** Limits that keep a hostile or oversized file from freezing or crashing the tab. */
export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 60,
  maxPinAttempts: 5,
  /** Largest canvas we rasterize to (about 25 megapixels). */
  maxCanvasPixels: 25_000_000,
};
