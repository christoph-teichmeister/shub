// The only source of theme colours. Components use `var(--<token>)`, never raw colours.
// Fixed (non-theme) brand colours, sizes, spacing, radii, type and motion live in tokens.css.
import type { ThemeDef } from '../../../../shared/api.ts';

const UI_TOKEN_NAMES = [
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
  // Crab village: a parchment-and-wood look of its own, the same in every built-in theme
  'village-bg', // around the map
  'village-grass', // map ground under the grass tiles
  'village-parchment', // cards, signs, name plates
  'village-parchment-line', // card and chip borders
  'village-wood', // buttons, signposts
  'village-wood-dark', // button and plate borders, path edges
  'village-ink', // text on parchment and wood
  'village-ink-muted', // secondary text on parchment
  'village-gold', // pressed buttons, focus ring
  'village-sky', // "waiting" dream bubble
  'village-alarm', // context from 160k
] as const;

type UiTokens = Record<(typeof UI_TOKEN_NAMES)[number], string>;

/** Terminal colours follow these UI tokens until a theme sets them itself (keeps older themes looking the same). */
export const TERMINAL_DEFAULTS = {
  'term-fg': 'fg-2',
  'term-cursor': 'pink', // a project's own colour wins
  'term-black': 'panel',
  'term-red': 'pink',
  'term-green': 'status-your-turn',
  'term-yellow': 'yellow',
  'term-blue': 'status-working',
  'term-magenta': 'purple',
  'term-cyan': 'link',
  'term-white': 'fg',
  'term-bright-black': 'muted',
  'term-bright-red': 'pink',
  'term-bright-green': 'status-your-turn',
  'term-bright-yellow': 'yellow',
  'term-bright-blue': 'status-working',
  'term-bright-magenta': 'purple',
  'term-bright-cyan': 'link',
  'term-bright-white': 'fg',
} as const satisfies Record<string, keyof UiTokens>;

type TerminalToken = keyof typeof TERMINAL_DEFAULTS;
export const TOKEN_NAMES = [...UI_TOKEN_NAMES, ...(Object.keys(TERMINAL_DEFAULTS) as TerminalToken[])];

export type TokenName = (typeof TOKEN_NAMES)[number];
export type ThemeTokens = Record<TokenName, string>;

const ansi = (bright: boolean) =>
  ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'].map((c) => ({
    name: `term-${bright ? 'bright-' : ''}${c.toLowerCase()}` as TerminalToken,
    label: bright ? `Bright ${c.toLowerCase()}` : c,
  }));

/** Every token with a plain label, grouped as the theme editor shows them. */
export const TOKEN_GROUPS: { title: string; tokens: { name: TokenName; label: string }[] }[] = [
  {
    title: 'Surfaces',
    tokens: [
      { name: 'bg', label: 'Background' },
      { name: 'panel', label: 'Sidebar and menus' },
      { name: 'raised', label: 'Selected row, hover' },
      { name: 'line', label: 'Divider lines' },
      { name: 'line-strong', label: 'Menu and dialog borders' },
      { name: 'shadow', label: 'Shadow under menus' },
    ],
  },
  {
    title: 'Text',
    tokens: [
      { name: 'fg', label: 'Text' },
      { name: 'fg-2', label: 'Secondary text' },
      { name: 'muted', label: 'Muted text' },
      { name: 'link', label: 'Links' },
      { name: 'danger', label: 'Errors, close, context from 160k' },
    ],
  },
  {
    title: 'Accents',
    tokens: [
      { name: 'primary', label: 'Buttons, focus ring' },
      { name: 'primary-fg', label: 'Text on buttons' },
      { name: 'on-accent', label: 'Text on coloured badges' },
      { name: 'pink', label: 'Pink (logo underscore)' },
      { name: 'yellow', label: 'Global Claude icon, context from 120k' },
      { name: 'purple', label: 'Avatar, accent icons' },
    ],
  },
  {
    title: 'Status',
    tokens: [
      { name: 'status-needs-you', label: 'Needs you' },
      { name: 'status-needs-you-bg', label: 'Needs-you row background' },
      { name: 'status-needs-you-fg', label: 'Needs-you row text' },
      { name: 'status-working', label: 'Working' },
      { name: 'status-your-turn', label: 'Your turn' },
    ],
  },
  {
    title: 'Village',
    tokens: [
      { name: 'village-bg', label: 'Around the map' },
      { name: 'village-grass', label: 'Grass' },
      { name: 'village-parchment', label: 'Cards and signs' },
      { name: 'village-parchment-line', label: 'Card borders' },
      { name: 'village-wood', label: 'Buttons' },
      { name: 'village-wood-dark', label: 'Button borders, path edges' },
      { name: 'village-ink', label: 'Text' },
      { name: 'village-ink-muted', label: 'Secondary text' },
      { name: 'village-gold', label: 'Pressed button, focus ring' },
      { name: 'village-sky', label: 'Waiting bubble' },
      { name: 'village-alarm', label: 'Context from 160k' },
    ],
  },
  {
    title: 'Terminal',
    tokens: [
      { name: 'term-bg', label: 'Background' },
      { name: 'term-fg', label: 'Text' },
      { name: 'term-cursor', label: 'Cursor (if the project has no colour)' },
      { name: 'selection', label: 'Selection' },
      ...ansi(false),
      ...ansi(true),
    ],
  },
];

const village = {
  'village-bg': '#3b2414',
  'village-grass': '#5a9e3c',
  'village-parchment': '#f6dfaa',
  'village-parchment-line': '#8a4a1f',
  'village-wood': '#c48a4a',
  'village-wood-dark': '#5a3518',
  'village-ink': '#2a1408',
  'village-ink-muted': '#6b4a2a',
  'village-gold': '#e8b04a',
  'village-sky': '#bfe4f6',
  'village-alarm': '#d0342c',
};

const monokai: UiTokens = {
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
  ...village,
};

const dracula: UiTokens = {
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
  ...village,
};

const neutralDark: UiTokens = {
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
  ...village,
};

export const BUILT_IN_THEMES: ThemeDef[] = [
  { id: 'monokai', name: 'Monokai', builtIn: true, tokens: monokai },
  { id: 'dracula', name: 'Dracula', builtIn: true, tokens: dracula },
  { id: 'neutral-dark', name: 'Neutral dark', builtIn: true, tokens: neutralDark },
];

export const DEFAULT_THEME_ID = 'monokai';

/** Colours offered for project symbols (stored as hex in the project). Never orange: that means "needs you". */
export const PROJECT_COLORS = [
  { name: 'Yellow', value: '#e6db74' },
  { name: 'Green', value: '#a6e22e' },
  { name: 'Blue', value: '#66d9ef' },
  { name: 'Purple', value: '#ae81ff' },
  { name: 'Pink', value: '#f92672' },
  { name: 'Teal', value: '#4fd6be' },
  { name: 'Indigo', value: '#8c9cff' },
  { name: 'Rose', value: '#ff9ec7' },
  { name: 'Sand', value: '#d4b483' },
  { name: 'Grey', value: '#b8b8a8' },
] as const;

const isToken = (name: string): name is TokenName => (TOKEN_NAMES as readonly string[]).includes(name);

/** Full token set for a theme: built-in base (or Monokai), then the theme's own tokens, then overrides.
 *  Terminal tokens nobody set follow their UI token (TERMINAL_DEFAULTS). */
export function resolveTokens(theme: ThemeDef, overrides: Record<string, string> = {}): ThemeTokens {
  const base = BUILT_IN_THEMES.find((t) => t.id === (theme.base ?? theme.id)) ?? BUILT_IN_THEMES[0];
  const out = { ...base.tokens } as Partial<ThemeTokens>;
  for (const [name, value] of Object.entries({ ...theme.tokens, ...overrides })) if (isToken(name)) out[name] = value;
  for (const [term, ui] of Object.entries(TERMINAL_DEFAULTS) as [TerminalToken, keyof UiTokens][])
    out[term] ??= out[ui];
  return out as ThemeTokens;
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
