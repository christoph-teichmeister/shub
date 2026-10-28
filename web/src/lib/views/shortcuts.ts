/** The Alt shortcuts, as shown in the overview (Alt ?). Handled in Main.svelte. */
export const SHORTCUTS: [string, string[]][] = [
  ['Open / hide the global Claude', ['Alt G']],
  ['Show / hide the sidebar', ['Alt B']],
  ['Next session that needs you', ['Alt J']],
  ['Crab village / back', ['Alt V']],
  ['In the village: walk (arrows too when standing)', ['W', 'A', 'S', 'D']],
  ['In the village: allow / deny the pinned crab', ['Y', 'N']],
  ['In the village: close the chat window', ['Alt W']],
  ['Search projects and sessions', ['Alt K']],
  ['New session in this project', ['Alt N']],
  ['Go to tab 1 to 9', ['Alt 1', 'Alt 9']],
  ['Previous / next tab', ['Alt [', 'Alt ]']],
  ['Previous / next session in the sidebar, across projects', ['Alt ↑', 'Alt ↓']],
  ['Toggle split view', ['Alt S']],
  ['Toggle services panel', ['Alt D']],
  ['Terminal pane in this session', ['Alt T']],
  ['Separate terminal tab in this project', ['Alt Shift T']],
  ['Rename session', ['Alt R']],
  ['In a terminal: jump a word back / forward', ['Ctrl ←', 'Ctrl →']],
  ['Close session', ['Alt W']],
  ['In search: new session / pin the project', ['Alt Enter', 'Alt P']],
  ['This overview', ['Alt ?']],
];

/** One-liners for the empty "Pick a project" pane; one is drawn per visit. */
export const TIPS: string[] = [
  'Alt K searches projects and sessions, and adds a new project when nothing matches.',
  'Alt J jumps to the next session that needs you.',
  'Alt V opens the crab village: every session is a crab, and you can walk around.',
  'Alt S splits the view to watch two sessions side by side.',
  'Alt 1 to 9 jump straight to a tab.',
  'Alt ? lists every shortcut.',
  'Almost all shortcuts sit on Alt, so Ctrl C, Ctrl K and friends stay with Claude and the shell.',
  'Ctrl ← and Ctrl → jump a word in the terminal.',
];
