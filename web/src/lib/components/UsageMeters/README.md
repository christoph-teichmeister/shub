# UsageMeters

The 5h and 7d usage limits as two bars with the used % and the even-pace %. Clicking the 7d meter cycles its pace between until the reset, until Friday 16:00 (work week, `usagePace.ts`) and both; the choice is kept in localStorage. Reads `app.usage`; renders nothing until a limit is known. No props.
