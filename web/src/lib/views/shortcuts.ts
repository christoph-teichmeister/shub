/** The Alt shortcuts, grouped as shown in the shortcut dialog (Alt ?). Handled in Main.svelte, Overview.svelte, Village.svelte. */
export const SHORTCUT_GROUPS: { title: string; items: [string, string[]][] }[] = [
  {
    title: 'Navigation',
    items: [
      ['Search projects and sessions', ['Alt K']],
      ['Next session that needs you', ['Alt J']],
      ['Go to tab 1 to 9', ['Alt 1', 'Alt 9']],
      ['Previous / next tab', ['Alt [', 'Alt ]']],
      ['Previous / next session in the sidebar, across projects', ['Alt ↑', 'Alt ↓']],
      ['Crab village / back', ['Alt V']],
      ['Overview of all sessions / back', ['Alt O']],
      ['This list of shortcuts', ['Alt ?']],
    ],
  },
  {
    title: 'Sessions',
    items: [
      ['New session in this project (overview: pick a project, opens as a pane)', ['Alt N']],
      ['Rename session', ['Alt R']],
      ['Close session (overview: the focused pane; village: the chat window)', ['Alt W']],
      ['Terminal pane in this session', ['Alt T']],
      ['Separate terminal tab in this project', ['Alt Shift T']],
      ['In a terminal: jump a word back / forward', ['Ctrl ←', 'Ctrl →']],
      ['In search: new session / pin the project', ['Alt Enter', 'Alt P']],
    ],
  },
  {
    title: 'Panels',
    items: [
      ['Open / hide the global Claude', ['Alt G']],
      ['Show / hide the sidebar', ['Alt B']],
      ['Toggle split view', ['Alt S']],
      ['Toggle services panel', ['Alt D']],
    ],
  },
  {
    title: 'Village',
    items: [
      ['Walk (optional; click a crab and use the card buttons instead)', ['W', 'A', 'S', 'D']],
      ['Talk to the crab or sit at your desk, whichever is in reach', ['E']],
      ['At your desk: walk the line / open the first crab', ['↑', '↓', 'Enter']],
      ['Allow / deny the pinned crab', ['Y', 'N']],
      ['Run the pinned crab / close its card', ['R', 'Esc']],
      ['Close the chat window', ['Alt W']],
    ],
  },
  {
    title: 'Overview',
    items: [
      ['Focus the neighbouring pane / pane N', ['Alt ← ↑ → ↓', 'Alt 1', 'Alt 9']],
      ['Next pane that needs you / open the focused one full size', ['Alt J', 'Alt Enter']],
    ],
  },
];
