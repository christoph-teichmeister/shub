#!/usr/bin/env node
// The shub launcher: installs signed shub releases side by side, starts the active one and updates it.
// Commands it does not know go to the CLI of the installed app version (`shub status`, `shub session ...`).
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor, realDoctorDeps } from './doctor.ts';
import { source } from './releases.ts';
import { service } from './service.ts';
import { channelFor, check, healthCheck, rollback, update, type Deps } from './update.ts';
import { currentVersion, readState, shubHome, writeState } from './versions.ts';

const env = process.env;
const self = fileURLToPath(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

const HELP = `shub — your session hub (launcher ${pkg.version})

Usage: shub [command]

  start                         run the installed shub (the default)
  install [--channel stable|beta]
                                download and install the latest release
  update [--to <version>] [--channel stable|beta] [--check] [--json]
                                install a newer release and restart shub
  rollback                      switch back to the previous version
  service install|uninstall     run shub as a systemd user unit (Linux) or launchd agent (macOS)
  doctor                        check Node, tmux, Claude Code, Docker and the port
  --version                     launcher and app version

Every other command goes to the installed app: shub status, shub project, shub session, shub open, ...
("shub <command> --help" for its help).

Environment: SHUB_HOME (default ~/.local/share/shub), SHUB_PORT (default 4780).`;

class UsageError extends Error {}

function flags(args: string[], valued: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!m) throw new UsageError(`unexpected argument "${args[i]}"`);
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (valued.includes(m[1])) {
      if (args[i + 1] === undefined) throw new UsageError(`--${m[1]} needs a value`);
      out[m[1]] = args[++i];
    } else out[m[1]] = true;
  }
  return out;
}

const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/** The channel picked in the app's Settings (config.json); the launcher never writes that file. */
function configuredChannel(): string | undefined {
  const dir = env.SHUB_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'shub');
  try {
    return (JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { updateChannel?: string }).updateChannel;
  } catch {
    return undefined;
  }
}

function deps(home: string): Deps {
  if (env.SHUB_TEST_RELEASES) console.error(`shub: test releases from ${env.SHUB_TEST_RELEASES}, not GitHub`);
  const port = Number(env.SHUB_PORT ?? readState(home).port ?? 4780);
  return { home, source: source(env), service: service(), health: healthCheck(port), log: (l) => console.log(l) };
}

function currentDir(home: string): string {
  try {
    return realpathSync(join(home, 'current'));
  } catch {
    throw new UsageError('shub is not installed yet. Run: shub install');
  }
}

/** Replace this process with the app (same PID, so systemd and launchd see the app itself). */
function exec(home: string, args: (dir: string) => string[]): never {
  const dir = currentDir(home);
  process.chdir(dir);
  return process.execve!(process.execPath, [process.execPath, ...args(dir)], {
    ...env,
    SHUB_HOME: home,
    SHUB_LAUNCHER: self,
  });
}

async function main(argv: string[]): Promise<void> {
  if (process.platform === 'win32') {
    throw new UsageError(
      'shub runs on Linux and macOS. On Windows, install it inside WSL2 (wsl --install) and run it there.',
    );
  }
  const home = shubHome(env);
  const [command = 'start', ...rest] = argv;
  switch (command) {
    case 'start': {
      writeState(home, { port: Number(env.SHUB_PORT ?? 4780) });
      return exec(home, (dir) => [join(dir, 'server', 'main.ts')]);
    }
    case 'install': {
      const f = flags(rest, ['channel']);
      const current = currentVersion(home);
      if (current) return void console.log(`shub ${current} is installed. Newer versions: shub update`);
      await update(deps(home), { channel: channelFor(str(f.channel), configuredChannel(), null) });
      return void console.log('Next: shub service install (runs shub in the background), or shub start');
    }
    case 'update': {
      const f = flags(rest, ['to', 'channel']);
      const channel = channelFor(str(f.channel), configuredChannel(), currentVersion(home));
      if (f.check) {
        const result = await check(deps(home), channel);
        if (f.json) return void console.log(JSON.stringify(result));
        return void console.log(
          result.latest
            ? `shub ${result.latest} is available:\n\n${result.changelog}`
            : `shub ${result.current} is up to date (${channel}).`,
        );
      }
      const result = await update(deps(home), { to: str(f.to), channel });
      if (result && !result.ok) process.exitCode = 1;
      return;
    }
    case 'rollback': {
      flags(rest, []);
      const result = await rollback(deps(home));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case 'service': {
      const [action, ...more] = rest;
      const f = flags(more, []);
      const s = service();
      if (action === 'install') {
        currentDir(home);
        return void console.log(s.install({ node: process.execPath, launcher: self, home, env }, !!f.force));
      }
      if (action === 'uninstall') return void console.log(s.uninstall());
      throw new UsageError('usage: shub service install|uninstall');
    }
    case 'doctor': {
      flags(rest, []);
      const findings = await doctor(realDoctorDeps(env, Number(env.SHUB_PORT ?? 4780)));
      for (const f of findings)
        console.log(`${f.ok ? 'ok  ' : f.optional ? 'note' : 'FAIL'}  ${f.name.padEnd(12)}${f.detail}`);
      if (findings.some((f) => !f.ok && !f.optional)) process.exitCode = 1;
      return;
    }
    case '--version':
    case '-v':
      return void console.log(`launcher ${pkg.version}\napp ${currentVersion(home) ?? 'not installed (shub install)'}`);
    case '--help':
    case '-h':
    case 'help':
      return void console.log(HELP);
    default:
      return exec(home, (dir) => ['--no-warnings', join(dir, 'cli', 'shub.ts'), ...argv]);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`shub: ${err instanceof Error && !(err instanceof TypeError) ? err.message : (err as Error).stack}`);
  process.exitCode = 1;
});
