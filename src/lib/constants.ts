export const OUT_W = 1000, OUT_H = 1500;          // ACHA
export const MAX_OUTPUT_BYTES = 2_000_000;        // not 2 MiB, so either reading of "2 MB" passes
export const MAX_PHOTOS = 100;                    // per batch (device memory, not server cost)
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000;
export const PREVIEW_MAX_SIDE = 1600;             // preview shown in the editor AND used for detection
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;
