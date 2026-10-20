// Sample data for the styleguide.
import type { ProjectView, ServiceContainer, Session, SessionStatus } from '../../../../shared/api.ts';

const now = '2026-10-19T14:02:00Z';

export function session(id: string, name: string, status: SessionStatus, extra: Partial<Session> = {}): Session {
  return {
    id,
    kind: 'claude',
    projectId: 'ai-portal',
    name,
    cwd: '~/PycharmProjects/work/ai-portal',
    status,
    claudeSessionId: null,
    permissionMode: 'default',
    startedBy: 'chris',
    parentId: null,
    links: [],
    createdAt: now,
    lastActivityAt: now,
    ...extra,
  };
}

export const SESSIONS: Session[] = [
  session('s1', 'MR 2136 review', 'needs-you'),
  session('s2', 'BLM-412 export', 'working', {
    links: [{ source: 'plugin:kb-board', label: '#202', url: 'https://example.com/202' }],
  }),
  session('s3', 'Tailwind build fix', 'your-turn'),
  session('s4', 'Old spike', 'paused'),
  session('s5', 'Crashed run', 'exited'),
];

export function project(id: string, name: string, icon: ProjectView['resolvedIcon'], accent: string): ProjectView {
  return {
    id,
    name,
    path: `~/PycharmProjects/${id}`,
    group: 'Work',
    visibility: 'pinned',
    order: 0,
    icon: { kind: 'auto' },
    buttons: [],
    resolvedIcon: icon,
    accent,
  };
}

export const PROJECTS: ProjectView[] = [
  {
    ...project('ai-portal', 'ai-portal', { kind: 'gitlab', host: 'gitlab.example.com' }, '#f92672'),
    remoteUrl: 'https://gitlab.example.com/work/ai-portal',
  },
  {
    ...project('listo', 'listo', { kind: 'github', host: 'github.com' }, '#f92672'),
    remoteUrl: 'https://github.com/example/listo',
  },
  project('kb-app', 'kb-app', { kind: 'symbol', symbol: 'table', color: '#ae81ff' }, '#ae81ff'),
  project('dotfiles', 'dotfiles', { kind: 'symbol', symbol: 'home', color: '#e6db74' }, '#e6db74'),
  project('knowledge-base', 'knowledge-base', { kind: 'symbol', symbol: 'book', color: '#a6e22e' }, '#a6e22e'),
  project('scratch', 'scratch', { kind: 'none' }, '#f92672'),
];

const svc = (
  id: string,
  name: string,
  kind: ServiceContainer['kind'],
  state: ServiceContainer['state'],
  status: string,
  port?: number,
): ServiceContainer => ({
  id,
  name,
  project: 'ai-portal-mr-2136',
  workingDir: '~/PycharmProjects/work/ai-portal/.claude/worktrees/mr-2136',
  image: `${name}:latest`,
  kind,
  state,
  status,
  ports: port ? [{ host: port, container: port }] : [],
});

export const CONTAINERS: ServiceContainer[] = [
  svc('c1', 'backend', 'python', 'running', 'Up 41 minutes (healthy)', 8003),
  svc('c2', 'db', 'postgres', 'running', 'Up 41 minutes', 5435),
  svc('c3', 'rabbit', 'rabbitmq', 'running', 'Up 41 minutes', 5672),
  svc('c4', 'worker', 'celery', 'exited', 'Exited (1)'),
  svc('c5', 'cache', 'redis', 'restarting', 'Restarting', 6379),
];

export const LOG = `17:41:02 celery@worker v5.4.0 ready.
17:41:03 Connected to amqp://rabbit:5672//
17:44:19 ERROR Task reports.export failed
17:44:19 KeyError: 'EXPORT_BUCKET'
17:44:19 worker exited with code 1`;
