# The weekday brief

A scheduled Claude session sends a short push to the owner's phone each weekday
morning: the few things in the repositories that are waiting on the owner and worth doing soon. The
*Problems* morning brief at 6:40 covers home and life admin; this one covers the projects,
so neither crowds the other out.

## What the session does
1. Clone `cdomotor-g/atlas` (public, read only).
2. Run `node tools/brief.mjs` and send **exactly what it prints** as the final message. That is
   what the push shows. Nothing else: no preamble, no sign-off.
3. **Change nothing.** No commits, no edits, no issues. The brief only reads `data/map.json`,
   which the *Collect* workflow refreshes every three hours.

## What the script picks
From everything waiting on the owner: the blockers in `status.blocked` that wait on `human`
(the owner's hands, money or say) or `computer` (only the owner's sign-in), and the `[Human]` and `[Computer]`
issues that no blocker already stands for. A blocker whose issue is closed is left out, and an
issue seen from two repositories counts once. Dates are in Queensland time (UTC+10).
- 📅 up to two with a date in the next fortnight in their words ("before 25 Nov"), soonest first;
- 🆕 up to three new since the last brief (Friday's, on a Monday), newest first;
- ⚡ up to two quick wins: the suggested way through takes half an hour or less, the most it
  frees first, with its size;
- ⏳ one more of the rest, in turn, oldest first, a different one each weekday, so nothing sits
  forgotten;
- 👉 how many in all, and the link to the *Blockers* view.
- ⚠️ a warning above that when the map is two days old or more (the *Collect* workflow has
  stopped refreshing it).

At most 600 characters. When it is too long, lines come off the bottom first. Change the rules in
`tools/brief.mjs`, and this list with them. `node test/check.mjs` checks the picks.

## Example (`node tools/brief.mjs --date 2026-11-16`)
```
📅 Wed 25 Nov: Flood-Net #274 ElevenLabs credits run short before they renew on 25 Nov: #265 is…
⚡ Flood-Net #237 Switch accounts on: Supabase sending through Resend, the sign-in… (30 min)
⚡ Flood-Net #270 Give the Worker its GitHub token (GITHUB_ISSUES_TOKEN) so /api/report… (5 min)
⏳ Waiting 7 weeks: Flood-Net #204 Report templates wait on the owner's example assessment reports
👉 27 in all (19 for you, 8 at your computer): https://cdomotor-g.github.io/atlas/#blockers
```
