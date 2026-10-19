# plugin-hello

Smallest useful shub plugin, Python 3 standard library only. It proves the plugin contract is
language-agnostic: a process, three environment variables and plain HTTP.

- Fills the sidebar section **Hello** with the number of running sessions (`GET /api/sessions`),
  refreshed on session events from `GET /api/events/stream` (Server-Sent Events).
- Offers the settings action **Say hello**; clicking it logs a line (see Settings > Plugins > Logs).

Rights requested: `read`, `ui.contribute`.

## Try it

```sh
shub plugin add https://github.com/<you>/shub-plugin-hello   # or copy this folder to ~/.config/shub/plugins/hello
shub plugin enable hello --grant read,ui.contribute
```

See [docs/PLUGINS.md](../../docs/PLUGINS.md) for the full contract.
