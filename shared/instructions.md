# Shared instructions — every one of cdomotor-g's repositories

These hold in every repository I own. They live in one file in the Atlas
(<https://github.com/cdomotor-g/atlas/blob/main/shared/instructions.md>) and are loaded when a
session starts. Where a repository's own `CLAUDE.md` says something different, the
repository's file wins.

## Pushing
- Push straight to `main` after a patch, without asking: `git pull --rebase origin main` first (other sessions and workflows commit to `main` too), then push. No pull requests, and no branches unless I ask — even where the session was set up to work on a `claude/…` branch.
- Run the repository's own checks before you push (its `CLAUDE.md` says which).
- **Work on `main` from the start.** If the session put you on a `claude/…` branch, switch before your first commit: `git fetch origin main && git checkout -B main origin/main`. Otherwise the session's automatic "unpushed commits" check nudges you after every reply, and each nudge costs a whole extra turn. If you end up on a `claude/…` branch anyway, after pushing run `git branch -u origin/main` so the check sees it's pushed. When an automatic check nudges you and nothing needs doing, answer in one line: no run summary.

## Plain words
- I'm not a software engineer. In anything a person reads — a page, a message, a doc, an issue, a commit message, a report — prefer the everyday word.
- On a page, give a word that means something particular there its meaning on hover (`title`), and list the meanings where a finger can read them too (a key, or a *what the words mean* fold).

## Private data and names
- Nothing private goes in a public repository — not in its files, issues or commit messages: no landholder names or contact details, no site codes (gate, padlock, logger or key codes), no passwords, keys or tokens, nothing copied from a private repository.
- The Flood-Net app is **Flood-Net** in anything a person reads; its repository is `cdomotor-g/MegaNet`.

## Who clears what
- `human` (and **Y** in the run summary) only for what needs my hands, money or say: hardware, a site, an order, a decision.
- `computer` (and **S**) for what needs only my sign-in: a dashboard, a setting, an account page, GitHub settings. A Claude session at my computer does it signed in as me — Claude in Chrome for websites, computer use for apps, Claude Code through Remote Control for a shell — while I approve.
- Write blockers, their ways through and issue tags that way.

## Usage — size the job, then do it
My Claude plan has a weekly allowance; treat it like fuel. `docs/usage.md` in the Atlas explains it in plain words.

**Size it first.** Before anything bigger than a small fix (several files, research, a design, a long unattended run), your whole reply is this sizing card, filled in, and you wait for my pick. Skip it for small fixes, when I've already picked ("go", "B"), and in scheduled runs.

```markdown
---
# 📏 SIZING CARD
> **Job:** what I asked for, in ten words at most.
>
> What makes it big, in one plain sentence.

| | Option | What you get | Model / Effort | Cost |
|---|---|---|---|---|
| ⭐ | **A** | the core only | Sonnet / High | 🟡 ~2% |
|  | **B** | all of it | Opus / High | 🔴 ~8% |
|  | **C** | part now, the rest as issues | Sonnet / Medium | 🟢 ~0.5% now |

**Pick:** A — why, in one line.
**This session:** Opus / Extra · ⬇️ more than A needs: start A in a new session on Sonnet / High.

Reply A, B or C (or "go" for the ⭐).
```

- **Same layout every time:** the heading word for word, this table with these five columns in this order, two or three rows lettered A, B, C, and ⭐ in the first column of the one you'd pick. No bullet-point version, nothing after the reply line, and no run summary (a card is not a run).
- **Model / Effort** use the app's own words: Haiku, Sonnet, Opus · Low, Medium, High, Extra, Max.
- **Cost** is a share of my week: 🟢 under 1% · 🟡 1–5% · 🔴 over 5%. About US$14 at list price is 1%.
- **This session:** ✅ right for the pick · ⬇️ more than it needs · ⬆️ less than it needs — and what to do about it.

**Which setup.** Haiku / Low–Medium: looking up, renaming, formatting, filling data. Sonnet / Medium–High: most coding with a clear brief, bugs with a known cause, docs, tests. Opus / High: design across several parts, a bug nobody can pin down, security, safety or money. Extra or Max only after High has failed.
- **Hand work down.** You can't change this session's model, but a subagent with `model: "sonnet"` or `"haiku"` can do bulk reading, searching and mechanical edits while you keep the decisions.
- **Stop when it grows.** Past about twice its size, stop at a working point, push, and show a new sizing card: finish now, or the rest as issues tagged with their model/effort.
- **Fresh sessions.** Every message re-reads the whole conversation. When work is pushed and the next job is different, or the context passes about 200,000 tokens, end with a three-to-six-line hand-over to paste into a new session (or suggest `/compact`).
- **Research and unattended runs** work to a budget (default 2% of my week) and stop with what they have.
- **Read lean.** Search before opening whole files, read only the part you need, parse big outputs with a script.

## Issue titles
- Start every issue title with tags, so a list shows at a glance what it is and who can move it: `[<Structure>] [<Who>] <title>`.
  - Structure: `[Standalone]`, `[Epic]`, or `[Sub-issue of #<n>]`.
  - Who: `[<Model>/<Effort>]` when an AI agent could do it — models `Opus5`, `Sonnet5`, `Haiku4.5`, `Fable5`; effort `Low`, `Med`, `High`, `XHigh`, `Max` — repeated on the body's first line (`Recommended: Sonnet5 / Med`). `[Human]` when it needs me; `[Human] [Computer]` when it needs only my sign-in.
  - Example: `[Sub-issue of #42] [Sonnet5/Med] Fix flaky login test`.

## Run summary — how to end a run
When you finish a piece of work, end your reply with this report, filled in. A short reply that only answers a question (no work done) skips it and doesn't use up a run number.

```markdown
---
# 🏁 THIS RUN SUMMARY (Run N)
> **You asked:** what I asked for, in a few words.
>
> What this run achieved, in one plain sentence. **Needs you:** Y1, Q1 — or **Nothing needs you.**

## ✅ Done
- **D1** What changed and where, with a link when there is one (commit, issue, page).

## 🧪 Checks
- **C1** 🟢 What was checked, and what it showed.

## 🚧 Not done
- **N1** What was skipped, failed or is left for later, and why.

## 🙋 Needs you
- **Y1** What needs your hands, money or say, step by step.

## 💻 Needs your sign-in
- **S1** What needs only your sign-in, as a brief to paste into Dispatch.

## ❓ Questions
- **Q1** The question. Options as **Q1.1**, **Q1.2**, the one you'd pick marked *(recommended)*.
```

- **The marker.** A horizontal rule, then the 🏁 heading word for word, so I can find it by scrolling. N counts the summaries in this chat: Run 1 first, then one more than the last marker. A new chat starts at Run 1. Use it once per reply, at the start of the report: everything above it is working notes, and nothing comes after the report.
- **What I asked, then what came of it.** Straight under the heading, **You asked:** and my request in ten words at most (several asks joined with ·), so I can tell which request a report answers when I scroll back. Then one plain sentence on what the run achieved, listing every Y, S and Q point, or saying nothing needs me.
- **Same sections, same letters, every repository.** These headings, emoji and order; leave out any that would be empty, and add none. Every point starts with its section's letter and number: **D** done · **C** checks · **N** not done · **Y** needs you · **S** needs your sign-in · **Q** questions. Nest with a dot (**D2.1**). Numbers restart each run, so when I reply "Q1: yes" or "Run 2 Y1", that's the point I mean.
- **Checks show their result:** 🟢 passed · 🟡 passed with a warning · 🔴 failed · ⚪ not run, and why. Never call something fixed or passing that wasn't checked.
- **Needs you, or needs your sign-in.** **Y** is only what needs my hands, money or say: hardware, a site, an order, a decision. What needs only my sign-in (a dashboard, a setting, an account page) is **S**: do it yourself if this session can use my computer; otherwise write it as a brief I can paste into Dispatch.
- **Short.** One line a point, two at most: what happened and what it means for me, not how it was done.
- **Plain words.** I'm not a software engineer, and I may read only this report. Prefer the everyday word. Where a technical term, an abbreviation, a word used in a special sense, or a mention of something I may not have seen (a file, a tool, an earlier step) is the clearest choice, add a few words saying what it is the first time. Name a thing by what it does, not only by its file or function name.
