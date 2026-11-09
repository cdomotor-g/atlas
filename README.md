<p align="center"><img src="assets/logos/atlas.svg" width="84" alt=""></p>

# Atlas

**One map of every repository: what each is, where it is up to, and how they depend on each other.**

**→ <https://cdomotor-g.github.io/atlas/>**

It opens on **Priorities**: what to work on next, with every open issue weighed. Beside it is a
zoomable map of the Flood-Net family and its neighbours — the Quansheng radio firmware,
RPi ALERT, Flood-Net itself, open-ALERT, SoRT, the Droggies and the older tools — with a
line for everything one repository takes from another. Click a repository to see its parts,
where it is up to, what is waiting on you, its open issues and a ready-made brief for
switching back into it. Click a line to see exactly what flows along it and whether the
receiving end has kept up.

| View | What it answers |
|---|---|
| **Priorities** | What to work on next: every open issue and blocker weighed — how much its repository matters, how bad it is if it's left, what doing it opens up, how soon it's needed — against what it costs in your time, agent time and money. Three cards say where to start (your next step, a job to hand an agent, the most important of the rest), with a ranked list and a chart whose bars switch between **When** (a plan in time, deadlines marked), **Effort**, **Your time**, **Cost** and **Importance**. Every number is a guess until you change it on the page, on the issue (an `Atlas triage:` line) or in the registry ([`docs/priorities.md`](docs/priorities.md)). **▶ Start here** on every view, and the first line of the weekday phone message, is its pick for you. The Atlas opens here. |
| **Map** | How does it all fit together? What is behind? Drag to rearrange, scroll or pinch to zoom (zoom in for each repository's one-line description and the counts on its lines), click to drill down. On a phone held upright the zones stack top to bottom. |
| **Blockers** | Everything stopping work, four ways: **Who clears it** (four lanes — only you, on your computer, an agent can, waiting on another repo), **What frees what** (each blocker read left to right to what clearing it frees, chains first), **What it takes** (repositories against needs: a decision, your sign-in, hardware, money, time, someone else, agent work) and **Quick wins** (size of the way through against how much it frees). Every blocker has a tag — its issue number, or a dashed name when it has none — that opens one page with what it holds up and the ways through (who can do each, the effort, the one the repo would pick); **Make the issue on GitHub** gives an untracked one a number. **Do it for me** hands a step behind your sign-in to a Claude session on your computer; **Help me** asks a session to walk you through yours. On the map, the **Blockers** button draws a line from each repository to **You**, **Your computer**, **Agents** or the repository it waits on. |
| **Roadmap** | Every repository's Now / Next / Later / Blocked on one screen. |
| **Board** | Every open issue, by who can move it: on your computer, waiting on you, ready for an agent (by model), behind upstream, epics. **Prompt** copies a brief for a new Claude Code session or Dispatch; **Do it for me**, one for a Claude session on your computer. |
| **Links** | Every dependency between repositories and its state. |
| **Activity** | The latest commits everywhere, newest first. |

## How it works

```
 each repository                         this repository                         you
 ───────────────                         ───────────────                         ───
 atlas.json  ── what it is, its parts,   tools/collect.mjs (every 3 h)           index.html
               status (Now/Next/Blocked),  reads every atlas.json, plus          the map, roadmap,
               what it offers, what it     commits, issues, releases, CI      ─▶ board, links,
               takes from others           and drift on every link, from         activity
                                           GitHub → data/map.json
 .github/workflows/atlas.yml (daily)
   validates atlas.json; when something it copies or follows has moved
   on upstream, opens an issue here with the upstream commits (forward)

 shared/on-the-atlas.md (loaded into every session, docs/shared-instructions.md)
   agents tell consumers when they change what others rely on (forward),
   file asks upstream (back), and keep status current
```

- **Each repository describes itself** in an `atlas.json` at its root — format and every
  field explained in [`schema/atlas.schema.json`](schema/atlas.schema.json). Links are
  declared by the *consumer* (`consumes`), because the consumer is what breaks.
- **Forward propagation.** A consumer records where it last caught up with each provider:
  a pinned commit (`agent/vendor/meganet/SOURCE`), a version (`RPi ALERT 0.15.3` in a
  catalogue) or a review date. When the provider changes a watched file after that, the
  link turns **behind**; the consumer's daily `atlas.yml` check opens an issue there with
  the upstream commits and the catch-up step, and closes it once the pin moves.
- **Back propagation.** When a repository needs another to change, its agent files an
  issue in the other one and lists it under `asks`. Issues that name another repository
  show on the line between them.
- **Blockers and the ways through.** A repository records what blocks it in
  `status.blocked`: who it waits on, what it holds up, and the `options` through it. The
  Atlas adds the blockers it can see for itself — `[Human]` issues, links behind upstream,
  asks nobody has filed, failing CI, a status nobody has checked for a month — each with a
  suggested way through.
- **You, your computer, or an agent.** A blocker waits on `human` when it needs the owner's
  hands, money or say (the bench, an order, a decision), and on `computer` when it needs only
  their sign-in (a dashboard, a setting, an account page). A Claude session at the owner's
  computer clears those signed in as them — Claude in Chrome for websites, computer use for
  desktop apps, Claude Code in a folder shared through Remote Control for a shell — while the
  owner approves, types passwords and makes any payment. The Atlas also puts a `human` blocker
  of kind `access`, and a `[Human]` issue tagged `[Computer]` or about a sign-in, with your
  computer.
- **Blocker tags.** Each blocker is found by its issue number, or — until it has one — by
  its `id` in `status.blocked` (`rpi-alert/bench-first-run`, also its address:
  `#blockers/rpi-alert/bench-first-run`). An issue made from the Blockers view starts with
  the line `Atlas blocker: rpi-alert/bench-first-run`; the collector records it, and the
  Atlas links that issue to the blocker until the number is in `atlas.json`. A blocker whose
  issue has been closed is marked *closed*.
- Repositories that can't carry an `atlas.json` (archived, or not attached) are described
  by the Atlas itself in [`data/fallback/`](data/fallback).

## Files

| Path | What |
|---|---|
| `index.html`, `assets/atlas.js`, `assets/atlas.css` | The page. Plain HTML/CSS/JS, no build, no libraries. |
| `assets/triage.js` | The Priorities view's sums: what each item is worth, what it costs, and a plan in time ([`docs/priorities.md`](docs/priorities.md)). |
| `data/registry.json` | Which repositories are on the map, where each sits, which zone; optionally how much each matters (`weight`) and how open work is weighed (`triage`). |
| `data/fallback/*.json` | `atlas.json` for repositories that don't carry their own. |
| `data/map.json` | What the page draws. Written by `tools/collect.mjs`; don't edit by hand. |
| `schema/atlas.schema.json` | The `atlas.json` format. |
| `tools/collect.mjs` | Builds `data/map.json`. `.github/workflows/collect.yml` runs it every three hours. |
| `tools/drift.mjs`, `.github/workflows/drift.yml` | The check every repository runs on itself (a reusable workflow). |
| `shared/instructions.md`, `shared/on-the-atlas.md` | The rules every repository shares, loaded into every session in every repository when it starts; `tools/shared.mjs` points a repository at them ([`docs/shared-instructions.md`](docs/shared-instructions.md)). |
| `tools/usage/snapshot.js` | Where the Claude allowance is going: the week used, whether the pace lasts, the costliest sessions. Runs in the owner's signed-in Chrome for the daily *Usage watch* ([`tools/usage/README.md`](tools/usage/README.md); how to spend less: [`docs/usage.md`](docs/usage.md)). |
| `tools/brief.mjs` | The weekday push to the owner's phone: the Priorities view's pick first, then what is waiting on the owner and worth doing soon ([`docs/brief.md`](docs/brief.md)). |
| `tools/build-standalone.mjs` | One self-contained HTML file with everything inlined (`dist/atlas.html`). |
| `assets/logos/` | Logos and pictures; `credits.json` says where each came from. |
| `test/check.mjs` | The Atlas's own checks (`node test/check.mjs`, about a second). |

## Running it locally

```bash
python3 -m http.server 8000                         # then http://localhost:8000
GITHUB_TOKEN=… node tools/collect.mjs               # refresh data/map.json from GitHub
node tools/collect.mjs --local ~/src                # …reading atlas.json drafts from clones under ~/src first
node tools/drift.mjs --manifest ../RPi_ALERT/atlas.json   # one repository's check, report only
```

Adding a repository: [`docs/adding-a-repo.md`](docs/adding-a-repo.md).
