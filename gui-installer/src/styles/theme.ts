/**
 * Claude-inspired warm design system.
 *
 * Light cream background, warm neutral tones, terracotta accent.
 * Matches the premium, minimal aesthetic of claude.ai.
 */
export const theme = {
  /* backgrounds */
  bgPrimary: "var(--bg-primary)",
  bgSecondary: "var(--bg-secondary)",
  bgTertiary: "var(--bg-tertiary)",
  bgHover: "var(--bg-hover)",

  /* cards */
  card: "var(--card)",
  cardBorder: "var(--card-border)",
  cardShadow: "var(--card-shadow)",
  cardShadowHover: "var(--card-shadow-hover)",

  /* accent — warm terracotta (Claude-style) */
  accent: "var(--accent)",
  accentHover: "var(--accent-hover)",
  accentLight: "var(--accent-light)",
  accentMedium: "var(--accent-medium)",

  /* semantic colors */
  success: "var(--success)",
  successLight: "var(--success-light)",
  error: "var(--error)",
  errorLight: "var(--error-light)",
  warning: "var(--warning)",
  warningLight: "var(--warning-light)",

  /* text */
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  textOnAccent: "var(--text-on-accent)",

  /* misc */
  border: "var(--border)",
  divider: "var(--divider)",
  radius: "12px",
  radiusSm: "8px",
  radiusFull: "9999px",
} as const;
