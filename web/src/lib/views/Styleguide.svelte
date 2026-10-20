<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import BottomPanel from '../components/BottomPanel/BottomPanel.svelte';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../components/ChoiceButton/ChoiceButton.svelte';
  import Drawer from '../components/Drawer/Drawer.svelte';
  import Section from '../components/Section/Section.svelte';
  import SelectField from '../components/SelectField/SelectField.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import EmptyState from '../components/EmptyState/EmptyState.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import { ICONS, type IconName } from '../components/Icon/icons.ts';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import Kbd from '../components/Kbd/Kbd.svelte';
  import Menu from '../components/Menu/Menu.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import ProjectRow from '../components/ProjectRow/ProjectRow.svelte';
  import ServicesTree from '../components/ServicesTree/ServicesTree.svelte';
  import SessionRow from '../components/SessionRow/SessionRow.svelte';
  import SessionTab from '../components/SessionTab/SessionTab.svelte';
  import Sidebar from '../components/Sidebar/Sidebar.svelte';
  import SidebarSection from '../components/SidebarSection/SidebarSection.svelte';
  import SplitView from '../components/SplitView/SplitView.svelte';
  import StatusBadge from '../components/StatusBadge/StatusBadge.svelte';
  import StatusDot from '../components/StatusDot/StatusDot.svelte';
  import TabBar from '../components/TabBar/TabBar.svelte';
  import TerminalView from '../components/TerminalView/TerminalView.svelte';
  import Toast from '../components/Toast/Toast.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { app } from '../stores/state.svelte.ts';
  import { applyTheme, BUILT_IN_THEMES, PROJECT_COLORS, TOKEN_NAMES } from '../tokens/tokens.ts';
  import { CONTAINERS, LOG, PROJECTS, SESSIONS } from './fixtures.ts';

  const STATUSES = ['new', 'needs-you', 'working', 'your-turn', 'waiting', 'paused', 'starting', 'exited'] as const;
  const version = __APP_VERSION__;

  let themeId = $state(document.documentElement.dataset.theme ?? 'monokai');
  let dialogOpen = $state(false);
  let drawerOpen = $state(false);
  let approvalOpen = $state(false);
  let text = $state('ai-portal');
  let select = $state('text');
  let checked = $state(true);
  let choice = $state('pinned');
  let renaming = $state(false);
  let panelTab = $state('services');
  let liveId = $state('');
  let liveOn = $state(false);
  let lastAction = $state('');

  onMount(() => {
    document.title = 'Styleguide · shub';
  });

  $effect(() => {
    applyTheme(BUILT_IN_THEMES.find((t) => t.id === themeId) ?? BUILT_IN_THEMES[0]);
    untrack(() => app.themeVersion++);
  });

  const sections = [
    'Brand',
    'Tokens',
    'Icons',
    'Buttons',
    'Status',
    'Projects',
    'Sidebar',
    'Tabs',
    'Menu and dialog',
    'Forms',
    'Drawer',
    'Toast',
    'Empty state',
    'Split view',
    'Bottom panel',
    'Terminal',
  ];
  const slug = (s: string) => s.toLowerCase().replaceAll(' ', '-');
</script>

<div class="page">
  <header class="top">
    <Wordmark size="md" />
    <span class="grow">Styleguide</span>
    <label class="theme">
      Theme
      <select bind:value={themeId}>
        {#each BUILT_IN_THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </select>
    </label>
    <a href="#/">Back to the app</a>
  </header>
  <nav class="toc" aria-label="Sections">
    {#each sections as s (s)}<a
        href="#/styleguide"
        onclick={(e) => (e.preventDefault(), document.getElementById(slug(s))?.scrollIntoView())}>{s}</a
      >{/each}
  </nav>

  <main class="content">
    <section id="brand" aria-labelledby="h-brand">
      <h2 id="h-brand">Brand</h2>
      <div class="row wrap end">
        <Wordmark size="xl" tagline />
        <Wordmark size="lg" />
        <Wordmark size="md" />
        <Wordmark size="sm" />
      </div>
      <p class="note">shub — your session hub. All your Claude Code sessions in one window. Version {version}.</p>
      <div class="row wrap">
        <span class="card">Project accent <Wordmark accent={PROJECTS[3].accent} /></span>
        <span class="card">Purple project <Wordmark accent={PROJECTS[2].accent} /></span>
        <span class="card">Needs you (blinks) <Wordmark needsYou /></span>
      </div>
    </section>

    <section id="tokens" aria-labelledby="h-tokens">
      <h2 id="h-tokens">Tokens</h2>
      <div class="swatches">
        {#each TOKEN_NAMES as name (name)}
          <div class="swatch">
            <span class="chip" style:background="var(--{name})"></span>
            <code>--{name}</code>
          </div>
        {/each}
      </div>
      <p class="type-ui">IBM Plex Sans · interface text</p>
      <p class="type-mono">JetBrains Mono · wordmark, terminal</p>
    </section>

    <section id="icons" aria-labelledby="h-icons">
      <h2 id="h-icons">Icons</h2>
      <div class="row wrap">
        {#each Object.keys(ICONS) as name (name)}
          <span class="icon-cell" title={name}><Icon name={name as IconName} /><code>{name}</code></span>
        {/each}
      </div>
    </section>

    <section id="buttons" aria-labelledby="h-buttons">
      <h2 id="h-buttons">Buttons</h2>
      <div class="row wrap">
        <Button variant="primary">New session</Button>
        <Button>Worktree start</Button>
        <Button variant="dashed">Run tests</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Close</Button>
        <Button icon="split">Split view</Button>
        <Button icon="split" pressed>Split view on</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
      </div>
      <div class="row wrap">
        <IconButton label="New project" icon="plus" size="md" variant="outline" />
        <IconButton label="Settings" icon="gear" variant="filled" />
        <IconButton label="Project settings" icon="gear" size="lg" variant="outline" />
        <IconButton label="Start" icon="play" tone="start" />
        <IconButton label="Stop" icon="stop" tone="stop" />
        <IconButton label="Restart" icon="restart" />
        <IconButton label="Send logs to Claude" icon="message" tone="accent" />
        <IconButton label="Close" icon="close" size="xs" tone="muted" />
        <IconButton label="Pressed" icon="split" pressed />
        <IconButton label="Disabled" icon="play" disabled />
        <Kbd keys="Alt K" />
        <Kbd keys="Alt ?" />
      </div>
    </section>

    <section id="status" aria-labelledby="h-status">
      <h2 id="h-status">Status</h2>
      <div class="row wrap">
        {#each STATUSES as s (s)}<span class="card"><StatusDot status={s} /> {s}</span>{/each}
      </div>
      <div class="row wrap">
        <StatusBadge text="1 needs you" tone="needs-you" />
        <StatusBadge text="2 working" tone="working" />
        <StatusBadge text="done" tone="done" />
        <StatusBadge text="3" />
      </div>
      <p class="note">Orange is only for "needs you".</p>
    </section>

    <section id="projects" aria-labelledby="h-projects">
      <h2 id="h-projects">Projects</h2>
      <div class="row wrap">
        {#each PROJECTS as p (p.id)}
          <span class="card"
            ><ProjectIcon icon={p.resolvedIcon} name={p.name} size="sm" /><ProjectIcon
              icon={p.resolvedIcon}
              name={p.name}
            /><ProjectIcon icon={p.resolvedIcon} name={p.name} size="lg" />{p.resolvedIcon.kind}</span
          >
        {/each}
      </div>
    </section>

    <section id="sidebar" aria-labelledby="h-sidebar">
      <h2 id="h-sidebar">Sidebar</h2>
      <div class="sidebar-demo">
        <Sidebar>
          {#snippet header()}<Wordmark />{/snippet}
          <SidebarSection
            title="Board"
            badge={{ text: '2 need you', tone: 'needs-you' }}
            entries={[
              {
                id: '1',
                title: '#198 Clean up the dotfiles repo',
                subtitle: 'po-review',
                tone: 'needs-you',
                url: '#/styleguide',
              },
              { id: '2', title: '#195 card run', subtitle: '4 min', tone: 'working', action: 'open' },
              { id: '3', title: 'maintenance yamsa', subtitle: 'done 09:12', tone: 'done' },
            ]}
          />
          <SidebarSection title="Empty plugin" entries={[]} />
          <SidebarSection title="Work">
            <ProjectRow
              project={PROJECTS[0]}
              sessions={SESSIONS.slice(0, 3)}
              href="#/styleguide"
              settingsHref="#/styleguide"
              selected
            >
              {#each SESSIONS as s, i (s.id)}<SessionRow
                  session={s}
                  href="#/styleguide"
                  selected={i === 1}
                  closing={i === SESSIONS.length - 1}
                  onmenu={() => {}}
                />{/each}
            </ProjectRow>
            <ProjectRow project={PROJECTS[1]} sessions={[]} href="#/styleguide" settingsHref="#/styleguide" />
            <ProjectRow
              project={PROJECTS[2]}
              sessions={SESSIONS.slice(1, 2)}
              href="#/styleguide"
              settingsHref="#/styleguide"
            />
          </SidebarSection>
          {#snippet footer()}<span class="note">Footer: dormant hint, user chip</span>{/snippet}
        </Sidebar>
      </div>
    </section>

    <section id="tabs" aria-labelledby="h-tabs">
      <h2 id="h-tabs">Tabs</h2>
      <TabBar label="Sessions demo">
        <SessionTab session={SESSIONS[0]} selected onhide={() => {}} onmenu={() => {}} />
        <SessionTab session={SESSIONS[1]} onhide={() => {}} onmenu={() => {}} />
        <SessionTab session={SESSIONS[2]} bind:renaming onhide={() => {}} />
        <SessionTab session={{ ...SESSIONS[1], permissionMode: 'auto' }} onhide={() => {}} />
        <SessionTab session={SESSIONS[1]} closing onhide={() => {}} />
        {#snippet trailing()}<IconButton label="New session" icon="plus" size="md" tone="muted" />{/snippet}
      </TabBar>
      <div class="row"><Button size="sm" onclick={() => (renaming = true)}>Rename the third tab</Button></div>
    </section>

    <section id="forms" aria-labelledby="h-forms">
      <h2 id="h-forms">Forms</h2>
      <div class="row wrap end">
        <TextField label="Name" bind:value={text} />
        <TextField label="Folder" value="~/PycharmProjects/work/ai-portal" mono hint="Sessions start here." />
        <TextField label="Access token" value="" type="password" error="Wrong token" />
        <TextField label="Disabled" value="read only" disabled />
      </div>
      <div class="row wrap end">
        <TextField label="Prompt" value={'Review {input}'} rows={3} />
        <SelectField
          label="Asks for"
          bind:value={select}
          options={[
            { value: 'nothing', label: 'Nothing' },
            { value: 'text', label: 'Text' },
          ]}
          hint="What the button asks before it starts."
        />
        <SelectField
          label="In a table"
          hideLabel
          size="sm"
          value="default"
          options={[{ value: 'default', label: 'Default' }]}
        />
      </div>
      <div class="row wrap">
        <Checkbox label="Remember this device for 30 days" bind:checked />
        <Checkbox label="Unchecked" checked={false} />
        <Checkbox label="Phone push" hint="When a session needs me" checked />
        <Checkbox label="Disabled" checked disabled />
      </div>
      <div class="row wrap" role="group" aria-label="Choices">
        <ChoiceButton pressed={choice === 'pinned'} onclick={() => (choice = 'pinned')}>Pinned in sidebar</ChoiceButton>
        <ChoiceButton pressed={choice === 'dormant'} onclick={() => (choice = 'dormant')}
          >Dormant (search only)</ChoiceButton
        >
        <ChoiceButton shape="card" pressed>Monokai</ChoiceButton>
        <ChoiceButton shape="card" pressed={false}>Dracula</ChoiceButton>
        <ChoiceButton shape="square" aria-label="Home symbol" pressed><Icon name="home" /></ChoiceButton>
        <ChoiceButton shape="square" aria-label="Book symbol" pressed={false}><Icon name="book" /></ChoiceButton>
        {#each PROJECT_COLORS as c, i (c.value)}
          <ChoiceButton shape="swatch" swatch={c.value} aria-label={c.name} pressed={i === 0} />
        {/each}
      </div>
      <Section title="Section title" description="One muted line under the title.">
        {#snippet aside()}<code>shub plugin add &lt;git-url&gt;</code>{/snippet}
        <p class="note">Section content.</p>
      </Section>
    </section>

    <section id="drawer" aria-labelledby="h-drawer">
      <h2 id="h-drawer">Drawer</h2>
      <div class="row"><Button onclick={() => (drawerOpen = true)}>Open drawer</Button></div>
      <Drawer
        open={drawerOpen}
        title="Global Claude"
        subtitle="Not tied to a project"
        closeLabel="Close drawer"
        onclose={() => (drawerOpen = false)}
      >
        {#snippet actions()}<Button size="sm">New chat</Button>{/snippet}
        <EmptyState title="Drawer body" body="Fills the height." />
        {#snippet footer()}A muted note at the bottom.{/snippet}
      </Drawer>
    </section>

    <section id="menu-and-dialog" aria-labelledby="h-menu">
      <h2 id="h-menu">Menu and dialog</h2>
      <div class="row wrap start">
        <Menu
          label="Session menu demo"
          items={[
            { id: 'rename', label: 'Rename' },
            { id: 'link', label: 'Link to card…', hint: '#202' },
            { id: 'pause', label: 'Pause session' },
            {
              id: 'wt',
              label: 'Worktree close…',
              danger: true,
              separator: true,
              description: 'Stops its containers and removes the worktree; asks first.',
            },
            { id: 'off', label: 'Disabled', disabled: true },
            { id: 'close', label: 'Close session' },
          ]}
          onselect={(id) => (lastAction = id)}
          onclose={() => {}}
        />
        <div class="col">
          <Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
          {#if lastAction}<span class="note">Picked: {lastAction}</span>{/if}
        </div>
      </div>
      <Dialog
        open={dialogOpen}
        title="Close BLM-412 export?"
        description="It is still working."
        onclose={() => (dialogOpen = false)}
      >
        {#snippet actions()}
          <Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
          <Button variant="danger" onclick={() => (dialogOpen = false)}>Close</Button>
        {/snippet}
      </Dialog>
      <Button onclick={() => (approvalOpen = true)}>Approval dialog</Button>
      <Dialog
        open={approvalOpen}
        tone="needs-you"
        title="A session wants to start a new session"
        description="Free-form prompt, so shub asks you first"
        onclose={() => (approvalOpen = false)}
      >
        {#snippet actions()}
          <Button variant="danger" onclick={() => (approvalOpen = false)}>Reject</Button>
          <Button onclick={() => (approvalOpen = false)}>Start</Button>
        {/snippet}
      </Dialog>
    </section>

    <section id="toast" aria-labelledby="h-toast">
      <h2 id="h-toast">Toast</h2>
      <Toast
        fixed={false}
        items={[
          { id: 1, message: 'Logs of worker sent to MR 2136 review', tone: 'neutral' },
          { id: 2, message: 'Could not reach the server', tone: 'error' },
          { id: 3, message: 'MR 2136 review needs you', tone: 'needs-you' },
        ]}
        ondismiss={() => {}}
      />
    </section>

    <section id="empty-state" aria-labelledby="h-empty">
      <h2 id="h-empty">Empty state</h2>
      <div class="box">
        <EmptyState title="No session yet" body="Start one here or with Alt N.">
          <Button variant="primary">New session</Button>
        </EmptyState>
      </div>
    </section>

    <section id="split-view" aria-labelledby="h-split">
      <h2 id="h-split">Split view</h2>
      <div class="box tall">
        <SplitView sessions={SESSIONS.slice(0, 3)} selectedId="s2">
          {#snippet pane(s)}<pre class="fake">{s.name}: terminal here</pre>{/snippet}
        </SplitView>
      </div>
    </section>

    <section id="bottom-panel" aria-labelledby="h-bottom">
      <h2 id="h-bottom">Bottom panel</h2>
      <div class="box tall">
        <BottomPanel
          tabs={[
            { id: 'services', label: 'Services' },
            { id: 't1', label: 'Terminal 1' },
          ]}
          active={panelTab}
          onselect={(id) => (panelTab = id)}
          onnew={() => {}}
          onhide={() => {}}
          context="ai-portal-mr-2136"
        >
          {#if panelTab === 'services'}
            <ServicesTree
              containers={CONTAINERS}
              host="localhost"
              onaction={(a, c) => (lastAction = `${a} ${c.name}`)}
              loadLogs={async () => LOG}
              loadInspect={async (id) => ({ Id: id, Config: { Env: ['DJANGO_DEBUG=1', 'EXPORT_BUCKET='] } })}
            />
          {:else}
            <pre class="fake">Plain terminal here</pre>
          {/if}
        </BottomPanel>
      </div>
      <div class="box">
        <ServicesTree containers={[]} onaction={() => {}} loadLogs={async () => ''} loadInspect={async () => ({})} />
      </div>
    </section>

    <section id="terminal" aria-labelledby="h-terminal">
      <h2 id="h-terminal">Terminal</h2>
      <p class="note">TerminalView needs a live session. Enter a session id to attach.</p>
      <form
        class="row"
        onsubmit={(e) => {
          e.preventDefault();
          liveOn = !!liveId;
        }}
      >
        <label class="theme">Session id <input bind:value={liveId} /></label>
        <Button type="submit" size="sm">Attach</Button>
      </form>
      {#if liveOn}
        <div class="box tall">
          {#key liveId}<TerminalView sessionId={liveId} accent={PROJECTS[2].accent} />{/key}
        </div>
      {/if}
    </section>
  </main>
</div>

<style>
  .page {
    min-height: 100%;
    background: var(--bg);
    color: var(--fg);
  }

  .top {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    border-bottom: var(--hairline) solid var(--line);
    background: var(--panel);
  }

  .grow {
    flex: 1 1 auto;
    color: var(--muted);
  }

  .theme {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-2);
  }

  select,
  input {
    height: var(--size-control-sm);
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }

  .toc {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-5) var(--space-12);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h2 {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .wrap {
    flex-wrap: wrap;
  }

  .end {
    align-items: flex-end;
  }

  .start {
    align-items: flex-start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .card {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--panel);
    color: var(--fg-2);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--size-menu) * 0.6), 1fr));
    gap: var(--space-2);
  }

  .swatch {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .swatch .chip {
    width: var(--size-control);
    height: var(--size-control);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-sm);
  }

  .type-ui {
    margin: 0;
    font-size: var(--text-xl);
  }

  .type-mono {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: var(--weight-black);
  }

  .icon-cell {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: calc(var(--size-control-lg) * 2);
    color: var(--fg-2);
    font-size: var(--text-2xs);
  }

  .sidebar-demo {
    display: flex;
    height: calc(var(--size-panel) * 1.8);
  }

  .box {
    display: flex;
    min-height: calc(var(--size-panel) * 0.6);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .tall {
    height: var(--size-panel);
  }

  .fake {
    margin: 0;
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--fg-2);
  }
</style>
