# ImageViewer

Modal on the native `<dialog>` that shows an image a session printed the path of (screenshots, pastes). Escape and backdrop click close it, the arrow keys step through `paths`. The parent loads the image and owns `index`.

| Prop      | Type                      | Notes                                                 |
| --------- | ------------------------- | ----------------------------------------------------- |
| `paths`   | `string[] \| null`        | Images to step through; null = closed                 |
| `index`   | `number`                  | Shown image                                           |
| `src`     | `string \| null`          | URL of the shown image; null = loading, `''` = failed |
| `onstep`  | `(index: number) => void` | Previous / next                                       |
| `onclose` | `() => void`              | Set `paths = null` here                               |

States: one image, several images (counter and arrows), loading, failed.
