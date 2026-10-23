import { createDarkTheme } from 'baseui';

// Switchyard tokens: the single source for every colour/font used in .tsx.
// styles.css and the CodeMirror theme mirror these values as raw hex.
export const tokens = {
  bg: '#000',
  fg: '#fff',
  fgSoft: '#e5e5e5',
  fgMuted: '#8a8a8a',
  fgFaint: '#5c5c5c',
  border: '#262626',
  rowRule: '#171717',
  borderStrong: '#3a3a3a',
  accent: '#7dd3fc',
  accentLine: '#1f3a4a',
  accentWash: '#060d12',
  dangerLine: '#4a2626',
  dangerWash: '#120606',
  negative: '#f87171',
  warning: '#fbbf24',
  positive: '#4ade80',
  hover: '#0a0a0a',
  active: '#1f1f1f',
  codeBg: '#0d0d0d',
  serif: '"Newsreader", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  /** page titles only — the one size above 17px prose */
  titleSize: '20px',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const zero = '0px';

export const theme = createDarkTheme({
  colors: {
    primaryA: tokens.fg,
    primaryB: tokens.bg,
    backgroundPrimary: tokens.bg,
    backgroundSecondary: tokens.hover,
    backgroundTertiary: tokens.active,
    contentPrimary: tokens.fg,
    contentSecondary: tokens.fgMuted,
    contentTertiary: tokens.fgFaint,
    borderOpaque: tokens.border,
    borderSelected: tokens.accent,
    negative: tokens.negative,
    warning: tokens.warning,
    positive: tokens.positive,
    accent: tokens.accent,
    inputFill: tokens.hover,
    inputFillActive: tokens.hover,
    inputBorder: tokens.border,
  },
  borders: {
    radius100: zero,
    radius200: zero,
    radius300: zero,
    radius400: zero,
    radius500: zero,
    buttonBorderRadius: zero,
    buttonBorderRadiusMini: zero,
    checkboxBorderRadius: zero,
    surfaceBorderRadius: zero,
    inputBorderRadius: zero,
    inputBorderRadiusMini: zero,
    popoverBorderRadius: zero,
    tagBorderRadius: zero,
  },
  typography: {
    font100: { fontFamily: tokens.sans },
    font150: { fontFamily: tokens.sans },
    font200: { fontFamily: tokens.sans },
    font250: { fontFamily: tokens.sans },
    font300: { fontFamily: tokens.sans },
    font350: { fontFamily: tokens.sans },
    font400: { fontFamily: tokens.sans },
    font450: { fontFamily: tokens.sans },
  },
});
