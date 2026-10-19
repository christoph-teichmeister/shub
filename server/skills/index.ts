// Discovers Claude Code skills for a project: project, global and installed-plugin skills.
import { globSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { ROUTES, type SkillInfo } from '../../shared/api.ts';
import { HttpError, requireRight } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services, Skills } from '../services.ts';

/** Minimal YAML frontmatter: `key: value`, quoted values, and `>`/`|` or indented continuation lines. */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  let key = '';
  let block: '' | '>' | '|' = '';
  for (const line of m[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (field) {
      key = field[1];
      const value = field[2].trim();
      block = /^[>|][+-]?$/.test(value) ? (value[0] as '>' | '|') : '';
      out[key] = block ? '' : unquote(value);
    } else if (key && /^\s+\S/.test(line)) {
      const sepChar = block === '|' ? '\n' : ' ';
      out[key] = out[key] ? out[key] + sepChar + line.trim() : line.trim();
    }
  }
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    const inner = value.slice(1, -1);
    return value[0] === '"' ? inner.replace(/\\"/g, '"') : inner.replace(/''/g, "'");
  }
  return value;
}

function readSkill(file: string, scope: SkillInfo['scope'], prefix = ''): SkillInfo | null {
  try {
    const meta = parseFrontmatter(readFileSync(file, 'utf8'));
    const name = meta.name || basename(dirname(file));
    return { name: prefix + name, description: meta.description ?? '', scope, path: file };
  } catch {
    return null;
  }
}

function scan(dir: string, pattern: string): string[] {
  try {
    return globSync(pattern, { cwd: dir }).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Plugin cache layout: cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md. Newest version wins. */
function pluginSkills(cacheDir: string): SkillInfo[] {
  const newest = new Map<string, { skill: SkillInfo; mtime: number }>();
  for (const file of scan(cacheDir, '**/skills/*/SKILL.md')) {
    const plugin = relative(cacheDir, file).split(sep)[1];
    const skill = readSkill(file, 'plugin', plugin ? `${plugin}:` : '');
    if (!skill) continue;
    const mtime = statSync(file).mtimeMs;
    const seen = newest.get(skill.name);
    if (!seen || mtime > seen.mtime) newest.set(skill.name, { skill, mtime });
  }
  return [...newest.values()].map((v) => v.skill);
}

export function discoverSkills(projectPath: string, home = homedir()): SkillInfo[] {
  const found = [
    ...scan(join(projectPath, '.claude', 'skills'), '*/SKILL.md').map((f) => readSkill(f, 'project')),
    ...scan(join(home, '.claude', 'skills'), '*/SKILL.md').map((f) => readSkill(f, 'global')),
    ...pluginSkills(join(home, '.claude', 'plugins', 'cache')),
  ].filter((s): s is SkillInfo => s !== null);
  // A project skill shadows a global one of the same name, as in Claude Code.
  const seen = new Set<string>();
  return found.filter((s) => !seen.has(s.name) && seen.add(s.name));
}

export function create(_ctx: Context, services: Services): { module: ShubModule; service: Skills } {
  // ponytail: scans the disk on every call; add a cache with fs.watch if the skills route gets slow.
  const service: Skills = { forProject: (path) => discoverSkills(path) };
  return {
    module: {
      name: 'skills',
      routes: (router) =>
        router.add(ROUTES.skills, (req) => {
          requireRight(req.caller, 'read');
          const project = services.config.project(req.params.id);
          if (!project) throw new HttpError(404, 'no such project');
          return service.forProject(project.path);
        }),
    },
    service,
  };
}
