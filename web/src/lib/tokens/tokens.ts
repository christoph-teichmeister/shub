// The only source of theme colours. Components use `var(--<token>)`, never raw colours.
// Fixed (non-theme) brand colours, sizes, spacing, radii, type and motion live in tokens.css.
import type { ThemeDef } from '../../../../shared/api.ts';

export const TOKEN_NAMES = [
  'bg', // app background
  'panel', // sidebar, bottom panel, menus
  'raised', // selected rows, kbd, hover fills
  'line', // hairlines
  'line-strong', // menu and dialog borders
  'fg', // primary text
  'fg-2', // secondary text
  'muted', // tertiary text, labels (4.5:1 on bg and panel)
  'primary', // primary button, active tab underline, focus ring
  'primary-fg', // text on primary
  'on-accent', // dark text on coloured tiles and badges
  'term-bg', // terminal background
  'selection', // terminal selection
  'link',
  'danger',
  'yellow',
  'pink', // brand underscore, default project accent
  'purple',
  'status-needs-you', // orange, reserved for "needs you"; never a project colour
  'status-needs-you-bg',
  'status-needs-you-fg',
  'status-working',
  'status-your-turn',
  'shadow',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type ThemeTokens = Record<TokenName, string>;

const monokai: ThemeTokens = {
  bg: '#272822',
  panel: '#1e1f1c',
  raised: '#3e3d32',
  line: '#3b3a32',
  'line-strong': '#49483e',
  fg: '#f8f8f2',
  'fg-2': '#d6d6c8',
  muted: '#a8a28a',
  primary: '#ae81ff',
  'primary-fg': '#1e1f1c',
  'on-accent': '#1e1f1c',
  'term-bg': '#272822',
  selection: '#49483e',
  link: '#66d9ef',
  danger: '#f92672',
  yellow: '#e6db74',
  pink: '#f92672',
  purple: '#ae81ff',
  'status-needs-you': '#fd971f',
  'status-needs-you-bg': '#3a2f1c',
  'status-needs-you-fg': '#ffd9a8',
  'status-working': '#66d9ef',
  'status-your-turn': '#a6e22e',
  shadow: 'rgb(0 0 0 / 50%)',
};

const dracula: ThemeTokens = {
  bg: '#282a36',
  panel: '#21222c',
  raised: '#44475a',
  line: '#383a4a',
  'line-strong': '#4d5066',
  fg: '#f8f8f2',
  'fg-2': '#d6d8e6',
  muted: '#a4abcb',
  primary: '#bd93f9',
  'primary-fg': '#21222c',
  'on-accent': '#21222c',
  'term-bg': '#282a36',
  selection: '#44475a',
  link: '#8be9fd',
  danger: '#ff79c6',
  yellow: '#f1fa8c',
  pink: '#ff79c6',
  purple: '#bd93f9',
  'status-needs-you': '#ffb86c',
  'status-needs-you-bg': '#3a3128',
  'status-needs-you-fg': '#ffe0bd',
  'status-working': '#8be9fd',
  'status-your-turn': '#50fa7b',
  shadow: 'rgb(0 0 0 / 50%)',
};

const neutralDark: ThemeTokens = {
  bg: '#0f1115',
  panel: '#14171c',
  raised: '#262b33',
  line: '#262b33',
  'line-strong': '#343a44',
  fg: '#e6e8eb',
  'fg-2': '#c9ced4',
  muted: '#9aa3ad',
  primary: '#8ab4ff',
  'primary-fg': '#0f1115',
  'on-accent': '#0f1115',
  'term-bg': '#0b0d10',
  selection: '#343a44',
  link: '#5b9cf5',
  danger: '#f2a5a5',
  yellow: '#e2c08d',
  pink: '#f2a5a5',
  purple: '#b9a3f5',
  'status-needs-you': '#f0a050',
  'status-needs-you-bg': '#2a1f12',
  'status-needs-you-fg': '#f5d0a6',
  'status-working': '#5b9cf5',
  'status-your-turn': '#7fb89a',
  shadow: 'rgb(0 0 0 / 55%)',
};

export const BUILT_IN_THEMES: ThemeDef[] = [
  { id: 'monokai', name: 'Monokai', builtIn: true, tokens: monokai },
  { id: 'dracula', name: 'Dracula', builtIn: true, tokens: dracula },
  { id: 'neutral-dark', name: 'Neutral dark', builtIn: true, tokens: neutralDark },
];

export const DEFAULT_THEME_ID = 'monokai';

const isToken = (name: string): name is TokenName => (TOKEN_NAMES as readonly string[]).includes(name);

/** Full token set for a theme: built-in base (or Monokai), then the theme's own tokens, then overrides. */
export function resolveTokens(theme: ThemeDef, overrides: Record<string, string> = {}): ThemeTokens {
  const base = BUILT_IN_THEMES.find((t) => t.id === (theme.base ?? theme.id)) ?? BUILT_IN_THEMES[0];
  const out = { ...(base.tokens as ThemeTokens) };
  for (const [name, value] of Object.entries({ ...theme.tokens, ...overrides })) if (isToken(name)) out[name] = value;
  return out;
}

/** Sets every theme token as a CSS custom property on :root. Unknown token names are ignored. */
export function applyTheme(theme: ThemeDef, overrides: Record<string, string> = {}): ThemeTokens {
  const tokens = resolveTokens(theme, overrides);
  const root = document.documentElement;
  for (const name of TOKEN_NAMES) root.style.setProperty(`--${name}`, tokens[name]);
  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.bg);
  return tokens;
}

/** The theme a config asks for, falling back to the default built-in. */
export function findTheme(themes: ThemeDef[], id: string | undefined): ThemeDef {
  return (
    themes.find((t) => t.id === id) ??
    BUILT_IN_THEMES.find((t) => t.id === id) ??
    BUILT_IN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  );
}

/** Current value of a token (theme or tokens.css) from the document, for canvas consumers such as xterm.js. */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}
