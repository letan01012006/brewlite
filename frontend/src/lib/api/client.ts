import { accessToken, unauthorized } from "@/lib/auth-session";

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
  timeoutMs?: number;
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { token, auth = true, headers, signal, timeoutMs = 15000, ...rest } = options;

  const authHeader: Record<string, string> = {};
  const activeToken = auth ? (token ?? accessToken()) : null;

  if (activeToken) {
    authHeader["Authorization"] = `Bearer ${activeToken}`;
  }

  const url = `/api${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
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

    return await res.json() as T;
  } catch (error) {
    // Timeouts do not mean payments were rejected; never retry mutations here.
    if (signal?.aborted) throw error;
    if (timedOut) throw new ApiError("Kết nối quá lâu. Vui lòng kiểm tra mạng và thử lại.", 0, "TIMEOUT");
    if (error instanceof ApiError) throw error;
    throw new ApiError("Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.", 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
