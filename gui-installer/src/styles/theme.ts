/**
 * Claude-inspired warm design system.
 *
 * Light cream background, warm neutral tones, terracotta accent.
 * Matches the premium, minimal aesthetic of claude.ai.
 */
export const theme = {
  /* backgrounds */
  bgPrimary: "#F7F5F0",
  bgSecondary: "#FFFFFF",
  bgTertiary: "#F0EDE6",
  bgHover: "#EBE8E1",

  /* cards */
  card: "#FFFFFF",
  cardBorder: "#E8E4DD",
  cardShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
  cardShadowHover: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",

  /* accent — warm terracotta (Claude-style) */
  accent: "#C4704B",
  accentHover: "#B5613C",
  accentLight: "rgba(196,112,75,0.08)",
  accentMedium: "rgba(196,112,75,0.16)",

  /* semantic colors */
  success: "#1A8754",
  successLight: "rgba(26,135,84,0.08)",
  error: "#D93025",
  errorLight: "rgba(217,48,37,0.08)",
  warning: "#E8A317",
  warningLight: "rgba(232,163,23,0.08)",

  /* text */
  textPrimary: "#1A1A1A",
  textSecondary: "#5F6368",
  textMuted: "#9AA0A6",
  textOnAccent: "#FFFFFF",

  /* misc */
  border: "#E8E4DD",
  divider: "#F0EDE6",
  radius: "12px",
  radiusSm: "8px",
  radiusFull: "9999px",
} as const;
