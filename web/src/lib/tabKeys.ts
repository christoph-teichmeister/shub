/**
 * Keydown handler for a `role="tablist"`: Left/Right (wrapping), Home and End move focus to a tab and select it.
 * Put it on the tablist element. Only selected tabs are in the Tab order; arrows reach the rest.
 */
export function tabKeys(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const list = e.currentTarget as HTMLElement;
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const next =
    e.key === 'ArrowRight'
      ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft'
        ? tabs[(i - 1 + tabs.length) % tabs.length]
        : e.key === 'Home'
          ? tabs[0]
          : e.key === 'End'
            ? tabs.at(-1)
            : undefined;
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.click();
}
