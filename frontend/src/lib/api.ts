import axios, {
  AxiosError,
  AxiosInstance,
  type AxiosRequestConfig,
} from "axios";
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  clearSessionState,
  SELECTED_ORGANIZATION_KEY,
} from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";
const LOGIN_PATH = "/login";

/** Endpoints that must never trigger the refresh flow (they are pre-auth or own the session lifecycle). */
const AUTH_EXCLUDED_URLS = new Set([
  "/auth/login",
  "/auth/select-organization",
  "/auth/refresh",
  "/auth/logout",
]);

type ApiErrorData = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  requestId?: unknown;
};

export interface ApiErrorDetails {
  code: string;
  message: string;
  requestId?: string;
}

/**
 * The user and tenant a POS surface was rendered for.
 *
 * A POS request carries this so the transport can refuse to leave under any
 * other credential — including one a refresh rotated in from another tab.
 */
export interface PosRequestScope {
  userId: string;
  organizationId: string;
}

/** Answer of a POS request the client refused to send under a changed session. */
export const POS_SCOPE_MISMATCH_CODE = "ERR_POS_SCOPE_MISMATCH";

interface AccessTokenClaims {
  sub?: unknown;
  organizationId?: unknown;
}

const UNKNOWN_ERROR_CODE = "UNKNOWN_ERROR";

function safeMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages = value.filter(
      (item): item is string => typeof item === "string" && !!item.trim(),
    );
    if (messages.length > 0) return messages.join(", ");
  }
  return undefined;
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 128
    ? value.trim()
    : undefined;
}

export function getApiErrorDetails(error: unknown, fallback: string): ApiErrorDetails {
  const data = axios.isAxiosError(error)
    ? (error.response?.data as ApiErrorData | undefined)
    : undefined;
  const message = safeMessage(data?.message) ?? safeMessage(data?.error) ?? fallback;
  const code =
    typeof data?.code === "string" && data.code.trim()
      ? data.code.trim()
      : UNKNOWN_ERROR_CODE;

  return { code, message, requestId: safeRequestId(data?.requestId) };
}

/**
 * Auth responses keep returning tokens in the JSON body (dual-mode backend)
 * while also setting httpOnly cookies. Only the access token is consumed
 * here; it goes straight to the in-memory session store.
 */
interface AuthTokenResponse {
  accessToken?: string;
  /** Legacy alias still accepted by some endpoints. */
  token?: string;
  refreshToken?: string;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return getApiErrorDetails(error, fallback).message;
}

// Custom per-request flags used by the refresh-and-retry flow.
// InternalAxiosRequestConfig extends this interface, so both sides get the flags.
declare module "axios" {
  export interface AxiosRequestConfig {
    _retry?: boolean;
    _isRefreshCall?: boolean;
    /** Bound identity of a POS request; set only by the POS call sites. */
    posScope?: PosRequestScope;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function defaultOnSessionExpired(): void {
  if (typeof window !== "undefined") {
    window.location.href = LOGIN_PATH;
  }
}

/**
 * Reads the claims the backend signed, without verifying the signature: this is
 * only used to tell whether the credential still describes the POS surface, and
 * the server remains the authority on what the token grants.
 */
function readAccessTokenClaims(token: string): AccessTokenClaims | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object"
      ? (parsed as AccessTokenClaims)
      : null;
  } catch {
    return null;
  }
}

/** The tenant the transport would actually present for this request. */
function selectedOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_ORGANIZATION_KEY);
}

/**
 * Whether the credential this request would leave under still belongs to the
 * surface that asked for it.
 *
 * A platform session carries no tenant of its own and rides the selected one,
 * exactly as the request interceptor advertises it in `X-Organization-Id`.
 */
function posScopeMatches(scope: PosRequestScope): boolean {
  const token = getAccessToken();
  // A cookie-only request could use another tab's session at the proxy.
  // Scoped POS requests cannot establish their identity without a bearer.
  if (!token) return false;
  const claims = readAccessTokenClaims(token);
  if (!claims || claims.sub !== scope.userId) return false;
  const tenant =
    typeof claims.organizationId === "string"
      ? claims.organizationId
      : selectedOrganizationId();
  return tenant === scope.organizationId;
}

export class ApiClient {
  private client: AxiosInstance;

  /** Promise shared by concurrent 401s so only ONE /auth/refresh runs at a time. */
  private refreshInProgress: Promise<string | null> | null = null;

  constructor(
    private readonly onSessionExpired: () => void = defaultOnSessionExpired
  ) {
    this.client = axios.create({
      baseURL: API_URL,
      // Cookies (access/refresh/csrf) must flow on every request, including
      // cross-site calls to the API host.
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.request.use(
      (config) => {
        // A POS request names the user and tenant its surface was rendered for.
        // The shared cookies can be rotated by another tab, so the identity is
        // verified at dispatch — on the first attempt and again on every retry —
        // and the request is dropped before it leaves the browser.
        const posScope = config.posScope;
        if (posScope && !posScopeMatches(posScope)) {
          return Promise.reject(
            new AxiosError(
              "La sesión cambió de usuario u organización; no se envió la solicitud del punto de venta.",
              POS_SCOPE_MISMATCH_CODE,
              config
            )
          );
        }

        // Access token lives in memory only.
        const token = getAccessToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        if (typeof window !== "undefined") {
          const orgId = localStorage.getItem(SELECTED_ORGANIZATION_KEY);
          if (orgId) {
            config.headers["X-Organization-Id"] = orgId;
          }
          // Defense-in-depth: send the readable CSRF cookie value on mutating
          // requests. Harmless alongside Bearer (the backend CSRF guard only
          // enforces when no Bearer header is present).
          if (
            config.method &&
            ["post", "put", "patch", "delete"].includes(config.method)
          ) {
            const csrfToken = readCookie("csrf_token");
            if (csrfToken) {
              config.headers["x-csrf-token"] = csrfToken;
            }
          }
        }
        if (posScope) {
          // The bound tenant wins over whatever storage holds by now, so the
          // request and the site the cashier sees can never disagree.
          config.headers["X-Organization-Id"] = posScope.organizationId;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const config = error.config;

        if (
          error.response?.status !== 401 ||
          !config ||
          config._retry ||
          config._isRefreshCall ||
          AUTH_EXCLUDED_URLS.has(config.url ?? "")
        ) {
          return Promise.reject(error);
        }

        return this.refreshSession().then((newToken) => {
          if (!newToken) {
            // Refresh failed — the session is definitively dead. Tear the whole
            // session down rather than only the user cache: the organization
            // scope is identity-scoped state that the next login would inherit
            // and send as X-Organization-Id.
            clearSessionState();
            this.onSessionExpired();
            return Promise.reject(error);
          }
          // Retry the original request exactly once with the fresh token.
          // The request interceptor picks up the new Bearer automatically.
          config._retry = true;
          return this.client.request(config);
        });
      }
    );
  }

  /**
   * POST /auth/refresh using the httpOnly refresh_token cookie.
   * Concurrent callers share a single in-flight promise (dedupe).
   * Resolves with the new access token, or null when the refresh failed.
   */
  private refreshSession(): Promise<string | null> {
    if (!this.refreshInProgress) {
      const refreshPromise = this.client
        .post<AuthTokenResponse>(
          "/auth/refresh",
          {},
          { _isRefreshCall: true }
        )
        .then((response) => {
          const token =
            response.data.accessToken ??
            response.data.token ??
            null;
          if (token) {
            setAccessToken(token);
            return token;
          }
          clearAccessToken();
          return null;
        })
        .catch(() => {
          clearAccessToken();
          return null;
        })
        .finally(() => {
          this.refreshInProgress = null;
        });

      this.refreshInProgress = refreshPromise;
    }
    return this.refreshInProgress;
  }

  /** Internal axios instance. Exposed for tests only — do not use in app code. */
  getAxiosInstance(): AxiosInstance {
    return this.client;
  }

  get<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: AxiosRequestConfig
  ) {
    return this.client.get<T>(url, { ...config, params });
  }

  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ) {
    return this.client.post<T>(url, data, config);
  }

  postWithFormData<T = unknown>(url: string, data: FormData) {
    return this.client.post<T>(url, data, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  }

  put<T = unknown>(url: string, data?: unknown) {
    return this.client.put<T>(url, data);
  }

  patch<T = unknown>(url: string, data?: unknown) {
    return this.client.patch<T>(url, data);
  }

  delete<T = unknown>(url: string, config?: Record<string, unknown>) {
    return this.client.delete<T>(url, config);
  }

  upload<T = unknown>(url: string, file: File) {
    const formData = new FormData();
    formData.append("image", file);
    return this.client.post<T>(url, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  }

  async exportData(url: string, data?: unknown) {
    const response = await this.client.post(url, data, {
      responseType: "blob",
    });

    this.downloadBlobResponse(response.data, response.headers);
  }

  async downloadData(url: string, params?: Record<string, unknown>) {
    const response = await this.client.get(url, {
      params,
      responseType: "blob",
    });

    this.downloadBlobResponse(response.data, response.headers);
  }

  /** GET twin of `fetchBlob`, for documents read without side effects. */
  async getBlob(url: string): Promise<{ blob: Blob; filename: string }> {
    const response = await this.client.get(url, { responseType: "blob" });

    return {
      blob: response.data as Blob,
      filename: this.filenameFromHeaders(
        response.headers,
        `export_${Date.now()}`
      ),
    };
  }

  /** Fetches a binary response without downloading it (preview flows). */
  async fetchBlob(
    url: string,
    data?: unknown
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await this.client.post(url, data, {
      responseType: "blob",
    });

    return {
      blob: response.data as Blob,
      filename: this.filenameFromHeaders(
        response.headers,
        `export_${Date.now()}`
      ),
    };
  }

  /** Saves an already-fetched blob with the given filename. */
  saveBlob(blob: Blob, filename: string) {
    const urlBlob = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = urlBlob;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(urlBlob);
  }

  private downloadBlobResponse(
    blobData: BlobPart,
    headers: Record<string, unknown>
  ) {
    const contentType =
      typeof headers["content-type"] === "string"
        ? headers["content-type"]
        : undefined;
    this.saveBlob(
      new Blob([blobData], { type: contentType }),
      this.filenameFromHeaders(headers, `export_${Date.now()}`)
    );
  }

  private filenameFromHeaders(
    headers: Record<string, unknown>,
    fallback: string
  ): string {
    const contentDisposition =
      typeof headers["content-disposition"] === "string"
        ? headers["content-disposition"]
        : undefined;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(
        /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
      );
      if (filenameMatch && filenameMatch[1]) {
        return filenameMatch[1].replace(/^['"]|['"]$/g, "");
      }
    }
    return fallback;
  }
}

export const api = new ApiClient();
