# Dialog

Modal on the native `<dialog>` (`showModal`): focus trap, Escape and backdrop click close it. The parent owns `open`.

| Prop          | Type         | Notes                          |
| ------------- | ------------ | ------------------------------ |
| `open`        | `boolean`    |                                |
| `title`       | `string`     | Labels the dialog              |
| `description` | `string`     | One short line under the title |
| `onclose`     | `() => void` | Set `open = false` here        |
| `children`    | snippet      | Body (form fields)             |
| `actions`     | snippet      | Buttons, primary last          |

States: confirm (text + two buttons), input (a labelled field), info (shortcuts list).
