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
fix. You get a card like this:

> **Job:** add 3D roads to the repeater map — big because it touches the map, the data and the print layout.
> - **A** roads layer only, Sonnet / High, about 2% of your week
> - **B** roads plus relocation tools, Opus / High, about 8% *(recommended)*
> - **C** roads now, relocation tools as two roadmap issues
>
> This session is on Opus / Extra: more than A or C need.

Reply with a letter. If you'd already chosen, say so in the first message ("go", "do B") and it
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
Before any job bigger than a quick answer or small fix, first reply with a short sizing card: the job in one line and what makes it big; two or three ways to do it, each with the model and effort it needs and a rough cost as a share of my weekly allowance (about US$14 at list price is 1%); and the one you'd pick, marked recommended. Wait for my pick unless I've already said "go". If the work grows past about twice its size, stop at a working point and offer to finish or roadmap the rest.
```
