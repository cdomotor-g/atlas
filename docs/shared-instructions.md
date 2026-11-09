# Shared instructions — one set of rules for every repository

The rules every one of cdomotor-g's repositories shares are written once, here:

| File | Holds | Loaded in |
|---|---|---|
| [`shared/instructions.md`](../shared/instructions.md) | Pushing, plain words, private data, who clears what, usage (sizing a job before starting it, which model and effort, when to start fresh), issue titles, and the run summary every run ends with | every repository |
| [`shared/on-the-atlas.md`](../shared/on-the-atlas.md) | Working with the map: `atlas.json`, telling the repositories that rely on this one, asks, pins, status and blockers | repositories with an `atlas.json` |

Change a rule there and every new session in every repository follows it. There are no
copies to bring into line. Where a repository's own `CLAUDE.md` says something different, the
repository's file wins, so what is particular to one repository stays in that repository.

## How it reaches an agent

1. **The start-up hook.** Each repository's `.claude/settings.json` has a SessionStart hook: a
   command Claude Code runs when a session opens, and again after `/clear` and after a long
   conversation is compacted. It downloads the file from
   `raw.githubusercontent.com/cdomotor-g/atlas/main/shared/…` and prints it, and Claude Code
   puts what it prints in front of the agent. If the download fails it prints where to read
   the file instead.
2. **The pointer.** Each repository's `CLAUDE.md` (and `AGENTS.md`, where there is one) has a
   short *Shared instructions* section saying where the rules live and to fetch them if they
   are not in front of the agent. That covers the sessions where the hook doesn't run: a cloud
   session with several repositories attached (their own hooks don't apply there), Windows
   without Git Bash, no internet, or an agent that isn't Claude Code.
3. **Your Claude settings.** Chats outside the repositories (claude.ai, Dispatch) read neither,
   so a short version of the run summary sits in the owner's Claude settings (below).

Why not a copy in each repository: a copy has to be copied out to every repository after each
change, by a session with all of them attached, and a repository nobody copied into quietly
keeps the old rules.

## Limits

- Each file stays under 9,500 characters. A hook's output past 10,000 characters reaches the
  agent only as a short preview; `node test/check.mjs` fails a file that grows too long.
- Whatever is on the Atlas's `main` branch is what every agent is told, from its next session
  (GitHub's file server can take about five minutes to hand out a changed file). Only the owner
  (and the sessions he runs) can push there.

## Pointing a repository at them

In a session with the repositories cloned side by side:

```bash
node atlas/tools/shared.mjs --check */   # list the repositories that aren't pointed at them
node atlas/tools/shared.mjs */           # point them: the pointer section and the start-up hook
```

It replaces an old copy of the run summary (or an older `## Run summary` section) with the
pointer, adds the hooks to `.claude/settings.json` and keeps the settings already there. Run
it again on a repository when it gets an `atlas.json`. A repository that adds its own lines to
the run summary puts them just after the pointer section.

## Short version, for Claude's profile settings

Goes in claude.ai *Settings* → *Your Claude* → *Instructions*, after the owner's other
instructions. Keep it saying what the run summary in `shared/instructions.md` says.

```text
End every reply that finishes a piece of work with a run summary: a horizontal rule, then the heading "# 🏁 THIS RUN SUMMARY (Run N)" (N counts the summaries in this chat, starting at 1), then "You asked:" and my request in ten words at most (several asks joined with ·), then one plain sentence on what the run achieved and either "Needs you: Y1, Q1…" or "Nothing needs you." Then these sections as ## headings, in this order, leaving out any that would be empty: ✅ Done (D) · 🧪 Checks (C, each marked 🟢 passed, 🟡 passed with a warning, 🔴 failed or ⚪ not run, and why) · 🚧 Not done (N) · 🙋 Needs you (Y: only what needs my hands, money or say) · 💻 Needs your sign-in (S: what needs only my sign-in, written as a brief I can paste into Dispatch) · ❓ Questions (Q, with options as Q1.1, Q1.2 and the one you'd pick marked recommended). Every point starts with its section's letter and number (D1, C2; nest as D2.1) so I can reply "Q1: yes" or "Run 2 Y1". One line a point, two at most. Plain words: I'm not a software engineer and may read only this report, so prefer the everyday word, and the first time you use a technical term, an abbreviation, a word in a special sense, or mention something I may not have seen, add a few words saying what it is. A reply that only answers a question skips the summary. Where a repository's CLAUDE.md sets out the run summary, follow that.
```
