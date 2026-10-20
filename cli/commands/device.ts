import { DEVICE_LEVELS, type Device, type DeviceLevel } from '../../shared/api.ts';
import { api, CliError, output } from './lib/client.ts';

export const summary = 'Paired devices: list, approve a waiting phone, set what it may do, remove.';
export const usage = [
  'shub device list',
  'shub device approve <id>          let a waiting phone sign in',
  `shub device level <id> <${DEVICE_LEVELS.join('|')}>`,
  'shub device remove <id>           unpair; its open connections end at once',
  '',
  '<id> may be a unique prefix of the device id.',
].join('\n');

async function find(prefix: string | undefined): Promise<Device> {
  if (!prefix) throw new CliError(`missing device id. ${usage.split('\n')[1]}`);
  const matches = (await api<Device[]>('GET', '/api/devices')).filter((d) => d.id.startsWith(prefix));
  if (matches.length !== 1) throw new CliError(`${matches.length ? 'several' : 'no'} devices match "${prefix}"`);
  return matches[0];
}

export async function run(args: string[], opts: { json: boolean }): Promise<void> {
  const [action, id, value] = args;
  if (!action || action === 'list') {
    const devices = await api<Device[]>('GET', '/api/devices');
    return output(devices, opts.json, () =>
      devices
        .map((d) => `${d.id.slice(0, 8)}  ${d.name}  ${d.kind}  ${d.state === 'pending' ? 'PENDING' : d.level}`)
        .join('\n'),
    );
  }
  const device = await find(id);
  const path = `/api/devices/${encodeURIComponent(device.id)}`;
  if (action === 'approve') {
    const d = await api<Device>('POST', `${path}/approve`);
    return output(d, opts.json, () => `${d.name} approved (${d.level})`);
  }
  if (action === 'level') {
    if (!DEVICE_LEVELS.includes(value as DeviceLevel)) throw new CliError(`level must be ${DEVICE_LEVELS.join(', ')}`);
    const d = await api<Device>('PATCH', path, { level: value });
    return output(d, opts.json, () => `${d.name} may now: ${d.level}`);
  }
  if (action === 'remove') {
    await api('DELETE', path);
    return output({ ok: true }, opts.json, () => `${device.name} removed`);
  }
  throw new CliError(`unknown action "${action}".\n${usage}`);
}
