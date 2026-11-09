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

### The scheduled task

Name **Usage watch**, daily at 7:48 pm Brisbane, needing the owner's computer (it uses his
signed-in Chrome), phone alerts on. Its instructions:

```text
You are the daily Usage watch for the owner (C, in Brisbane). It tells him how fast his Claude allowance is going, so he can ease off before it runs out. Read only: change nothing, commit nothing, open no issues, send no email. Nobody is watching; don't ask questions. Keep token use low: this check should cost a few cents, not dollars.

1. Download the script into this session: `curl -fsS https://raw.githubusercontent.com/cdomotor-g/atlas/main/tools/usage/snapshot.js -o /tmp/snapshot.js`, then Read /tmp/snapshot.js.
2. Load the Claude in Chrome tools in ONE ToolSearch call: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__tabs_close_mcp. Open a new tab and navigate it to https://claude.ai/code (the owner's Chrome is signed in).
3. Run the script with javascript_tool on that tab: the text is `await ` followed by the script's full contents, exactly as downloaded. It returns a plain-text report. If the result is cut short, run it again as `window.__usage = await ` + the script, then read `window.__usage` in two halves with .slice().
4. Close the tab you opened.
5. Your whole reply is the report exactly as returned: no preamble, no sign-off, no run summary.
6. Load PushNotification with ToolSearch and send one line under 200 characters built from the report, e.g. "📊 Week 36% used · runs out Thu at this pace (keep to 12%/day) · last 24h ~17% · biggest: Droggies animation (Max effort)". Start it with ⚠️ instead of 📊 when the report says the allowance runs out before the reset. On Saturdays start it with "📊 Week in review:" and lead with the since-reset total and the biggest session instead of the last 24 hours.
7. If Chrome can't be reached, the page isn't signed in, or the script throws, reply with "📊 Usage watch couldn't run:" and the reason in one line, and send that same line as the notification.
```

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
