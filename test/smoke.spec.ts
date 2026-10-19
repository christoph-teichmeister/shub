import { expect, test, type Page } from '@playwright/test';
import type { ProjectView, Session } from '../shared/api.ts';

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

const API: Record<string, unknown> = {
  '/api/config': {
    version: 1,
    groups: ['Work'],
    projects: [project],
    themes: [],
    activeTheme: 'monokai',
    notifications: {},
    plugins: [],
  },
  '/api/projects': [project],
  '/api/sessions': [session],
  '/api/approvals': [],
  '/api/plugins': [],
  '/api/auth/me': { name: 'Chris' },
  '/api/sessions/s1/services': [],
};

async function mockApi(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await page.route('**/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path in API) return r.fulfill({ json: API[path] });
    return r.fulfill({ status: 404, json: { error: `no mock for ${path}` } });
  });
  await page.routeWebSocket('**/api/events', (ws) => ws.send(JSON.stringify({ type: 'hello', apiVersion: 1 })));
  await page.routeWebSocket('**/api/terminals/**', (ws) => ws.send('\u001b[32m●\u001b[0m mocked terminal\r\n'));
  return errors;
}

test('app shell, wordmark and projects render', async ({ page }) => {
  const errors = await mockApi(page);
  await page.goto('/#/');
  const nav = page.getByRole('navigation', { name: 'Projects' });
  await expect(nav).toBeVisible();
  await expect(nav.getByLabel('shub, a session needs you')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'ai-portal' })).toBeVisible();
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

test('styleguide renders every section', async ({ page }) => {
  const errors = await mockApi(page);
  await page.goto('/#/styleguide');
  for (const name of ['Brand', 'Tokens', 'Buttons', 'Status', 'Sidebar', 'Tabs', 'Bottom panel'])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Theme').selectOption('dracula');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
  expect(errors).toEqual([]);
});
