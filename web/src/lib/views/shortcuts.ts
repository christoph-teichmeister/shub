/** The Alt shortcuts, as shown in the overview (Alt ?). Handled in Main.svelte. */
export const SHORTCUTS: [string, string[]][] = [
  ['Open / hide the global Claude', ['Alt G']],
  ['Show / hide the sidebar', ['Alt B']],
  ['Next session that needs you', ['Alt J']],
  ['Search projects and sessions', ['Alt K']],
  ['New session in this project', ['Alt N']],
  ['Go to tab 1 to 9', ['Alt 1', 'Alt 9']],
  ['Previous / next tab', ['Alt [', 'Alt ]']],
  ['Toggle split view', ['Alt S']],
  ['Toggle services panel', ['Alt D']],
  ["Plain terminal in this session's folder", ['Alt T']],
  ['Rename session', ['Alt R']],
  ['In a terminal: jump a word back / forward', ['Ctrl ←', 'Ctrl →']],
  ['Close session', ['Alt W']],
  ['In search: new session / pin the project', ['Alt Enter', 'Alt P']],
  ['This overview', ['Alt ?']],
];
