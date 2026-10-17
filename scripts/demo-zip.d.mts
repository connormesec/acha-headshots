export const DEMO_ROSTER: [first: string, last: string, number: number, position?: string][];
export const DEMO_PHOTOS: [name: string, outcome: "identified" | "review" | "failed"][];
export function renderPhoto(name: string, width?: number, height?: number): Promise<Buffer>;
export function buildDemoZip(): Promise<Uint8Array<ArrayBuffer>>;
export function expected(): { total: number; identified: number; review: number; failed: number };
