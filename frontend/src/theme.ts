// The single source for every colour/font in .tsx: each token is a CSS
// variable, and styles.css defines the values for light and dark.
const v = (name: string) => `var(--${name})`;

export const tokens = {
  bg: v('bg'),
  surface: v('surface'),
  sunken: v('sunken'),
  fg: v('fg'),
  fgSoft: v('fg-soft'),
  fgMuted: v('fg-muted'),
  fgFaint: v('fg-faint'),
  border: v('border'),
  rule: v('rule'),
  accent: v('accent'),
  accentWash: v('accent-wash'),
  onAccent: v('on-accent'),
  negative: v('negative'),
  negativeWash: v('negative-wash'),
  warning: v('warning'),
  warningWash: v('warning-wash'),
  positive: v('positive'),
  hover: v('hover'),
  active: v('active'),
  shadow: v('shadow'),
  serif: v('serif'),
  sans: v('sans'),
  mono: v('mono'),
};

/** One constant per breakpoint so media queries read the same everywhere. */
export const PHONE = '@media (max-width: 639px)';
export const DRAWERLESS = '@media (max-width: 899px)';
export const DESKTOP = '@media (min-width: 900px)';
export const COARSE = '@media (pointer: coarse)';
export const HOVER = '@media (hover: hover)';

export const SIDEBAR_W = 272;
export const TABS_H = 56;

export type ThemePref = 'auto' | 'light' | 'dark';
const THEME_KEY = 'zdown.theme';

export function themePref(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch { return 'auto'; }
}

export function applyTheme(pref: ThemePref = themePref()) {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171512' : '#fbfaf6');
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* storage blocked */ }
  applyTheme(pref);
}
