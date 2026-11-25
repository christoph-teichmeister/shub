// Which projects have their session rows folded. Shared so the Active group can sink folded projects below the open ones.
// Remembered per browser; storage can be missing or throw (private window), `stored` guards that.
import { store, stored } from '../stored.ts';

const key = (id: string) => `shub.collapsed.project.${id}`;
const state = $state<Record<string, boolean>>({});

export const isFolded = (id: string) => state[id] ?? stored(key(id)) === '1';

export function setFolded(id: string, folded: boolean) {
  state[id] = folded;
  store(key(id), folded ? '1' : null);
}
