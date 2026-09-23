/**
 * Hand-written API client. Kept hand-written (not generated from an OpenAPI schema) for
 * Prototype 1 to stay in lockstep with fast-moving backend routes without a codegen step.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8100/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include", // send/receive the httpOnly refresh cookie
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json();
  if (!res.ok) {
    const err = body?.error ?? { code: "unknown", message: "Request failed" };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return body as T;
}

// ---- Auth ----

export interface CurrentUser {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: "owner" | "staff";
}

export async function login(email: string, password: string) {
  return apiFetch<{ access_token: string; expires_in: number }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}

export async function getMe() {
  return apiFetch<CurrentUser>("/auth/me");
}

export { API_BASE_URL };
