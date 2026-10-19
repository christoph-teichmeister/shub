# shub styleguide

How the web app looks and how its components are built. Live reference: open `#/styleguide` in the app (every component in every state, theme switcher).

## Brand

- Name: **shub**, always lower case. Tagline: **shub — your session hub**. Secondary line: "All your Claude Code sessions in one window."
- Wordmark `shub_` in JetBrains Mono 700 (800 at large sizes). The underscore takes the open project's accent (default pink). When any session needs the user it turns orange and blinks once per second; with `prefers-reduced-motion` it only turns orange.
- App icon `s_`: dark tile, cream "s", pink underscore. Sources in `web/public/icons/*.svg`; PNGs are rendered by `node scripts/render-icons.ts` and committed.
- Version is CalVer `YYYY.M.MICRO` from `package.json`, injected at build time as `__APP_VERSION__`. Never hard-code it.

## Tokens

`web/src/lib/tokens/` is the only place with raw colours and sizes. stylelint rejects hex, `rgb()`, `hsl()` and named colours everywhere else.

- **Theme colours** (`tokens.ts`, `TOKEN_NAMES`): `bg`, `panel`, `raised`, `line`, `line-strong`, `fg`, `fg-2`, `muted`, `primary`, `primary-fg`, `on-accent`, `term-bg`, `selection`, `link`, `danger`, `yellow`, `pink`, `purple`, `status-needs-you`, `status-needs-you-bg`, `status-needs-you-fg`, `status-working`, `status-your-turn`, `shadow`. Built-in themes: `monokai` (default), `dracula`, `neutral-dark`. `applyTheme(theme, overrides)` writes them as `--<name>` on `:root`; custom themes extend a built-in via `base` and may only set these names.
- **Fixed tokens** (`tokens.css`): brand tiles (`--brand-gitlab`, `--brand-github`, `--svc-*`), spacing, sizes, radii, type, motion, layers.

### Spacing

`--space-0-5` 2 · `--space-1` 4 · `--space-1-5` 6 · `--space-2` 8 · `--space-2-5` 10 · `--space-3` 12 · `--space-3-5` 14 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32 · `--space-12` 48 (px). Component sizes are `--size-*` (controls 26/28/32/36/40, tab 38, row 26, tiles 16/22/32, sidebar 300). Borders use `--hairline`, focus and status rings `--ring`.

### Radii

`--radius-xs` 4 (kbd, chips) · `-sm` 6 (rows, small buttons) · `-md` 8 (buttons, project rows) · `-lg` 10 (panes, menus, toasts) · `-xl` 14 (dialogs) · `-round` (dots, avatars) · `-pill` (badges).

### Type

UI: IBM Plex Sans (`--font-ui`); wordmark, paths, ports, terminal: JetBrains Mono (`--font-mono`). Sizes `--text-3xs` 8 … `--text-base` 14 (body) … `--text-xl` 18 (headings). Weights 400/500/600 for UI, 700/800 for the wordmark. Section labels: `--text-xs`, 600, uppercase, `--tracking-label`, `muted`.

### Motion

`--duration-fast` 120 ms (hover), `--duration-base` 200 ms, `--duration-blink` 1 s (wordmark only), `--ease-standard`. Under `prefers-reduced-motion: reduce` the durations are 0 and nothing blinks; wrap any animation in `@media (prefers-reduced-motion: no-preference)`.

### Layers

`--z-raised` 1 · `--z-sticky` 10 · `--z-menu` 100 · `--z-dialog` 200 (native `<dialog>` uses the top layer anyway) · `--z-toast` 300.

## Status colours

| Status      | Mark                  | Colour                      |
| ----------- | --------------------- | --------------------------- |
| `needs-you` | solid dot, tinted row | `status-needs-you` (orange) |
| `working`   | ring                  | `status-working`            |
| `your-turn` | check                 | `status-your-turn`          |
| `paused`    | pause bars            | `muted`                     |
| `exited`    | muted ring            | `muted`                     |

- **Orange is reserved for "needs you".** Never use it for anything else, and never offer it as a project colour.
- A status mark is never the only signal: always show the status text (or a visually hidden label) next to it.

## Accessibility

- Real `<button>`, `<a>` and `<label>` elements; icon-only buttons go through `IconButton`, which requires a `label` (aria-label + tooltip).
- Focus ring: `:focus-visible` with `--ring` in `--primary` (global in `tokens.css`); do not remove outlines without a visible replacement.
- Text contrast at least 4.5:1 in every built-in theme. `muted` passes on `bg` and `panel` but not on `raised`: use `fg-2` for small text on hovered or selected rows.
- Shortcuts are all on Alt and handled by one capture-phase `keydown` listener on `window` in `views/Main.svelte` (inside the search overlay, `Alt Enter` and `Alt P` are handled by its input). Never bind Ctrl keys: they belong to Claude Code and the shell in the terminal.
- Tab lists (`role="tablist"`) move with Left / Right / Home / End via `lib/tabKeys.ts`; only the selected tab is in the Tab order.
- Form controls come from `TextField`, `SelectField`, `Checkbox` and `ChoiceButton`, which always render a label (`hideLabel` keeps it for screen readers in table rows).

## Icons

Inline stroke SVG on a 16 px grid, `currentColor`, round caps (`components/Icon/icons.ts`). Decorative icons are `aria-hidden`; give `label` only when the icon is the sole content. No icon fonts, no external sprites. Add an icon by adding a path to `ICONS`.

## Writing

Short, plain, sentence case ("New session", "Split view on", "Nothing needs you"). No trailing periods on buttons and labels, no exclamation marks. Name the thing, then the action ("Close BLM-412 export?"). Shortcuts are written `Alt K`.

## Components

- One folder per component: `web/src/lib/components/<Name>/<Name>.svelte` plus `README.md` (props table and the states it has). Helpers that belong to one component live in its folder (e.g. `Icon/icons.ts`).
- Svelte 5 runes, TypeScript, typed `$props()`. Data types come from `shared/api.ts`.
- Styles are scoped in the component's `<style>`. No global overrides, no `:global()` reaching into other components, no patching third-party code (xterm.js is configured only through its public options and official addons).
- Components take data and callbacks; only views (`web/src/lib/views/`) talk to the API and stores.
- Values from data (project accent, symbol colour) are passed as CSS custom properties (`style:--accent={…}`), never as inline colours in CSS.

### Adding a component to `/styleguide`

1. Create the folder, component and README as above.
2. Import it in `web/src/lib/views/Styleguide.svelte` and render every state from its README in a `<section>` with an `h2` (add the section name to `sections`). Use sample data from `views/fixtures.ts`.
3. Check all three themes with the switcher, then run `npm run build`, `npx svelte-check --tsconfig web/tsconfig.json`, `npx stylelint "web/src/**/*.{css,svelte}"`, `npx prettier --check web docs` and `npx playwright test` (after a build).
