# Getting the most out of the Claude allowance

Plain-words notes for the owner. The rules every session follows are the *Usage* section of
[`shared/instructions.md`](../shared/instructions.md); this page explains them.

## The two dials

**Model** is which brain does the work.

| Model | Good at | Cost |
|---|---|---|
| Haiku 5.5 | Looking things up, renaming, tidying, filling in data | cheapest |
| Sonnet 5.5 | Most coding with a clear brief, fixing a bug once you know the cause, docs, tests | well under Opus |
| Opus 5.5 | Designing across several parts, a bug nobody can pin down, security, safety, money | the most of the three |
| Fable 5.1 | The hardest work | can use at most half the week on its own; not for everyday use |

The usage watch shows each session's model and cost, so after a week or two you'll see the
real difference on your own work.

**Effort** is how long it thinks before it acts: Low, Medium (Claude's recommended default),
High, Extra, Max. More thinking helps on hard problems and is wasted on easy ones. Max uses
3.5 times or more what Medium does. Extra sits between High and Max.

## Will Sonnet give me more bugs?

On hard, open-ended problems, sometimes: Opus is better at holding a big design in its head
and at finding a bug nobody can see. On a job with a clear brief (change this screen, add this
field, fix this error message), Sonnet's work is about as good, and the repository's own
checks catch the slips either model makes. What causes most bugs is a vague brief, not the
model. A session that sizes the job first (below) also tells you when a job needs Opus.

A practical rule: start on **Sonnet / High**. Move up to Opus when Sonnet has gone round in
circles twice, or the job is design, security or something only you understand the stakes of.

## You don't have to choose: let the session size it

Every repository's sessions now **size the job before starting** anything bigger than a small
fix. The card always has the same layout, so you can read it at a glance:

---
### 📏 SIZING CARD
> **Job:** add 3D roads to the repeater map.
>
> Big because it touches the map, the data and the print layout.

| | Option | What you get | Model / Effort | Cost |
|---|---|---|---|---|
|  | **A** | roads layer only | Sonnet / High | 🟡 ~2% |
| ⭐ | **B** | roads plus relocation tools | Opus / High | 🔴 ~8% |
|  | **C** | roads now, relocation tools as two roadmap issues | Sonnet / High | 🟡 ~2% now |

**Pick:** B — the relocation tools reuse the road data, so doing them together saves a second pass.
**This session:** Opus / Extra · ⬇️ more than B needs: start B in a new session on Opus / High.

Reply A, B or C (or "go" for the ⭐).

---

What the marks mean:

- **⭐** the option the session would pick.
- **Cost** is a share of your week: 🟢 under 1% · 🟡 1–5% · 🔴 over 5%.
- **This session:** ✅ right for the pick · ⬇️ more than it needs (you're overpaying) · ⬆️ less
  than it needs (it may struggle).

The exact layout lives in the *Usage* section of the shared rules, so every repository's
sessions draw it the same way. If one ever gives you bullet points instead, say "card please".

If you've already chosen, say so in the first message ("go", "do B") and it
skips the card. A session can't switch its own model, but it can hand the dull parts (reading
lots of files, mechanical edits) to a cheaper helper, and it will tell you when the next
session can start on something cheaper.

Plain chats on claude.ai don't load these rules; the line to add to your profile is at the end.

## When to start a fresh session

Every message re-sends the whole conversation, so message 50 costs far more than message 5,
even when the work is the same size. Start fresh when:

- a piece of work is pushed and the next one is a different job, even in the same repository;
- the session says it's long (past about 200,000 tokens, roughly a short novel), or it's been
  open more than a day;
- you've changed direction, and the early conversation is now mostly wrong turns.

Keep going when you're mid-way through one feature and the next message depends on what was
just said. The repository itself (its files, issues and commits) is the long-term memory, so
a fresh session loses less than it feels like. Sessions end long work with a short hand-over to
paste into the next one.

In Claude Code you can also shrink a session without leaving it:

- **`/compact`** squashes the conversation so far into a short summary and carries on from
  there. Good mid-feature, when the early back-and-forth no longer matters. You can steer what
  it keeps: `/compact keep the decisions about the print layout`.
- **`/clear`** wipes the conversation and starts clean in the same session: the cheapest
  restart when the next job is different.
- **`/context`** shows how full the conversation is.

Plain chats on claude.ai have no such command; start a new chat instead.

## The "unpushed commits" nudge

Claude Code on the web checks, after every reply, whether the session's working branch (a
`claude/…` name it makes up) has commits that aren't online. Your sessions push straight to
`main`, so that branch never gets pushed and the check fires: "Hook re-prompted Claude …
Please push these changes". Each nudge makes Claude take another full turn, re-reading the
whole conversation. The shared rules now tell sessions to switch to `main` before their first
commit, so the check stays quiet.

## Budgets for research and overnight runs

You don't need to guess minutes. The budget is a share of your week, and the session estimates
it on the sizing card. As a guide: a quick look-up 0.5%, a comparison of a few options 1–2%, a
deep report 3–5%. Unattended runs default to 2% and stop with what they have when it's spent.
The Toradex comparison that ran overnight on 8 Nov used about 6%.

## The yardstick

About **US$14 at list price is 1% of the week** on the Max plan (measured 9 Nov 2026: US$482
of Claude Code sessions was 36% of the week). List price is what the same work would cost on
Anthropic's pay-as-you-go rates; it's a yardstick, not a bill.

## Watching it

The **Usage watch** scheduled task runs [`tools/usage/snapshot.js`](../tools/usage/README.md)
in your signed-in Chrome each evening and sends a phone alert: how much of the week is gone,
whether that pace lasts to Saturday, the costliest sessions and the habits to watch. You can
also see the totals any time at claude.ai → Settings → Usage.

## Setting the starting model

There's no single default setting. Each app remembers the model and effort you last picked in
its new-message box, and Claude Code and chats remember theirs separately:

- **Claude Code (web):** claude.ai/code → the model name beside the message box (bottom right,
  e.g. "Opus 5.5 Extra") → pick **Sonnet 5.5** → **Effort** → **High**.
- **Chats (web):** claude.ai → the model name under the message box (e.g. "Opus 5.5 High") →
  **Sonnet 5.5** → effort **High**.
- **Phone and desktop app:** the same picker sits by the message box in each. Set it once in
  each app, for Code and for chats.

## Line for your Claude profile instructions

Chats and Dispatch don't load the repository rules. To get the sizing card there too, add this
to claude.ai → Settings → Your Claude → Instructions:

```text
Before any job bigger than a quick answer or small fix, reply with only a sizing card and wait for my pick (skip it if I've already said "go"). Always this layout: a horizontal rule; the heading "# 📏 SIZING CARD"; a quote with "Job:" and my ask in ten words, then what makes it big in one sentence; then a table with exactly these columns: (blank for ⭐) | Option | What you get | Model / Effort | Cost — two or three rows lettered A, B, C, ⭐ on the one you'd pick. Model / Effort in the app's words (Haiku, Sonnet, Opus · Low, Medium, High, Extra, Max). Cost as a share of my weekly allowance (about US$14 at list price is 1%), marked 🟢 under 1%, 🟡 1–5%, 🔴 over 5%. Then "Pick:" with a one-line reason, "This session:" with its model / effort and ✅ right, ⬇️ more than needed or ⬆️ less than needed, and last "Reply A, B or C (or "go" for the ⭐)." Never a bullet-point version; no run summary on a card. If the work grows past about twice its size, stop at a working point and show a new card.
```
