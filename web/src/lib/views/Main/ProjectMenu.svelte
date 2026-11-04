<script lang="ts">
  // A sidebar project's right-click menu: new session or terminal, settings, pin or dormant, remove.
  import type { ProjectView } from '../../../../../shared/api.ts';
  import Menu, { type MenuItem } from '../../components/Menu/Menu.svelte';
  import { api } from '../../stores/api.ts';
  import { go } from '../../stores/router.svelte.ts';
  import { loadProjects } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';
  import type { Confirm } from './ConfirmDialog.svelte';

  interface Props {
    menu: { project: ProjectView; x: number; y: number } | null;
    /** The open project: removing it goes back home. */
    current: ProjectView | null;
    onnewsession: (p: ProjectView) => void;
    onnewterminal: (p: ProjectView) => void;
    onconfirm: (confirm: Confirm) => void;
  }
  let { menu = $bindable(), current, onnewsession, onnewterminal, onconfirm }: Props = $props();

  function projectMenuItems(p: ProjectView): MenuItem[] {
    return [
      { id: 'new', label: 'New session' },
      { id: 'terminal', label: 'New terminal' },
      { id: 'settings', label: 'Project settings' },
      { id: 'visibility', label: p.visibility === 'pinned' ? 'Make dormant (search only)' : 'Pin to sidebar' },
      {
        id: 'remove',
        label: 'Remove from hub',
        separator: true,
        danger: true,
        description: 'The folder and its sessions stay.',
      },
    ];
  }

  async function onProjectMenu(p: ProjectView, id: string) {
    if (id === 'new') onnewsession(p);
    else if (id === 'terminal') onnewterminal(p);
    else if (id === 'settings') go('settings', 'project', p.id);
    else if (id === 'visibility') {
      const visibility = p.visibility === 'pinned' ? 'dormant' : 'pinned';
      await api('projectUpdate', { params: { id: p.id }, body: { visibility } }).catch(toastError);
      void loadProjects();
      toast(visibility === 'dormant' ? `${p.name} is dormant; find it with Alt K` : `${p.name} is pinned`);
    } else if (id === 'remove')
      onconfirm({
        title: `Remove ${p.name} from the hub?`,
        body: `Only the entry goes. The folder ${p.path} and its Claude history stay on disk.`,
        action: 'Remove',
        danger: true,
        run: async () => {
          await api('projectDelete', { params: { id: p.id } }).catch(toastError);
          await loadProjects();
          if (current?.id === p.id) go();
        },
      });
  }
</script>

{#if menu}
  {@const p = menu.project}
  <Menu
    label="Project menu for {p.name}"
    items={projectMenuItems(p)}
    x={menu.x}
    y={menu.y}
    onselect={(id) => onProjectMenu(p, id)}
    onclose={() => (menu = null)}
  />
{/if}
