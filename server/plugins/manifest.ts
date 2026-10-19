// Strict validation of shub-plugin.json and of what plugins push for their sidebar sections.
// Shared by the server and `shub plugin add`; everything here comes from untrusted plugin code.
import type { PluginManifest, Right, SidebarSectionContent } from '../../shared/api.ts';
import { isRight } from '../permissions/rules.ts';

export const MANIFEST_FILE = 'shub-plugin.json';
export const NAME_RE = /^[a-z0-9-]+$/;
const ID_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
export const MAX_ENTRIES = 50;
export const MAX_STRING = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function onlyKeys(o: Obj, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(o)) if (!allowed.includes(key)) errors.push(`${where}: unknown key "${key}"`);
}

function contributionList<K extends 'title' | 'label'>(value: unknown, textKey: K, where: string, errors: string[]) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return void errors.push(`${where} must be an array`);
  const seen = new Set<string>();
  return value.map((item, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(item)) {
      errors.push(`${at} must be an object`);
      return { id: '' } as { id: string } & Record<K, string>; // never returned: errors make the caller throw
    }
    onlyKeys(item, ['id', textKey], at, errors);
    if (!isStr(item.id) || !ID_RE.test(item.id)) errors.push(`${at}.id must match ${ID_RE}`);
    else if (seen.has(item.id)) errors.push(`${at}.id "${item.id}" is duplicated`);
    else seen.add(item.id);
    const text = item[textKey];
    if (!isStr(text) || !text.trim() || text.length > MAX_STRING)
      errors.push(`${at}.${textKey} must be 1-${MAX_STRING} chars`);
    return { id: item.id, [textKey]: text } as { id: string } & Record<K, string>;
  });
}

/** Returns the manifest or throws an Error listing every problem. */
export function validateManifest(value: unknown): PluginManifest {
  const errors: string[] = [];
  if (!isObj(value)) throw new Error('manifest must be a JSON object');
  onlyKeys(value, ['name', 'version', 'description', 'start', 'rights', 'contributes'], 'manifest', errors);
  const { name, version, description, start, rights, contributes } = value;
  if (!isStr(name) || !NAME_RE.test(name) || name.length > 64) errors.push(`name must match ${NAME_RE} (max 64)`);
  if (!isStr(version) || !version.trim() || version.length > 64) errors.push('version must be a non-empty string');
  if (description !== undefined && (!isStr(description) || description.length > 500)) {
    errors.push('description must be a string of at most 500 chars');
  }
  if (!Array.isArray(start) || start.length === 0 || !start.every((s) => isStr(s) && s.length > 0)) {
    errors.push('start must be a non-empty array of non-empty strings');
  }
  if (!Array.isArray(rights) || !rights.every(isRight)) errors.push('rights must be an array of known rights');
  else if (new Set(rights).size !== rights.length) errors.push('rights contain duplicates');

  let contributions: PluginManifest['contributes'];
  if (contributes !== undefined) {
    if (!isObj(contributes)) errors.push('contributes must be an object');
    else {
      onlyKeys(contributes, ['sidebarSections', 'sessionMenuActions', 'settingsActions'], 'contributes', errors);
      contributions = {
        sidebarSections: contributionList(contributes.sidebarSections, 'title', 'sidebarSections', errors),
        sessionMenuActions: contributionList(contributes.sessionMenuActions, 'label', 'sessionMenuActions', errors),
        settingsActions: contributionList(contributes.settingsActions, 'label', 'settingsActions', errors),
      };
    }
  }
  if (errors.length) throw new Error(`invalid ${MANIFEST_FILE}:\n- ${errors.join('\n- ')}`);
  return {
    name: name as string,
    version: version as string,
    ...(description !== undefined && { description: description as string }),
    start: start as string[],
    rights: rights as Right[],
    ...(contributions && { contributes: contributions }),
  };
}

const BADGE_TONES = ['needs-you', 'working', 'neutral'];
const ENTRY_TONES = ['needs-you', 'working', 'done', 'neutral'];

class SectionError extends Error {}

const cap = (v: unknown, where: string, optional = false): string | undefined => {
  if (v === undefined && optional) return undefined;
  if (!isStr(v)) throw new SectionError(`${where} must be a string`);
  return v.slice(0, MAX_STRING);
};

function httpUrl(v: unknown, where: string): string | undefined {
  if (v === undefined) return undefined;
  if (!isStr(v) || v.length > 2000) throw new SectionError(`${where} must be a URL`);
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new SectionError(`${where} must be an absolute URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SectionError(`${where} must be http or https`);
  return url.href;
}

function tone<T extends string>(v: unknown, allowed: string[], where: string): T | undefined {
  if (v === undefined) return undefined;
  if (!isStr(v) || !allowed.includes(v)) throw new SectionError(`${where} must be one of ${allowed.join(', ')}`);
  return v as T;
}

/** Validates a SidebarSectionContent; caps entries and string lengths. Throws SectionError. */
export function sanitizeSection(value: unknown): SidebarSectionContent {
  if (!isObj(value)) throw new SectionError('body must be an object');
  if (!Array.isArray(value.entries)) throw new SectionError('entries must be an array');
  let badge: SidebarSectionContent['badge'] = null;
  if (value.badge !== undefined && value.badge !== null) {
    if (!isObj(value.badge)) throw new SectionError('badge must be an object or null');
    badge = {
      text: cap(value.badge.text, 'badge.text')!,
      tone: tone(value.badge.tone, BADGE_TONES, 'badge.tone') ?? 'neutral',
    };
  }
  const entries = value.entries.slice(0, MAX_ENTRIES).map((e: unknown, i: number) => {
    const at = `entries[${i}]`;
    if (!isObj(e)) throw new SectionError(`${at} must be an object`);
    const entry: SidebarSectionContent['entries'][number] = {
      id: cap(e.id, `${at}.id`)!,
      title: cap(e.title, `${at}.title`)!,
    };
    const subtitle = cap(e.subtitle, `${at}.subtitle`, true);
    const t = tone<NonNullable<typeof entry.tone>>(e.tone, ENTRY_TONES, `${at}.tone`);
    const url = httpUrl(e.url, `${at}.url`);
    const action = cap(e.action, `${at}.action`, true);
    if (subtitle !== undefined) entry.subtitle = subtitle;
    if (t !== undefined) entry.tone = t;
    if (url !== undefined) entry.url = url;
    if (action !== undefined) entry.action = action;
    return entry;
  });
  return { badge, entries };
}

export { SectionError };
