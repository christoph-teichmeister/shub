// Names shub gives sessions on its own: a prompt's first words, the model's title a moment later, an MR/PR's title.
import { autoName } from './launch.ts';
import { findMr, mrName, type MrLookup } from './mr.ts';
import type { SessionsService } from './service.ts';
import type { Titler } from './title.ts';

type Named = Pick<SessionsService, 'get' | 'rename' | 'addLink'>;

export class AutoNamer {
  #sessions: Named;
  #titler: Titler;
  #mrLookup: MrLookup;
  /** The last name shub itself gave each session; any other name (button, user, skill) is never overwritten.
   *  ponytail: in memory, so after a shub restart only "Session N" names follow an MR link. */
  #autoNames = new Map<string, string>();

  constructor(sessions: Named, titler: Titler, mrLookup: MrLookup) {
    this.#sessions = sessions;
    this.#titler = titler;
    this.#mrLookup = mrLookup;
  }

  nameFromPrompt(id: string, prompt: string): void {
    const quick = autoName({ prompt, n: 0 });
    this.#sessions.rename(id, quick, 'shub');
    this.retitle(id, prompt, quick);
  }

  /** The quick name stays until the model's title arrives, and stays for good if the user renamed meanwhile. */
  retitle(id: string, prompt: string, quick: string): void {
    this.#autoNames.set(id, quick);
    void this.#titler(prompt).then((title) => {
      if (title && this.#autoNamed(id) && this.#sessions.get(id)?.name === quick) this.#autoRename(id, title);
    });
  }

  nameFromMr(id: string, prompt: string): void {
    const ref = findMr(prompt);
    const session = this.#sessions.get(id);
    if (!ref || !session || session.links.some((l) => l.url === ref.url)) return;
    this.#sessions.addLink(id, { source: 'shub', url: ref.url, label: ref.label });
    if (!this.#autoNamed(id)) return;
    void this.#mrLookup(ref).then((mr) => {
      if (mr && this.#autoNamed(id)) this.#autoRename(id, mrName(ref, mr));
    });
  }

  #autoNamed(id: string): boolean {
    const name = this.#sessions.get(id)?.name;
    return !!name && (/^Session \d+$/.test(name) || this.#autoNames.get(id) === name);
  }

  #autoRename(id: string, name: string): void {
    this.#sessions.rename(id, name, 'shub');
    this.#autoNames.set(id, this.#sessions.get(id)!.name);
  }
}
