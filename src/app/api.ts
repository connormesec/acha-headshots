/** Calls to this site's own server (/api). Everything else in the app runs in the browser. */

import { asset } from "../lib/constants";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** JSON in, JSON out. Non-2xx responses throw an ApiError with the server's message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(asset(`api/${path}`), {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON (e.g. a static host's 404 page) */
  }
  if (!res.ok) {
    const err = body as { error?: string; code?: string } | undefined;
    throw new ApiError(err?.error ?? `The server answered ${res.status}`, res.status, err?.code);
  }
  if (body === undefined && text) throw new ApiError("The server sent something unexpected", res.status);
  return body as T;
}

export interface Spend { monthUsd: number; monthCapUsd: number; dayUsd: number; dayCapUsd: number }

export interface Me {
  admin: boolean;
  /** False when the server has no ADMIN_PASSWORD (or there is no server: a static-only deploy). */
  loginAvailable: boolean;
  /** An admin can use the AI number reader right now (key set, under budget). */
  visionAvailable: boolean;
  spend: Spend | null;
  /** No server answered: login, AI help and roster import are unavailable. */
  offline?: boolean;
}

export const authApi = {
  me: () => api<Me>("auth/me"),
  login: (password: string) => api<Me>("auth/login", { body: { password } }),
  logout: () => api<Me>("auth/logout", { body: {} }),
};
