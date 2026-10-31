# Adding a repository to the Atlas

1. **Registry.** Add an entry to `data/registry.json`: an `id` (lowercase, dashes), the
   `repo`, a `group` (zone), `x`/`y` on the map (about 1700 × 1050; drag it on the live
   map to find a spot, then copy the numbers), `size` (1 is normal), a `logo` in
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
3. **CLAUDE.md.** Copy the "Atlas" section from any repository already on the map
   (RPi_ALERT's is a good one) and change the id.
4. **Workflow.** Copy `.github/workflows/atlas.yml` from RPi_ALERT. Set `issues: false` if
   the repository has issues turned off, or its own rules say who opens issues.
5. Run `node test/check.mjs` here and push. The next collect (or **Run workflow** on
   *Collect* in the Actions tab) puts it on the map.
