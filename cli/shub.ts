#!/usr/bin/env -S node --no-warnings
// shub CLI: `shub <command> [args] [--json]`. Each command is a module cli/commands/<name>.ts exporting
//   summary: string           one line for `shub --help`
//   usage: string             shown by `shub <command> --help`
//   run(args, opts): Promise<void>   args without the command name, opts = { json }
import { readdirSync, readFileSync } from 'node:fs';
import { CliError } from './commands/lib/client.ts';

export interface CommandModule {
  summary: string;
  usage: string;
  run(args: string[], opts: { json: boolean }): Promise<void>;
}

const commandsDir = new URL('./commands/', import.meta.url);

function version(): string {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function commandNames(): string[] {
  return readdirSync(commandsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.slice(0, -3))
    .sort();
}

async function load(name: string): Promise<CommandModule | null> {
  if (!/^[a-z][a-z-]*$/.test(name) || !commandNames().includes(name)) return null;
  return import(new URL(`${name}.ts`, commandsDir).href);
}

async function help(): Promise<string> {
  const lines = ['shub — your session hub', '', 'Usage: shub <command> [args] [--json]', '', 'Commands:'];
  for (const name of commandNames()) lines.push(`  ${name.padEnd(10)} ${(await load(name))?.summary ?? ''}`);
  lines.push(
    '',
    'Options:',
    '  --json       machine-readable output',
    '  --help, -h   help for shub or a command',
    '  --version    print the version',
    '',
    'Environment: SHUB_URL (default http://127.0.0.1:4780), SHUB_TOKEN (set inside shub sessions;',
    'otherwise the access token file in the shub state dir is used).',
  );
  return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const [name, ...rest] = args;
  if (name === '--version' || name === '-v' || name === 'version') return console.log(version());
  if (!name || name === '--help' || name === '-h' || name === 'help') return console.log(await help());
  const command = await load(name);
  if (!command) throw new CliError(`unknown command "${name}". Run "shub --help".`);
  if (rest.includes('--help') || rest.includes('-h')) return console.log(command.usage);
  await command.run(rest, { json });
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`shub: ${err instanceof CliError ? err.message : (err as Error).stack}`);
  process.exitCode = 1;
});
