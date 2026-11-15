/** "Saved" feedback shared by every settings pane: a successful save calls noteSaved(), <SaveStatus> shows it. */
export const saved = $state({ at: 0 });
export const noteSaved = () => (saved.at = Date.now());
