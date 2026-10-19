# TabBar

Row of session tabs (`role="tablist"`). Put `SessionTab`s in `children`, the "+" button in `trailing`. Left / Right / Home / End move between tabs and select them (`lib/tabKeys.ts`).

| Prop       | Type                                 |
| ---------- | ------------------------------------ |
| `label`    | `string` (aria-label of the tablist) |
| `children` | snippet                              |
| `trailing` | snippet                              |
