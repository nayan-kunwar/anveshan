/**
 * Same-origin API client. Next rewrites /api/* to Express, so the session
 * cookie is first-party — no CORS, no credentials flag needed.
 */

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

function toApiError(body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err: unknown = body.error;
    if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
      const code: unknown = err.code;
      const message: unknown = err.message;
      if (typeof code === "string" && typeof message === "string") {
        return new ApiError(code, message);
      }
    }
  }
  return new ApiError("INTERNAL", "Request failed");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    throw toApiError(body);
  }
  return body as T;
}

export interface User {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface Subscription {
  frequency: "immediate" | "daily";
  watchNewPrograms: boolean;
  watchAllPrograms: boolean;
  digestTimezone: string;
  digestTimeLocal: string;
  nextDigestAt: string | null;
  updatedAt: string;
}

export interface WatchedProgram {
  programId: string;
  name: string;
  externalId: string;
}

export interface Program {
  id: string;
  platform: string;
  externalId: string;
  name: string;
  url?: string;
  updatedAt: string;
}

export function requestMagicLink(email: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("/api/v1/auth/request-magic-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyMagicLink(token: string): Promise<{ data: User }> {
  return api<{ data: User }>("/api/v1/auth/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function me(): Promise<{ data: User }> {
  return api<{ data: User }>("/api/v1/auth/me");
}

export function logout(): Promise<{ ok: true }> {
  return api<{ ok: true }>("/api/v1/auth/logout", { method: "POST" });
}

export function getSubscription(): Promise<{ data: Subscription | null }> {
  return api<{ data: Subscription | null }>("/api/v1/subscriptions");
}

export function putSubscription(input: {
  frequency: "immediate" | "daily";
  watchNewPrograms: boolean;
  watchAllPrograms: boolean;
  digestTimezone?: string;
  digestTimeLocal?: string;
}): Promise<{ data: Subscription }> {
  return api<{ data: Subscription }>("/api/v1/subscriptions", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listWatches(): Promise<{ data: WatchedProgram[] }> {
  return api<{ data: WatchedProgram[] }>("/api/v1/subscriptions/watches");
}

export function addWatch(programId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("/api/v1/subscriptions/watches", {
    method: "POST",
    body: JSON.stringify({ programId }),
  });
}

export function removeWatch(programId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/v1/subscriptions/watches/${programId}`, {
    method: "DELETE",
  });
}

export function unsubscribe(userId: string, token: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("/api/v1/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ userId, token }),
  });
}

interface ProgramPage {
  data: Program[];
  pagination: { page: number; pageSize: number; total: number };
}

/** Load one catalog page (server-side pagination, 25/page default). */
export async function listPrograms(page: number, pageSize = 25): Promise<ProgramPage> {
  return api<ProgramPage>(`/api/v1/programs?page=${page}&pageSize=${pageSize}`);
}

export function getProgram(id: string): Promise<{ data: Program }> {
  return api<{ data: Program }>(`/api/v1/programs/${id}`);
}

export interface Asset {
  id: string;
  identifier: string;
  type: string;
  scope: string;
}

export interface Change {
  id: string;
  type: string;
  programId: string;
  assetId: string | null;
  assetIdentifier: string | null;
  collectionRunId: string;
  detectedAt: string;
}

interface AssetPage {
  data: Asset[];
  pagination: { page: number; pageSize: number; total: number };
}

interface ChangePage {
  data: Change[];
  pagination: { page: number; pageSize: number; total: number };
}

export function listAssets(
  id: string,
  opts: { scope?: "ALL" | "IN" | "OUT"; page?: number; pageSize?: number } = {},
): Promise<AssetPage> {
  const params = new URLSearchParams({
    scope: opts.scope ?? "IN",
    page: String(opts.page ?? 1),
    pageSize: String(opts.pageSize ?? 25),
  });
  return api<AssetPage>(`/api/v1/programs/${id}/assets?${params.toString()}`);
}

export function listChanges(
  id: string,
  opts: { since?: string | undefined; page?: number; pageSize?: number } = {},
): Promise<ChangePage> {
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    pageSize: String(opts.pageSize ?? 25),
  });
  if (opts.since) params.set("since", opts.since);
  return api<ChangePage>(`/api/v1/programs/${id}/changes?${params.toString()}`);
}
