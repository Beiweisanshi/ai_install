import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  forgotPassword,
  getPublicSettings,
  login,
  login2FA,
  register,
  resetPassword,
  sendVerifyCode,
} from "../lib/backendApi";
import { formatText, t } from "../lib/strings";
import { theme } from "../styles/theme";
import type { AuthSession, PublicSettings } from "../types";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface AuthPanelProps {
  onAuthenticated: (session: AuthSession) => void | Promise<void>;
  rememberLogin: boolean;
  onRememberLoginChange: (enabled: boolean) => void;
}

type AuthMode = "login" | "register" | "forgot" | "reset";

function AuthPanel({ onAuthenticated, rememberLogin, onRememberLoginChange }: AuthPanelProps) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [verifyCountdown, setVerifyCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    getPublicSettings()
      .then(setSettings)
      .catch((e) => setError(normalizeError(e)));
  }, []);

  useEffect(() => {
    if (verifyCountdown <= 0) return;
    const timer = window.setTimeout(() => setVerifyCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [verifyCountdown]);

  useEffect(() => {
    if (!settings?.turnstile_enabled || !settings.turnstile_site_key || !turnstileRef.current) {
      return;
    }

    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !turnstileRef.current || widgetIdRef.current) return;
        widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: settings.turnstile_site_key,
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => {
            setTurnstileToken("");
            setError(t("auth.turnstileFailed"));
          },
        });
      })
      .catch((e) => setError(normalizeError(e)));

    return () => {
      cancelled = true;
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [settings]);

  const is2FA = Boolean(tempToken);
  const title = is2FA ? t("auth.twoFactorTitle") : modeTitle(mode);

  return (
    <section className="flex h-full items-center justify-center">
      <div
        className="w-[460px] rounded-lg border p-6"
        style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadow }}
      >
        <div className="grid gap-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
              {title}
            </h1>
            <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
              {t("auth.description")}
            </p>
          </div>
          {!is2FA && (
            <div className="mx-auto flex rounded-lg p-1 text-xs" style={{ background: theme.bgTertiary }}>
              <Tab active={mode === "login"} onClick={() => switchMode("login")}>{t("auth.loginTab")}</Tab>
              <Tab active={mode === "register"} onClick={() => switchMode("register")}>{t("auth.registerTab")}</Tab>
            </div>
          )}
        </div>

        <form
          className="mt-5 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!loading && canSubmit()) void submit();
          }}
        >
          {is2FA ? (
            <>
              <div className="text-sm" style={{ color: theme.textSecondary }}>
                {formatText("auth.twoFactorPrompt", { email: maskedEmail || t("auth.currentAccount") })}
              </div>
              <Input label={t("auth.twoFactorCode")} value={totpCode} onChange={setTotpCode} />
            </>
          ) : (
            renderModeFields()
          )}

          {settings?.turnstile_enabled && settings.turnstile_site_key && (
            <div ref={turnstileRef} className="min-h-[65px]" />
          )}
          {mode === "login" && !is2FA && (
            <label className="flex items-center gap-2 text-xs" style={{ color: theme.textSecondary }}>
              <input
                checked={rememberLogin}
                onChange={(event) => onRememberLoginChange(event.target.checked)}
                type="checkbox"
              />
              {t("auth.rememberLogin")}
            </label>
          )}
        </form>

        {message && (
          <div className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: theme.successLight, color: theme.success }}>
            {message}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: theme.errorLight, color: theme.error }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          disabled={loading || !canSubmit()}
          onClick={() => void submit()}
          style={{ background: theme.accent, color: theme.textOnAccent }}
          type="button"
        >
          {loading ? t("auth.processing") : submitLabel()}
        </button>

        {!is2FA && (
          <div className="mt-4 flex items-center justify-between text-xs" style={{ color: theme.textSecondary }}>
            <button className="btn btn-text" onClick={() => switchMode(mode === "forgot" ? "login" : "forgot")} type="button">
              {mode === "forgot" ? t("auth.backToLogin") : t("auth.forgotPassword")}
            </button>
            <button className="btn btn-text" onClick={() => switchMode(mode === "reset" ? "login" : "reset")} type="button">
              {mode === "reset" ? t("auth.backToLogin") : t("auth.existingResetToken")}
            </button>
          </div>
        )}
      </div>
    </section>
  );

  function renderModeFields() {
    if (mode === "forgot") {
      return (
        <>
          {settings?.password_reset_enabled === false && <Notice text={t("auth.passwordResetDisabled")} />}
              <Input label={t("auth.email")} placeholder={t("auth.loginEmailPlaceholder")} type="email" value={email} onChange={setEmail} />
        </>
      );
    }

    if (mode === "reset") {
      return (
        <>
          <Input label={t("auth.email")} placeholder={t("auth.loginEmailPlaceholder")} type="email" value={email} onChange={setEmail} />
          <Input label={t("auth.resetToken")} value={resetToken} onChange={setResetToken} />
          <Input label={t("auth.newPassword")} placeholder={t("auth.passwordPlaceholder")} type="password" value={password} onChange={setPassword} />
          <Input label={t("auth.confirmNewPassword")} placeholder={t("auth.confirmPasswordPlaceholder")} type="password" value={confirmPassword} onChange={setConfirmPassword} />
        </>
      );
    }

    return (
      <>
        <Input label={t("auth.email")} placeholder={t("auth.loginEmailPlaceholder")} type="email" value={email} onChange={setEmail} />
        <Input label={t("auth.password")} placeholder={t("auth.passwordPlaceholder")} type="password" value={password} onChange={setPassword} />
        {mode === "register" && (
          <>
            {settings?.registration_enabled === false && <Notice text={t("auth.registrationDisabled")} />}
            <Input label={t("auth.confirmPassword")} placeholder={t("auth.confirmPasswordPlaceholder")} type="password" value={confirmPassword} onChange={setConfirmPassword} />
            {settings?.email_verify_enabled && (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Input label={t("auth.emailVerifyCode")} value={verifyCode} onChange={setVerifyCode} />
                <button
                  className="btn btn-secondary rounded-lg px-3 py-2.5 text-xs font-medium disabled:opacity-50"
                  disabled={loading || verifyCountdown > 0 || !email.trim()}
                  onClick={requestVerifyCode}
                  style={{ background: theme.bgTertiary, color: theme.textSecondary }}
                  type="button"
                >
                  {verifyCountdown > 0 ? `${verifyCountdown}s` : t("auth.sendVerifyCode")}
                </button>
              </div>
            )}
            {settings?.promo_code_enabled && <Input label={t("auth.promoCodeOptional")} value={promoCode} onChange={setPromoCode} />}
            {settings?.invitation_code_enabled && <Input label={t("auth.invitationCodeOptional")} value={invitationCode} onChange={setInvitationCode} />}
          </>
        )}
      </>
    );
  }

  async function submit() {
    clearStatus();
    if (settings?.turnstile_enabled && !turnstileToken && mode !== "reset") {
      setError(t("auth.turnstileRequired"));
      return;
    }

    setLoading(true);
    try {
      if (is2FA) {
        await onAuthenticated(await login2FA(tempToken, totpCode.trim()));
      } else if (mode === "login") {
        const response = await login(email.trim(), password, turnstileToken);
        if ("requires_2fa" in response) {
          setTempToken(response.temp_token);
          setMaskedEmail(response.user_email_masked ?? "");
          return;
        }
        await onAuthenticated(response);
      } else if (mode === "register") {
        await onAuthenticated(await register(email.trim(), password, {
          verifyCode: verifyCode.trim(),
          turnstileToken,
          promoCode: promoCode.trim(),
          invitationCode: invitationCode.trim(),
        }));
      } else if (mode === "forgot") {
        setMessage(await forgotPassword(email.trim(), turnstileToken));
      } else {
        setMessage(await resetPassword(email.trim(), resetToken.trim(), password));
        setMode("login");
      }
    } catch (e) {
      setError(normalizeError(e));
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  async function requestVerifyCode() {
    clearStatus();
    if (settings?.turnstile_enabled && !turnstileToken) {
      setError(t("auth.turnstileRequired"));
      return;
    }

    setLoading(true);
    try {
      const response = await sendVerifyCode(email.trim(), turnstileToken);
      setVerifyCountdown(response.countdown);
      setMessage(response.message || t("auth.verifyCodeSent"));
    } catch (e) {
      setError(normalizeError(e));
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  function canSubmit() {
    if (is2FA) return totpCode.trim().length === 6;
    if (mode === "forgot") return settings?.password_reset_enabled !== false && Boolean(email.trim());
    if (mode === "reset") {
      return Boolean(email.trim() && resetToken.trim() && password.length >= 6 && password === confirmPassword);
    }
    if (mode === "register") {
      const hasVerifyCode = !settings?.email_verify_enabled || Boolean(verifyCode.trim());
      return Boolean(settings?.registration_enabled !== false && email.trim() && password.length >= 6 && password === confirmPassword && hasVerifyCode);
    }
    return Boolean(email.trim() && password);
  }

  function submitLabel() {
    if (is2FA) return t("auth.submitLogin2FA");
    if (mode === "register") return t("auth.submitRegister");
    if (mode === "forgot") return t("auth.submitForgot");
    if (mode === "reset") return t("auth.submitReset");
    return t("auth.submitLogin");
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setTempToken("");
    setTotpCode("");
    clearStatus();
    resetTurnstile();
  }

  function clearStatus() {
    setError(null);
    setMessage(null);
  }

  function resetTurnstile() {
    setTurnstileToken("");
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }
}

function modeTitle(mode: AuthMode) {
  if (mode === "register") return t("auth.registerTitle");
  if (mode === "forgot") return t("auth.forgotTitle");
  if (mode === "reset") return t("auth.resetTitle");
  return t("auth.loginTitle");
}

function Tab({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="btn btn-secondary rounded-md px-2.5 py-1 font-medium"
      onClick={onClick}
      style={{ background: active ? theme.card : "transparent", color: active ? theme.textPrimary : theme.textSecondary }}
      type="button"
    >
      {children}
    </button>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: theme.warningLight, color: theme.warning }}>
      {text}
    </div>
  );
}

function Input({
  label,
  type = "text",
  value,
  placeholder,
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const effectiveType = type === "password" && visible ? "text" : type;

  return (
    <label className="grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
      {label}
      <span className="relative">
        <input
          className={`w-full rounded-lg border px-3 py-2.5 ${type === "password" ? "pr-16" : ""}`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
          type={effectiveType}
          value={value}
        />
        {type === "password" && (
          <button
            className="btn btn-text absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs"
            onClick={() => setVisible((current) => !current)}
            style={{ color: theme.textSecondary }}
            type="button"
          >
            {visible ? t("auth.passwordHide") : t("auth.passwordShow")}
          </button>
        )}
      </span>
    </label>
  );
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector('script[src*="turnstile"]');
  if (existing) {
    return new Promise<void>((resolve) => {
      window.onTurnstileLoad = () => resolve();
    });
  }

  return new Promise<void>((resolve, reject) => {
    window.onTurnstileLoad = () => resolve();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error(t("auth.turnstileLoadFailed")));
    document.head.appendChild(script);
  });
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/, "") || t("app.error.requestFailed");
}

export default AuthPanel;
