// Inline stroke icons on a 16x16 grid. `fill: true` icons are solid shapes.
export const ICONS = {
  plus: { d: 'M8 3v10M3 8h10' },
  search: { d: 'M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM10.5 10.5 14 14' },
  gear: {
    d: 'M10.2 8a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  },
  close: { d: 'M4 4l8 8M12 4l-8 8' },
  check: { d: 'M3 8.5l3.2 3L13 4.5' },
  'chevron-down': { d: 'M4 6l4 4 4-4' },
  'chevron-right': { d: 'M6 4l4 4-4 4' },
  split: {
    d: 'M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zM8 2.5v11',
  },
  services: { d: 'M3 6h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 6V3.5h3V6M9 6V3.5h3V6' },
  play: { d: 'M4 2.5l9 5.5-9 5.5z', fill: true },
  stop: { d: 'M4 3h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', fill: true },
  restart: { d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3' },
  message: { d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z' },
  sparkle: {
    d: 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1',
  },
  more: { d: 'M3.5 8h.01M8 8h.01M12.5 8h.01' },
  pause: { d: 'M5.5 3.5v9M10.5 3.5v9' },
  link: { d: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1' },
  table: {
    d: 'M3.5 2.5h9A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4a1.5 1.5 0 0 1 1.5-1.5zM2 6h12M6 6v7.5',
  },
  home: { d: 'M2.5 7.5L8 3l5.5 4.5V13H2.5zM6.5 13V9.5h3V13' },
  book: {
    d: 'M3 3h4a1.5 1.5 0 0 1 1.5 1.5V13A1.5 1.5 0 0 0 7 11.5H3zM13 3H9.5A1.5 1.5 0 0 0 8 4.5V13a1.5 1.5 0 0 1 1.5-1.5H13z',
  },
  board: { d: 'M2.5 2.5h3v11h-3zM6.5 2.5h3v7h-3zM10.5 2.5h3v9h-3z' },
  terminal: { d: 'M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5h2.5' },
  folder: { d: 'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z' },
  code: { d: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5' },
  database: {
    d: 'M13 3.5c0 1.1-2.2 2-5 2s-5-.9-5-2 2.2-2 5-2 5 .9 5 2zM3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
  },
  worker: { d: 'M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5' },
  compose: {
    d: 'M3 7h10a1.5 1.5 0 0 1 1.5 1.5V11a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 11V8.5A1.5 1.5 0 0 1 3 7zM3.5 7V5h2.2v2M6.9 7V5h2.2v2M10.3 7V3h2.2v4',
  },
} satisfies Record<string, { d: string; fill?: boolean }>;

export type IconName = keyof typeof ICONS;
export const isIconName = (name: string): name is IconName => name in ICONS;
