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
  onAuthenticated: (session: AuthSession) => void;
}

type AuthMode = "login" | "register" | "forgot" | "reset";

function AuthPanel({ onAuthenticated }: AuthPanelProps) {
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
            setError("人机验证失败，请重试");
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
  const title = is2FA ? "二次验证" : modeTitle(mode);

  return (
    <section className="flex h-full items-center justify-center">
      <div
        className="w-[460px] rounded-lg border p-6"
        style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadow }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
              {title}
            </h1>
            <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
              登录芝麻灵码后，工作台会自动读取账户 Key、余额和环境状态。
            </p>
          </div>
          {!is2FA && (
            <div className="flex rounded-lg p-1 text-xs" style={{ background: theme.bgTertiary }}>
              <Tab active={mode === "login"} onClick={() => switchMode("login")}>登录</Tab>
              <Tab active={mode === "register"} onClick={() => switchMode("register")}>注册</Tab>
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3">
          {is2FA ? (
            <>
              <div className="text-sm" style={{ color: theme.textSecondary }}>
                请输入 {maskedEmail || "当前账号"} 的 6 位二次验证码。
              </div>
              <Input label="2FA 验证码" value={totpCode} onChange={setTotpCode} />
            </>
          ) : (
            renderModeFields()
          )}

          {settings?.turnstile_enabled && settings.turnstile_site_key && (
            <div ref={turnstileRef} className="min-h-[65px]" />
          )}
        </div>

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
          className="mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          disabled={loading || !canSubmit()}
          onClick={submit}
          style={{ background: theme.accent, color: theme.textOnAccent }}
          type="button"
        >
          {loading ? "处理中..." : submitLabel()}
        </button>

        {!is2FA && (
          <div className="mt-4 flex items-center justify-between text-xs" style={{ color: theme.textSecondary }}>
            <button onClick={() => switchMode(mode === "forgot" ? "login" : "forgot")} type="button">
              {mode === "forgot" ? "返回登录" : "忘记密码"}
            </button>
            <button onClick={() => switchMode(mode === "reset" ? "login" : "reset")} type="button">
              {mode === "reset" ? "返回登录" : "已有重置 token"}
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
          {settings?.password_reset_enabled === false && <Notice text="当前服务器未开放密码找回。" />}
          <Input label="邮箱" type="email" value={email} onChange={setEmail} />
        </>
      );
    }

    if (mode === "reset") {
      return (
        <>
          <Input label="邮箱" type="email" value={email} onChange={setEmail} />
          <Input label="重置 token" value={resetToken} onChange={setResetToken} />
          <Input label="新密码" type="password" value={password} onChange={setPassword} />
          <Input label="确认新密码" type="password" value={confirmPassword} onChange={setConfirmPassword} />
        </>
      );
    }

    return (
      <>
        <Input label="邮箱" type="email" value={email} onChange={setEmail} />
        <Input label="密码" type="password" value={password} onChange={setPassword} />
        {mode === "register" && (
          <>
            {settings?.registration_enabled === false && <Notice text="当前服务器未开放注册。" />}
            <Input label="确认密码" type="password" value={confirmPassword} onChange={setConfirmPassword} />
            {settings?.email_verify_enabled && (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Input label="邮箱验证码" value={verifyCode} onChange={setVerifyCode} />
                <button
                  className="rounded-lg px-3 py-2.5 text-xs font-medium disabled:opacity-50"
                  disabled={loading || verifyCountdown > 0 || !email.trim()}
                  onClick={requestVerifyCode}
                  style={{ background: theme.bgTertiary, color: theme.textSecondary }}
                  type="button"
                >
                  {verifyCountdown > 0 ? `${verifyCountdown}s` : "发送验证码"}
                </button>
              </div>
            )}
            {settings?.promo_code_enabled && <Input label="优惠码（可选）" value={promoCode} onChange={setPromoCode} />}
            {settings?.invitation_code_enabled && <Input label="邀请码（可选）" value={invitationCode} onChange={setInvitationCode} />}
          </>
        )}
      </>
    );
  }

  async function submit() {
    clearStatus();
    if (settings?.turnstile_enabled && !turnstileToken && mode !== "reset") {
      setError("请先完成人机验证");
      return;
    }

    setLoading(true);
    try {
      if (is2FA) {
        onAuthenticated(await login2FA(tempToken, totpCode.trim()));
      } else if (mode === "login") {
        const response = await login(email.trim(), password, turnstileToken);
        if ("requires_2fa" in response) {
          setTempToken(response.temp_token);
          setMaskedEmail(response.user_email_masked ?? "");
          return;
        }
        onAuthenticated(response);
      } else if (mode === "register") {
        onAuthenticated(await register(email.trim(), password, {
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
      setError("请先完成人机验证");
      return;
    }

    setLoading(true);
    try {
      const response = await sendVerifyCode(email.trim(), turnstileToken);
      setVerifyCountdown(response.countdown);
      setMessage(response.message || "验证码已发送");
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
    if (is2FA) return "验证并登录";
    if (mode === "register") return "注册并登录";
    if (mode === "forgot") return "发送重置邮件";
    if (mode === "reset") return "重置密码";
    return "登录";
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
  if (mode === "register") return "注册账号";
  if (mode === "forgot") return "找回密码";
  if (mode === "reset") return "重置密码";
  return "登录账号";
}

function Tab({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="rounded-md px-2.5 py-1 font-medium"
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
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
      {label}
      <input
        className="rounded-lg border px-3 py-2.5 outline-none"
        onChange={(e) => onChange(e.target.value)}
        style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
        type={type}
        value={value}
      />
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
    script.onerror = () => reject(new Error("无法加载人机验证脚本"));
    document.head.appendChild(script);
  });
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/, "") || "请求失败";
}

export default AuthPanel;
