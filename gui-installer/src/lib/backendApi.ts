import { invoke } from "@tauri-apps/api/core";

import { t } from "./strings";
import type {
  ApiKey,
  AuthSession,
  PaymentCheckoutInfo,
  PublicSettings,
  SendVerifyCodeResponse,
  UserProfile,
} from "../types";

const DEFAULT_API_BASE_URL = "http://localhost:8080/api/v1";

export const API_BASE_URL = (
  import.meta.env.VITE_BACKEND_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

export const PUBLIC_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

interface ApiEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

interface BackendResponse {
  status: number;
  body: string;
}

interface LoginSuccessResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  user: AuthSession["user"];
}

export interface TotpLoginResponse {
  requires_2fa: true;
  temp_token: string;
  user_email_masked?: string;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    return await request<PublicSettings>("/settings/public");
  } catch {
    return {
      registration_enabled: false,
      email_verify_enabled: false,
      password_reset_enabled: false,
      invitation_code_enabled: false,
      promo_code_enabled: false,
      turnstile_enabled: false,
      turnstile_site_key: "",
      site_name: "zm_tools",
      api_base_url: API_BASE_URL,
    };
  }
}

export async function login(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthSession | TotpLoginResponse> {
  const response = await request<LoginSuccessResponse | TotpLoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      turnstile_token: turnstileToken || undefined,
    }),
  });

  if (isTotpLoginResponse(response)) return response;
  return toSession(response);
}

export async function login2FA(tempToken: string, totpCode: string): Promise<AuthSession> {
  const response = await request<LoginSuccessResponse>("/auth/login/2fa", {
    method: "POST",
    body: JSON.stringify({
      temp_token: tempToken,
      totp_code: totpCode,
    }),
  });
  return toSession(response);
}

export async function register(
  email: string,
  password: string,
  options: {
    verifyCode?: string;
    turnstileToken?: string;
    promoCode?: string;
    invitationCode?: string;
  } = {},
): Promise<AuthSession> {
  const response = await request<LoginSuccessResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      verify_code: options.verifyCode || undefined,
      turnstile_token: options.turnstileToken || undefined,
      promo_code: options.promoCode || undefined,
      invitation_code: options.invitationCode || undefined,
    }),
  });
  return toSession(response);
}

export async function sendVerifyCode(
  email: string,
  turnstileToken?: string,
): Promise<SendVerifyCodeResponse> {
  return request<SendVerifyCodeResponse>("/auth/send-verify-code", {
    method: "POST",
    body: JSON.stringify({
      email,
      turnstile_token: turnstileToken || undefined,
    }),
  });
}

export async function forgotPassword(email: string, turnstileToken?: string): Promise<string> {
  const response = await request<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({
      email,
      turnstile_token: turnstileToken || undefined,
    }),
  });
  return response.message;
}

export async function resetPassword(
  email: string,
  token: string,
  newPassword: string,
): Promise<string> {
  const response = await request<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({
      email,
      token,
      new_password: newPassword,
    }),
  });
  return response.message;
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
  const response = await request<LoginSuccessResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return toSession(response);
}

export async function listApiKeys(session: AuthSession): Promise<ApiKey[]> {
  const page = await request<{ items?: ApiKey[]; data?: ApiKey[] } | ApiKey[]>(
    "/keys?page=1&page_size=100&status=active",
    {
      headers: authHeaders(session),
    },
  );

  if (Array.isArray(page)) return page;
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  return [];
}

export async function getUserProfile(session: AuthSession): Promise<UserProfile> {
  return request<UserProfile>("/user/profile", {
    headers: authHeaders(session),
  });
}

export async function getPaymentCheckoutInfo(session: AuthSession): Promise<PaymentCheckoutInfo> {
  return request<PaymentCheckoutInfo>("/payment/checkout-info", {
    headers: authHeaders(session),
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...headersToRecord(init.headers),
  };

  const response = await sendRequest(url, {
    ...init,
    headers,
  });

  const payload = await parseJson<ApiEnvelope<T> | T>(response);
  if (!response.ok) {
    throw new Error(extractMessage(payload) || `HTTP ${response.status}`);
  }

  if (isEnvelope<T>(payload)) {
    if (payload.code !== undefined && payload.code !== 0) {
      throw new Error(payload.message || t("app.error.requestFailed"));
    }
    return payload.data as T;
  }

  return payload as T;
}

async function sendRequest(url: string, init: RequestInit): Promise<Response> {
  if (!isTauriRuntime()) {
    return fetch(url, init);
  }

  const proxied = await invoke<BackendResponse>("backend_request", {
    input: {
      method: init.method || "GET",
      url,
      headers: headersToRecord(init.headers),
      body: typeof init.body === "string" ? init.body : undefined,
    },
  });

  return new Response(proxied.body, {
    status: proxied.status,
    headers: { "Content-Type": "application/json" },
  });
}

function authHeaders(session: AuthSession) {
  return {
    Authorization: `${session.token_type || "Bearer"} ${session.access_token}`,
  };
}

function toSession(response: LoginSuccessResponse): AuthSession {
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined,
    token_type: response.token_type || "Bearer",
    user: response.user,
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text);
  }
}

function isEnvelope<T>(value: ApiEnvelope<T> | T): value is ApiEnvelope<T> {
  return typeof value === "object" && value !== null && ("code" in value || "data" in value);
}

function extractMessage(value: unknown) {
  if (typeof value === "object" && value !== null && "message" in value) {
    return String((value as { message?: unknown }).message ?? "");
  }
  return "";
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isTotpLoginResponse(
  value: LoginSuccessResponse | TotpLoginResponse,
): value is TotpLoginResponse {
  return "requires_2fa" in value && value.requires_2fa === true;
}
