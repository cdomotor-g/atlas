# Usage watch

`snapshot.js` tells the owner where his Claude allowance is going: how much of the week is
used, whether that pace lasts to the reset, the sessions that cost the most in the last day and
since the reset, and the habits that burn it (Max effort, conversations left to grow very long,
everything on Opus).

## How it runs

Claude's usage figures sit behind the owner's claude.ai sign-in, so the script runs in his own
browser, not in a cloud session or on GitHub:

1. A Claude session with Claude in Chrome downloads the script:
   `curl -fsS https://raw.githubusercontent.com/cdomotor-g/atlas/main/tools/usage/snapshot.js`
2. It opens `https://claude.ai/code` in a new tab and runs the script's text with Chrome's
   javascript tool, prefixed with `await `. The script returns a short plain-text report.
3. It passes the report on (phone alert, email, a chat) and closes the tab.

The daily scheduled task "Usage watch" does exactly this; its instructions say how it alerts.
You can also run it any time: paste the script into the browser console on claude.ai.

## What the numbers mean

- **Weekly allowance** comes from Claude's own record of the limit, which every Claude Code
  session receives. It counts everything: Claude Code, chats and Cowork.
- **US$ figures** are what the work would have cost at Anthropic's list price. They are not a
  bill; the Max plan covers them. They are only Claude Code sessions.
- **About US$14 is 1% of the week** on the owner's Max plan (measured 9 Nov 2026: US$482 of
  sessions was 36%). If the plan changes, change `PER_PERCENT` in the script.
- A session that started before a window (the last day, or the week) counts only the part
  inside it, worked out from the running total each turn records.

## Reads only

The script only reads the lists the claude.ai pages show. It changes nothing, stores nothing,
and sends nothing anywhere: the session running it decides where the report goes. Session
titles can name private work, so the report goes only to the owner.
