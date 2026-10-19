import { spawn } from 'node:child_process';
import { baseUrl, output } from './lib/client.ts';
import { findProject } from './lib/projects.ts';

export const summary = 'Open shub (or a project) in the browser.';
export const usage = 'shub open [<project id|name>]';

export async function run(args: string[], opts: { json: boolean }): Promise<void> {
  const url = args[0]
    ? `${baseUrl()}/?project=${encodeURIComponent((await findProject(args[0])).id)}`
    : `${baseUrl()}/`;
  if (!opts.json)
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  output({ url }, opts.json, () => `Opening ${url}`);
}
