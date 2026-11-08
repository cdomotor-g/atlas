# Priorities — what to work on next

The Atlas's **Priorities** view (`#priorities`) weighs every open issue and blocker in every
repository against the others, so there is one place to look for what matters most right now.
The Atlas opens on it. **▶ Start here**, at the top of every view, is its pick for the owner, and
the first line of the weekday phone message ([`brief.md`](brief.md)), worked out by the same code. The sums are in
[`assets/triage.js`](../assets/triage.js); the page that draws them is `assets/atlas.js`.

## What gets weighed

Every open issue is one item, except an epic that still has open sub-issues (its sub-issues
stand for it) and the roadmap issue. Every blocker that no open issue stands for is one item too
(a blocker recorded in `status.blocked`, a link behind upstream, an ask nobody has filed, a
failing check, a status nobody has checked for a month). A blocker that an issue stands for adds
what it frees and its ways through to that issue.

## How

Four parts make its **importance**, out of 100:

| Part | Scale | Where it comes from |
|---|---|---|
| **How much the repository matters** | 1–5 | `weight` on the repository in `data/registry.json`. Left out, the Atlas guesses: its phase (live or beta 4, building 3, idea or maintenance 2, archived 1), one more when four or more repositories rely on it (live, a copy, a protocol or a release — not a citation), one less when nothing even cites it. |
| **How bad if it's left** | 1–5 | The issue's `Atlas triage:` line; else a label (`p0`/`critical`/`security` 5, `p1`/`bug` 4, `p2` 3, `p3`/`enhancement` 2); else what it is (a failing check 4, behind upstream 3, an old status 2); else its title's words (security, privacy, lost data, an outage 5; broken, failing, stuck, running out 4; *Maybe*, follow-ups, polish 2); else 3, ordinary work. A blocker that holds work up is at least 3. |
| **What it opens up** | 0–5 | How much clearing it frees, as the Blockers view counts it (what it holds up, plus what the blockers behind it hold up): 1, 2, 3–4 → 3, 5–7 → 4, 8 or more → 5. One more when another repository waits on it too. |
| **How soon** | 0–5 | A deadline — the issue's line, else the first date still to come in its title, its opening or its blocker (2 days or less 5, a week 4, two weeks 3, a month 2, three months 1) — plus 2 when it is on its repository's **Now** list (1 for **Next**), plus 1 when it has held work up for a month (2 for three months). |

The repository and how bad multiply (`repository × how bad ÷ 5`), so a bad problem in a
repository that matters little can rank below a smaller one where it matters most. Then
`importance = 100 × (2 × that + what it opens up + how soon) ÷ 20` with the standard weights
(2, 1, 1); the weights can change.

What it **costs**, in dollars:

- **Your time.** All of it when you do it; about half (at least 10 minutes) when an agent at your
  computer does it while you approve; 10 minutes to half an hour to hand a job to an agent and
  check what comes back. At **$60 an hour** unless you say otherwise.
- **Agent time.** The job's size, at **$5 an hour** (set it to 0 on a flat plan).
- **Money.** The issue's line; else the largest amount in the suggested way through (or the
  title and opening when it has none); a purchase with no price written down counts as $50.

The **size** of a job comes from the issue's line, else the suggested way through (`"10 min"`,
`"an afternoon"`), else its `[Model/Effort]` tag (Low ½ h, Med 1½ h, High 3 h, XHigh 6 h, Max
10 h of agent work), else a guess (a decision 15 min, a sign-in 30 min, hardware half a day, an
agent job 1½ h, an epic 8 h).

**Best next** is importance for what it costs: `importance ÷ (1 + log₂(1 + cost ÷ $15))`, with the
cost weight as a power on the divisor (0 ignores cost). A five-minute decision that frees three
jobs beats a week of work that frees none.

## What the page shows

- **Three cards**: *Your next step* (the best next item that needs you or your sign-in), *Hand to
  an agent* (the best next item an agent can do from anywhere — it works while you do yours), and
  *Most important* (the most important of the rest, whatever it costs).
- **Ranked list**, in one of five orders: Best next, Most important, Most urgent, Opens up most,
  Cheapest first. Filter by who takes the next step.
- **Chart**: the same rows as bars, measured five ways — **When** (a plan: yours one after another
  at your hours a day, agent sessions side by side, nothing before what it waits for; each
  deadline marked, and a bar outlined red when it lands after it), **Effort**, **Your time**,
  **Cost** (your time, agent time, money) and **Importance** (its three parts). *One after
  another* starts each bar where the last ended, so the last one's end is the total; *Side by
  side* starts them all at zero. Group by who or by repository.
- **Each item's page**: every part, why, and where it came from (*guess*, *on the issue*, *in the
  registry*, *yours*), with a control to change it; the cost broken down; when it could be done;
  what it waits for and frees; the buttons that get it done.
- **How it's weighed**: the weights, each repository's 1–5, your hours a day, agent sessions at
  once, and what an hour of yours and an agent's is worth.

## Making a change stick

Changes on the page stay in that browser. To make them hold for everyone:

- **One issue** — put a line of its own in the issue's body (the item's page copies it, or a
  prompt that writes it):

  ```
  Atlas triage: severity 4 · opens 2 · due 2026-11-25 · effort 2h · cost $40
  ```

  Every part is optional and the order doesn't matter. `severity` 1–5 (how bad if it's left),
  `opens` 0–5 (what doing it frees), `due` a date, `effort` a size in words, `cost` dollars. The
  collector reads it every three hours (`triageMark` in `tools/lib.mjs`); the issue keeps it, so
  it holds until someone changes it. Agents add it when they open an issue and know any of it
  (`shared/on-the-atlas.md`).
- **Repositories and settings** — *Keep these for everyone* copies a prompt that writes them into
  `data/registry.json`: `"weight": 1–5` on each repository, and at the top level

  ```json
  "triage": { "weights": { "importance": 2, "opportunity": 1, "urgency": 1, "cost": 1 },
              "yourHoursADay": 1, "agentsAtOnce": 2, "agentHoursADay": 6,
              "yourHour": 60, "agentHour": 5, "unknownPurchase": 50 }
  ```

  Every key is optional. `node test/check.mjs` checks them.
