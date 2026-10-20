// Phone setup: checks Tailscale and puts shub behind `tailscale serve` (tailnet only, never Funnel).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROUTES, type PhoneSetup } from '../../shared/api.ts';
import { publicUrl } from '../config/index.ts';
import type { Context } from '../context.ts';
import { HttpError, requireUser, type Router } from '../api/router.ts';
import type { Services } from '../services.ts';

const run = promisify(execFile);

async function json(args: string[]): Promise<unknown> {
  const { stdout } = await run('tailscale', args, { timeout: 5000 });
  return JSON.parse(stdout);
}

interface TailscaleStatus {
  BackendState?: string;
  Self?: { DNSName?: string };
  CertDomains?: string[] | null;
  Peer?: Record<string, { HostName?: string; OS?: string; Online?: boolean }>;
}

/** The wizard's view of `tailscale status --json` and `tailscale serve status --json`. */
export function parseTailscale(status: TailscaleStatus, serve: unknown, port: number): PhoneSetup['tailscale'] {
  const serveText = JSON.stringify(serve ?? {});
  return {
    installed: true,
    running: status.BackendState === 'Running',
    dnsName: status.Self?.DNSName?.replace(/\.$/, '') || undefined,
    https: (status.CertDomains ?? []).length > 0,
    phones: Object.values(status.Peer ?? {})
      .filter((p) => p.Online && /^(ios|android)$/i.test(p.OS ?? ''))
      .map((p) => p.HostName ?? '?'),
    served: serveText.includes(`127.0.0.1:${port}"`) || serveText.includes(`localhost:${port}"`),
  };
}

async function tailscale(port: number): Promise<PhoneSetup['tailscale']> {
  let status: TailscaleStatus;
  try {
    status = (await json(['status', '--json'])) as TailscaleStatus;
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return { installed: !missing, running: false, https: false, phones: [], served: false };
  }
  const serve = await json(['serve', 'status', '--json']).catch(() => ({}));
  return parseTailscale(status, serve, port);
}

async function phoneSetup(ctx: Context, services: Services): Promise<PhoneSetup> {
  return {
    tailscale: await tailscale(ctx.port),
    publicUrl: publicUrl(services.config.get()),
    publicUrlSource: process.env.SHUB_PUBLIC_URL ? 'env' : services.config.get().publicUrl ? 'config' : undefined,
  };
}

export function phoneSetupRoutes(ctx: Context, services: Services, router: Router): void {
  router.add(ROUTES.phoneSetup, (req) => {
    requireUser(req.caller);
    return phoneSetup(ctx, services);
  });
  router.add(ROUTES.phoneSetupServe, async (req) => {
    requireUser(req.caller);
    const ts = await tailscale(ctx.port);
    if (!ts.running || !ts.dnsName) throw new HttpError(409, 'Tailscale is not connected on this machine');
    if (!ts.https) throw new HttpError(409, 'HTTPS certificates are off in the Tailscale admin console (DNS page)');
    try {
      await run('tailscale', ['serve', '--bg', `http://127.0.0.1:${ctx.port}`], { timeout: 30_000 });
    } catch (err) {
      const out = `${(err as { stderr?: string }).stderr ?? ''}${(err as Error).message}`;
      if (/access denied|permission/i.test(out))
        throw new HttpError(
          409,
          'Tailscale needs you as operator once: run "sudo tailscale set --operator=$USER" in a terminal, then try again',
        );
      throw new HttpError(500, `tailscale serve failed: ${out.trim().split('\n')[0]}`);
    }
    services.config.update((c) => (c.publicUrl = `https://${ts.dnsName}`), req.caller.id);
    return phoneSetup(ctx, services);
  });
}
