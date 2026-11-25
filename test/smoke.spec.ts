import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
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
  '/api/projects/clone': { root: '', folders: [], repos: [] },
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
  '/api/group/transcripts': { running: false, done: 0, total: 0, size: 3_145_728 },
  '/api/group/folder': { folder: '/home/me/Sync/shub', items: 42, scannedAt: '2026-11-15T08:00:00Z', conflicts: 0 },
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
    // The phone overview asks every project for its other hosts' sessions: none by default.
    if (/^\/api\/projects\/[^/]+\/old-sessions$/.test(path)) return r.fulfill({ json: [], headers: CORS });
    // The phone chat view loads the conversation of the open session: empty by default.
    if (/^\/api\/sessions\/[^/]+\/messages$/.test(path)) return r.fulfill({ json: [], headers: CORS });
    return r.fulfill({ status: 404, json: { error: `no mock for ${path}` }, headers: CORS });
  });
  await page.routeWebSocket('**/api/events', (ws) => ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 })));
  await page.routeWebSocket('**/api/terminals/**', (ws) => ws.send('\u001b[32m●\u001b[0m mocked terminal\r\n'));
  return { errors, calls };
}

test('the preview server never reaches a live shub: what the test does not mock answers 503', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(503);
  expect(await res.json()).toEqual({ error: 'not mocked in the smoke test: /api/health' });
});

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

  await nav.getByRole('link', { name: 'ai-portal' }).click({ position: { x: 20, y: 10 } }); // the hover actions cover the rest of the row
  await expect(page.getByRole('heading', { name: 'ai-portal', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'MR 2136 review' })).toBeVisible();
  await expect(page.locator('.xterm')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'MR 2136 review' })).toHaveAccessibleDescription(
    /needs you: Claude is blocked/,
  );

  await page.keyboard.press('Alt+Slash');
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('status legend lists the five states', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Status legend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Status legend' });
  for (const state of ['needs you', 'your turn', 'working', 'waiting', 'paused'])
    await expect(dialog.locator('dt').filter({ hasText: state })).toBeVisible();
  await expect(dialog.getByText('Parked until something outside happens')).toBeVisible();
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
    .locator('.drawer')
    .evaluate((el) => el.getAnimations().map((a) => a.effect?.getComputedTiming().duration));
  expect(durations).toEqual([200]);
  // A modal dialog: focus moves in, and Tab never reaches the page behind (past the last button it leaves for the
  // browser's own controls, here the body, and comes back to the first). Escape closes it.
  const drawer = page.getByRole('dialog', { name: 'Global Claude' });
  const focus = () =>
    drawer.evaluate((d) =>
      d.contains(document.activeElement) ? 'drawer' : document.activeElement === document.body ? 'browser' : 'page',
    );
  await expect.poll(focus).toBe('drawer');
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    seen.push(await focus());
  }
  expect(seen).toEqual(['drawer', 'drawer', 'drawer', 'browser', 'drawer']);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
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

test.describe('chunks that do not arrive', () => {
  // The service worker would fetch the chunks itself, past page.route.
  test.use({ serviceWorkers: 'block' });
  const aborted = (e: string) => e.includes('net::ERR_FAILED');

  test('a lazy view offers a reload', async ({ page }) => {
    const { errors } = await mockApi(page);
    await page.route('**/assets/Styleguide-*.js', (r) => r.abort());
    await page.goto('/#/styleguide');
    await expect(page.getByRole('heading', { name: 'This view did not load' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    expect(errors.filter((e) => !aborted(e))).toEqual([]);
  });

  test('the terminal draws on the DOM renderer without the WebGL addon', async ({ page }) => {
    const { errors } = await mockApi(page);
    await page.route('**/assets/addon-webgl-*.js', (r) => r.abort());
    await page.goto('/#/p/ai-portal/s1');
    await expect(page.locator('.xterm-rows')).toContainText('mocked terminal');
    expect(errors.filter((e) => !aborted(e))).toEqual([]);
  });
});

test('login on 401: the host browser bootstraps with the token', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    '/api/config': { status: 401, json: { error: 'login required' } },
    'POST /api/auth/bootstrap': { device: { id: 'desk-1', state: 'active', level: 'control' } },
    'POST /api/auth/pairing/redeem': { device: { id: 'phone-1', state: 'pending', level: 'prompts' } },
    'POST /api/auth/challenge': { status: 409, json: { error: 'waiting for approval' } },
  });
  await page.goto('/#/');
  await expect(page.getByText('your Claude sessions')).toBeVisible();
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
    'POST /api/auth/challenge': { nonce: 'n1', hostId: 'host-1' },
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

  // Remove hides the host in this browser only: no sign-out (that would revoke the device group-wide), and it stays
  // hidden after a reload although the group still lists it.
  await page.goto('/#/settings/devices');
  await page.getByRole('listitem').filter({ hasText: 'Laptop' }).getByRole('button', { name: 'Remove' }).click();
  await expect(chips.getByRole('button', { name: /Laptop/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(chips.getByRole('button', { name: /Laptop/ })).toHaveCount(0);
  expect(calls.some((c) => c.path === '/api/auth/logout')).toBe(false);
  expect(calls.filter((c) => c.path === '/api/group/peers').length).toBeGreaterThan(1);
});

test('when the group cannot be asked, the per-browser machines are all there is', async ({ page }) => {
  await mockApi(page, {
    '/api/group/peers': { status: 500, json: { error: 'boom' } },
    'POST /api/auth/bootstrap': { device: { id: 'desk-1', state: 'active', level: 'control' } },
    'POST /api/auth/challenge': { nonce: 'n1', hostId: 'host-1' },
    'POST /api/auth/session': { token: 't1', expiresAt: '2099-01-01T00:00:00Z' },
  });
  await page.route('**/api/config', (r) => r.fulfill({ status: 401, json: { error: 'login required' } }), { times: 1 });
  await page.goto('/#/');
  await page.getByLabel('Access token').fill('secret');
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await reloaded;
  await expect(page.getByRole('navigation', { name: 'Machines' }).getByRole('button')).toHaveCount(0);
});

test('machines that do not answer show offline after the timeout, and their polls do not pile up', async ({ page }) => {
  const t0 = Date.parse('2026-10-29T10:00:00Z');
  await page.clock.install({ time: t0 });
  const hosts = ['Laptop', 'Mini', 'Tower'];
  const { errors } = await mockApi(page, {
    'POST /api/auth/bootstrap': { device: { id: 'desk-1', state: 'active', level: 'control' } },
    'POST /api/auth/challenge': { nonce: 'n1' },
    'POST /api/auth/session': { token: 't1', expiresAt: '2099-01-01T00:00:00Z' },
    '/api/group/peers': hosts.map((name) => ({
      id: name,
      name,
      url: `https://${name.toLowerCase()}.tail.ts.net`,
      state: 'in-sync',
    })),
  });
  let asked = 0;
  // They sign in, then never answer their session lists (switched off mid-request).
  await page.route(/^https:\/\/\w+\.tail\.ts\.net\/api\/sessions$/, () => void asked++);
  await page.route(
    '**/api/config',
    (r) => r.fulfill({ status: 401, json: { error: 'login required' }, headers: CORS }),
    { times: 1 },
  );
  await page.goto('/#/');
  await page.getByLabel('Access token').fill('secret');
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await reloaded;
  await expect.poll(() => asked).toBe(1);
  // From here on time only moves when the test says so. 10 s per silent machine: the round takes 30 s, so the
  // 20 s poll timer fires while it runs, and must not start a second round.
  await page.clock.pauseAt(t0 + 8_000);
  await page.clock.fastForward(10_000);
  await expect.poll(() => asked).toBe(2);
  await page.clock.fastForward(10_000);
  await expect.poll(() => asked).toBe(3);
  await page.waitForTimeout(300);
  expect(asked).toBe(3);
  const chips = page.getByRole('navigation', { name: 'Machines' });
  await expect(chips.getByRole('button', { name: /Laptop/ })).toHaveAccessibleName(/offline/);
  await expect(chips.getByRole('button', { name: /Mini/ })).toHaveAccessibleName(/offline/);
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
  await expect(
    page.getByText(/Now approve Pixel in Settings > Devices, on your computer or a trusted Control phone/),
  ).toBeVisible();
  const redeem = calls.find((c) => c.path === '/api/auth/pairing/redeem')?.body as Record<string, unknown>;
  expect(redeem).toMatchObject({ code: 'abc123', deviceName: 'Pixel', publicKey: { kty: 'EC', crv: 'P-256' } });
  expect(redeem.publicKey).not.toHaveProperty('d');
  // The waiting text shows before the challenge goes out.
  await expect.poll(() => calls.find((c) => c.path === '/api/auth/challenge')?.body).toEqual({ deviceId: 'phone-1' });
  expect(errors.filter((e) => !e.includes('401') && !e.includes('409'))).toEqual([]);
});

test('the approval wait stops when the sign-in page closes', async ({ page }) => {
  await page.clock.install();
  const { errors, calls } = await mockApi(page, {
    'POST /api/auth/pairing/redeem': { device: { id: 'phone-1', state: 'pending', level: 'prompts' } },
    'POST /api/auth/challenge': { status: 409, json: { error: 'waiting for approval' } },
  });
  await page.goto('/pair/abc123');
  await page.getByLabel('Device name').fill('Pixel');
  await page.getByRole('button', { name: 'Pair this device' }).click();
  await expect(
    page.getByText(/Now approve Pixel in Settings > Devices, on your computer or a trusted Control phone/),
  ).toBeVisible();
  // Back later: the sign-in page waits again, then the user leaves it.
  await page.goto('/#/login');
  await expect(page.getByText(/Now approve .* in Settings > Devices/)).toBeVisible();
  await page.evaluate(() => (location.hash = '#/styleguide'));
  await expect(page.getByRole('heading', { name: 'Drawer' })).toBeVisible();
  const asked = () => calls.filter((c) => c.path === '/api/auth/challenge').length;
  const before = asked();
  await page.clock.fastForward(10_000);
  await page.waitForTimeout(300);
  expect(asked()).toBe(before);
  expect(errors.filter((e) => !e.includes('401') && !e.includes('409'))).toEqual([]);
});

test('the game is one iframe that survives leaving and coming back, and Restart game is the only reset', async ({
  page,
}) => {
  const { errors } = await mockApi(page);
  await page.route('https://aidle-digital.web.app/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<title>game</title><p>game</p>' }),
  );
  await page.goto('/#/game');
  const frame = page.locator('iframe[title="Game"]');
  await expect(frame).toHaveAttribute('src', 'https://aidle-digital.web.app/');
  await frame.evaluate((el) => ((el as HTMLIFrameElement & { mark?: number }).mark = 7));
  await page.keyboard.press('Alt+KeyV');
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();
  await expect(frame).toBeHidden();
  await page.keyboard.press('Alt+KeyV');
  await expect(frame).toBeVisible();
  expect(await frame.evaluate((el) => (el as HTMLIFrameElement & { mark?: number }).mark)).toBe(7);
  expect(errors).toEqual([]);
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
  await expect(page.getByLabel('Show worktree-start as Quick action')).toBeHidden();
  await page.getByText(/shown as Quick actions/).click();
  await expect(page.getByLabel('Show worktree-start as Quick action')).toBeChecked();
  await page.getByLabel('Show refine-ticket as Quick action').check();
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
    'PATCH /api/settings': {
      ...config,
      themes: [{ id: 'monokai', name: 'Monokai', builtIn: true, tokens: {}, terminal: { fontSize: 16 } }],
    },
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
  const { errors, calls } = await mockApi(page, {
    '/api/config': {
      ...config,
      themes: [{ id: 'monokai', name: 'Monokai', builtIn: true, tokens: {}, terminal: { fontSize: 15 } }],
    },
  });
  await page.goto('/#/settings/appearance');
  const section = page.getByRole('region', { name: 'Terminal' });
  await section.getByRole('button', { name: 'This device only' }).click();
  await section.getByLabel('Size (px)').fill('11');
  await section.getByLabel('Size (px)').press('Enter');
  await expect(section.getByLabel('Font sample')).toHaveCSS('font-size', '11px');
  expect(await page.evaluate(() => localStorage.getItem('shub.terminal.device'))).toBe('{"fontSize":11}');
  await page.reload();
  await expect(section.getByLabel('Size (px)')).toHaveValue('11');
  await section.getByRole('button', { name: 'Reset to theme' }).click();
  await expect(section.getByLabel('Size (px)')).toHaveValue('15');
  await section.getByRole('button', { name: 'This theme' }).click();
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

test('settings > Sync shows the sync folder and how it is doing', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/settings/sync');
  const folder = page.getByRole('region', { name: 'Sync folder' });
  await expect(folder.getByText('Connected')).toBeVisible();
  await expect(folder.getByText(/42 items/)).toBeVisible();
  await expect(page.getByText('3 MB of transcripts on this machine.')).toBeVisible();
  await folder.getByText('How it works and how to set it up').click();
  await expect(folder.getByText(/a sync tool moves the folder/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings > Sync without a folder says nothing is shared and greys the switches', async ({ page }) => {
  const { errors } = await mockApi(page, { '/api/group/folder': { items: 0, conflicts: 0 } });
  await page.goto('/#/settings/sync');
  await expect(page.getByText('No folder set: nothing is shared with your other machines.')).toBeVisible();
  await expect(page.getByLabel('Themes')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('settings saves the sync folder', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    '/api/group/folder': { items: 0, conflicts: 0 },
    'POST /api/settings': { json: {} },
  });
  await page.goto('/#/settings/sync');
  await page.getByLabel('Folder on this machine').fill('~/Sync/shub');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/settings')?.body).toEqual({ syncFolder: '~/Sync/shub' });
  expect(errors).toEqual([]);
});

test('settings asks for the sync folder status every 10 s only while Sync is open', async ({ page }) => {
  await page.clock.install();
  const { errors, calls } = await mockApi(page);
  const polls = () => calls.filter((c) => c.path === '/api/group/folder').length;
  await page.goto('/#/settings/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await page.clock.runFor(25_000);
  expect(polls()).toBe(0);
  await page.goto('/#/settings/sync');
  await expect.poll(polls).toBe(1);
  await page.clock.runFor(10_000);
  await expect.poll(polls).toBe(2);
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
    'POST /api/sessions': { status: 200, json: session },
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
  // Enter starts a session right away.
  await expect
    .poll(() => calls.find((c) => c.path === '/api/sessions' && c.body)?.body)
    .toMatchObject({ projectId: 'ai-portal', kind: 'claude' });

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

test('first run without Claude history explains the words and leads with Add a folder', async ({ page }) => {
  const { errors } = await mockApi(page, { '/api/projects': [], '/api/projects/import': [] });
  await page.goto('/#/');
  await expect(page.getByText('A project is a folder you run Claude in.')).toBeVisible();
  await expect(page.getByText('No Claude history yet: point shub at any code folder.')).toBeVisible();
  await page.getByRole('button', { name: 'Add a folder' }).click();
  await expect(page).toHaveURL(/#\/settings\/project\/new$/);
  expect(errors).toEqual([]);
});

test('add a project by cloning a GitHub repository into private or work', async ({ page }) => {
  const { errors, calls } = await mockApi(page, {
    '/api/projects/clone': {
      root: '/home/me/code',
      folders: ['private', 'work'],
      repos: [{ name: 'me/shub', url: 'https://github.com/me/shub' }],
    },
    'POST /api/projects/clone': { path: '/home/me/code/work/shub' },
    'POST /api/projects': { ...project, id: 'shub', name: 'shub' },
  });
  await page.goto('/#/settings/project/new');
  await page.getByRole('button', { name: 'GitHub' }).click();
  await page.getByLabel('Repository').fill('https://github.com/me/shub');
  await page.getByRole('button', { name: 'work', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('shub');
  await page.locator('form').getByRole('button', { name: 'Add project' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/projects/clone')?.body)
    .toEqual({ url: 'https://github.com/me/shub', folder: 'work', name: 'shub' });
  await expect
    .poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/projects')?.body)
    .toMatchObject({ name: 'shub', path: '/home/me/code/work/shub' });
  expect(errors).toEqual([]);
});

test('no project open: quickstart steps; the empty sidebar offers Add project', async ({ page }) => {
  const { errors } = await mockApi(page, {
    '/api/projects': [dormant],
    '/api/config': { ...config, projects: [], groups: [] },
  });
  await page.goto('/#/p/none');
  await expect(page.getByText('Press New session.')).toBeVisible();
  await expect(page.getByText('a Claude not tied to a project, optional')).toBeVisible();
  await expect(page.getByText('Press Alt ? for all shortcuts.')).toBeVisible();
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings\/project\/new$/);
  // The global Claude is optional, and the drawer says so.
  await page.keyboard.press('Alt+KeyG');
  await expect(page.getByText('Optional: a general Claude, not tied to a project.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a project without sessions explains what a session is', async ({ page }) => {
  const { errors } = await mockApi(page, { '/api/sessions': [] });
  await page.goto('/#/p/ai-portal');
  await expect(page.getByText(/A session is Claude Code running in this project's folder/)).toBeVisible();
  await expect(page.getByText(/Start one here or press Alt N\./)).toBeVisible();
  expect(errors).toEqual([]);
});

test('login with a wrong token tells where to find it, without markdown backticks', async ({ page }) => {
  const { errors } = await mockApi(page, {
    '/api/config': { status: 401, json: { error: 'login required' } },
    'POST /api/auth/bootstrap': { status: 401, json: { error: 'bad token' } },
  });
  await page.goto('/#/');
  await expect(page.getByText(/Run shub token in a terminal/)).toBeVisible();
  await page.getByLabel('Access token').fill('nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Wrong token\. Print it again with shub token/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('`');
  expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
});

test('the pairing form says a code is needed away from the host', async ({ page }) => {
  const { errors } = await mockApi(page, { '/api/config': { status: 401, json: { error: 'login required' } } });
  // Open the page under another host name: the form then asks for a pairing code, not the host token.
  await page.route('http://shub.test/**', (r) =>
    r
      .fetch({ url: r.request().url().replace('http://shub.test', 'http://127.0.0.1:4791') })
      .then((res) => r.fulfill({ response: res })),
  );
  await page.goto('http://shub.test/#/login');
  await expect(
    page.getByText('Not on the machine that runs shub? You need a pairing code, not the token.'),
  ).toBeVisible();
  expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
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
  await page.getByRole('button', { name: 'Show terminal' }).click(); // Claude sessions open as a chat on the phone
  await expect(page.getByRole('group', { name: 'Quick keys' })).toBeVisible();
  await page.getByLabel('Message to Claude').fill('go on');
  await page.getByLabel('Message to Claude').press('Enter');
  await expect
    .poll(() => calls.filter((c) => c.path === '/api/sessions/s1/keys').at(-1)?.body)
    .toEqual({ keys: ['go on', 'Enter'] });
  expect(errors).toEqual([]);
});

test('the phone never shows the game', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/game');
  await expect(page.getByRole('heading', { name: 'Needs you · 1' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('phone runs a command Claude handed over after a second tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const other = { ...session, id: 's2', name: 'Other one' };
  const pendingCommands = [{ command: 'cd ~ && git pull' }, { command: 'make', session: 's2' }];
  const handing = { ...session, status: 'needs-you', pendingCommands };
  const { errors, calls } = await mockApi(page, { '/api/sessions': [handing, other] });
  let events: { send(m: string): void } | undefined;
  await page.routeWebSocket('**/api/events', (ws) => {
    events = ws;
    ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 }));
  });
  await page.goto('/#/');
  await expect(page.getByText('▶ 2 commands').first()).toBeVisible();
  await page.getByRole('link', { name: 'Open', exact: true }).first().click();
  const chip = page.getByRole('region', { name: 'Commands from Claude' });
  await expect(chip.locator('code')).toHaveText(['cd ~ && git pull', 'make']);
  await expect(chip.getByText('Runs in Other one')).toBeVisible();
  await expect(chip.getByRole('button', { name: 'Run in Other one' })).toBeVisible();
  await chip.getByRole('button', { name: 'Run in session' }).click();
  expect(calls.some((c) => c.path === '/api/sessions/s1/command')).toBe(false);
  // Claude hands over another list between the taps: the first tap no longer counts.
  const changed = [{ command: 'rm -rf build' }, ...pendingCommands];
  events!.send(JSON.stringify({ type: 'session.updated', session: { ...handing, pendingCommands: changed } }));
  await expect(chip.locator('code')).toHaveText(['rm -rf build', 'cd ~ && git pull', 'make']);
  await expect(chip.getByRole('button', { name: 'Tap again to run' })).toHaveCount(0);
  await chip.getByRole('button', { name: 'Run in session' }).first().click();
  await chip.getByRole('button', { name: 'Tap again to run' }).click();
  await expect
    .poll(() => calls.find((c) => c.path === '/api/sessions/s1/command')?.body)
    .toEqual({ index: 0, command: 'rm -rf build', action: 'run' });
  expect(errors).toEqual([]);
});

test('Copy says Copied only when the clipboard took the command', async ({ page }) => {
  const pendingCommands = [{ command: 'make' }];
  const { errors } = await mockApi(page, { '/api/sessions': [{ ...session, pendingCommands }] });
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard blocked'));
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('region', { name: 'Commands from Claude' }).getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Clipboard blocked')).toBeVisible();
  expect(await page.locator('.toast').allInnerTexts()).not.toContain('Copied'); // no retry: it would wait it out
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

test('theme editor saves the terminal look with the theme and shows it in the preview', async ({ page }) => {
  const { errors, calls } = await mockApi(page, { 'PUT /api/themes/my-theme': {}, 'PATCH /api/settings': config });
  await page.goto('/#/settings/theme/new');
  await page.getByLabel('Name', { exact: true }).fill('My theme');
  const group = page.locator('details.group', { has: page.locator('summary', { hasText: /^Terminal$/ }) });
  await group.getByLabel('Font', { exact: true }).fill("'IBM Plex Mono'");
  await group.getByLabel('Font', { exact: true }).press('Tab');
  await group.getByLabel('Size (px)').fill('16');
  await group.getByLabel('Size (px)').press('Tab');
  await expect(page.locator('.p-term')).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: 'Save and use' }).click();
  await expect
    .poll(() => calls.find((c) => c.path === '/api/themes/my-theme')?.body)
    .toMatchObject({ name: 'My theme', terminal: { fontFamily: "'IBM Plex Mono'", fontSize: 16 } });
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
  await expect(page.getByRole('menuitem', { name: 'Close worktree' })).toBeVisible();
  await page.keyboard.press('Escape');
  await row.hover();
  await page.getByRole('button', { name: 'Clean up all' }).click();
  await expect(page.getByRole('dialog', { name: /Close 1 orphaned worktree\?/ })).toBeVisible();
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

test("a quick switch never shows the previous session's containers", async ({ page }) => {
  const other: Session = { ...session, id: 's2', name: 'Docs pass', status: 'your-turn' };
  const container = (name: string) => ({
    id: name,
    name,
    project: 'ai-portal',
    workingDir: project.path,
    image: name,
    kind: 'other',
    state: 'running',
    status: 'Up 1 minute',
    ports: [],
  });
  const { errors } = await mockApi(page, {
    '/api/sessions': [session, other],
    '/api/sessions/s2/services': [container('docs-web')],
    '/api/services/docs-web/logs': { lines: [] },
  });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let asked!: () => void;
  const s1Asked = new Promise<void>((r) => (asked = r));
  // MR 2136 review's containers answer late, after the switch to Docs pass.
  await page.route('**/api/sessions/s1/services', async (r) => {
    asked();
    await held;
    await r.fulfill({ json: [container('review-web')] });
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.keyboard.press('Alt+KeyD');
  await s1Asked;
  await page.goto('/#/p/ai-portal/s2');
  await expect(page.getByText('Docs pass').first()).toBeVisible();
  await page.keyboard.press('Alt+KeyD');
  await expect(page.getByText('docs-web').first()).toBeVisible();
  release();
  await page.waitForTimeout(500);
  await expect(page.getByText('docs-web').first()).toBeVisible();
  await expect(page.getByText('review-web')).toHaveCount(0);
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
  await dialog.getByLabel('How should shub check it happened?').fill('Has Kai commented on MR !2213 in ai/ai-portal?');
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
    'POST /api/auth/challenge': { nonce: 'n1', hostId: 'host-1' },
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
    'POST /api/auth/challenge': { nonce: 'n1', hostId: 'host-1' },
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
  await expect(page.getByText('MR 2136 review').first()).toBeVisible();
  await page.keyboard.press('Alt+m');
  const editor = page.getByRole('textbox', { name: 'Markdown draft' });
  await editor.fill('mine');
  await expect(page.getByRole('alert').filter({ hasText: 'changed the file' })).toContainText(
    'changed the file while you typed',
  );
  await page.getByRole('button', { name: 'Take theirs' }).click();
  await expect(editor).toHaveValue('claude wrote this');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});

test('notes: a poll answered after a save does not bring the older text back', async ({ page }) => {
  const { errors } = await mockApi(page);
  let file = { path: '/state/notes/s1.md', text: '# Draft\n', rev: 'r1' };
  let gets = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let pollSent!: () => void;
  const polling = new Promise<void>((r) => (pollSent = r));
  await page.route('**/api/sessions/s1/notes', async (r) => {
    if (r.request().method() === 'PUT') {
      file = { ...file, text: (r.request().postDataJSON() as { text: string }).text, rev: 'r2' };
      return r.fulfill({ json: { rev: file.rev } });
    }
    // The first poll reads the file before the save and answers only after it; later polls stay unanswered.
    const before = file;
    if (++gets > 2) return;
    if (gets === 2) {
      pollSent();
      await held;
    }
    return r.fulfill({ json: before });
  });
  await page.goto('/#/p/ai-portal/s1');
  await expect(page.getByText('MR 2136 review').first()).toBeVisible();
  await page.keyboard.press('Alt+m');
  const editor = page.getByRole('textbox', { name: 'Markdown draft' });
  await expect(editor).toHaveValue('# Draft\n');
  await polling;
  await editor.fill('# Draft\nmore');
  await expect.poll(() => file.rev).toBe('r2');
  await expect(page.getByText('saved', { exact: true })).toBeVisible();
  release();
  await page.waitForTimeout(500);
  await expect(editor).toHaveValue('# Draft\nmore');
  expect(errors).toEqual([]);
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

test('phone keeps the message when sending it failed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, {
    '/api/sessions': [session],
    'POST /api/sessions/s1/keys': { status: 503, json: { error: 'tmux is gone' } },
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: 'Show terminal' }).click(); // Claude sessions open as a chat on the phone
  const field = page.getByLabel('Message to Claude');
  await field.fill('run the tests');
  await field.press('Enter');
  await expect(page.getByText('tmux is gone')).toBeVisible();
  await expect(field).toHaveValue('run the tests');
  expect(errors.filter((e) => !e.includes('503'))).toEqual([]);
});

test('phone toast sits at the top and the message field is 16 px, so iOS does not zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, {
    '/api/sessions': [session],
    '/api/updates': { ...(API['/api/updates'] as object), staged: '2026.10.1' },
  });
  await page.goto('/#/p/ai-portal/s1');
  const toastBox = page.locator('.toast').first();
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
  await page.getByRole('button', { name: 'Show terminal' }).click(); // Claude sessions open as a chat on the phone
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

test('the phone terminal opens no keyboard: typing goes through the message field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: 'Show terminal' }).click(); // Claude sessions open as a chat on the phone
  await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute('inputmode', 'none');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/p/ai-portal/s1');
  await expect(page.locator('.xterm-helper-textarea')).not.toHaveAttribute('inputmode', 'none');
  expect(errors).toEqual([]);
});

test('phone quick keys page up and down through the chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, calls } = await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: 'Page up' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/sessions/s1/keys')?.body).toEqual({ keys: ['PageUp'] });
  await page.getByRole('button', { name: 'Page down' }).click();
  await expect
    .poll(() => calls.filter((c) => c.path === '/api/sessions/s1/keys').at(-1)?.body)
    .toEqual({ keys: ['PageDown'] });
  expect(errors).toEqual([]);
});

type Marked = { alive?: boolean };
const announceUpdate = () =>
  navigator.serviceWorker.dispatchEvent(
    new MessageEvent('message', { data: { type: 'app-updated', version: '2099.1.0' } }),
  );

const leaveApp = () => {
  document.hasFocus = () => false; // a real focus move; the headless page always has focus
  window.dispatchEvent(new Event('blur'));
};

test('update toasts once, then applies on the next focus move, never over unsent text', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/');
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();
  await page.evaluate(() => {
    (window as Marked).alive = true; // disappears if the page reloads
    const input = document.body.appendChild(document.createElement('input'));
    input.value = 'unsent draft';
    input.focus();
  });
  await page.evaluate(announceUpdate);
  await expect(
    page.getByText('shub 2099.1.0 is downloaded. It applies when you switch away from the app.'),
  ).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as Marked).alive)).toBe(true); // no reload without a focus move

  await page.evaluate(leaveApp); // unsent draft: still no reload
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as Marked).alive)).toBe(true);

  await page
    .evaluate(() => {
      document.querySelector('input')?.remove();
      window.dispatchEvent(new Event('blur'));
    })
    .catch(() => {}); // the reload destroys the context
  await expect
    .poll(() => page.evaluate(() => (window as Marked).alive).catch(() => undefined)) // mid-reload
    .toBeUndefined();
});

test('clicking a Markdown draft path in the terminal opens it in the notes panel', async ({ page }) => {
  const path = '/tmp/claude-1000/-home-chris-proj/61590bf5/scratchpad/1968-description.md';
  const { errors, calls } = await mockApi(page, {
    '/api/markdown-link': { file: path, url: null },
    '/api/note-file': { text: '# Ticket 1968\n', rev: 'r1' },
  });
  await page.routeWebSocket('**/api/terminals/**', (ws) => ws.send(`Draft is ready:\r\n${path}\r\n`));
  await page.goto('/#/p/ai-portal/s1');
  const screen = page.locator('.xterm-screen');
  await expect(screen).toBeVisible();
  const box = (await screen.boundingBox())!;
  // The path is on the second row; sweep down the rows until xterm marks a link under the pointer, then click.
  let y = box.y;
  await expect(async () => {
    y += 6;
    await page.mouse.move(box.x + 60, y);
    await expect(page.locator('.xterm-cursor-pointer')).toHaveCount(1, { timeout: 150 });
  }).toPass({ timeout: 10_000, intervals: [50] });
  await page.mouse.click(box.x + 60, y);
  await expect(page.getByRole('textbox', { name: 'Markdown draft' })).toHaveValue('# Ticket 1968\n');
  expect(errors).toEqual([]);
});

test('the overview and shortcuts have buttons for what the keys do', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/overview');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next needing you' }).click();
  await page.getByRole('button', { name: 'Shortcuts (Alt ?)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shortcuts' });
  await expect(dialog.getByRole('heading', { name: 'Navigation' })).toBeVisible();
  await expect(dialog.getByText('On macOS, Alt is the Option key.')).toBeVisible();
  expect(errors).toEqual([]);
});
test('overview: a long question in a pane header stays on one line, icon and text aligned', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const summary = 'AskUserQuestion: #30 Kennzahlen "Köpfe" und "Verfügbarkeit" mit einer sehr langen Frage dahinter';
  const asking = { ...session, status: 'needs-you', pendingPermission: { tool: 'AskUserQuestion', summary } };
  const { errors } = await mockApi(page, { '/api/sessions': [asking] });
  await page.goto('/#/overview');
  const ask = page.locator('button.ask').first();
  await expect(ask).toBeVisible();
  const [icon, text, box] = await Promise.all([
    ask.locator('svg').boundingBox(),
    ask.locator('span').boundingBox(),
    ask.boundingBox(),
  ]);
  const mid = (b: { y: number; height: number } | null) => b!.y + b!.height / 2;
  expect(Math.abs(mid(icon) - mid(text))).toBeLessThan(2);
  expect(box!.height).toBeLessThan(30);
  expect(errors).toEqual([]);
});

test('server down: the banner says so with the last good time, and Retry now brings the data back', async ({
  page,
}) => {
  await mockApi(page, { '/api/sessions': [session] });
  await page.goto('/#/p/ai-portal/s1');
  await expect(page.getByText('MR 2136 review').first()).toBeVisible();
  const banner = page.getByRole('alert').filter({ hasText: 'does not answer' });
  await expect(banner).toHaveCount(0);

  const down = (r: Route) => r.abort();
  await page.route('**/api/**', down);
  await page.evaluate(() => dispatchEvent(new Event('online'))); // the events socket reconnects and reloads everything
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('It may be off.');
  await expect(banner).toContainText(/Showing data from \d/);

  await page.unroute('**/api/**', down);
  await banner.getByRole('button', { name: 'Retry now' }).click();
  await expect(banner).toHaveCount(0);
});

test('a 401 says you are signed out before the login form', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/config', (r) => r.fulfill({ status: 401, json: { error: 'login required' } }), { times: 1 });
  await page.goto('/#/');
  await expect(page.getByRole('alert').filter({ hasText: 'Signed out. Sign in again.' })).toBeVisible();
  await expect(page.getByLabel('Access token')).toBeVisible();
});

test('a failing call that is not a network error shows a toast instead of only logging', async ({ page }) => {
  await mockApi(page, { '/api/usage': { status: 500, json: { error: 'usage store is broken' } } });
  await page.goto('/#/');
  await expect(page.getByRole('alert').filter({ hasText: 'usage store is broken' })).toBeVisible();
});

test('a failing call toasts once, however often the data reloads', async ({ page }) => {
  await mockApi(page, { '/api/usage': { status: 500, json: { error: 'usage store is broken' } } });
  await page.goto('/#/');
  const toast = page.getByRole('alert').filter({ hasText: 'usage store is broken' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await page.evaluate(() => dispatchEvent(new Event('online'))); // reconnect reloads everything
  await page.waitForTimeout(500);
  await expect(toast).toHaveCount(0);
});

test('a version mismatch says which side is older, politely', async ({ page }) => {
  await mockApi(page, { '/api/health': { ok: true, version: '2026.10.0', apiVersion: 0, machine: 'laptop' } });
  await page.goto('/#/');
  const banner = page.getByRole('status').filter({ hasText: 'runs an older shub' });
  await expect(banner).toBeVisible();
});

test('settings say "Saved" after a save and a failed save speaks plainly', async ({ page }) => {
  const { errors } = await mockApi(page, { 'PATCH /api/settings': config });
  await page.goto('/#/settings/sessions');
  const status = page.getByTestId('save-status');
  await expect(status).toHaveText('Changes save automatically');
  await page.getByRole('button', { name: /Accept edits/ }).click();
  await expect(status).toHaveText('Saved');
  await mockApi(page, { 'PATCH /api/settings': { status: 502, json: {} } });
  await page.getByRole('button', { name: /Plan/ }).click();
  await expect(page.getByText("Can't reach shub. Is it running?")).toBeVisible();
  expect(errors.filter((e) => !/502/.test(e))).toEqual([]);
});

test('a project change that cannot be saved says which field needs a value', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/settings/project/ai-portal');
  await expect(page.getByLabel('Name')).toHaveValue('ai-portal');
  await page.getByLabel('Name').fill('');
  await expect(page.getByTestId('save-status')).toHaveText('Not saved: Name needs a value');
  await page.getByLabel('Name').fill('ai-portal-2');
  await expect(page.getByTestId('save-status')).not.toContainText('Not saved');
});

test('a prompt-skipping default and the trust switch ask first', async ({ page }) => {
  const { errors, calls } = await mockApi(page, { 'PATCH /api/settings': config });
  await page.goto('/#/settings/sessions');
  const writes = () => calls.filter((c) => c.method === 'PATCH' && c.path === '/api/settings').map((c) => c.body);

  // Tapping the mode that is already the default does nothing.
  await page.getByRole('button', { name: /^Ask first/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(writes()).toEqual([]);

  await page.getByRole('button', { name: /^Bypass/ }).click();
  const ask = page.getByRole('dialog', { name: 'Make Bypass the default?' });
  await expect(ask).toContainText(
    'Every new session can edit files and run commands without asking. Use only in sandboxes.',
  );
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(writes()).toEqual([]);

  await page.getByRole('button', { name: /^Bypass/ }).click();
  await ask.getByRole('button', { name: 'Make default' }).click();
  await expect.poll(writes).toEqual([{ defaultPermissionMode: 'bypassPermissions' }]);

  // A safe mode needs no question.
  await page.getByRole('button', { name: /^Plan/ }).click();
  await expect.poll(writes).toHaveLength(2);

  const trust = page.getByRole('checkbox', { name: 'Skip the approval' });
  await expect(page.getByText('Sessions may act without asking')).toBeVisible();
  await trust.click({ force: true });
  const trustAsk = page.getByRole('dialog', { name: 'Let sessions act without your approval?' });
  await expect(trustAsk).toBeVisible();
  await expect(trust).not.toBeChecked();
  await trustAsk.getByRole('button', { name: 'Cancel' }).click();
  expect(writes()).toHaveLength(2);
  await expect(trustAsk).toBeHidden();
  await trust.click({ force: true });
  await trustAsk.getByRole('button', { name: 'Turn on' }).click();
  await expect.poll(() => writes().length).toBe(3);
  expect(writes()[2]).toEqual({ trustSessions: true });
  expect(errors).toEqual([]);
});

test('closing an idle Claude session is at once, with an undo toast that resumes it', async ({ page }) => {
  const idle: Session = { ...session, status: 'your-turn', claudeSessionId: 'c-1' };
  const { errors, calls } = await mockApi(page, {
    '/api/sessions': [idle],
    'POST /api/sessions': { status: 200, json: { ...idle, id: 's9' } },
  });
  await page.goto('/#/p/ai-portal/s1');
  await page.getByRole('button', { name: 'Close MR 2136 review' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/sessions/s1']);

  const undo = page.locator('.toast').filter({ hasText: 'Closed MR 2136 review' });
  await expect(undo).toContainText('resume the conversation');
  await undo.getByRole('button', { name: 'Resume' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/sessions')?.body)
    .toMatchObject({ projectId: 'ai-portal', kind: 'claude', resumeClaudeSessionId: 'c-1' });
  expect(errors).toEqual([]);
});

test('the overview explains itself once, and the dismissal sticks', async ({ page }) => {
  const { errors } = await mockApi(page);
  await page.goto('/#/overview');
  const intro = page.getByRole('note').filter({ hasText: 'All running sessions as live terminals, normally up to 6' });
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Dismiss' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(intro).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a narrow window says why the overview shows the phone view', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/#/overview');
  await expect(page.getByText('The overview needs a wider window, so this is the phone view.')).toBeVisible();
});
