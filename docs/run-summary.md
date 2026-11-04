# Run summary — one closing report for every repository

Every agent run, in every one of cdomotor-g's repositories, ends with the same report: the
same headings, emoji and order, and the same letter for the same kind of point. The owner
can read any repository's report the same way and answer a point by its code (`Q1: yes`,
`Run 2 Y1`) without saying which repository's scheme it is.

The text between the two markers below is copied word for word into each repository's
`CLAUDE.md`, and into its `AGENTS.md` where it has one. Never change a repository's copy on
its own: change it here, then copy it out. In a session with the repositories cloned side by
side:

```bash
node atlas/tools/run-summary.mjs --check */CLAUDE.md */AGENTS.md   # list the copies that differ
node atlas/tools/run-summary.mjs */CLAUDE.md */AGENTS.md           # bring them all into line
```

It replaces what is between the markers (or an older `## Run summary` section) and adds the
block at the end of a file that has neither. `node test/check.mjs` holds the Atlas's own two
copies to this one.

<!-- run-summary:start · the same in every repository: change it in cdomotor-g/atlas docs/run-summary.md, then copy it out with tools/run-summary.mjs -->
## Run summary — how to end a run
When you finish a piece of work, end your reply with this report, filled in. A short reply that only answers a question (no work done) skips it and doesn't use up a run number.

```markdown
---
# 🏁 THIS RUN SUMMARY (Run N)
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

- **The marker.** A horizontal rule, then the 🏁 heading word for word, so I can find it by scrolling. N counts the summaries in this chat: Run 1 first, then one more than the last marker. A new chat starts at Run 1. Use it once per reply, at the start of the report: everything above it is working notes, and nothing comes after the report. The line under it lists every Y, S and Q point, or says nothing needs me.
- **Same sections, same letters, every repository.** These headings, emoji and order; leave out any that would be empty, and add none. Every point starts with its section's letter and number: **D** done · **C** checks · **N** not done · **Y** needs you · **S** needs your sign-in · **Q** questions. Nest with a dot (**D2.1**). Numbers restart each run, so when I reply "Q1: yes" or "Run 2 Y1", that's the point I mean.
- **Checks show their result:** 🟢 passed · 🟡 passed with a warning · 🔴 failed · ⚪ not run, and why. Never call something fixed or passing that wasn't checked.
- **Needs you, or needs your sign-in.** **Y** is only what needs my hands, money or say: hardware, a site, an order, a decision. What needs only my sign-in (a dashboard, a setting, an account page) is **S**: do it yourself if this session can use my computer; otherwise write it as a brief I can paste into Dispatch.
- **Short.** One line a point, two at most: what happened and what it means for me, not how it was done.
- **Plain words.** I'm not a software engineer, and I may read only this report. Prefer the everyday word. Where a technical term, an abbreviation, a word used in a special sense, or a mention of something I may not have seen (a file, a tool, an earlier step) is the clearest choice, add a few words saying what it is the first time. Name a thing by what it does, not only by its file or function name.
<!-- run-summary:end -->
