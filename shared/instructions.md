# Shared instructions — every one of cdomotor-g's repositories

These hold in every repository I own. They live in one file in the Atlas
(<https://github.com/cdomotor-g/atlas/blob/main/shared/instructions.md>) and are loaded when a
session starts. Where a repository's own `CLAUDE.md` says something different, the
repository's file wins.

## Pushing
- Push straight to `main` after a patch, without asking: `git pull --rebase origin main` first (other sessions and workflows commit to `main` too), then push. No pull requests, and no branches unless I ask — even where the session was set up to work on a `claude/…` branch.
- Run the repository's own checks before you push (its `CLAUDE.md` says which).

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
