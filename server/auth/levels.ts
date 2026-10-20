// Device levels (docs/SECURITY.md): one gate for every route a paired phone calls.
import { DEVICE_LEVELS, ROUTE_LEVELS, ROUTES, type DeviceLevel } from '../../shared/api.ts';

const BY_SPEC = new Map<string, DeviceLevel>(
  Object.entries(ROUTE_LEVELS).map(([name, level]) => [ROUTES[name as keyof typeof ROUTES], level]),
);

/** Lowest level a route needs: listed in ROUTE_LEVELS, else GET view and everything else control. */
export function routeLevel(spec: string): DeviceLevel {
  return BY_SPEC.get(spec) ?? (spec.startsWith('GET ') ? 'view' : 'control');
}

export function atLeast(level: DeviceLevel, needed: DeviceLevel): boolean {
  return DEVICE_LEVELS.indexOf(level) >= DEVICE_LEVELS.indexOf(needed);
}

/** Why a device of `level` may not call `spec`, or null. Callers without a level (desktop, clients) pass. */
export function refuseLevel(level: DeviceLevel | undefined, spec: string): string | null {
  if (!level) return null;
  const needed = routeLevel(spec);
  return atLeast(level, needed)
    ? null
    : `this device may ${level === 'view' ? 'only view' : 'only answer prompts'}; ${needed} is needed`;
}
