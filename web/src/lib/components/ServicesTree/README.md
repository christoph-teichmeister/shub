# ServicesTree

PyCharm-style Docker services: vertical toolbar (start, stop, restart, send logs to Claude), a compact tree grouped by compose project (state dot, service-type tile, name, first port as a link or the Docker status when down), and Log / Env / Ports / Inspect tabs for the selected container.

| Prop          | Type                          | Notes                                   |
| ------------- | ----------------------------- | --------------------------------------- |
| `containers`  | `ServiceContainer[]`          |                                         |
| `onaction`    | `(action, container) => void` | `start`, `stop`, `restart`, `send-logs` |
| `loadLogs`    | `(id) => Promise<string>`     | Log tab                                 |
| `loadInspect` | `(id) => Promise<unknown>`    | Env (`Config.Env`) and Inspect tabs     |
| `host`        | `string`                      | Host for port links; page host          |

States: all running, one exited (red ring, status text), restarting, empty, collapsed group, each detail tab.
