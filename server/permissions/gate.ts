// The approval gate for writes: allowed ones run at once, "ask" ones once the user approved them.
import type { Approval } from '../../shared/api.ts';
import { HttpError, type Caller } from '../api/router.ts';
import type { PermissionAction, Permissions, Services } from '../services.ts';

export type Gated<T> = T | { approval: Approval };

export interface ApprovalInfo {
  action: Approval['action'];
  projectId: string | null;
  summary: string;
  detail: string;
}

/**
 * Decides every action; the most restrictive decision wins. "deny" throws 403, and when all allow it returns null so
 * the caller goes ahead. On "ask" it files one approval (`info` gets the reason), runs `onApproved` once the user
 * approves, and returns the approval.
 */
export function approvalGate(
  permissions: Permissions,
  caller: Caller,
  actions: PermissionAction[],
  info: (reason: string) => ApprovalInfo,
  onApproved: () => unknown,
): Approval | null {
  const decisions = actions.map((a) => permissions.decide(caller, a));
  const denied = decisions.find((d) => d.outcome === 'deny');
  if (denied?.outcome === 'deny') throw new HttpError(403, denied.reason);
  const asked = decisions.find((d) => d.outcome === 'ask');
  if (asked?.outcome !== 'ask') return null;
  const request = info(asked.reason);
  const approval = permissions.requestApproval({ requestedBy: caller.id, ...request });
  permissions
    .waitForDecision(approval.id)
    .then((ok) => ok && onApproved())
    .catch((err) => console.error(`shub: approved ${request.action} failed`, err));
  return approval;
}

/** Runs `apply` and logs it once every action is allowed, or after the user approved it (see approvalGate). */
export function gate<T>(
  services: Services,
  caller: Caller,
  actions: PermissionAction[],
  info: ApprovalInfo,
  apply: () => T,
): Gated<T> {
  const run = () => {
    const result = apply();
    services.permissions.log({ actor: caller.id, action: info.action, detail: info.summary });
    return result;
  };
  const approval = approvalGate(services.permissions, caller, actions, () => info, run);
  return approval ? { approval } : run();
}
