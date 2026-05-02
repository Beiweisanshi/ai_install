import { useEffect, useState } from "react";

import { listApiKeys } from "../lib/backendApi";
import { maskKey } from "../lib/toolKeys";
import { theme } from "../styles/theme";
import type { ApiKey, AuthSession } from "../types";

interface KeySelectionProps {
  session: AuthSession;
  onSelected: (key: ApiKey) => void;
  onLogout: () => void;
}

function KeySelection({ session, onSelected, onLogout }: KeySelectionProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listApiKeys(session)
      .then((items) => setKeys(items.filter((key) => key.status === "active")))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [session]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
            选择 API Key
          </h1>
          <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
            当前账号：{session.user.email}。新流程会在工作台里按工具选择 Key。
          </p>
        </div>
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          onClick={onLogout}
          style={{ background: theme.bgTertiary, color: theme.textSecondary }}
          type="button"
        >
          退出登录
        </button>
      </div>

      {loading && <div style={{ color: theme.textSecondary }}>正在读取账户 Key...</div>}
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: theme.errorLight, color: theme.error }}>
          {error}
        </div>
      )}
      {!loading && !error && keys.length === 0 && (
        <div className="rounded-lg border p-6 text-sm" style={{ background: theme.card, borderColor: theme.cardBorder, color: theme.textSecondary }}>
          当前账号没有 active API Key。
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {keys.map((key) => (
          <button
            className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-all duration-150 hover:-translate-y-px"
            key={key.id}
            onClick={() => onSelected(key)}
            style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadow }}
            type="button"
          >
            <div>
              <div className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                {key.name}
              </div>
              <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                {maskKey(key.key)} / {key.group?.name ?? "未分组"} / 已用 {key.quota_used}
              </div>
            </div>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: theme.successLight, color: theme.success }}>
              active
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default KeySelection;
