import { accessToken, unauthorized } from "@/lib/auth-session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface RequestOptions extends RequestInit {
  token?: string;
  auth?: boolean;
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { token, auth = true, headers, ...rest } = options;

  const authHeader: Record<string, string> = {};
  const activeToken = auth ? (token ?? accessToken()) : null;

  if (activeToken) {
    authHeader["Authorization"] = `Bearer ${activeToken}`;
  }

  const url = `${API_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const res = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401 && activeToken) unauthorized(activeToken);
    let errBody: { code?: string; message?: string | string[] } = {};
    try {
      errBody = await res.json();
    } catch {
      // Body không phải JSON
    }

    const message = Array.isArray(errBody.message)
      ? errBody.message.join(", ")
      : errBody.message || res.statusText || "Yêu cầu thất bại";
    const code = errBody.code || "UNKNOWN_ERROR";

    throw new ApiError(message, res.status, code);
  }

  return res.json() as Promise<T>;
}
