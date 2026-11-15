import type { LaunchPermissionMode } from '../../../shared/api.ts';

/** One list of permission modes for every screen, so the same mode always has the same name and hint. */
export const PERMISSION_MODES: { value: LaunchPermissionMode; label: string; hint: string; risky?: boolean }[] = [
  { value: 'default', label: 'Ask first', hint: 'Asks before commands and edits.' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Edits files freely, asks for commands.' },
  { value: 'plan', label: 'Plan', hint: 'Reads and plans, changes nothing.' },
  { value: 'auto', label: 'Auto', hint: 'Skips prompts with a safety check.', risky: true },
  { value: 'bypassPermissions', label: 'Bypass', hint: 'Skips every prompt. Only in sandboxes.', risky: true },
  { value: 'inherit', label: 'My Claude settings', hint: 'Uses your ~/.claude settings as they are.' },
];
