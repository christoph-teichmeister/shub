# SidebarSection

A titled block in the sidebar: a project group ("Work") or a plugin section ("Board runner"). Clicking the title collapses it to the header (badge stays); the state is remembered per browser in `localStorage` under `shub.collapsed.<title>` (`1` folded, `0` open; no entry = `defaultCollapsed`).

| Prop               | Type                               | Notes                                                    |
| ------------------ | ---------------------------------- | -------------------------------------------------------- |
| `title`            | `string`                           | Shown as an uppercase label                              |
| `badge`            | `SidebarSectionContent['badge']`   | Optional count pill                                      |
| `collapsedBadge`   | `SidebarSectionContent['badge']`   | Replaces `badge` while collapsed (groups: who needs you) |
| `defaultCollapsed` | `boolean`                          | Starts folded until opened (plugin sections)             |
| `entries`          | `SidebarSectionContent['entries']` | Plugin rows; link if `url`, button if `action`           |
| `onentry`          | `(entry) => void`                  | Clicked entry with an `action`                           |
| `ondrop`           | `(e: DragEvent) => void`           | Makes the section a drop target (groups)                 |
| `children`         | snippet                            | Project rows                                             |

States: group with rows, plugin section with entries (tones needs-you / working / done / neutral), empty plugin section, collapsed, drag-over.
