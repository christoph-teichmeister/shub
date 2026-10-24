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
- **Fixed tokens** (`tokens.css`): brand tiles (`--svc-*`), spacing, sizes, radii, type, motion, layers.

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
| `waiting`   | clock                 | `muted`                     |
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

## Phone

The phone layout (`views/Phone.svelte`, under 700 px) follows a few rules:

- **Thumb size**: tap targets are `--size-touch` (44 px); `IconButton` size `lg` grows to it on a phone.
- **Fields are 16 px**: `tokens.css` raises every text field to 16 px under 700 px, because iOS Safari zooms the page on focus below that.
- **Bottom edge is for the thumb**: the composer, the permission bar and the sticky New session button live there; toasts go to the top, dialogs become bottom sheets. Nothing transient may cover them.
- **Safe areas**: `viewport-fit=cover` plus `env(safe-area-inset-*)` on bars and the bottom row.
- **Chrome stays small**: the permission question is one line until tapped, quick keys can be hidden (`shub.quickKeys` in `localStorage`), the terminal gets the rest.
- **Push is offered once** on the overview (`shub.pushPrompt` in `localStorage` after "Not now").

## Crab Village

The village (`#/village`, `views/Village/`) has a parchment-and-wood look of its own, the same in every theme.

- **Tokens**: the `village-*` group in `tokens.ts` (also in the theme editor): `village-bg`, `-grass`, `-parchment`, `-parchment-line`, `-paper`, `-wood`, `-wood-dark`, `-ink`, `-ink-muted`, `-gold`, `-sky`, `-alarm`, and for the time of day `-tint-morning`, `-tint-evening`, `-tint-night`, `-glow`, `-firefly`, `-cloud` (tints, glow and clouds carry their alpha: `rgb(… / 52%)`). One sprite pixel is `--village-px` (2 px); size map things in multiples of it.
- **Sprites**: pixel grids drawn in code by `scripts/village/sprites.ts`, written as SVGs (one `<rect>` per colour run) to `web/public/village/` and committed. Sprite colours live in the SVGs, not in tokens. Hats and roofs come as a mask (filled with the project colour) plus a detail layer.
- **Adding a sprite**: write a function that returns its grid next to the others, register it in `sprites()` under its file name, run `node scripts/village/sprites.ts`, commit the new SVG. `scripts/village/sprites.test.ts` fails when the committed files differ from a fresh run. Add its size to `SIZES` in `village/world.ts` when the layout needs it.
- **Tile grid**: the map is laid out on one grid of `TILE` = 32 px cells (16 sprite pixels, `village/tiles.ts`): district rects, gates, roads, the queue lane and the plaza all sit on it. `world.ground` holds a material per cell (grass, dirt, cobble). Roads and spurs are 2 tiles wide, straight runs with right-angle bends; the plaza is a rectangle with its corner cells cut.
- **Autotiles**: the ground is drawn "dual-grid": each tile sits on a cell corner (half a tile off the grid) and picks one of 16 variants from the four cells it touches (bit 1 NW, 2 NE, 4 SW, 8 SE). Each material is one 4 × 4 atlas, `tiles-<material>.svg`, made by `autotiles()` in `sprites.ts` (rounded inner and outer corners, an edge ring, a lip outside; outside the material is transparent). `Village.svelte` draws the layers once per map into one canvas (one pixel per sprite pixel, `image-rendering: pixelated`), under everything else.
- **Adding a material**: give it a number in `tiles.ts`, an `autotiles({ tex, ring, lip })` atlas in `sprites()`, and a `LAYERS` entry (layers draw bottom to top, so a material that lies on another lists it in `is`); fill its cells in `buildWorld`.
- **Your character**: `village/walk.ts` (pure) moves you at 140 px/s on your own `requestAnimationFrame` loop in `Village.svelte` (the crabs keep their 140 ms step); `blocked()` is the one test for where you cannot stand (houses, desks, hall via `path.ts` `blockers`, forest, water, pond, fences except the gates, map edge) and `advance()` slides along walls. Sprites: `you-0/1` (seated, typing), `you-desk` (the empty desk), `you-walk0` (stand), `you-walk1/2` (steps); a flip by CSS faces you left. Keys on the focused map: `W A S D` walk (arrows too while standing), `E` talks to the nearest crab within `REACH` (64 px) or sits you at the desk within `DESK_REACH` (the "E talk" / "E sit" bubble shows what it would do); the queue keys (arrows and `J K` walk the line, `Enter`, `Y` allow, `N` deny, `R`) only work while seated. The camera follows you (lerp, inside the pan clamp) until you drag; walking follows again. Reduced motion: one tile per key press, no smoothing or walk frames.
- **Chat window**: `views/Village/ChatWindow.svelte` floats a `TerminalView` over the map (fixed, `--z-menu`, parchment tabs on a wood title bar). Opening a crab (`open()` in `Village.svelte`: double-click, `Enter`, the card's Open) adds or shows its tab instead of leaving the village; `village/chats.ts` (pure) keeps the tabs (a vanished session's tab closes itself) and clamps the window to the browser window. A closed window opens beside the crab you opened (`beside()`: right of it, left near the right edge, clamped; the camera turns the crab's map spot into window px), so it never covers that crab; opening more crabs into an open window leaves it where it is. Drag by the title bar, resize at the corner grip; only a real drag or resize saves the rect in `localStorage` (`shub-village-chat`), and from then on the saved rect wins over placing it beside the crab. While the terminal has focus every key is its own (WASD does not walk, `Esc` is Claude's); `Alt W` or the x closes the window and a click on the bare map takes the keys back. The crab of the shown tab keeps its ring. No window on the phone: it opens the full view.
- **Camera**: `village/camera.ts` (pure) holds the zoom maths: `minZoom` (the world just covers the window) to `MAX_ZOOM` 1.6, `zoomAt` (wheel and buttons, around a point), `pinchZoom` (two fingers: zoom by finger distance around the starting midpoint, which follows the fingers, always from the pinch start, so no drift), `clampPan`, `fitWorld`. Mouse or one finger drags to pan after 4 px (below that it is a click or tap); a second finger stops the drag and pinches, no click fires; lifting a finger of a pinch hands over to the other finger (drag from where it is) or a fresh pinch, so the camera never jumps. Pinch and drag are direct, no smoothing, so reduced motion needs nothing extra.
- **Layout and motion**: `village/world.ts` lays the map out (pure, seeded); `village/crabs.ts` places the crabs; `village/ambience.ts` holds time of day, ambient life and celebrations as functions of the 140 ms step counter. Overlays (tint, glows, clouds) never catch pointer events. With `prefers-reduced-motion` the step stops (a still scene, no confetti) and a 30 s timer keeps times current; a hidden tab pauses it.

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
