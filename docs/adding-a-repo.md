# Adding a repository to the Atlas

1. **Registry.** Add an entry to `data/registry.json`: an `id` (lowercase, dashes), the
   `repo`, a `group` (zone), `x`/`y` on the map (about 1700 × 1050; drag it on the live
   map to find a spot, then copy the numbers), `tall` — `[x, y]` for the map on a phone held
   upright (about 1000 × 1650, the zones stacked top to bottom; every repository needs one,
   or phones get the wide map) — `size` (1 is normal), a `logo` in
   `assets/logos/` (add its source to `assets/logos/credits.json`), and `private: true` if
   it is. A private repository with a public Pages site also takes `pages` (its site URL),
   so the Atlas can read its `atlas.json` from there.
2. **atlas.json.** In the repository's root, following `schema/atlas.schema.json`. Start
   from this and fill it in from the code, not from memory:

   ```json
   {
     "$schema": "https://cdomotor-g.github.io/atlas/schema/atlas.schema.json",
     "atlas": 1,
     "id": "my-repo",
     "repo": "cdomotor-g/my-repo",
     "name": "My Repo",
     "tagline": "One line: what it is.",
     "about": "Two to four plain sentences.",
     "kind": "web app",
     "site": "https://cdomotor-g.github.io/my-repo/",
     "docs": { "readme": "README.md", "agents": "CLAUDE.md" },
     "status": {
       "phase": "building",
       "updated": "2026-10-31",
       "summary": "One sentence: where it is up to today.",
       "now": [], "next": [], "blocked": []
     },
     "components": [],
     "provides": [],
     "consumes": []
   }
   ```

   If the repository can't carry the file (archived, or someone else's), put it in
   `data/fallback/<id>.json` here instead.
3. **CLAUDE.md.** With the `atlas.json` in place, point the repository at the shared
   instructions: `node tools/shared.mjs <path to its folder>` (`docs/shared-instructions.md`).
   That gives its `CLAUDE.md` the *Shared instructions* section and its
   `.claude/settings.json` the start-up hook that loads `shared/instructions.md` and
   `shared/on-the-atlas.md` (how to work with the map) into every session. Then add a short
   *Atlas* section of its own: `This repo is **`<id>`** on the Atlas`, and anything particular
   to it (issues turned off, a pin that moves by itself).
4. **Workflow.** Copy `.github/workflows/atlas.yml` from RPi_ALERT. Set `issues: false` if
   the repository has issues turned off, or its own rules say who opens issues.
5. Run `node test/check.mjs` here and push. The next collect (or **Run workflow** on
   *Collect* in the Actions tab) puts it on the map.
