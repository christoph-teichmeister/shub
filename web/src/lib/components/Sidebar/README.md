# Sidebar

The project navigation column (`<nav aria-label="Projects">`): fixed header, scrolling middle, footer.

| Prop        | Type         | Notes                                   |
| ----------- | ------------ | --------------------------------------- |
| `header`    | snippet      | Wordmark, search, Global Claude         |
| `children`  | snippet      | Plugin sections and project groups      |
| `footer`    | snippet      | Dormant hint, shortcut hints, user chip |
| `collapsed` | `boolean`    | Folds to a slim rail (animated width)   |
| `ontoggle`  | `() => void` | Shows the hide/show button top right    |
