import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Approval, ProjectView, Session } from '../shared/api.ts';
import { contrastRatio } from '../web/src/lib/tokens/contrast.ts';

const project: ProjectView = {
  id: 'ai-portal',
  name: 'ai-portal',
  path: '~/PycharmProjects/work/ai-portal',
  group: 'Work',
  visibility: 'pinned',
  order: 0,
  icon: { kind: 'auto' },
  buttons: [{ id: 'wt', label: 'Worktree start', skill: '/worktree-start', ask: 'text', confirm: false }],
  resolvedIcon: { kind: 'gitlab', host: 'gitlab.example.com' },
  accent: '#f92672',
};

const session: Session = {
  id: 's1',
  kind: 'claude',
  projectId: 'ai-portal',
  name: 'MR 2136 review',
  cwd: project.path,
  status: 'needs-you',
  claudeSessionId: null,
  permissionMode: 'default',
  startedBy: 'chris',
  parentId: null,
  links: [],
  createdAt: '2026-10-19T14:02:00Z',
  lastActivityAt: '2026-10-19T14:02:00Z',
  statusSince: '2026-10-19T14:02:00Z',
};

const dormant: ProjectView = {
  ...project,
  id: 'street-tours',
  name: 'street-tours',
  path: '~/PycharmProjects/private/street-tours',
  group: 'Private',
  visibility: 'dormant',
  buttons: [],
  resolvedIcon: { kind: 'github', host: 'github.com' },
};

const config = {
  version: 1,
  groups: ['Work'],
  projects: [project, dormant],
  themes: [],
  activeTheme: 'monokai',
  notifications: { desktopNeedsYou: true, pushNeedsYou: true, pushYourTurn: false, noPushWhileDesktopFocused: true },
  plugins: [],
};

const API: Record<string, unknown> = {
  '/api/health': { ok: true, version: '2026.10.0', apiVersion: 1, machine: 'laptop' },
  '/api/usage': { fiveHour: { used: 42, resetsAt: 1_900_000_000 }, sevenDay: { used: 95 } },
  '/api/config': config,
  '/api/projects': [project, dormant],
  '/api/sessions': [session],
  '/api/sessions/restorable': [],
  '/api/approvals': [],
  '/api/plugins': [],
  '/api/worktrees': [
    {
      projectId: 'ai-portal',
      path: '/home/chris/PycharmProjects/work/ai-portal/.claude/worktrees/2200',
      name: '2200',
      branch: 'feature/#2200-api',
      state: 'remote-gone',
      lastCommitAt: null,
    },
  ],
  '/api/worktrees/children': [],
  '/api/auth/me': { caller: { kind: 'user', id: 'user' }, device: null },
  '/api/devices': [],
  '/api/group/conflicts': [],
  '/api/group/transcripts': { running: true, done: 1_048_576, total: 5_242_880, size: 3_145_728 },
  '/api/group/peers': [
    { id: 'h2', name: 'Laptop', url: 'https://laptop.tail.ts.net', state: 'in-sync' },
    { id: 'h3', name: 'Mini', state: 'offline', since: '2026-10-20T10:00:00Z' },
  ],
  '/api/phone-setup': {
    tailscale: {
      installed: true,
      running: true,
      dnsName: 'pc.tail.ts.net',
      https: true,
      phones: ['Pixel'],
      offlinePhones: [],
      served: true,
    },
    publicUrl: 'https://pc.tail.ts.net',
    publicUrlSource: 'config',
  },
  '/api/updates': {
    current: '2026.10.0',
    channel: 'stable',
    mode: 'ask',
    managedBy: 'launcher',
    latest: '2026.10.1',
    changelog: '## 2026.10.1\n\n### Features\n\n- launcher: add shub doctor',
    checkedAt: '2026-10-19T14:00:00Z',
    previous: '2026.9.0',
  },
  '/api/updates/changelog': [],
  '/api/sessions/s1/services': [],
  '/api/projects/ai-portal/old-sessions': [],
  '/api/projects/street-tours/old-sessions': [],
  '/api/projects/ai-portal/skills': [
    { name: 'worktree-start', description: 'Start work on an isolated git worktree', scope: 'global', path: '' },
    { name: 'refine-ticket', description: 'Interactive refinement of a ticket', scope: 'global', path: '' },
  ],
};

type Mock = unknown | { status: number; json: unknown };
interface Call {
  method: string;
  path: string;
  body: unknown;
  /** Which machine was called: the app's own or another one a phone app knows. */
  origin: string;
}

/** Fulfilled responses still go through the browser's CORS check when another machine is called. */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

/** Mocks /api. `overrides` keys are "METHOD /path" or "/path"; `{status, json}` values set the status. */
async function mockApi(page: Page, overrides: Record<string, Mock> = {}): Promise<{ errors: string[]; calls: Call[] }> {
  const errors: string[] = [];
  const calls: Call[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await page.route('**/api/**', (r) => {
    const method = r.request().method();
    const url = new URL(r.request().url());
    const path = url.pathname;
    if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    // Uploads (pasted pictures) are binary: record their type and size instead of failing to parse them.
    let body: unknown;
    try {
      body = r.request().postDataJSON();
    } catch {
      body = { type: r.request().headers()['content-type'], bytes: r.request().postDataBuffer()?.length };
    }
    calls.push({ method, path, body, origin: url.origin });
    const table: Record<string, Mock> = { ...API, ...overrides };
    const key = `${method} ${path}` in table ? `${method} ${path}` : path;
    if (key in table && (method === 'GET' || key.includes(' '))) {
      const hit = table[key];
      if (hit && typeof hit === 'object' && 'status' in hit) {
        return r.fulfill({ ...(hit as { status: number; json: unknown }), headers: CORS });
      }
      return r.fulfill({ json: hit, headers: CORS });
    }
    if (method !== 'GET') return r.fulfill({ json: { ok: true }, headers: CORS });
    return r.fulfill({ status: 404, json: { error: `no mock for ${path}` }, headers: CORS });
  });
  await page.routeWebSocket('**/api/events', (ws) => ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 })));
  await page.routeWebSocket('**/api/terminals/**', (ws) => ws.send('\u001b[32m●\u001b[0m mocked terminal\r\n'));
  return { errors, calls };
}

test('app shell, wordmark and projects render', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/');
  const nav = page.getByRole('navigation', { name: 'Projects' });
  await expect(nav).toBeVisible();
  await expect(nav.getByLabel('shub, a session needs you')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'ai-portal' })).toBeVisible();
  // Auto-detected GitLab/GitHub projects show letters, not one shared logo.
  await expect(nav.getByRole('link', { name: 'ai-portal' }).locator('.tile')).toHaveText('AP');
  await expect(nav.getByRole('link', { name: 'street-tours' })).toHaveCount(0);
  await expect(nav.getByText('1 needs you')).toBeVisible();
  await expect(page).toHaveTitle('(1) shub');
  await expect(page.getByTitle(/^5h limit: 42% used/)).toBeVisible();
  await expect(page.getByTitle(/^7d limit: 95% used/)).toBeVisible();

  await nav.getByRole('link', { name: 'ai-portal' }).click();
  await expect(page.getByRole('heading', { name: 'ai-portal', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'MR 2136 review' })).toBeVisible();
  await expect(page.locator('.xterm')).toBeVisible();

  await page.keyboard.press('Alt+Slash');
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('sidebar groups collapse and stay collapsed after reload', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/');
  const nav = page.getByRole('navigation', { name: 'Projects' });
  const toggle = nav.getByRole('button', { name: 'Work', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'ai-portal' })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'ai-portal' })).toHaveCount(0);
  await expect(nav.getByRole('region', { name: 'Work', exact: true }).getByText('1 needs you')).toBeVisible();

  await page.reload();
  await expect(nav.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await nav.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'ai-portal' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('sidebar hides, stays hidden after reload and comes back with Alt B', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/');
  const nav = page.getByRole('navigation', { name: 'Projects' });
  await nav.getByRole('button', { name: 'Hide sidebar (Alt B)' }).click();
  await expect(nav.getByRole('button', { name: 'Project settings for ai-portal' })).toBeHidden();
  await expect(nav).toHaveJSProperty('offsetWidth', 56);
  // The rail keeps the project icons with their status.
  await expect(nav.getByRole('link', { name: /^ai-portal\s+1 needs you/ })).toBeVisible();
  // Everything the open sidebar shows has a place in the rail.
  await expect(nav.getByRole('button', { name: /^Search or add project/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: '1 need you, jump to the next (Alt J)' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /settings$/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/rail.png' });

  await page.reload();
  await expect(nav.getByRole('button', { name: 'Show sidebar (Alt B)' })).toBeVisible();
  await page.keyboard.press('Alt+KeyB');
  await expect(nav.getByRole('link', { name: 'ai-portal' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Hide sidebar (Alt B)' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('global Claude drawer slides in with the sidebar timing (Alt G)', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/');
  await page.keyboard.press('Alt+KeyG');
  // The minified CSS writes the 200ms token as .2s; the slide must still take 200ms.
  const durations = await page
    .locator('aside.drawer')
    .evaluate((el) => el.getAnimations().map((a) => a.effect?.getComputedTiming().duration));
  expect(durations).toEqual([200]);
  expect(errors).toEqual([]);
});

test('styleguide renders every section', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/styleguide');
  for (const name of ['Brand', 'Tokens', 'Buttons', 'Status', 'Sidebar', 'Tabs', 'Bottom panel'])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Theme').selectOption('dracula');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
  expect(errors).toEqual([]);
});

test('login on 401: the host browser bootstraps with the token', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    '/api/config': { status: 401, json: { error: 'login required' } },
    'POST /api/auth/bootstrap': { device: { id: 'desk-1', state: 'active', level: 'control' } },
    'POST /api/auth/pairing/redeem': { device: { id: 'phone-1', state: 'pending', level: 'prompts' } },
    'POST /api/auth/challenge': { status: 409, json: { error: 'waiting for approval' } },
  });
  await page.goto('/#/');
  await expect(page.getByText('your session hub')).toBeVisible();
  await page.getByLabel('Access token').fill('secret');
  // Login reloads the page; wait for that, or the reload races the goto below.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await reloaded;
  await expect
    .poll(() => calls.find((c) => c.path === '/api/auth/bootstrap')?.body)
    .toMatchObject({ token: 'secret', publicKey: { kty: 'EC', crv: 'P-256' } });
  expect(errors.filter((e) => !e.includes('401') && !e.includes('409'))).toEqual([]);
});

test('the machine chips come from the group: one pairing signs the browser in on every host with its own key', async ({
  page,
}) => {
  const { calls, errors } = await mockApi(page, {
    'POST /api/auth/bootstrap': { device: { id: 'desk-1', state: 'active', level: 'control' } },
    'POST /api/auth/challenge': { nonce: 'n1' },
    'POST /api/auth/session': { token: 't1', expiresAt: '2099-01-01T00:00:00Z' },
  });
  await page.route('https://laptop.tail.ts.net/api/sessions', (r) => r.fulfill({ json: [], headers: CORS }));
  // First browser on this host: the token creates its key; the group lists the Laptop (default mock).
  await page.route(
    '**/api/config',
    (r) => r.fulfill({ status: 401, json: { error: 'login required' }, headers: CORS }),
    {
      times: 1,
    },
  );
  await page.goto('/#/');
  await page.getByLabel('Access token').fill('secret');
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await reloaded;
  const chips = page.getByRole('navigation', { name: 'Machines' });
  await expect(chips.getByRole('button', { name: /Laptop/ })).toBeVisible();
  // It signs in on the Laptop as the same device, with no pairing there.
  await expect
    .poll(() => calls.find((c) => c.origin === 'https://laptop.tail.ts.net' && c.path === '/api/auth/challenge')?.body)
    .toEqual({ deviceId: 'desk-1' });
  expect(calls.some((c) => c.path === '/api/auth/pairing/redeem')).toBe(false);
  expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
});

test('a phone pairs with a code and waits for approval', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    'POST /api/auth/pairing/redeem': { device: { id: 'phone-1', state: 'pending', level: 'prompts' } },
    'POST /api/auth/challenge': { status: 409, json: { error: 'waiting for approval' } },
  });
  await page.goto('/pair/abc123');
  await page.getByLabel('Device name').fill('Pixel');
  await page.getByRole('button', { name: 'Pair this device' }).click();
  // Not approved on the machine yet: the challenge answers 409 and the page waits.
  await expect(page.getByText(/Now approve Pixel on a trusted host or a Control phone/)).toBeVisible();
  const redeem = calls.find((c) => c.path === '/api/auth/pairing/redeem')?.body as Record<string, unknown>;
  expect(redeem).toMatchObject({ code: 'abc123', deviceName: 'Pixel', publicKey: { kty: 'EC', crv: 'P-256' } });
  expect(redeem.publicKey).not.toHaveProperty('d');
  expect(calls.find((c) => c.path === '/api/auth/challenge')?.body).toEqual({ deviceId: 'phone-1' });
  expect(errors.filter((e) => !e.includes('401') && !e.includes('409'))).toEqual([]);
});

test('app settings and project settings', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    'PATCH /api/settings': { ...config, activeTheme: 'dracula' },
    '/api/projects/ai-portal/worktrees': [{ path: '~/PycharmProjects/work/ai-portal', branch: 'main' }],
  });
  await page.goto('/#/settings/appearance');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page
    .getByRole('group', { name: 'Theme' })
    .getByRole('button', { name: /Dracula/ })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
  expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/settings')?.body).toEqual({
    activeTheme: 'dracula',
  });
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.getByLabel('Phone push: a session needs me')).toBeChecked();

  await page.goto('/#/settings/updates');
  const updates = page.getByRole('region', { name: 'Updates' });
  await expect(updates.getByText('shub 2026.10.1 is available')).toBeVisible();
  await expect(updates.getByRole('listitem').filter({ hasText: 'launcher: add shub doctor' })).toBeVisible();
  await expect(updates.getByLabel('Release channel')).toHaveValue('stable');
  await updates.getByRole('button', { name: 'Install 2026.10.1' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/updates/install')?.body).toEqual({ version: '2026.10.1' });
  await expect(updates.getByRole('button', { name: 'Roll back to 2026.9.0' })).toBeVisible();

  await page.goto('/#/settings/project/ai-portal');
  await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('ai-portal');
  await expect(page.getByLabel('Group').locator('option')).toHaveText(['Work', 'Private', 'New group…']);
  await page.getByLabel('Group').selectOption('New group…');
  await page.getByLabel('New group name').fill('Side');
  await expect(page.getByLabel('Show worktree-start as button')).toBeHidden();
  await page.getByText(/shown as buttons/).click();
  await expect(page.getByLabel('Show worktree-start as button')).toBeChecked();
  await page.getByLabel('Show refine-ticket as button').check();
  await page.getByLabel('Permission mode for refine-ticket').selectOption('locked');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect
    .poll(
      () =>
        (calls.find((c) => c.method === 'PATCH') && calls.filter((c) => c.method === 'PATCH').at(-1)?.body) as {
          buttons?: unknown[];
        },
    )
    .toMatchObject({
      name: 'ai-portal',
      group: 'Side',
      buttons: [
        { skill: '/worktree-start' },
        { skill: '/refine-ticket', label: 'Refine ticket', lockDefaultMode: true },
      ],
    });

  const lastPatch = () => calls.filter((c) => c.method === 'PATCH').at(-1)?.body as { mainCheckout?: unknown };
  await page.getByLabel('Protect this folder as the main checkout').check();
  await expect(page.getByLabel('Branch')).toHaveValue('main');
  await expect.poll(lastPatch).toMatchObject({ mainCheckout: { branch: 'main', updateMinutes: 15 } });
  await page.getByLabel('Update every (minutes, 0 = never)').fill('30');
  await expect.poll(lastPatch).toMatchObject({ mainCheckout: { branch: 'main', updateMinutes: 30 } });
  await page.getByLabel('Protect this folder as the main checkout').uncheck();
  await expect.poll(lastPatch).toMatchObject({ mainCheckout: null });
  expect(errors).toEqual([]);
});

test('terminal settings send only the changed field and update the sample', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    'PATCH /api/settings': { ...config, terminal: { fontSize: 16 } },
  });
  await page.goto('/#/settings/appearance');
  const section = page.getByRole('region', { name: 'Terminal' });
  await expect(section.getByLabel('Size (px)')).toHaveValue('13');
  await section.getByLabel('Size (px)').fill('16');
  await section.getByLabel('Size (px)').press('Enter');
  await expect.poll(() => calls.find((c) => c.path === '/api/settings')?.body).toEqual({ terminal: { fontSize: 16 } });
  await expect(section.getByLabel('Font sample')).toHaveCSS('font-size', '16px');
  await section.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect
    .poll(() => calls.filter((c) => c.path === '/api/settings').at(-1)?.body)
    .toEqual({ terminal: { fontSize: null } });
  expect(errors).toEqual([]);
});

test('own terminal settings stay in this browser and win over the shared ones', async ({ page }) => {
  const { errors, calls } = await mockApi(page, { '/api/config': { ...config, terminal: { fontSize: 15 } } });
  await page.goto('/#/settings/appearance');
  const section = page.getByRole('region', { name: 'Terminal' });
  await section.getByRole('button', { name: 'This device only' }).click();
  await section.getByLabel('Size (px)').fill('11');
  await section.getByLabel('Size (px)').press('Enter');
  await expect(section.getByLabel('Font sample')).toHaveCSS('font-size', '11px');
  expect(await page.evaluate(() => localStorage.getItem('shub.terminal.device'))).toBe('{"fontSize":11}');
  await page.reload();
  await expect(section.getByLabel('Size (px)')).toHaveValue('11');
  await section.getByRole('button', { name: 'Reset to shared' }).click();
  await expect(section.getByLabel('Size (px)')).toHaveValue('15');
  await section.getByRole('button', { name: 'All devices' }).click();
  expect(await page.evaluate(() => localStorage.getItem('shub.terminal.device'))).toBeNull();
  expect(calls.filter((c) => c.path === '/api/settings')).toEqual([]);
  expect(errors).toEqual([]);
});

test('update dot on the user chip; read-only updates from a git checkout', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: /Update available/ })).toBeVisible();

  const git = { current: '2026.10.0', channel: 'stable', managedBy: 'git', checkedAt: null };
  await mockApi(page, { '/api/updates': git });
  await page.goto('/#/settings/updates');
  await page.reload();
  const updates = page.getByRole('region', { name: 'Updates' });
  await expect(updates.getByText('git manages its updates')).toBeVisible();
  await expect(updates.getByRole('button', { name: /Install|Check now/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('settings > Sync lists the other hosts of the group with their state', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/settings/sync');
  const hosts = page.getByRole('region', { name: 'Other hosts' });
  await expect(hosts.getByText('Laptop', { exact: true })).toBeVisible();
  await expect(hosts.getByText('In sync')).toBeVisible();
  await expect(hosts.getByText('https://laptop.tail.ts.net')).toBeVisible();
  await expect(hosts.getByText('Mini', { exact: true })).toBeVisible();
  await expect(hosts.getByText('no address published yet')).toBeVisible();
  await expect(hosts.getByText(/^Offline since/)).toBeVisible();
  await expect(page.getByText('Copying: 1 MB of 5 MB. 3 MB of transcripts on this machine.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a sync conflict shows as a badge and Settings > Sync, and picking a version resolves it', async ({ page }) => {
  const conflict = {
    key: 'config:terminal',
    ours: { hosts: [], deleted: false, body: { fontSize: 14 } },
    theirs: { hosts: ['Laptop'], deleted: false, body: { fontSize: 16 } },
  };
  const { errors, calls } = await mockApi(page, {
    '/api/group/conflicts': [conflict],
    'POST /api/group/resolve': { status: 204 },
  });
  await page.goto('/#/settings/sync');
  const section = page.getByRole('region', { name: 'Conflicts' });
  await expect(section.getByText('config:terminal')).toBeVisible();
  await section.getByRole('button', { name: 'Compare' }).click();
  const dialog = page.getByRole('dialog', { name: 'Two versions of config:terminal' });
  await expect(dialog.getByText('Laptop')).toBeVisible();
  await expect(dialog.getByText('14')).toBeVisible();
  await expect(dialog.getByText('16')).toBeVisible();
  await dialog.getByRole('button', { name: 'Take the other' }).click();
  await expect
    .poll(() => calls.find((c) => c.path === '/api/group/resolve')?.body)
    .toEqual({ key: 'config:terminal', pick: 'theirs' });
  expect(errors).toEqual([]);
});

test('settings: calls to action on top, search across all areas', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/settings');
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByText('2026.10.1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();

  await page.keyboard.press('/');
  await page.keyboard.type('push');
  await expect(page.getByLabel('Phone push: a session needs me')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Devices', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Appearance' })).toHaveCount(0);
  await expect(attention).toHaveCount(0);
  // Search reads the rendered text: a word only in a hint finds its card, other areas hide.
  await page.getByLabel('Search all settings').fill('sandboxes');
  await expect(page.getByRole('region', { name: 'Permission mode for new sessions' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Devices', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => CSS.highlights.get('settings-search')?.size ?? 0)).toBeGreaterThan(0);

  // A hit inside a folded part opens it; ending the search folds it again.
  await page.getByLabel('Search all settings').fill('letter spacing');
  await expect(page.getByLabel('Letter spacing (px)')).toBeVisible();
  await page.getByLabel('Search all settings').press('Escape');
  await expect.poll(() => page.evaluate(() => CSS.highlights.get('settings-search')?.size)).toBe(0);
  await page.goto('/#/settings/appearance');
  await expect(page.getByLabel('Letter spacing (px)')).toBeHidden();
  await page.goto('/#/settings');
  await expect(page.getByRole('region', { name: 'Appearance' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Sessions', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('approval dialog and search', async ({ page }) => {
  const approval: Approval = {
    id: 'a1',
    requestedBy: 'session:s1',
    action: 'session.start',
    projectId: 'ai-portal',
    summary: 'Start a session in ai-portal (free prompt)',
    detail: 'Add this line to ~/.zshrc',
    createdAt: '2026-10-19T14:02:00Z',
    state: 'pending',
  };
  const { errors, calls } = await mockApi(page, {
    '/api/approvals': [approval],
    'POST /api/approvals/a1': { ...approval, state: 'rejected' },
  });
  await page.goto('/#/');
  const dialog = page.getByRole('dialog', { name: 'A session wants to start a new session' });
  await expect(dialog.getByText('Add this line to ~/.zshrc')).toBeVisible();
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog).toBeHidden();
  expect(calls.find((c) => c.path === '/api/approvals/a1')?.body).toEqual({ approve: false });

  await page.keyboard.press('Alt+KeyK');
  const search = page.getByRole('dialog', { name: 'Search projects and sessions' });
  await expect(search.getByRole('option', { name: /street-tours/ })).toBeVisible();
  await page.keyboard.type('portal');
  await expect(search.getByText('Pinned')).toBeVisible();
  await expect(search.getByRole('option', { name: /ai-portal/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(search).toBeHidden();
  await expect(page.getByRole('heading', { name: 'ai-portal', level: 1 })).toBeVisible();

  // Adding a project lives in the search now.
  await page.keyboard.press('Alt+KeyK');
  await search.getByRole('option', { name: /Add a project/ }).click();
  await expect(page).toHaveURL(/#\/settings\/project\/new$/);
  expect(errors).toEqual([]);
});

test('first run import screen', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    '/api/projects': [],
    '/api/projects/import': [
      {
        path: '/home/me/dotfiles',
        name: 'dotfiles',
        sessions: 96,
        lastUsedAt: new Date().toISOString(),
        suggested: 'pinned',
        resolvedIcon: { kind: 'github' },
      },
    ],
  });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Pick your projects' })).toBeVisible();
  await expect(page.getByLabel('Add dotfiles')).toBeChecked();
  await expect(page.getByLabel('Group for dotfiles').locator('option')).toHaveText(['Work', 'New group…']);
  await page.getByLabel('Group for dotfiles').selectOption('New group…');
  await page.getByLabel('New group for dotfiles').fill('Side');
  await page.getByLabel('New group for dotfiles').press('Tab');
  await expect(page.getByLabel('Group for dotfiles')).toHaveValue('Side');
  await page.getByRole('button', { name: 'Add 1 project' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/projects')?.body)
    .toMatchObject({
      name: 'dotfiles',
      group: 'Side',
    });
  expect(errors).toEqual([]);
});

test('phone overview answers a permission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const asking = { ...session, pendingPermission: { tool: 'Bash', summary: 'pytest core/tests' } };
  const { errors, calls } = await mockApi(page, { '/api/sessions': [asking] });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Needs you · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/sessions/s1/keys')?.body).toEqual({ keys: ['1'] });
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Quick keys' })).toBeVisible();
  await page.getByLabel('Message to Claude').fill('go on');
  await page.getByLabel('Message to Claude').press('Enter');
  await expect
    .poll(() => calls.filter((c) => c.path === '/api/sessions/s1/keys').at(-1)?.body)
    .toEqual({ keys: ['go on', 'Enter'] });
  expect(errors).toEqual([]);
});

test('the phone never shows the crab village', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/village');
  await expect(page.getByRole('heading', { name: 'Needs you · 1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Crab village map' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('phone runs a command Claude handed over after a second tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const other = { ...session, id: 's2', name: 'Other one' };
  const pendingCommands = [{ command: 'cd ~ && git pull' }, { command: 'make', session: 's2' }];
  const handing = { ...session, status: 'needs-you', pendingCommands };
  const { errors, calls } = await mockApi(page, { '/api/sessions': [handing, other] });
  await page.goto('/#/');
  await expect(page.getByText('▶ 2 commands').first()).toBeVisible();
  await page.getByRole('link', { name: 'Open', exact: true }).first().click();
  const chip = page.getByRole('region', { name: 'Commands from Claude' });
  await expect(chip.locator('code')).toHaveText(['cd ~ && git pull', 'make']);
  await expect(chip.getByText('Runs in Other one')).toBeVisible();
  await expect(chip.getByRole('button', { name: 'Run in Other one' })).toBeVisible();
  await chip.getByRole('button', { name: 'Run in session' }).click();
  expect(calls.some((c) => c.path === '/api/sessions/s1/command')).toBe(false);
  await chip.getByRole('button', { name: 'Tap again to run' }).click();
  await expect
    .poll(() => calls.find((c) => c.path === '/api/sessions/s1/command')?.body)
    .toEqual({ index: 0, action: 'run' });
  expect(errors).toEqual([]);
});

test('theme editor blinks the colour you point at in the preview', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/settings/theme/new');
  const side = page.locator('.p-side');
  const bg = () => side.evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(bg).toBe('rgb(30, 31, 28)');
  await page.getByLabel('Pick Sidebar and menus', { exact: true }).hover();
  // Monokai panel #1e1f1c pulses towards its inverse, so it leaves the real colour.
  await expect.poll(bg).not.toBe('rgb(30, 31, 28)');
  await page.mouse.move(0, 0);
  await expect(page.locator('.preview')).not.toHaveClass(/flashing/);
  await expect.poll(bg).toBe('rgb(30, 31, 28)');
  // Terminal colours are their own tokens and blink in the preview's terminal too.
  const red = () =>
    page
      .locator('.t-red')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
  const before = await red();
  await page.getByLabel('Pick Red', { exact: true }).hover();
  await expect.poll(red).not.toBe(before);
  await page.screenshot({ path: 'test-results/theme-editor.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('contrast ratio follows WCAG', () => {
  expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 1);
  expect(contrastRatio('#f8f8f2', '#272822')!).toBeGreaterThan(4.5);
  expect(contrastRatio('#777777', '#ffffff')!).toBeCloseTo(4.48, 1);
  expect(contrastRatio('var(--x)', '#fff')).toBeNull();
});

test('a selection Claude copies with OSC 52 lands in the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { errors } = await mockApi(page);
  let replies = 0;
  // As tmux forwards it: empty selection field, base64 of UTF-8. The `?` read request must stay unanswered.
  const b64 = Buffer.from('Opus · Claude\n').toString('base64');
  await page.routeWebSocket('**/api/terminals/**', (ws) => {
    ws.onMessage((m) => typeof m === 'string' && m.includes('\u001b]52') && replies++);
    ws.send(`\u001b]52;;${b64}\u0007\u001b]52;c;?\u0007`);
  });
  await page.goto('/#/p/ai-portal/s1');
  await expect(page.locator('.xterm')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Opus · Claude\n');
  expect(replies).toBe(0);
  expect(errors).toEqual([]);
});

test("a session's terminal and second Claude are panes in its control center, not sidebar rows", async ({ page }) => {
  const shell: Session = { ...session, id: 'sh1', kind: 'shell', name: 'shell', status: 'your-turn', parentId: 's1' };
  const second: Session = { ...session, id: 's2', name: 'Second Claude', status: 'working', parentId: 's1' };
  const { errors, calls } = await mockApi(page, {
    '/api/sessions': [{ ...session, status: 'your-turn' }, second],
    'POST /api/sessions': { status: 200, json: shell },
  });
  await page.goto('/#/p/ai-portal/s1');
  const nav = page.getByRole('navigation');
  await expect(page.getByRole('tab', { name: 'MR 2136 review' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Second Claude' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Second Claude/ })).toHaveCount(0);
  // The pane that works shows on the session's row.
  await expect(nav.getByRole('link', { name: /MR 2136 review/ })).toContainText('working');

  // Closing the session asks first, because its panes end with it; closing a pane does not.
  await page.getByRole('button', { name: 'Close MR 2136 review' }).click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText('Close MR 2136 review and its pane?');
  await expect(ask).toContainText('Second Claude (working)');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);

  await page.getByRole('button', { name: /^New/ }).click();
  await page.getByRole('menuitem', { name: 'Terminal in this session' }).click();
  await expect(page.getByRole('tab', { name: 'shell' })).toHaveAttribute('aria-selected', 'true');
  const start = calls.find((c) => c.method === 'POST' && c.path === '/api/sessions');
  expect(start?.body).toEqual({ projectId: 'ai-portal', kind: 'shell', parentId: 's1' });
  expect(errors).toEqual([]);
});

test('the Worktrees dialog finds a worktree and opens a terminal in it as its own tab', async ({ page }) => {
  const path = '/home/chris/PycharmProjects/work/ai-portal/.claude/worktrees/2200';
  const shell: Session = { ...session, id: 'sh1', kind: 'shell', name: 'Terminal · 2200', cwd: path, parentId: null };
  const { errors, calls } = await mockApi(page, { 'POST /api/sessions': { status: 200, json: shell } });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Worktrees of ai-portal' });
  await expect(dialog.getByText('feature/#2200-api')).toBeVisible();
  await dialog.getByLabel('Search').fill('nothing like it');
  await expect(dialog.getByText('No worktree matches.')).toBeVisible();
  await dialog.getByLabel('Search').fill('2200');
  await dialog.getByRole('button', { name: 'Terminal in 2200' }).click();
  await expect(dialog).toBeHidden();
  const start = calls.find((c) => c.method === 'POST' && c.path === '/api/sessions');
  expect(start?.body).toMatchObject({ projectId: 'ai-portal', kind: 'shell', cwd: path });
  expect(errors).toEqual([]);
});

test('worktrees of closed sessions fold under their own row in the project', async ({ page }) => {
  const path = '/home/chris/PycharmProjects/work/ai-portal/.claude/worktrees/review-3600';
  const { errors } = await mockApi(page, {
    '/api/worktrees/children': [
      {
        projectId: 'ai-portal',
        path,
        name: 'review-3600',
        branch: '',
        state: 'detached',
        lastCommitAt: null,
        originSessionId: 'closed-session',
        conversation: null,
        busy: false,
      },
    ],
  });
  await page.goto('/#/p/ai-portal/s1');
  const row = page.getByRole('button', { name: 'Orphaned worktrees 1 worktree' });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /review-3600/ })).toBeHidden();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /review-3600/ })).toBeVisible();
  await page.getByRole('button', { name: /review-3600/ }).hover();
  await page.getByRole('button', { name: 'Menu for review-3600' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete worktree' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('worktrees a session created sit under it; a click resumes the conversation there', async ({ page }) => {
  const base = '/home/chris/PycharmProjects/work/ai-portal/.claude/worktrees';
  const child = (name: string, over: object) => ({
    projectId: 'ai-portal',
    path: `${base}/${name}`,
    name,
    branch: '',
    state: 'detached',
    lastCommitAt: null,
    originSessionId: 's1',
    conversation: null,
    busy: false,
    ...over,
  });
  const conversation = '0b0e4c2a-6a39-4d55-9f7e-0c6a1d2c3b4a';
  const children = [
    child('review-3445', { conversation }),
    child('review-3548', { busy: true }),
    child('review-3511', { state: 'merged' }),
  ];
  const resumed: Session = { ...session, id: 's2', name: 'review-3445', cwd: `${base}/review-3445` };
  const { errors, calls } = await mockApi(page, {
    '/api/worktrees/children': children,
    'POST /api/sessions': { status: 200, json: resumed },
    '/api/sessions/s2/services': [],
  });
  await page.goto('/#/p/ai-portal/s1');
  // Folded under the session until opened.
  await expect(page.getByRole('button', { name: /review-3445/ })).toBeHidden();
  await page.getByRole('button', { name: '3 worktrees' }).click();
  await expect(page.getByRole('button', { name: /review-3445/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /review-3548/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /review-3511/ })).toContainText('merged');
  await page.getByRole('button', { name: /review-3445/ }).click();
  // The click only queues the request, so wait for it to land.
  await expect
    .poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/sessions')?.body)
    .toEqual({
      projectId: 'ai-portal',
      kind: 'claude',
      cwd: `${base}/review-3445`,
      name: 'review-3445',
      resumeClaudeSessionId: conversation,
    });
  await expect(page).toHaveURL(/#\/p\/ai-portal\/s2$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  // The resumed session now runs in review-3445, so only the other two are dormant.
  await expect(page.getByRole('heading', { name: 'Worktrees · 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: /ai-portal · review-3511/ })).toContainText('merged');
  expect(errors).toEqual([]);
});

test('a terminal tab opens with Alt Shift T and starts Claude where it was cd-ed to, typed or clicked', async ({
  page,
}) => {
  const shell: Session = {
    ...session,
    id: 'sh1',
    kind: 'shell',
    name: 'Terminal 1',
    status: 'your-turn',
    parentId: null,
  };
  const here: Session = {
    ...session,
    id: 's9',
    name: 'Session 9',
    cwd: '/home/chris/PycharmProjects/work/ai-portal/web',
  };
  const { errors, calls } = await mockApi(page, {
    'POST /api/sessions': { status: 200, json: shell },
    'POST /api/sessions/sh1/claude-here': { status: 200, json: here },
    '/api/sessions/s8/services': [],
    '/api/sessions/s9/services': [],
  });
  let events: { send(m: string): void } | undefined;
  await page.routeWebSocket('**/api/events', (ws) => {
    events = ws;
    ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 }));
  });
  await page.goto('/#/p/ai-portal/s1');
  await expect(page.getByRole('tab', { name: 'MR 2136 review' })).toBeVisible();
  await page.keyboard.press('Alt+Shift+t');
  await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute('aria-selected', 'true');
  const start = calls.find((c) => c.method === 'POST' && c.path === '/api/sessions');
  expect(start?.body).toEqual({ projectId: 'ai-portal', kind: 'shell' });

  // `claude` typed in the terminal: the server says which terminal started it, and its open tab follows.
  const typed: Session = { ...here, id: 's8', name: 'Session 8' };
  events!.send(JSON.stringify({ type: 'session.started', session: typed, from: 'sh1' }));
  await expect(page.getByRole('tab', { name: 'Session 8' })).toHaveAttribute('aria-selected', 'true');

  await page
    .getByRole('navigation')
    .getByRole('link', { name: /Terminal 1/ })
    .click();
  await page.getByRole('button', { name: 'Start Claude here' }).click();
  await expect(page.getByRole('tab', { name: 'Session 9' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('active group keeps a project for 10 minutes after its last session closes', async ({ page }) => {
  const mocks: Record<string, unknown> = {
    '/api/config': { ...config, activeGroup: true },
    'PATCH /api/settings': { ...config, activeGroup: false },
  };
  const { errors } = await mockApi(page, mocks);
  let events: { send(m: string): void } | undefined;
  await page.routeWebSocket('**/api/events', (ws) => {
    events = ws;
    ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 }));
  });
  await page.clock.install();
  await page.goto('/#/p/ai-portal/s1');
  const activeGroup = page.getByRole('region', { name: 'Active' });
  await expect(activeGroup.getByRole('group', { name: 'ai-portal' })).toBeVisible();
  await expect(activeGroup.getByRole('group', { name: 'street-tours' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Work', exact: true })).toHaveCount(0); // the switch hides the normal groups

  events!.send(JSON.stringify({ type: 'session.closed', sessionId: 's1' }));
  mocks['/api/sessions'] = [];
  await page.clock.runFor(500); // the closing fade drops the session after 400 ms
  await expect(activeGroup.getByTitle(/Leaves the Active group in \d+:\d\d$/)).toBeVisible();
  await page.clock.fastForward('09:00');
  await expect(activeGroup.getByTitle(/Leaves the Active group in [01]:\d\d$/)).toBeVisible();
  // The fake clock may restart on reload, so only check the countdown is still there, then run past any grace.
  await page.reload();
  await expect(activeGroup.getByTitle(/Leaves the Active group in \d+:\d\d$/)).toBeVisible();
  await page.clock.fastForward('10:01');
  await expect(activeGroup.getByRole('group', { name: 'ai-portal' })).toHaveCount(0);
  await expect(activeGroup.getByText('Nothing here')).toBeVisible();
  await page.getByRole('group', { name: 'Show projects' }).getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('region', { name: 'Work', exact: true })).toBeVisible();
  await expect(activeGroup).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the tab bar + menu starts a session, a terminal or a project button; the tab ✕ closes', async ({ page }) => {
  const other: Session = { ...session, id: 's2', name: 'Docs pass', status: 'your-turn' };
  const { errors, calls } = await mockApi(page, {
    '/api/sessions': [session, other],
    '/api/sessions/s2/services': [],
  });
  await page.goto('/#/p/ai-portal/s2');
  await expect(page.getByRole('heading', { name: 'ai-portal', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Close Docs pass' }).click();
  await expect.poll(() => calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/sessions/s2']);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'New in ai-portal' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /New Claude session/,
    /New terminal/,
    /Claude in this session/,
    /Terminal in this session/,
    /Worktree start…/,
  ]);
  await menu.getByRole('menuitem', { name: /New terminal/ }).click();
  await expect(menu).toHaveCount(0);
  const start = calls.find((c) => c.method === 'POST' && c.path === '/api/sessions');
  expect(start?.body).toEqual({ projectId: 'ai-portal', kind: 'shell' });

  expect(errors).toEqual([]);
});

test('update curtain stays opaque until the reloaded page has its data', async ({ page }) => {
  const { errors } = await mockApi(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/sessions', async (r) => {
    await held;
    await r.fallback();
  });
  await page.addInitScript(() => sessionStorage.setItem('shub-updated', '2026.10.1'));
  await page.goto('/#/');
  const curtain = page.locator('.curtain');
  await page.waitForTimeout(300);
  await expect(curtain).toHaveClass(/shown/);
  expect(await curtain.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

  release();
  await expect(curtain).not.toHaveClass(/shown/);
  await expect(page.getByText('Updated to shub 2026.10.1.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the update toast shows the release notes since the replaced version', async ({ page }) => {
  const { errors } = await mockApi(page, {
    '/api/updates': {
      ...(API['/api/updates'] as object),
      current: '2026.10.2',
      last: {
        at: '2026-10-21T10:00:00Z',
        from: '2026.10.0',
        to: '2026.10.2',
        ok: true,
        message: 'Updated to 2026.10.2.',
      },
    },
    '/api/updates/changelog': [
      {
        version: '2026.10.2',
        publishedAt: '2026-10-21T09:00:00Z',
        notes: '### Fixes\n\n- terminal: keep the scroll position',
      },
      {
        version: '2026.10.1',
        publishedAt: '2026-10-20T09:00:00Z',
        notes: '### Features\n\n- launcher: add shub doctor',
      },
      {
        version: '2026.10.0',
        publishedAt: '2026-10-19T09:00:00Z',
        notes: '### Features\n\n- already installed before',
      },
    ],
  });
  await page.addInitScript(() => sessionStorage.setItem('shub-updated', '2026.10.2'));
  await page.goto('/#/');
  const toast = page.locator('.toast').filter({ hasText: 'Updated to shub 2026.10.2.' });
  await expect(toast.getByRole('listitem').filter({ hasText: 'terminal: keep the scroll position' })).toBeVisible();
  await expect(toast.getByRole('listitem').filter({ hasText: 'launcher: add shub doctor' })).toBeVisible();
  await expect(toast).not.toContainText('already installed before');
  expect(errors).toEqual([]);
});

test('a tab menu parks the session with a background check', async ({ page }) => {
  const { errors, calls } = await mockApi(page);
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('tablist').getByRole('button', { name: 'Menu for MR 2136 review' }).click();
  await page.getByRole('menuitem', { name: 'Wait for…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Wait for…' });
  await dialog.getByLabel('Waiting for').fill("Kai's answer on MR !2213");
  await dialog.getByLabel('How can Haiku tell it happened?').fill('Has Kai commented on MR !2213 in ai/ai-portal?');
  await dialog.getByLabel('Check every').selectOption('60');
  await dialog.getByLabel('When it happened').selectOption('send');
  await dialog
    .getByLabel('Prompt', { exact: true })
    .fill('Kai answered: {summary}. Verify it, then address his comments.');
  if (process.env.SHUB_SHOT) await page.screenshot({ path: process.env.SHUB_SHOT });
  await expect(dialog.getByRole('button', { name: 'Wait and check' })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('button', { name: 'Wait and check' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/sessions/s1')?.body).toEqual({
    waitingFor: "Kai's answer on MR !2213",
    waitCheck: 'Has Kai commented on MR !2213 in ai/ai-portal?',
    waitEveryMinutes: 60,
    waitOnDone: 'Kai answered: {summary}. Verify it, then address his comments.',
  });
  expect(errors).toEqual([]);
});

test('sessions: sidebar sorts by status, a dragged row is pinned on top', async ({ page }) => {
  const paused: Session = { ...session, id: 's2', name: 'Paused one', status: 'paused' };
  const working: Session = { ...session, id: 's3', name: 'Working one', status: 'working' };
  const { errors, calls } = await mockApi(page, { '/api/sessions': [session, paused, working] });
  await page.goto('/#/p/ai-portal/s1');
  const rows = page.getByRole('region', { name: 'Work', exact: true }).getByRole('link', { name: /one|review/ });
  await expect(page.getByRole('tab')).toHaveText(['MR 2136 review']);
  await expect(rows).toHaveText([/MR 2136 review/, /Working one/, /Paused one/]);

  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 4, y: 2 } });
  await expect(rows).toHaveText([/Paused one/, /MR 2136 review/, /Working one/]);
  const reorders = calls.filter((c) => c.path === '/api/sessions/reorder').map((c) => c.body);
  expect(reorders).toEqual([{ positions: { s2: 0 } }]);
  expect(errors).toEqual([]);
});

test('a pane that needs you moves its session up the sidebar and shows on the phone', async ({ page }) => {
  const quiet: Session = { ...session, id: 's1', name: 'Quiet one', status: 'your-turn' };
  const other: Session = { ...session, id: 's2', name: 'Other one', status: 'working' };
  const pane: Session = { ...session, id: 's3', name: 'Second Claude', status: 'needs-you', parentId: 's2' };
  const { errors } = await mockApi(page, {
    '/api/sessions': [quiet, other, pane],
    '/api/sessions/s2/services': [],
    '/api/sessions/s3/services': [],
  });
  await page.goto('/#/p/ai-portal/s2');
  const rows = page.getByRole('region', { name: 'Work', exact: true }).getByRole('link', { name: /one/ });
  await expect(rows).toHaveText([/Other one/, /Quiet one/]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/p/ai-portal/s3');
  const panes = page.getByRole('navigation', { name: 'Panes' });
  await expect(panes.getByRole('link')).toHaveText(['Other one', 'Second Claude']);
  await expect(panes.getByRole('link', { name: 'Second Claude' })).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

test('a phone app adds a second machine by address and typed code', async ({ page }) => {
  const { calls, errors } = await mockApi(page, {
    'POST /api/auth/pairing/redeem': { device: { id: 'phone-1', state: 'pending', level: 'prompts' } },
    'POST /api/auth/challenge': { nonce: 'n1' },
    'POST /api/auth/session': { token: 't1', expiresAt: '2099-01-01T00:00:00Z' },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  // First machine: the one the app comes from, approved at once in this mock.
  await page.goto('/pair/ABCDEFGH');
  await page.getByRole('button', { name: 'Pair this device' }).click();
  await expect(page.getByText(/signed in as/)).toBeVisible();

  await page.goto('/#/');
  await page.getByRole('button', { name: 'Add a machine' }).click();
  await page.route('https://pc.example.ts.net/api/health', (r) =>
    r.fulfill({ json: { ok: true, version: '2026.10.0', apiVersion: 1, machine: 'pc' }, headers: CORS }),
  );
  // The second machine has not approved the phone yet.
  await page.route('https://pc.example.ts.net/api/auth/challenge', (r) =>
    r.fulfill({ status: 409, json: { error: 'waiting for approval' }, headers: CORS }),
  );
  await page.getByLabel('Address').fill('pc.example.ts.net');
  await page.getByLabel('Pairing code').fill('abcd-efgh');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByText(/Now approve this device on pc/)).toBeVisible();
  const redeem = calls.find((c) => c.origin === 'https://pc.example.ts.net' && c.path === '/api/auth/pairing/redeem');
  expect(redeem?.body).toMatchObject({ code: 'abcd-efgh', publicKey: { kty: 'EC', crv: 'P-256' } });
  expect(errors.filter((e) => !e.includes('409'))).toEqual([]);
});

test('a desktop browser pairs, adds a host, switches between hosts and starts over when its key is lost', async ({
  page,
}) => {
  const { calls, errors } = await mockApi(page, {
    '/api/group/peers': [], // a group of one host until the second is paired
    'POST /api/auth/bootstrap': { device: { id: 'desk-1', state: 'active', level: 'control' } },
    'POST /api/auth/pairing/redeem': { device: { id: 'dev-1', state: 'pending', level: 'control' } },
    'POST /api/auth/challenge': { nonce: 'n1' },
    'POST /api/auth/session': { token: 't1', expiresAt: '2099-01-01T00:00:00Z' },
  });
  // Each host answers the join offer with its own info (one route table: the answer follows the caller's origin).
  await page.route('**/api/group/join/offer', (r) =>
    r.fulfill({
      json: { id: r.request().url().includes('pc.example') ? 'pc-host' : 'laptop-host', name: 'h', publicKey: {} },
      headers: CORS,
    }),
  );
  // First browser on the host: the token creates its key (first-browser bootstrap), signed in at once.
  await page.route(
    '**/api/config',
    (r) => r.fulfill({ status: 401, json: { error: 'login required' }, headers: CORS }),
    {
      times: 1,
    },
  );
  await page.goto('/#/');
  await page.getByLabel('Access token').fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'ai-portal' }).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Machines' })).toHaveCount(0); // one host: no switcher

  // A second host: pair by address and code from Settings > Devices; it approves at once in this mock.
  await page.route('https://pc.example.ts.net/api/health', (r) =>
    r.fulfill({ json: { ok: true, version: '2026.10.0', apiVersion: 1, machine: 'pc' }, headers: CORS }),
  );
  await page.goto('/#/settings/devices');
  await page.getByRole('button', { name: '+ Add a machine' }).click();
  await page.getByLabel('Address').fill('pc.example.ts.net');
  await page.getByLabel('Pairing code').fill('abcd-efgh');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  const redeem = () =>
    calls.find((c) => c.origin === 'https://pc.example.ts.net' && c.path === '/api/auth/pairing/redeem');
  await expect.poll(() => redeem()?.body).toMatchObject({ code: 'abcd-efgh', kind: 'browser' });
  // The approved browser carried each host's info to the other: both hosts join one group.
  const joined = (origin: string) =>
    calls.find((c) => c.origin === origin && c.path === '/api/group/join')?.body as { host: { id: string } };
  await expect.poll(() => joined('https://pc.example.ts.net')?.host.id).toBe('laptop-host');
  expect(joined(new URL(page.url()).origin)?.host.id).toBe('pc-host');
  // It switched to the new host; both show as chips, the shown one marked.
  await expect
    .poll(() => calls.some((c) => c.origin === 'https://pc.example.ts.net' && c.path === '/api/sessions'))
    .toBe(true);
  const chips = page.getByRole('navigation', { name: 'Machines' });
  await expect(chips.getByRole('button', { name: /pc/ })).toHaveAttribute('aria-current', 'true');
  await chips.getByRole('button', { name: /laptop/ }).click();
  await expect(chips.getByRole('button', { name: /laptop/ })).toHaveAttribute('aria-current', 'true');

  // Site data cleared: the host forgot the key (404), the app drops it and offers the sign-in again.
  await page.route('**/api/auth/challenge', (r) =>
    r.fulfill({ status: 404, json: { error: 'unknown device' }, headers: CORS }),
  );
  await page.route('**/api/config', (r) =>
    r.fulfill({ status: 401, json: { error: 'login required' }, headers: CORS }),
  );
  await page.reload();
  await expect(page.getByLabel('Access token')).toBeVisible();
  expect(errors.filter((e) => !/40[14]/.test(e))).toEqual([]);
});

test('the crab village draws every session as a crab, queues the ones that need you, acts on them, Alt V goes back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const groups = ['Work', 'Private', 'Everyday'];
  const colors = ['#66d9ef', '#a6e22e', '#ae81ff', '#f92672', '#4fd6be', '#b8b8a8'];
  const projects: ProjectView[] = [
    ['ai-portal', 'Work'],
    ['vynce', 'Work'],
    ['haso', 'Work'],
    ['shub', 'Private'],
    ['listo', 'Private'],
    ['dotfiles', 'Everyday'],
  ].map(([id, group], i) => ({ ...project, id, name: id, group, order: i, accent: colors[i] }));
  const crab = (id: string, projectId: string | null, name: string, status: Session['status'], extra = {}) => ({
    ...session,
    id,
    projectId,
    kind: projectId ? 'claude' : 'global',
    name,
    status,
    lastActivityAt: `2026-10-21T10:0${id.length}:00Z`,
    statusSince: `2026-10-21T10:0${id.length}:00Z`,
    ...extra,
  });
  const sessions = [
    crab('g1', null, 'Global Claude', 'working'),
    crab('s1', 'ai-portal', 'Ticket filters #482', 'working', {
      agents: [{ id: 'a1', type: 'Explore' }],
      context: { tokens: 130_000, window: 200_000 },
    }),
    crab('s2', 'ai-portal', 'Export CSV fix', 'needs-you', {
      pendingPermission: { tool: 'Bash', summary: 'git push origin' },
      context: { tokens: 170_000, window: 200_000 },
    }),
    crab('s3', 'vynce', 'MR 311 review', 'waiting', { waitingFor: "Kai's answer on the MR" }),
    // Just joined the line: calm, unlike the others there since the morning.
    crab('s4', 'shub', 'Image viewer review', 'your-turn', { statusSince: new Date().toISOString() }),
    crab('s5', 'shub', 'Session 3', 'new'),
    crab('s6', 'listo', 'Shopping list sync', 'paused'),
    crab('s7', 'dotfiles', 'Prompt theme', 'needs-you', { pendingCommands: [{ command: 'sudo systemctl restart x' }] }),
  ];
  const SCRATCH =
    '/tmp/claude-1000/-home-chris-PycharmProjects-private-shub/614b3dc8-8ed3-4e2d-bf15-8823e62eb0ee/scratchpad';
  const shot = (name: string) => `${process.env.VILLAGE_SHOTS ? SCRATCH : 'test-results'}/${name}`;
  const born = crab('s9', 'ai-portal', 'Fix the export', 'new');
  const children = (
    [
      ['agent-a1b2c3', 'worktree-agent-a1b2c3', 'open', true],
      ['2200', 'feature/#2200-api', 'merged', false],
    ] as const
  ).map(([name, branch, state, busy]) => ({
    projectId: 'ai-portal',
    path: `/home/chris/PycharmProjects/work/ai-portal/.claude/worktrees/${name}`,
    name,
    branch,
    state: state as string,
    lastCommitAt: null,
    originSessionId: 's1',
    conversation: null,
    busy,
  }));
  const arcade = { ...project, id: 'crab-arcade', name: 'crab-arcade', group: 'Games', buttons: [], order: 9 };
  const { errors, calls } = await mockApi(page, {
    '/api/config': { ...config, groups, projects },
    '/api/projects': projects,
    '/api/sessions': sessions,
    'POST /api/sessions': { status: 200, json: born },
    '/api/worktrees/children': children,
    '/api/sessions/s2/services': [],
    '/api/sessions/s1/services': [
      ['web', 'running', 'Up 41 minutes (healthy)'],
      ['postgres', 'running', 'Up 41 minutes'],
      ['celery', 'exited', 'Exited (1) 3 minutes ago'],
    ].map(([name, state, status], i) => ({
      id: `c${i}`,
      name,
      project: 'ai-portal',
      workingDir: project.path,
      image: name,
      kind: 'other',
      state,
      status,
      ports: [],
    })),
    ...Object.fromEntries(['s3', 's4', 's6', 's7'].map((id) => [`/api/sessions/${id}/services`, []])),
    'POST /api/projects': arcade,
    '/api/projects/import': [
      {
        path: '/home/chris/PycharmProjects/private/listo-api',
        name: 'listo-api',
        sessions: 3,
        lastUsedAt: '',
        suggested: 'pinned',
      },
    ],
  });
  const posted = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path).map((c) => c.body);
  let events: { send(m: string): void } | undefined;
  await page.routeWebSocket('**/api/events', (ws) => {
    events = ws;
    ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 }));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/p/ai-portal');
  const entry = page.getByRole('link', { name: 'Crab village, 3 in line' });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Crab Village' })).toBeVisible();

  const map = page.getByRole('region', { name: 'Crab village map' });
  const world = map.locator('.world');
  /** The map's visible area and the world's box, in page px. */
  const boxes = async () => {
    const m = (await map.boundingBox())!;
    const inner = await map.evaluate((el) => ({
      l: el.clientLeft,
      t: el.clientTop,
      w: el.clientWidth,
      h: el.clientHeight,
    }));
    return { frame: { x: m.x + inner.l, y: m.y + inner.t, w: inner.w, h: inner.h }, w: (await world.boundingBox())! };
  };
  /** The world covers the whole visible area: no bare bar beside it, at any zoom or pan. */
  const covers = async () => {
    const { frame: f, w } = await boxes();
    return w.x <= f.x + 1 && w.y <= f.y + 1 && w.x + w.width >= f.x + f.w - 1 && w.y + w.height >= f.y + f.h - 1;
  };
  /** Crabs only render near the camera, so make the window the world's shape and Fit shows every crab. */
  const showAll = async () => {
    const [W, H] = await world.evaluate((el) => [el.clientWidth, el.clientHeight]);
    const { frame } = await boxes();
    const size = page.viewportSize()!;
    await page.setViewportSize({
      width: size.width,
      height: Math.round(size.height + (frame.w * H) / W - frame.h + 24),
    });
    await page.getByRole('button', { name: 'Fit' }).click();
  };
  await showAll();
  /** Drag the empty grass (top left of the frame) by (dx, dy) with the mouse. */
  const dragMap = async (dx: number, dy: number) => {
    const m = (await map.boundingBox())!;
    await page.mouse.move(m.x + 6, m.y + 6);
    await page.mouse.down();
    await page.mouse.move(m.x + 6 + dx / 2, m.y + 6 + dy / 2, { steps: 4 });
    await page.mouse.move(m.x + 6 + dx, m.y + 6 + dy, { steps: 4 });
    await page.mouse.up();
  };
  await expect(map.locator('.crab')).toHaveCount(sessions.length);
  // Needs-you first, then your turn.
  await expect(
    map.getByRole('button', { name: 'Export CSV fix, ai-portal, needs you, number 1 in line' }),
  ).toBeVisible();
  await expect(map.getByRole('button', { name: 'Prompt theme, dotfiles, needs you, number 2 in line' })).toBeVisible();
  await expect(
    map.getByRole('button', { name: 'Image viewer review, shub, your turn, number 3 in line' }),
  ).toBeVisible();
  await expect(map.getByRole('button', { name: 'Global Claude, global Claude, working' })).toBeVisible();
  await expect(page.getByText('You · 3 in line')).toBeVisible();

  // Signals: a big backpack with sweat and panting at 170k, "!!" after hours in line, a calm newcomer, tents for
  // the worktrees (the agent's with its crab, the merged one faded), machines for the services (one down).
  const crab2 = map.getByRole('button', { name: /^Export CSV fix/ });
  await expect(crab2.locator('.pack')).toHaveAttribute('src', '/village/pack2.svg');
  await expect(crab2.locator('.drop')).toHaveCount(2);
  await expect(crab2.locator('.huff')).toBeVisible();
  await expect(crab2.locator('.bubble')).toHaveText('!!');
  await expect(map.getByRole('button', { name: /^Image viewer review/ }).locator('.bubble')).toHaveText('...');
  await expect(map.getByRole('button', { name: /^Ticket filters/ }).locator('.drop')).toHaveCount(2);
  const agentTent = map.getByRole('img', { name: /^Worktree worktree-agent-a1b2c3 \(working\), from "Ticket filters/ });
  await expect(agentTent.locator('.agent')).toBeVisible();
  await expect(map.getByRole('img', { name: /^Worktree feature\/#2200-api \(merged\)/ })).toHaveClass(/stale/);
  await expect(map.getByRole('img', { name: 'web: Up 41 minutes (healthy)' })).toBeVisible();
  await expect(map.getByRole('img', { name: 'celery: Exited (1) 3 minutes ago' }).locator('.alarm')).toBeVisible();
  await expect(map.locator('.machine')).toHaveCount(3);
  // Tall enough for the house with its yard and the queue in one picture.
  await page.setViewportSize({ width: 1440, height: 1700 });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('pr4-signals.png'), clip: { x: 0, y: 0, width: 1440, height: 1290 } });

  // Time of day, pinned: Night tints the map, lights every house with a session and lets the fireflies out.
  const time = page.getByRole('group', { name: 'Time of day' });
  await time.getByRole('button', { name: 'Day' }).click();
  await expect(map.locator('.tint')).toHaveCount(0);
  await expect(map.locator('.lantern').first()).toBeVisible();
  // The ground: roads, lane and plaza as autotiles in one canvas.
  await expect(map.locator('canvas.ground')).toHaveAttribute('data-drawn', '');
  await page.screenshot({ path: shot('tiles-day.png'), clip: { x: 0, y: 0, width: 1440, height: 1290 } });
  for (let i = 0; i < 15; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('160 %')).toBeVisible();
  await dragMap(700, 850);
  await page.screenshot({ path: shot('tiles-detail.png'), clip: { x: 0, y: 100, width: 1440, height: 1100 } });
  // Zoomed in at the world's top left corner: the rim is dense forest and shore, not a cut.
  for (let i = 0; i < 4; i++) await dragMap(1300, 1600);
  expect(await covers()).toBe(true);
  await page.screenshot({ path: shot('outskirts-day.png'), clip: { x: 0, y: 100, width: 1440, height: 1100 } });
  await time.getByRole('button', { name: 'Night' }).click();
  await page.screenshot({ path: shot('outskirts-night.png'), clip: { x: 0, y: 100, width: 1440, height: 1100 } });
  await page.getByRole('button', { name: 'Fit' }).click();
  await time.getByRole('button', { name: 'Night' }).click();
  await expect(map.locator('.tint.night')).toHaveCount(1);
  // Fireflies scale with the map and only the ones in view are drawn.
  await expect.poll(() => map.locator('.firefly').count()).toBeGreaterThan(20);
  await expect(map.locator('.house img[src="/village/house-lit.svg"]')).toHaveCount(5);
  await page.screenshot({ path: shot('tiles-night.png'), clip: { x: 0, y: 0, width: 1440, height: 1290 } });
  // The frame fills the window, whatever the map's size, and the world covers it: no bare bar at Fit.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(covers).toBe(true);
  await page.screenshot({ path: shot('strip-night.png') });
  await page.getByRole('button', { name: 'Fit' }).click();
  await time.getByRole('button', { name: 'Day' }).click();
  await page.screenshot({ path: shot('strip-day.png') });
  await time.getByRole('button', { name: 'Now' }).click();
  await expect(time.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'true');
  // Not the world's shape: Fit fits the larger side and still covers the window, and so does the smallest zoom.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(covers).toBe(true);
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
  expect(await covers()).toBe(true);
  await dragMap(900, 900);
  expect(await covers()).toBe(true);
  await dragMap(-3000, -3000);
  expect(await covers()).toBe(true);
  await showAll();

  // Camera: a drag pans the map, the wheel zooms around the cursor, a click on a crab still opens its card.
  await page.getByRole('button', { name: 'Fit' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  const origin = async () => (await world.boundingBox())!;
  const before = await origin();
  await dragMap(60, 40);
  const panned = await origin();
  expect(Math.round(panned.x - before.x)).toBe(60);
  expect(Math.round(panned.y - before.y)).toBe(40);
  expect(await map.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
  const c0 = (await map.boundingBox())!;
  await page.mouse.move(c0.x + 300, c0.y + 250);
  const wb = await origin();
  const under = { x: (c0.x + 300 - wb.x) / wb.width, y: (c0.y + 250 - wb.y) / wb.height };
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await origin()).width).toBeGreaterThan(wb.width);
  const wa = await origin();
  expect(Math.abs(wa.x + under.x * wa.width - (c0.x + 300))).toBeLessThan(2);
  expect(Math.abs(wa.y + under.y * wa.height - (c0.y + 250))).toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'false');
  expect(await covers()).toBe(true);

  // Touch: one finger pans, two fingers pinch (here in) around their centre, lifting them does not jump the camera; a tap opens.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  const cx = c0.x + 300;
  const cy = c0.y + 250;
  const t0 = await origin();
  await touch('touchStart', [{ x: cx, y: cy }]);
  for (const k of [0.5, 1]) await touch('touchMove', [{ x: cx + 30 * k, y: cy + 20 * k }]);
  await touch('touchEnd', []);
  await expect.poll(async () => Math.round((await origin()).x - t0.x)).toBe(30); // one finger pans
  expect(Math.round((await origin()).y - t0.y)).toBe(20);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const pb = await origin();
  const pu = { x: (cx - pb.x) / pb.width, y: (cy - pb.y) / pb.height };
  await touch('touchStart', [{ x: cx - 80, y: cy }]);
  await touch('touchStart', [
    { x: cx - 80, y: cy },
    { x: cx + 80, y: cy },
  ]);
  for (const d of [70, 60])
    await touch('touchMove', [
      { x: cx - d, y: cy },
      { x: cx + d, y: cy },
    ]);
  await expect.poll(async () => (await origin()).width / pb.width).toBeCloseTo(60 / 80, 2);
  const pa = await origin();
  expect(Math.abs(pa.x + pu.x * pa.width - cx)).toBeLessThan(2);
  expect(Math.abs(pa.y + pu.y * pa.height - cy)).toBeLessThan(2);
  // The fingers lift one after the other (CDP sends one pointerup each): the camera stays where the pinch left it.
  // CDP cannot lift one finger and move the other on, so the remaining finger's drag is not driven here.
  await touch('touchEnd', []);
  await page.waitForTimeout(100);
  expect(await origin()).toEqual(pa);
  await expect(page.getByRole('dialog')).toHaveCount(0); // a pinch is no click
  expect(await covers()).toBe(true);
  await page.getByRole('button', { name: 'Fit' }).click();
  const tapAt = (await crab2.boundingBox())!;
  await touch('touchStart', [{ x: tapAt.x + tapAt.width / 2, y: tapAt.y + tapAt.height / 2 }]);
  await touch('touchEnd', []);
  await expect(page.getByRole('dialog', { name: 'Export CSV fix' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Fit' }).click();
  await crab2.click();
  await expect(page.getByRole('dialog', { name: 'Export CSV fix' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Focus shows the card; Active only boards nothing up here, every project has a crab but haso.
  await crab2.focus();
  const card = page.getByRole('tooltip');
  await expect(card).toContainText('Asks: git push origin');
  await expect(card).toContainText('Context 170k / 200k');
  await expect(card).toContainText(/#1 in line for \d+ (min|h)/);
  await expect(crab2).toHaveAttribute('aria-describedby', 'village-card');
  await page.screenshot({ path: 'test-results/village-card.png' });
  await expect(page.locator('.house')).toHaveCount(6);
  await page.getByRole('button', { name: 'Active only' }).click();
  await expect(page.locator('.house')).toHaveCount(5);
  await page.getByRole('button', { name: 'Active only' }).click();
  await page.mouse.move(0, 0);
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(covers).toBe(true);
  await page.screenshot({ path: 'test-results/village.png' });

  await page.getByRole('button', { name: 'Fit' }).click();

  // A click pins the card with its actions; Allow sends the phone's "1".
  await crab2.click();
  const pinned = page.getByRole('dialog', { name: 'Export CSV fix' });
  await expect(pinned.getByRole('button', { name: 'Allow Y' })).toBeVisible();
  await expect(pinned.getByRole('button', { name: 'Compact' })).toBeDisabled();
  await expect(crab2).toHaveClass(/ring/);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('pr3-card.png') });
  await pinned.getByRole('button', { name: 'Allow Y' }).click();
  await expect.poll(() => posted('/api/sessions/s2/keys')).toEqual([{ keys: ['1'] }]);

  // Keyboard triage on the map: arrows walk the queue, N denies, R runs, Esc closes, Enter opens.
  await page.keyboard.press('Escape');
  await expect(pinned).toHaveCount(0);
  await expect(map).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('dialog', { name: 'Export CSV fix' })).toBeVisible();
  await page.keyboard.press('n');
  await expect.poll(() => posted('/api/sessions/s2/keys')).toEqual([{ keys: ['1'] }, { keys: ['3'] }]);
  await page.keyboard.press('j');
  await expect(page.getByRole('dialog', { name: 'Prompt theme' }).getByRole('button', { name: 'Run R' })).toBeVisible();
  await page.keyboard.press('r');
  await expect.poll(() => posted('/api/sessions/s7/command')).toEqual([{ index: 0, action: 'run' }]);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('dialog', { name: 'Export CSV fix' })).toBeVisible();
  await page.keyboard.press('Escape');

  // WASD stands you up and walks you; the camera follows and a drag lets go of it. D no longer denies.
  const youAt = async () => {
    const b = (await map.locator('.obj.me').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height };
  };
  await expect(map.locator('.obj.me')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(map).toBeFocused(); // a click on a zoom button hands the keys back to the map
  // So does every other header button; from the keyboard the focus stays on the button.
  const now = page.getByRole('button', { name: 'Now', exact: true });
  await now.focus();
  await page.keyboard.press('Enter');
  await expect(now).toBeFocused();
  await now.click();
  await expect(map).toBeFocused();
  await page.keyboard.down('d');
  await expect(map.locator('.obj.me')).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.keyboard.up('d');
  const walked = await youAt();
  const m = (await map.boundingBox())!;
  expect(Math.abs(walked.x - (m.x + m.width / 2))).toBeLessThan(m.width / 4); // the camera kept you near the middle
  await page.keyboard.down('s');
  await page.waitForTimeout(300);
  await page.keyboard.up('s');
  const south = await youAt();
  expect(south.y).toBeGreaterThan(walked.y - 1);
  expect(posted('/api/sessions/s2/keys')).toHaveLength(2); // no third key from the d we held
  await page.mouse.move(m.x + 6, m.y + 6);
  await page.mouse.down();
  await page.mouse.move(m.x + 120, m.y + 90, { steps: 4 });
  await page.mouse.up();
  const dragged = await youAt();
  expect(dragged.x).toBeGreaterThan(south.x + 60); // dragging let go of you
  await page.keyboard.press('Escape'); // keeps focus on the map
  await page.screenshot({ path: shot('walk.png') });
  await page.getByRole('button', { name: 'Fit' }).click();

  // Walk up the queue lane: a crab in reach turns and waves, E talks (pins its card); back at the desk E sits.
  const prompt = map.locator('.prompt');
  await map.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('e'); // nothing in reach where you stand
  await expect(page.getByRole('dialog', { name: 'Export CSV fix' })).toHaveCount(0);
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(map).toBeFocused();
  /** Map px: where you and the first crab in line are (the elements' left and top). */
  const mapPos = (l: Locator) => l.evaluate((e) => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
  const desk = () => mapPos(map.locator('.obj.you'));
  /** Walk in short taps of a key until the condition holds. */
  const tapUntil = async (key: string, done: () => Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await done()); i++) {
      await page.keyboard.down(key);
      await page.waitForTimeout(50);
      await page.keyboard.up(key);
    }
    expect(await done()).toBe(true);
  };
  const [meAt, crabAt] = [() => mapPos(map.locator('.obj.me')), () => mapPos(crab2)];
  // The way up the lane leads round the desk's left side (a lake lies below the plaza).
  await tapUntil('w', async () => (await meAt()).y < (await desk()).y + 30);
  await tapUntil('a', async () => (await meAt()).x < (await crabAt()).x - 90);
  await tapUntil('w', async () => (await meAt()).y < (await crabAt()).y + 10);
  await tapUntil('d', async () => (await meAt()).x > (await crabAt()).x - 30);
  await expect(prompt).toContainText('talk');
  await page.keyboard.press('e');
  await page.screenshot({ path: shot('talk.png') });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  // E pinned the crab nearest in the line, which one depends on where the last tap stopped (CI is slower than a
  // laptop). Away from the desk N acts on that card only: a deny for the crab asking, nothing for the other.
  const pinnedAsks = (await page.getByRole('dialog', { name: 'Export CSV fix' }).count()) === 1;
  await page.keyboard.press('n');
  await expect.poll(() => posted('/api/sessions/s2/keys')).toHaveLength(pinnedAsks ? 3 : 2);
  await page.keyboard.press('Escape');
  await tapUntil('a', async () => (await meAt()).x < (await desk()).x - 82);
  await tapUntil('s', async () => (await prompt.count()) > 0 && /sit/.test(await prompt.innerText()));
  await page.keyboard.press('e');
  await expect(map.locator('.obj.me')).toHaveCount(0);
  await expect(map.locator('img[alt="You, at your desk"]')).toBeVisible();
  await expect(map.locator('img[alt="You, at your desk"]')).toHaveAttribute('src', /you-[01]\.svg/);
  await page.screenshot({ path: shot('sit.png') });
  await page.keyboard.press('ArrowDown'); // seated, the arrows walk the queue again
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit' }).click();

  // "+" on a house: a new session with a first prompt; the village stays.
  await page.locator('.house', { hasText: 'ai-portal' }).hover();
  await page.getByRole('button', { name: 'New session in ai-portal' }).click();
  const popover = page.getByRole('form', { name: 'New session in ai-portal' });
  await expect(popover.getByRole('button', { name: 'Worktree start' })).toBeVisible();
  await popover.getByLabel('First prompt (optional)').fill('Fix the export');
  await page.screenshot({ path: shot('pr3-popover.png') });
  await popover.getByRole('button', { name: 'Start session' }).click();
  await expect(popover).toHaveCount(0);
  expect(posted('/api/sessions')).toEqual([{ projectId: 'ai-portal', kind: 'claude', prompt: 'Fix the export' }]);
  await expect(map.locator('.crab')).toHaveCount(sessions.length + 1);

  // "+ New project": a new district, a colour, the folder made with git init, then the first session.
  await page.getByRole('button', { name: '+ New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Build a new house' });
  await dialog.getByLabel('Name').fill('crab-arcade');
  await expect(dialog.getByRole('combobox', { name: 'Folder' })).toHaveValue('~/PycharmProjects/work/crab-arcade');
  await dialog.getByRole('combobox', { name: 'Folder' }).fill('/home/chris/PycharmProjects/private/crab-arcade');
  await dialog.getByRole('button', { name: '+ New district' }).click();
  await dialog.getByLabel('New district name').fill('Games');
  await dialog.getByRole('button', { name: 'Teal' }).click();
  await dialog.getByLabel('First prompt (optional)').fill('Set up a Vite app');
  await page.screenshot({ path: shot('pr3-dialog.png') });
  await dialog.getByRole('button', { name: 'Build house and start session' }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => posted('/api/projects'))
    .toEqual([
      {
        name: 'crab-arcade',
        path: '/home/chris/PycharmProjects/private/crab-arcade',
        group: 'Games',
        icon: { kind: 'symbol', symbol: 'home', color: '#4fd6be' },
        create: true,
      },
    ]);
  await expect
    .poll(() => posted('/api/sessions').at(-1))
    .toEqual({ projectId: 'crab-arcade', kind: 'claude', prompt: 'Set up a Vite app' });

  // A turn that ends hops with confetti.
  const newbie = map.getByRole('button', { name: /^Session 3/ });
  await expect(newbie.locator('.conf')).toHaveCount(0);
  events!.send(JSON.stringify({ type: 'session.status', sessionId: 's5', status: 'your-turn' }));
  await expect(newbie.locator('.conf')).toHaveCount(9);
  await expect(newbie.locator('.conf')).toHaveCount(0, { timeout: 6000 });
  // Its worktree merged: the big confetti for the crab that made it.
  const maker = map.getByRole('button', { name: /^Ticket filters/ });
  children[0].state = 'merged';
  events!.send(JSON.stringify({ type: 'worktrees.changed' }));
  await expect(maker.locator('.conf')).toHaveCount(18);
  await expect(maker.locator('.conf')).toHaveCount(0, { timeout: 6000 });

  await page.keyboard.press('Alt+KeyV');
  await expect(page.getByRole('heading', { name: 'ai-portal', level: 1 })).toBeVisible();
  await page.keyboard.press('Alt+KeyV');
  await expect(page.getByRole('heading', { name: 'Crab Village' })).toBeVisible();
  await showAll();

  // Chat in the map: opening a crab opens its terminal in a floating window and the village stays; keys go to it.
  const mr = map.getByRole('button', { name: /^MR 311 review/ });
  await mr.dblclick();
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  const tabs = chat.getByRole('tab');
  await expect(chat.getByRole('region', { name: 'MR 311 review' })).toBeVisible();
  await expect(tabs).toHaveText(['MR 311 review, waiting']);
  await expect(page).toHaveURL(/#\/village$/);
  await expect(mr).toHaveClass(/ring/);
  await expect(chat.locator('textarea')).toBeFocused();
  // It opens beside the crab, not over it.
  const [cb, mb] = [(await chat.boundingBox())!, (await mr.boundingBox())!];
  expect(cb.x >= mb.x + mb.width || cb.x + cb.width <= mb.x).toBe(true);
  expect(cb.y < mb.y + mb.height && cb.y + cb.height > mb.y).toBe(true);
  await page.keyboard.press('d'); // typed into the terminal: you stay at your desk
  await expect(map.locator('.obj.me')).toHaveCount(0);
  // A click on the bare map takes the keys back; the queue keys open a second crab in a second tab.
  await page.mouse.click((await map.boundingBox())!.x + 6, (await map.boundingBox())!.y + 6);
  await expect(map).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(tabs).toHaveText(['MR 311 review, waiting', 'Export CSV fix, needs you']);
  await expect(chat.getByRole('tab', { name: /^Export CSV fix/ })).toHaveAttribute('aria-selected', 'true');
  await expect(chat.locator('textarea')).toBeFocused();
  await expect(page).toHaveURL(/#\/village$/);
  // The title bar drags the window, the corner grip resizes it; both stay in localStorage.
  const at = async () => (await chat.boundingBox())!;
  const b0 = await at();
  const handle = async (l: Locator, dx: number, dy: number) => {
    const h = (await l.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 4 });
    await page.mouse.up();
  };
  await handle(chat.locator('.grow'), -200, -150);
  const b1 = await at();
  expect([Math.round(b1.x - b0.x), Math.round(b1.y - b0.y), b1.width, b1.height]).toEqual([
    -200,
    -150,
    b0.width,
    b0.height,
  ]);
  await handle(chat.locator('.grip'), 60, 40);
  const b2 = await at();
  expect([b2.x, b2.y, Math.round(b2.width - b1.width), Math.round(b2.height - b1.height)]).toEqual([
    b1.x,
    b1.y,
    60,
    40,
  ]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shub-village-chat')!))).toEqual({
    x: b2.x,
    y: b2.y,
    w: b2.width,
    h: b2.height,
  });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('chat.png') });
  // A tab's x closes it; Alt W closes the window and gives the keys back to the map.
  await chat.getByRole('button', { name: 'Close Export CSV fix' }).click();
  await expect(tabs).toHaveText(['MR 311 review, waiting']);
  await chat.locator('textarea').focus();
  await page.keyboard.press('Alt+KeyW');
  await expect(chat).toHaveCount(0);
  await expect(map).toBeFocused();
  // Opened again, it comes back where it was; "Open full view" leaves for the session.
  await mr.dblclick();
  expect(await at()).toEqual(b2);
  await chat.getByRole('link', { name: 'Open full view' }).click();
  await expect(page).toHaveURL(/#\/p\/vynce\/s3$/);
  expect(errors).toEqual([]);
});

test('the notes panel (Alt M) saves what you type and offers theirs when Claude changed the file', async ({ page }) => {
  const draft = { path: '/state/notes/s1.md', text: '# Draft\n', rev: 'r1' };
  const { errors, calls } = await mockApi(page, {
    '/api/sessions/s1/notes': draft,
    'PUT /api/sessions/s1/notes': { rev: 'r2' },
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: 'Notes' }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown draft' });
  await expect(editor).toHaveValue('# Draft\n');
  await editor.fill('# Draft\nmore');
  await expect.poll(() => calls.find((c) => c.method === 'PUT')?.body).toEqual({ text: '# Draft\nmore', rev: 'r1' });
  await expect(page.getByText('saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(editor).toHaveValue('# Draft\nmore');
  await page.getByRole('button', { name: 'Hide notes (Alt M)' }).click();
  await expect(editor).toHaveCount(0);
  await page.keyboard.press('Alt+m');
  await expect(editor).toBeVisible();
  expect(errors).toEqual([]);
});

test('notes: a save that lost against Claude shows the bar; Take theirs loads the file', async ({ page }) => {
  const { calls } = await mockApi(page, {
    '/api/sessions/s1/notes': { path: '/state/notes/s1.md', text: 'claude wrote this', rev: 'r9' },
    'PUT /api/sessions/s1/notes': { status: 409, json: { error: 'the notes changed meanwhile' } },
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.keyboard.press('Alt+m');
  const editor = page.getByRole('textbox', { name: 'Markdown draft' });
  await editor.fill('mine');
  await expect(page.getByRole('alert')).toContainText('changed the file while you typed');
  await page.getByRole('button', { name: 'Take theirs' }).click();
  await expect(editor).toHaveValue('claude wrote this');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});

test('phone offers push once, and Not now keeps it away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Headless Chromium reports notifications as denied; a real phone starts at "default".
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'default' }));
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/');
  const offer = page.getByRole('region', { name: 'Push notifications' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Needs you · 1' })).toBeVisible();
  await expect(offer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('phone toast sits at the top and the message field is 16 px, so iOS does not zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/p/ai-portal/s1');
  const toastBox = page.getByRole('status').locator('.toast').first();
  await expect(toastBox).toBeVisible();
  expect((await toastBox.boundingBox())!.y).toBeLessThan(60);
  const size = await page.getByLabel('Message to Claude').evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe('16px');
  expect(errors).toEqual([]);
});

test('phone permission bar is one line until tapped and keeps Always apart from Yes and No', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const asking = {
    ...session,
    pendingPermission: { tool: 'Bash', summary: 'pytest core/tests -k a_very_long_filter' },
  };
  const { errors, calls } = await mockApi(page, { '/api/sessions': [asking] });
  await page.goto('/#/p/ai-portal/s1');
  const line = page.getByRole('button', { name: /Allow Bash\?/ });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  const group = page.getByRole('group', { name: 'Answer the permission question' });
  await group.getByRole('button', { name: 'Always' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/sessions/s1/keys')?.body).toEqual({ keys: ['2'] });
  expect(errors).toEqual([]);
});

test('phone quick keys hide with the toggle and stay hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/p/ai-portal/s1');
  const keys = page.getByRole('group', { name: 'Quick keys' });
  await expect(keys).toBeVisible();
  await page.getByRole('button', { name: 'Toggle quick keys' }).click();
  await expect(keys).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Message to Claude')).toBeVisible();
  await expect(keys).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('phone new session sheet searches every project once the list is long', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const more = Array.from({ length: 5 }, (_, i) => ({ ...project, id: `p${i}`, name: `proj-${i}`, order: i + 1 }));
  const { errors, calls } = await mockApi(page, {
    '/api/sessions': [],
    '/api/projects': [project, dormant, ...more],
  });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'New session' }).click();
  const sheet = page.getByRole('dialog', { name: 'New session in' });
  await expect(sheet.getByRole('button', { name: 'street-tours' })).toHaveCount(0);
  await sheet.getByLabel('Find a project').fill('street');
  await sheet.getByRole('button', { name: 'street-tours' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/sessions')?.body)
    .toMatchObject({
      projectId: 'street-tours',
    });
  expect(errors).toEqual([]);
});

test('phone attaches a picture: it is pasted into the session and the field stays for a message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, calls } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/p/ai-portal/s1');
  await expect(page.getByRole('button', { name: 'Attach a picture' })).toBeVisible();
  await page.getByLabel('Pictures to send', { exact: true }).setInputFiles({
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not really a png'),
  });
  await expect(page.getByText('Picture added to your message')).toBeVisible();
  const paste = calls.find((c) => c.path === '/api/sessions/s1/paste');
  expect(paste?.body).toEqual({ type: 'image/png', bytes: 16 });
  expect(errors).toEqual([]);
});

test('a swipe in the phone terminal becomes mouse-wheel reports for the app inside', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  const sent: string[] = [];
  // Claude's fullscreen UI: mouse tracking on (button events, SGR encoding).
  await page.routeWebSocket('**/api/terminals/**', (ws) => {
    ws.send('\u001b[?1000h\u001b[?1006h');
    ws.onMessage((m) => sent.push(typeof m === 'string' ? m : m.toString()));
  });
  await page.goto('/#/p/ai-portal/s1');
  const screen = page.locator('.xterm-screen');
  await expect(screen).toBeVisible();
  const box = (await screen.boundingBox())!;
  const x = box.x + box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const top = box.y + 40;
  await touch('touchStart', top);
  for (let i = 1; i <= 10; i++) await touch('touchMove', top + i * 20); // finger down: older output
  await touch('touchEnd', 0);
  // SGR wheel up is button 64.
  await expect.poll(() => sent.filter((m) => m.startsWith('\u001b[<64;')).length).toBeGreaterThan(3);
  expect(sent.some((m) => m.startsWith('\u001b[<65;'))).toBe(false);
  expect(errors).toEqual([]);
});
