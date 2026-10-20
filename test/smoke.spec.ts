import { expect, test, type Page } from '@playwright/test';
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
  '/api/auth/me': { caller: { kind: 'user', id: 'user' }, device: null },
  '/api/devices': [],
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
    const body = r.request().postDataJSON() as unknown;
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
  await expect(nav.getByRole('link', { name: 'street-tours' })).toHaveCount(0);
  await expect(nav.getByText('1 needs you')).toBeVisible();
  await expect(page).toHaveTitle('(1) shub');

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
  await expect(nav.getByRole('link', { name: 'New project' })).toBeVisible();
  await expect(nav.getByRole('switch', { name: 'Active only' })).toBeVisible();
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

test('login on 401 and phone pairing', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    '/api/config': { status: 401, json: { error: 'login required' } },
    'POST /api/auth/pairing/redeem': { device: { id: 'phone-1', state: 'pending', level: 'prompts' } },
    'POST /api/auth/challenge': { status: 409, json: { error: 'waiting for approval on the machine' } },
  });
  await page.goto('/#/');
  await expect(page.getByText('your session hub')).toBeVisible();
  await page.getByLabel('Access token').fill('secret');
  await expect(page.getByLabel('Remember this device for 30 days')).toBeChecked();
  // Login reloads the page; wait for that, or the reload races the goto below.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await reloaded;
  await expect.poll(() => calls.find((c) => c.path === '/api/auth/login')?.body).toMatchObject({ token: 'secret' });

  await page.goto('/pair/abc123');
  await page.getByLabel('Device name').fill('Pixel');
  await page.getByRole('button', { name: 'Pair this phone' }).click();
  // Not approved on the machine yet: the challenge answers 409 and the page waits.
  await expect(page.getByText(/Now approve Pixel in shub/)).toBeVisible();
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
  await page.keyboard.press('Escape');
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
    .toEqual({ index: 0, action: 'run', enter: true });
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

test('closing the last terminal hides the bottom panel instead of showing Services', async ({ page }) => {
  const shell: Session = { ...session, id: 'sh1', kind: 'shell', name: 'shell', status: 'your-turn', parentId: 's1' };
  // Session has its own `status`, so wrap it to keep mockApi from reading it as the HTTP status.
  const { errors } = await mockApi(page, { 'POST /api/sessions': { status: 200, json: shell } });
  let events: { send(m: string): void } | undefined;
  await page.routeWebSocket('**/api/events', (ws) => {
    events = ws;
    ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 }));
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: /^Services/ }).click();
  const panel = page.getByRole('region', { name: 'Bottom panel' });
  await panel.getByRole('button', { name: /New plain terminal/ }).click();
  await expect(panel.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute('aria-selected', 'true');

  await panel.getByRole('button', { name: 'Close Terminal 1' }).click();
  events!.send(JSON.stringify({ type: 'session.closed', sessionId: 'sh1' }));
  await expect(panel).toHaveCount(0);
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

test('a terminal tab opens with Alt T and starts Claude where it was cd-ed to, typed or clicked', async ({ page }) => {
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
  await page.keyboard.press('Alt+t');
  await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute('aria-selected', 'true');
  const start = calls.find((c) => c.method === 'POST' && c.path === '/api/sessions');
  expect(start?.body).toEqual({ projectId: 'ai-portal', kind: 'shell' });

  // `claude` typed in the terminal: the server says which terminal started it, and its open tab follows.
  const typed: Session = { ...here, id: 's8', name: 'Session 8' };
  events!.send(JSON.stringify({ type: 'session.started', session: typed, from: 'sh1' }));
  await expect(page.getByRole('tab', { name: 'Session 8' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Terminal 1' }).click();
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
  await page.getByRole('switch', { name: 'Active only' }).click();
  await expect(page.getByRole('region', { name: 'Work', exact: true })).toBeVisible();
  await expect(activeGroup).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the tab ✕ hides a session from the tab bar but not the sidebar', async ({ page }) => {
  const other: Session = { ...session, id: 's2', name: 'Docs pass', status: 'your-turn' };
  const { errors, calls } = await mockApi(page, {
    '/api/sessions': [session, other],
    '/api/sessions/s2/services': [],
  });
  let events: { send(m: string): void } | undefined;
  await page.routeWebSocket('**/api/events', (ws) => {
    events = ws;
    ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 }));
  });
  await page.goto('/#/p/ai-portal/s2');
  const tab = (name: string) => page.getByRole('tab', { name });
  const row = (name: string) => page.getByRole('link', { name: new RegExp(name) });

  await tab('MR 2136 review').hover(); // the ✕ shows on hover
  await page.getByRole('button', { name: 'Hide MR 2136 review tab (stays in the sidebar)' }).click();
  await expect(tab('MR 2136 review')).toHaveCount(0);
  await expect(row('MR 2136 review')).toBeVisible();
  await page.reload();
  await expect(tab('Docs pass')).toBeVisible();
  await expect(tab('MR 2136 review')).toHaveCount(0);

  // Needing you again brings the tab back.
  events!.send(JSON.stringify({ type: 'session.status', sessionId: 's1', status: 'working' }));
  events!.send(JSON.stringify({ type: 'session.status', sessionId: 's1', status: 'needs-you' }));
  await expect(tab('MR 2136 review')).toBeVisible();

  // Hiding the open tab moves to its neighbour; opening the session from the sidebar shows its tab again.
  await page.getByRole('button', { name: 'Hide Docs pass tab (stays in the sidebar)' }).click();
  await expect(tab('MR 2136 review')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Docs pass')).toHaveCount(0);
  await row('Docs pass').click();
  await expect(tab('Docs pass')).toHaveAttribute('aria-selected', 'true');

  expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
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

test('a tab menu parks the session with a background check', async ({ page }) => {
  const { errors, calls } = await mockApi(page);
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('tablist').getByRole('button', { name: 'Menu for MR 2136 review' }).click();
  await page.getByRole('menuitem', { name: 'Wait for…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Wait for…' });
  await dialog.getByLabel('Waiting for').fill("Kai's answer on MR !2213");
  await dialog.getByLabel('How can Haiku tell it happened?').fill('Has Kai commented on MR !2213 in ai/ai-portal?');
  await dialog.getByLabel('Check every').selectOption('60');
  if (process.env.SHUB_SHOT) await page.screenshot({ path: process.env.SHUB_SHOT });
  await dialog.getByRole('button', { name: 'Wait and check' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/sessions/s1')?.body).toEqual({
    waitingFor: "Kai's answer on MR !2213",
    waitCheck: 'Has Kai commented on MR !2213 in ai/ai-portal?',
    waitEveryMinutes: 60,
  });
  expect(errors).toEqual([]);
});

test('sessions: sidebar sorts by status, a dragged tab keeps its place in both lists', async ({ page }) => {
  const paused: Session = { ...session, id: 's2', name: 'Paused one', status: 'paused' };
  const working: Session = { ...session, id: 's3', name: 'Working one', status: 'working' };
  const { errors, calls } = await mockApi(page, { '/api/sessions': [session, paused, working] });
  await page.goto('/#/p/ai-portal/s1');
  const tabs = page.getByRole('tab');
  const rows = page.getByRole('region', { name: 'Work', exact: true }).getByRole('link', { name: /one|review/ });
  await expect(tabs).toHaveText(['MR 2136 review', 'Paused one', 'Working one']);
  await expect(rows).toHaveText([/MR 2136 review/, /Working one/, /Paused one/]);

  await tabs.nth(2).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: 8 } });
  await expect(tabs).toHaveText(['Working one', 'MR 2136 review', 'Paused one']);
  await expect(rows).toHaveText([/Working one/, /MR 2136 review/, /Paused one/]);
  expect(calls.find((c) => c.path === '/api/sessions/reorder')?.body).toEqual({ positions: { s3: 0 } });
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
  await page.getByRole('button', { name: 'Pair this phone' }).click();
  await expect(page.getByText(/signed in as/)).toBeVisible();

  await page.goto('/#/');
  await page.getByRole('button', { name: 'Add a machine' }).click();
  await page.route('https://pc.example.ts.net/api/health', (r) =>
    r.fulfill({ json: { ok: true, version: '2026.10.0', apiVersion: 1, machine: 'pc' }, headers: CORS }),
  );
  // The second machine has not approved the phone yet.
  await page.route('https://pc.example.ts.net/api/auth/challenge', (r) =>
    r.fulfill({ status: 409, json: { error: 'waiting for approval on the machine' }, headers: CORS }),
  );
  await page.getByLabel('Address').fill('pc.example.ts.net');
  await page.getByLabel('Pairing code').fill('abcd-efgh');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByText(/Now approve this phone on pc/)).toBeVisible();
  const redeem = calls.find((c) => c.origin === 'https://pc.example.ts.net' && c.path === '/api/auth/pairing/redeem');
  expect(redeem?.body).toMatchObject({ code: 'abcd-efgh', publicKey: { kty: 'EC', crv: 'P-256' } });
  expect(errors.filter((e) => !e.includes('409'))).toEqual([]);
});
