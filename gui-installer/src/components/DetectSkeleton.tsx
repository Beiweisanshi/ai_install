import { theme } from "../styles/theme";
import { t } from "../lib/strings";

function DetectSkeleton({ tools }: { tools: string[] }) {
  return (
    <section className="flex h-full items-center justify-center">
      <div className="w-[520px] max-w-full rounded-lg border p-5" style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadow }}>
        <div className="flex items-center gap-3">
          <img alt="" className="h-8 w-8" src="/assets/logo.svg" />
          <div>
            <h1 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>{t("app.name")}</h1>
            <p className="text-sm" style={{ color: theme.textSecondary }}>{t("app.detecting")}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3">
          {tools.map((tool) => (
            <div className="grid grid-cols-[96px_1fr] items-center gap-3" key={tool}>
              <span className="text-sm" style={{ color: theme.textSecondary }}>{tool}</span>
              <span className="h-2 rounded-full animate-gentle-pulse" style={{ background: theme.bgTertiary }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default DetectSkeleton;
