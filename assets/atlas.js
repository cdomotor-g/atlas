/* Atlas — draws data/map.json (built by tools/collect.mjs) as a zoomable map, plus
   roadmap, board, links and activity views. No libraries, no build step. */
(() => {
'use strict';

// ------------------------------------------------------------------ words that mean something here
const HOW = {
  vendored:  { k: 'copy',      label: 'Copied',     means: 'A verbatim copy of the other repository\'s files is kept here, at a known commit. When the original changes, the copy has to be refreshed.' },
  generated: { k: 'copy',      label: 'Generated',  means: 'Data here is made from the other repository\'s data at a known commit. When the source data changes, it has to be made again.' },
  built:     { k: 'copy',      label: 'Built',      means: 'The other repository\'s source is built into something here (a firmware image, a bundle) at a known commit.' },
  live:      { k: 'live',      label: 'Read live',  means: 'Read from the other repository (or its site or API) every time it runs, so it is always current — but a breaking change there breaks this at once.' },
  release:   { k: 'release',   label: 'Release',    means: 'Looks at the other repository\'s latest published release (its version number).' },
  protocol:  { k: 'protocol',  label: 'Protocol',   means: 'Speaks a format or protocol the other repository defines. Both ends must change together.' },
  reference: { k: 'reference', label: 'Cites',      means: 'Links to or describes the other repository (docs, a catalogue). Goes stale rather than breaking.' },
  ported:    { k: 'reference', label: 'Ported',     means: 'Code or ideas taken from the other repository once and now looked after here, independently.' },
};
const STATE = {
  behind:    { label: 'Behind',    cls: 'bad',  means: 'The other repository has changed what this one watches since it last caught up. Something here probably needs refreshing.' },
  current:   { label: 'Current',   cls: 'good', means: 'Nothing this repository watches has changed upstream since it last caught up.' },
  unknown:   { label: 'Unknown',   cls: '',     means: 'The Atlas could not work it out — a private repository, a pin it could not read, or the GitHub API refused.' },
  untracked: { label: 'Live',      cls: 'acc',  means: 'No catch-up point is recorded: it is read live, or it is a loose reference.' },
  stale:     { label: 'May be stale', cls: 'warn', means: 'Something this repository cites or ported has changed since it was last reviewed. Worth a look; nothing is broken.' },
};
// A citation or a one-off port that has moved on is a nudge, not a break.
const stateOf = l => { const st = l.drift?.state || 'untracked'; return st === 'behind' && HOW[l.how]?.k === 'reference' ? 'stale' : st; };
const PHASE = {
  idea:        { color: '#8a4fd0', means: 'An idea, not built yet.' },
  building:    { color: '#2a7fd4', means: 'Being built; not yet in use.' },
  beta:        { color: '#1f9a8a', means: 'In use, still settling — expect changes.' },
  live:        { color: '#2f9e5f', means: 'In use and looked after.' },
  maintenance: { color: '#8d96a0', means: 'Works and is kept working; no new features planned.' },
  archived:    { color: '#8d96a0', means: 'Finished or superseded; kept for reference.' },
};
const COMP_STATUS = { live: '#2f9e5f', beta: '#1f9a8a', building: '#2a7fd4', planned: '#8a4fd0', retired: '#8d96a0' };

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, parent) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('atlas:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('atlas:' + k, JSON.stringify(v)); } catch { /* private window */ } },
};
function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const daysSince = d => d ? (Date.now() - new Date(d).getTime()) / 86400000 : Infinity;
const term = (text, means, cls = '') => `<span class="chip ${cls}" title="${esc(means)}">${esc(text)}</span>`;
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), 1800);
}
async function copyText(text, btn, msg = 'Copied — paste it into a new Claude Code session or Dispatch') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* nothing more to try */ } ta.remove();
  }
  if (btn) { btn.classList.add('done'); const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.classList.remove('done'); btn.textContent = old; }, 1400); }
  toast(msg);
}

// "#12" → issue in this repo; "owner/repo#12" → elsewhere; `code` → <code>
function rich(text, repo) {
  let h = esc(text);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g, (m, r, n) => `<a href="https://github.com/${r}/issues/${n}" target="_blank" rel="noopener">${r.split('/')[1]}#${n}</a>`);
  if (repo) h = h.replace(/(^|[\s(>])#(\d+)\b/g, (m, pre, n) => `${pre}<a href="https://github.com/${repo}/issues/${n}" target="_blank" rel="noopener">#${n}</a>`);
  return h;
}

// ------------------------------------------------------------------ data
let D, R = new Map(), L = [], ISSUES = [];
// v2: the map was re-laid out (2026-11-02); a drag saved against the old layout
// would put one repository back where the new one has another.
const layoutKey = 'layout-v2';
let custom = {};
// Two arrangements: the registry's x/y for a wide window, and its `tall` [x, y] for
// one held upright (a phone) — the map area more than 1.15 times as tall as it is
// wide. A drag is kept per arrangement.
let tall = false;
const hasTall = () => D.repos.every(r => Array.isArray(r.tall));
function isTall() {
  const el = $('#map'), w = el?.clientWidth || innerWidth, h = el?.clientHeight || innerHeight;
  return h > w * 1.15;
}
const layoutStore = () => layoutKey + (tall ? '-tall' : '');
function place() {
  tall = hasTall() && isTall();
  custom = store.get(layoutStore(), {});
  for (const r of D.repos) {
    const home = tall ? { x: r.tall[0], y: r.tall[1] } : D.registryPos?.[r.id] || { x: r.x, y: r.y };
    const pos = custom[r.id] || home;
    r.x = pos.x; r.y = pos.y;
  }
  const reset = $('#btn-reset');
  if (reset) reset.hidden = !Object.keys(custom).length;
}
// Turned from wide to tall or back since the map was drawn: draw it the other way.
function placeIfTurned() {
  if (!hasTall() || isTall() === tall) return false;
  place(); drawAll(); fit(null, false);
  return true;
}

function prepare(data) {
  D = data;
  R = new Map(D.repos.map(r => [r.id, r]));
  for (const r of D.repos) {
    const m = r.manifest || {};
    r.m = m;
    r.phase = m.status?.phase || (r.gh?.archived ? 'archived' : 'live');
    r.r = 44 * (r.size || 1);
    r.comps = (m.components || []).map(c => ({ ...c, repo: r.id }));
    r.in = []; r.out = [];
    for (const i of r.issues || []) if (i.computer) i.human = true; // [Computer]: an agent on the owner's computer does it, so it waits on them too
    r.humans = (r.issues || []).filter(i => i.human);
    r.ciFail = (r.ci || []).filter(c => c.conclusion === 'failure');
  }
  place();
  L = (D.links || []).filter(l => R.has(l.from) && R.has(l.to));
  for (const l of L) {
    // `id` is `<consumer>:<entry id>`, one per line on the map; `entry` is the id the consumer
    // gave it under `consumes`, the one a person reads. A map.json from before carries only
    // the entry id, which two consumers can share: make the same pair from it.
    if (!l.entry) { l.entry = l.id; l.id = `${l.to}:${l.entry}`; }
    l.kind = HOW[l.how]?.k || 'reference';
    R.get(l.from).out.push(l); R.get(l.to).in.push(l);
  }
  for (const r of D.repos) { r.behindIn = r.in.filter(l => stateOf(l) === 'behind'); r.staleIn = r.in.filter(l => stateOf(l) === 'stale'); }
  ISSUES = D.repos.flatMap(r => (r.issues || []).map(i => ({ ...i, repo: r })));
  buildBlockers();
  buildItems();
}

// ------------------------------------------------------------------ blockers
// Everything stopping work, as one list: what each repository records in status.blocked,
// plus what the Atlas can see for itself — [Human] issues, links behind upstream, asks
// nobody has filed, failing CI, a status nobody has checked for a month. Each carries the
// ways through it: the repository's own options, or a suggested one.
const KIND = {
  decision: 'Someone has to choose.',
  access: 'Needs an account, a secret or a setting behind the owner\'s sign-in. An agent on their computer can do it signed in as them.',
  hardware: 'Needs a device, a bench or a site visit.',
  money: 'Needs spending.',
  upstream: 'Waits on another repository or a vendor.',
  time: 'Waits for data to build up, or for a date.',
  other: '',
};
// "On your computer": a Claude session at the owner's own computer, signed in as them — Claude
// in Chrome (or the Claude app's browser) for websites and dashboards, computer use for desktop
// apps, Claude Code in a folder shared through Remote Control for a shell. What needs only the
// owner's sign-in goes there; what needs their hands, money or say stays "Only you".
const ON_COMPUTER = 'An agent at your computer, signed in as you: Claude in Chrome for websites and dashboards, computer use for desktop apps. You approve each site and app and type any password; it asks before anything that spends, deletes or can\'t be undone.';
const LANES = [
  { id: 'human', name: 'Only you', about: 'Hardware, money or a judgment call: what an agent can\'t do even signed in as you. The options say what one can take off your plate first.' },
  { id: 'computer', name: 'On your computer', about: 'Behind your sign-in, not your judgment: a dashboard, a setting, an account page. Do it for me copies a brief for a Claude session on your computer (Dispatch, or the desktop app with Claude in Chrome); it works signed in as you while you approve.' },
  { id: 'agent', name: 'An agent can clear', about: 'Nobody has to decide anything: hand one to a session with the prompt.' },
  { id: 'repo', name: 'Waiting on another repo', about: 'Clears when the other repository moves. The options say how to make it move.' },
];
// What clearing a blocker takes — the columns of "What it takes".
const NEEDS = [
  { id: 'decision', name: 'A decision', about: 'Someone has to choose. Usually minutes once the options are in front of you.' },
  { id: 'access', name: 'Your sign-in', about: 'An account, a secret or a dashboard setting behind your sign-in. An agent on your computer can do it as you.' },
  { id: 'hardware', name: 'Hardware or a site', about: 'A device, a bench or a site visit.' },
  { id: 'money', name: 'Money', about: 'Something has to be bought.' },
  { id: 'time', name: 'Time or real use', about: 'Waits for data to build up, for a date, or for real use.' },
  { id: 'upstream', name: 'Someone else', about: 'Another repository, or a vendor outside the Atlas.' },
  { id: 'agent', name: 'Agent work', about: 'An agent can clear it: hand it the prompt.' },
  { id: 'other', name: 'Something else', about: 'None of the above.' },
];
// How big the suggested way through is — the columns of "Quick wins".
const EFFORT = [
  { id: 'm5', label: '5 min or less', max: 5 },
  { id: 'm15', label: 'About 15 min', max: 15 },
  { id: 'm30', label: 'Half an hour', max: 30 },
  { id: 'h1', label: 'About an hour', max: 90 },
  { id: 'half', label: 'Half a day', max: 300 },
  { id: 'day', label: 'A day or more', max: Infinity },
  { id: 'none', label: 'Not sized', max: null },
];
function minutesOf(e) {
  const s = String(e || '').toLowerCase().trim(); let m;
  if (!s) return null;
  if ((m = s.match(/(\d+)\s*[–-]\s*(\d+)\s*h/))) return (+m[1] + +m[2]) * 30;
  if ((m = s.match(/(\d+)\s*h(?:ou)?rs?\b/))) return +m[1] * 60;
  if ((m = s.match(/(\d+)\s*min/))) return +m[1];
  if (/\b(an|one) hour\b|\bsitting\b/.test(s)) return 60;
  if (/afternoon|morning|half a day/.test(s)) return 240;
  if (/\bdays?\b|\bweeks?\b|\bforums?\b|\btrip\b/.test(s)) return 480;
  if (s === 'low') return 30;
  if (/^med/.test(s)) return 120;
  if (s === 'high') return 480;
  if (/\bnone\b/.test(s)) return 0;
  return null;
}
const effortOf = mins => mins === null ? 'none' : EFFORT.find(x => x.max !== null && mins <= x.max).id;
// A [Human] issue's title says roughly what it needs.
const HANDS = /\b(sites?|bench|hardware|masts?|antennas?|technician|trial|install|commission|field)\b/i;
const MONEY = /\b(buy|order|pay|spend|purchase)\b/i;
function guessKind(t) {
  if (/^(decide|choose|review|check|spot-check|maybe)\b/i.test(t)) return 'decision';
  if (/\b(sign[- ]?in|switch(es)? on|settings?|secrets?|dashboard|auth|tokens?|credentials?|accounts?|DNS|rename|passwords?)\b/i.test(t)) return 'access';
  if (HANDS.test(t)) return 'hardware';
  if (MONEY.test(t)) return 'money';
  return null;
}
let BLOCKERS = [], BLK = new Map();
const issueNum = ref => { const m = String(ref || '').match(/^#(\d+)$/); return m ? +m[1] : null; };
function whoOf(on) {
  if (!on || on === 'human') return 'human';
  if (on === 'agent' || on === 'computer') return on;
  const id = on.split('#')[0];
  return R.has(id) ? id : 'human';
}
const laneOf = b => ['human', 'computer', 'agent'].includes(b.who) ? b.who : 'repo';
const needOf = b => b.lane === 'agent' ? 'agent' : b.lane === 'repo' ? 'upstream' : NEEDS.some(n => n.id === b.kind) ? b.kind : b.lane === 'computer' ? 'access' : 'other';
// Who a [Human] issue waits on: the blocker that stands for it if there is one, else its own
// tags — [Computer], or a title about a sign-in, a setting or a dashboard (and not hardware,
// a site, another person or money as well), is for your computer.
const asYou = i => !!i.computer || (guessKind(i.title) === 'access' && !HANDS.test(i.title) && !MONEY.test(i.title));
function issueLane(r, i) {
  const key = `${r.repo.toLowerCase()}#${i.n}`;
  const b = BLOCKERS.find(x => x.iss?.key === key && (x.lane === 'human' || x.lane === 'computer'));
  return b ? b.lane : asYou(i) ? 'computer' : 'human';
}
const issueBlocker = (r, i) => BLOCKERS.find(x => x.iss?.key === `${r.repo.toLowerCase()}#${i.n}` && x.lane === 'computer');

// Tags: every blocker can be found by one. Its issue when it has one (#237, or MegaNet#239
// for an issue in another repository); otherwise the Atlas's name for it — its id in
// status.blocked, or one made from its first words — drawn dashed. The name is also the end
// of its address (#blockers/rpi-alert/bench-first-run).
const STOP = new Set('a an and are as at be by for from has have in into is it its of on or the their this to with'.split(' '));
const slugWords = (s, n = 4) => String(s || '').toLowerCase().replace(/(^|\s)#\d+\b/g, ' ').replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(w => w && !STOP.has(w)).slice(0, n).join('-') || 'blocker';
// '#12' or 'owner/repo#12' at the start of a string, read from `repo`.
function issueAt(ref, repo) {
  const m = String(ref || '').match(/^\s*(?:([\w.-]+\/[\w.-]+))?#(\d+)/);
  if (!m) return null;
  const full = m[1] || repo.repo;
  return { full, n: +m[2], key: `${full.toLowerCase()}#${m[2]}`, local: full.toLowerCase() === repo.repo.toLowerCase() };
}
const repoByFull = full => D.repos.find(x => x.repo.toLowerCase() === String(full).toLowerCase());
const MARK = /Atlas blocker:\s*([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*)/i;

function buildBlockers() {
  const out = [];
  // An issue made from a blocker opens with its tag ("Atlas blocker: rpi-alert/bench-first-run"),
  // so the two meet before anyone puts the number in atlas.json.
  const marked = new Map();
  for (const r of D.repos) for (const i of r.issues || []) {
    const t = i.blocker || String(i.excerpt || '').match(MARK)?.[1];
    if (t && !marked.has(t.toLowerCase())) marked.set(t.toLowerCase(), { r, i });
  }
  const used = new Map();
  const name = (r, want) => { if (!used.has(r.id)) used.set(r.id, new Set()); const s = used.get(r.id); let n = want, k = 2; while (s.has(n)) n = `${want}-${k++}`; s.add(n); return n; };
  const covered = new Map(); // repo id → issue numbers its blockers already stand for
  const cover = (full, n) => { const r = repoByFull(full); if (!r) return; if (!covered.has(r.id)) covered.set(r.id, new Set()); covered.get(r.id).add(n); };
  const found = (r, slug) => { const f = marked.get(`${r.id}/${slug}`); if (!f) return null; cover(f.r.repo, f.i.n); return f.r === r ? `#${f.i.n}` : `${f.r.repo}#${f.i.n}`; };

  for (const r of D.repos) {
    (r.m.status?.blocked || []).forEach((b, i) => {
      for (const m of `${b.issue || ''} ${b.what}`.matchAll(/(?:^|[^\w/])#(\d+)/g)) cover(r.repo, +m[1]);
      const own = issueAt(b.issue, r);
      const slug = name(r, b.id || (own?.local ? String(own.n) : slugWords(b.what)));
      const hit = b.issue ? null : found(r, slug);
      out.push({ key: `${r.id}:b${i}`, slug, named: !!b.id, repo: r, what: b.what, on: b.on, who: whoOf(b.on), kind: b.kind || null, since: b.since || null,
        issue: b.issue || hit, found: !!hit, holds: b.holds || [], options: b.options || [], source: 'recorded' });
    });
    // Something it takes from another repository has moved on.
    for (const l of r.behindIn) {
      const p = R.get(l.from);
      const issue = (r.issues || []).find(i => /^Upstream moved:/i.test(i.title) && i.title.includes(p.repo.split('/')[1]));
      const oldest = (l.drift.commits || []).map(c => c.date).sort()[0];
      const comp = consumerComp(l);
      // A short name for what it takes: the provider's `provides` name, its part, or the entry's id.
      const given = (p.m.provides || []).find(x => x.id === l.provider)?.name || providerComp(l)?.name || l.entry;
      // The tag stays behind-<entry id> (rpi-alert/behind-quansheng-v1-serial): issues and links already carry it.
      out.push({ key: `${r.id}:d:${l.entry}`, slug: name(r, `behind-${l.entry}`), repo: r, what: `Behind ${p.name}: ${given}`, on: 'agent', who: 'agent', kind: 'upstream',
        since: oldest?.slice(0, 10) || null, issue: issue ? `#${issue.n}` : null, link: l.id, lk: l, source: 'drift',
        holds: [`${comp ? comp.name : r.name}, in step with ${p.name} again`],
        options: [
          { what: l.on_change || `Bring it in line with ${p.name}, then move the pin in atlas.json.`, by: 'agent', model: 'Sonnet5/Med', recommended: true, issue: issue ? `#${issue.n}` : undefined },
          { what: `Check whether the upstream change matters here at all; if not, move the pin and say why in the commit.`, by: 'agent', model: 'Sonnet5/Low', effort: 'Low' },
        ] });
    }
    // Asks of another repository.
    for (const a of r.m.asks || []) {
      const t = R.get(a.to);
      if (!t) continue;
      const slug = name(r, `ask-${slugWords(a.what, 3)}`);
      const issue = a.issue || found(r, slug);
      out.push({ key: `${r.id}:a:${a.to}:${a.what.slice(0, 24)}`, slug, repo: r, what: a.what, on: issue || a.to, who: a.to, kind: 'upstream', target: a.to,
        since: a.since || null, issue: issue || null, found: !a.issue && !!issue, holds: [], source: 'ask',
        options: issue
          ? [{ what: `Work ${issue} in ${t.name}.`, by: 'agent', model: 'Sonnet5/Med', recommended: true, issue }]
          : [{ what: `File it as an issue in ${t.repo}, then put the issue in atlas.json's asks.`, by: 'agent', model: 'Sonnet5/Low', effort: '10 min', recommended: true },
             { what: `Make the change in ${t.name} directly, in a session that has both repositories.`, by: 'agent', model: 'Sonnet5/Med' }] });
    }
    for (const c of r.ciFail) out.push({ key: `${r.id}:ci:${c.name}`, slug: name(r, `ci-${slugWords(c.name, 3)}`), repo: r, what: `CI failing: ${c.name}`, on: 'agent', who: 'agent', kind: null,
      since: c.date?.slice(0, 10), issue: null, holds: [], source: 'ci', url: c.url,
      options: [{ what: `Read the failing step's log tail and fix it${r.id === 'flood-net' ? ' (or run /ci-doctor)' : ''}.`, by: 'agent', model: 'Sonnet5/Med', recommended: true }] });
    if (r.manifest && daysSince(r.m.status?.updated) > 30) out.push({ key: `${r.id}:stale`, slug: name(r, 'status-check'), repo: r, what: `Status not checked since ${r.m.status?.updated}`, on: 'agent', who: 'agent', kind: 'time',
      since: r.m.status?.updated, holds: ['an accurate map'], source: 'stale',
      options: [{ what: 'Re-read the repository and its open issues and refresh status in atlas.json.', by: 'agent', model: 'Sonnet5/Low', recommended: true }] });
  }
  // [Human] issues the repository's status doesn't already cover.
  for (const r of D.repos) {
    const cov = covered.get(r.id) || new Set();
    for (const i of r.issues || []) {
      if (!i.human || cov.has(i.n) || /^roadmap\b/i.test(i.title)) continue;
      const children = (r.issues || []).filter(c => c.structure === 'sub' && c.parent === i.n).map(c => `#${c.n}`);
      const mine = asYou(i);
      let kind = guessKind(i.title) || (i.computer ? 'access' : null);
      if (kind === 'access' && !mine) kind = HANDS.test(i.title) ? 'hardware' : 'money'; // a login, but hands or money too
      out.push({ key: `${r.id}:i${i.n}`, slug: name(r, String(i.n)), repo: r, what: `#${i.n} ${i.title}`, on: 'human', who: mine ? 'computer' : 'human', kind, kindGuessed: !!kind && !i.computer, tagged: !!i.computer,
        since: i.created?.slice(0, 10), issue: `#${i.n}`, holds: children, source: 'issue', context: i.excerpt || '',
        options: mine
          ? [{ what: `Do what #${i.n} asks, signed in as me, from the steps in the issue; tick each one off there as it's done.`, by: 'computer', recommended: true, issue: `#${i.n}` },
             { what: `Do it yourself from the steps in #${i.n}.`, by: 'human', issue: `#${i.n}` }]
          : [{ what: `Do what #${i.n} asks; its steps are in the issue.`, by: 'human', recommended: true, issue: `#${i.n}` },
             { what: `Do every part of #${i.n} that needs no hardware, money or decision — signed in as me where it needs a login — and leave what's left for me as a short list in the issue.`, by: 'computer', effort: 'Low' }],
      });
    }
  }

  for (const b of out) {
    b.uid = `${b.repo.id}/${b.slug}`;
    b.iss = b.issue ? issueAt(b.issue, b.repo) : null;
    b.tag = b.iss ? (b.iss.local ? `#${b.iss.n}` : `${b.iss.full.split('/')[1]}#${b.iss.n}`) : b.slug;
    // "#237 switch accounts on…" reads "Switch accounts on…" beside the tag #237.
    const bare = b.iss ? b.what.replace(new RegExp(`^\\s*(?:[\\w.-]+\\/[\\w.-]+)?#${b.iss.n}\\b[:\\s]*`), '') : b.what;
    b.title = bare === b.what ? b.what : bare.charAt(0).toUpperCase() + bare.slice(1);
    // A blocker recorded on the owner that needs only their sign-in (kind access) goes to an
    // agent on their computer: the login is what it borrows.
    if (b.source === 'recorded' && b.who === 'human' && b.kind === 'access') { b.who = 'computer'; b.reframed = true; }
    b.lane = laneOf(b);
    b.need = needOf(b);
    b.age = b.since ? Math.max(0, Math.round(daysSince(b.since))) : null;
    b.rec = b.options.find(o => o.recommended) || b.options[0] || null;
    b.mins = minutesOf(b.rec?.effort);
    b.effort = effortOf(b.mins);
    b.kids = []; b.parents = []; b.outs = [];
    // The collector keeps every open issue of a public repository, so one it doesn't have is closed.
    const ir = b.iss && repoByFull(b.iss.full);
    b.closed = !!(ir && !ir.private && ir.visible !== false && Array.isArray(ir.issues) && !ir.issues.some(i => i.n === b.iss.n));
  }
  // What frees what. A blocker holds another up when its `holds` names the other's issue
  // ("#255", or "#255 (why)"), or when the other is the same issue seen from another
  // repository (SoRT waiting on Flood-Net's #235). Everything else it holds is work it frees.
  const home = new Map();
  for (const b of out) if (b.iss?.local) { if (!home.has(b.iss.key)) home.set(b.iss.key, []); home.get(b.iss.key).push(b); }
  const tie = (a, c, note, same = false) => { if (a === c || a.kids.some(k => k.b === c)) return; a.kids.push({ b: c, note: note || '', same }); c.parents.push(a); };
  for (const a of out) for (const h of a.holds) {
    const m = String(h).match(/^\s*(?:[\w.-]+\/[\w.-]+)?#\d+\s*(?:\(([^)]*)\))?\s*$/);
    if (m) {
      const iss = issueAt(h, a.repo), ts = (home.get(iss.key) || []).filter(t => t !== a);
      if (ts.length) ts.forEach(t => tie(a, t, m[1]));
      else a.outs.push({ type: 'issue', iss, note: m[1] || '' });
    } else if (R.has(h)) {
      if (!out.some(t => t.repo.id === h && t.iss && a.iss && t.iss.key === a.iss.key)) a.outs.push({ type: 'repo', id: h });
    } else a.outs.push({ type: 'text', text: String(h) });
  }
  for (const c of out) if (c.iss && !c.iss.local) for (const a of home.get(c.iss.key) || []) tie(a, c, `the same issue, seen from ${c.repo.label || c.repo.name}`, true);
  // How much clearing it frees: what it holds, plus each blocker behind it and what that holds.
  // The same issue seen from another repository counts for what it holds there, not twice.
  for (const b of out) {
    const seen = new Set(), other = new Set();
    const walk = x => x.kids.forEach(k => { if (k.b !== b && !seen.has(k.b)) { seen.add(k.b); if (!k.same) other.add(k.b); walk(k.b); } });
    walk(b);
    b.downstream = [...seen];
    b.frees = b.outs.length + other.size + b.downstream.reduce((n, x) => n + x.outs.length, 0);
    b.score = b.frees * 3 + (b.lane === 'human' || b.lane === 'computer' ? 1 : 0) +Math.min(b.age || 0, 60) / 20 + (b.source === 'recorded' ? 1 : 0);
  }
  out.sort((a, b) => b.score - a.score);
  BLOCKERS = out;
  BLK = new Map(out.map(b => [b.uid, b]));
  for (const r of D.repos) r.blockers = out.filter(b => b.repo === r);
}

function holdChip(h, repo) {
  const m = String(h).match(/^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/);
  if (m) {
    const full = m[1] || repo.repo;
    const tgt = D.repos.find(x => x.repo.toLowerCase() === full.toLowerCase());
    const iss = (tgt?.issues || []).find(i => i.n === +m[2]);
    return `<a class="chip hold" href="https://github.com/${esc(full)}/issues/${m[2]}" target="_blank" rel="noopener" title="${esc(iss ? iss.title : 'Issue')}">${m[1] ? esc(full.split('/')[1]) : ''}#${m[2]}${iss ? ' ' + esc(iss.title.length > 34 ? iss.title.slice(0, 32) + '…' : iss.title) : ''}</a>`;
  }
  if (R.has(h)) { const t = R.get(h); return `<button class="chip hold" data-go-repo="${esc(t.id)}"><img src="${esc(t.logo)}" alt="">${esc(t.label || t.name)}</button>`; }
  return `<span class="chip hold">${esc(h)}</span>`;
}

function byBadge(o) {
  if (o.by === 'human') return `<span class="by by-human" title="You do this yourself">You</span>`;
  if (o.by === 'computer') return `<span class="by by-computer" title="${esc(ON_COMPUTER)}">Your computer</span>`;
  if (o.by === 'agent') return `<span class="by by-agent" title="An agent can do this${o.model ? ': ' + esc(o.model) + ' recommended' : ''}">Agent${o.model ? ` · ${esc(o.model)}` : ''}</span>`;
  const t = R.get(o.by);
  return t ? `<span class="by by-repo" title="Done in ${esc(t.name)}"><img src="${esc(t.logo)}" alt="">${esc(t.label || t.name)}</span>` : `<span class="by">${esc(o.by)}</span>`;
}

function optionPrompt(b, o) {
  const r = b.repo, where = R.get(o.by) || r;
  return [
    `In ${where.repo}: ${o.what}`,
    '',
    `This is a way through a blocker the Atlas records for ${r.name} (${r.repo}): "${b.what}"${b.since ? `, blocking since ${b.since}` : ''}. The Atlas's tag for it: ${b.uid}.`,
    b.holds.length ? `It holds up: ${b.holds.join(', ')}.` : '',
    b.issue ? `Tracking issue: ${/\//.test(b.issue) ? b.issue : r.repo + b.issue}` : '',
    o.issue && o.issue !== b.issue ? `This option's issue: ${/\//.test(o.issue) ? o.issue : where.repo + o.issue}` : '',
    b.lk ? driftText(b) : '',
    '',
    `Read ${where.repo}'s CLAUDE.md first and follow it.${o.model ? ` Recommended: ${o.model.replace('/', ' / ')}.` : ''}`,
    `When you're done, update status.blocked in ${manifestWhere(r)}: remove the blocker if it's cleared, or record what changed and what's left.`,
  ].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n');
}
function helpPrompt(b, o) {
  const iss = o.issue ? issueAt(o.issue, b.repo) : b.iss;
  return [
    `Walk me through this, one step at a time, and tell me what to check after each step: ${o.what}`,
    '',
    `It's to clear a blocker in ${b.repo.name} (${b.repo.repo}): "${b.what}". The Atlas's tag for it: ${b.uid}.`,
    iss ? `The issue has the details: https://github.com/${iss.full}/issues/${iss.n}` : '',
    `Read ${iss ? 'the issue and ' : ''}the repository's CLAUDE.md first. Never ask me to paste a secret into the chat.`,
    `If you can use my computer (Claude in Chrome for websites, computer use for apps), do the steps that only need me signed in yourself while I watch, and walk me through only what needs my hands, my money or my say.`,
  ].filter(Boolean).join('\n');
}
// For a Claude session at the owner's computer (Dispatch, or the desktop app with Claude in
// Chrome): it does the steps signed in as them, within the rules the owner would set.
function computerPrompt(b, o) {
  const iss = o.issue ? issueAt(o.issue, b.repo) : b.iss;
  return [
    `On my computer, signed in as me: ${o.what}`,
    '',
    `It clears a blocker in ${b.repo.name} (${b.repo.repo}): "${b.what}". The Atlas's tag for it: ${b.uid}.`,
    b.holds.length ? `It holds up: ${b.holds.join(', ')}.` : '',
    iss ? `The issue has the steps: https://github.com/${iss.full}/issues/${iss.n} — read it first, and the repository's CLAUDE.md.` : `Read the repository's CLAUDE.md first: https://github.com/${b.repo.repo}`,
    '',
    'How to work:',
    '- Websites and dashboards in my browser, where I am already signed in (Claude in Chrome, or the Claude app\'s own browser). Desktop apps with computer use. Anything that needs a shell here, in a Claude Code session in a folder I share through Remote Control.',
    '- Ask me for access to each site or app before you use it. When a page asks for a password or a two-factor code, stop and let me type it.',
    '- Never write a secret (a key, token or password) into the chat, a file, an issue or a commit.',
    '- Ask me before anything that deletes, publishes, sends a message as me or can\'t be undone, and before any choice the steps leave open. I place orders and payments myself: get them ready and hand them to me.',
    '- After each step, check that it took (reload, read the setting back), and tick it off in the issue.',
    '',
    `When it's done, comment on the issue with what you did and what's left, and update status.blocked in ${manifestWhere(b.repo)} (or ask a coding session to): take the blocker out if it's cleared, or say what's left.`,
  ].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n');
}

// Behind upstream: what changed, since when. The link records where the consumer last caught
// up (a review date, a pinned commit or a version); the drift check lists the provider's
// commits since then that touched the files the consumer watches.
const day = iso => { const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
function caughtUp(l) {
  const s = l.drift?.since || l.since || {};
  const at = s.commit ? `commit ${String(s.commit).slice(0, 7)}${s.commitDate ? ` of ${day(s.commitDate)}` : ''}` : s.version ? `version ${s.version}` : '';
  return { when: s.date ? day(s.date) : s.commitDate ? day(s.commitDate) : null, at, commit: s.commit || null };
}
function driftText(b) {
  const l = b.lk, d = l.drift || {}, p = R.get(l.from), c = caughtUp(l), cs = d.commits || [];
  return [
    `Why it's behind: ${b.repo.name} last caught up with ${p.name}${c.when ? ` on ${c.when}` : ''}${c.at ? ` (at ${p.name}'s ${c.at})` : ''}. Since then ${d.behind || cs.length} commit${(d.behind || cs.length) === 1 ? '' : 's'} there changed what it watches${(d.files || []).length ? ` (${d.files.join(', ')})` : ''}:`,
    ...cs.map(x => `- ${x.sha} ${x.date?.slice(0, 10) || ''} ${x.msg}${x.url ? ` ${x.url}` : ''}`),
  ].join('\n');
}
function driftHtml(b, { compact = false } = {}) {
  const l = b.lk; if (!l) return '';
  const d = l.drift || {}, p = R.get(l.from), r = b.repo, c = caughtUp(l), cs = d.commits || [];
  const n = d.behind || cs.length, how = HOW[l.how];
  const commits = cs.length ? `<ul class="why-commits">${cs.map(x => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"><code>${esc(x.sha)}</code></a>` : `<code>${esc(x.sha)}</code>`} <span class="muted">${esc(day(x.date))}</span> ${esc(x.msg)}</li>`).join('')}${n > cs.length ? `<li class="muted">…and ${n - cs.length} more</li>` : ''}</ul>` : '';
  const files = (d.files || []).length ? ` to ${d.files.map(f => `<code>${esc(f)}</code>`).join(', ')}` : '';
  const line = `<b>${n} commit${n === 1 ? '' : 's'}</b> in ${esc(p.name)}${files} since ${esc(r.name)} last caught up${c.when ? ` on ${esc(c.when)}` : ''}.`;
  if (compact) return `<details class="blk-why"><summary><b>Why it's behind:</b> ${line}</summary>${commits}</details>`;
  const pin = c.commit && /^[0-9a-f]{7,40}$/i.test(c.commit) ? `<a href="https://github.com/${esc(p.repo)}/commit/${esc(c.commit)}" target="_blank" rel="noopener">${esc(c.at)}</a>` : esc(c.at);
  return `<p>${esc(r.name)} takes this from ${esc(p.name)}: ${esc(l.what)}</p>
    ${how ? `<p>${term(how.label, how.means)} <span class="muted">${esc(how.means)}</span></p>` : ''}
    <p>${esc(r.name)} last caught up${c.when ? ` on <b>${esc(c.when)}</b>` : ''}${c.at ? ` (at ${pin})` : ''}. Since then <b>${n} commit${n === 1 ? '' : 's'}</b> there changed ${(d.files || []).length ? `${d.files.map(f => `<code>${esc(f)}</code>`).join(', ')}, which it watches` : 'what it watches'}:</p>
    ${commits}
    <p class="muted">No issue is behind this: those commits are the cause. It clears when ${esc(r.name)} has looked at them, done what they need (the ways through below), and moved its catch-up point for <code>${esc(l.entry)}</code> in ${manifestLink(r)}.</p>`;
}

// Where a repository's atlas.json lives: in the repository, or the Atlas's fallback copy.
const manifestUrl = r => r.manifestSource === 'fallback' ? `https://github.com/${D.owner}/atlas/blob/main/data/fallback/${r.id}.json` : `https://github.com/${r.repo}/blob/${r.branch || 'main'}/atlas.json`;
const manifestWhere = r => r.manifestSource === 'fallback' ? `${D.owner}/atlas's data/fallback/${r.id}.json` : `${r.repo}'s atlas.json`;
const manifestLink = r => `<a href="${esc(manifestUrl(r))}" target="_blank" rel="noopener">${r.manifestSource === 'fallback' ? `the Atlas's <code>data/fallback/${esc(r.id)}.json</code>` : `${esc(r.label || r.name)}'s <code>atlas.json</code>`}</a>`;

const cut = (s, n) => { s = String(s || '').replace(/`/g, ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const ageWords = a => a === null ? '' : a === 0 ? 'today' : a === 1 ? '1 day' : `${a} days`;
const tagTitle = b => `${b.repo.name}: ${cut(b.title, 240)}\n${b.iss ? `Issue ${b.iss.full}#${b.iss.n}${b.found ? ', found by its tag line' : ''}${b.closed ? ' — closed, so this may be cleared' : ''}.` : 'No issue yet: this is the Atlas’s name for it.'}\nOpen it for what it frees and the ways through.`;
// A blocker's tag. A button that opens it, or (span) a picture of one inside a bigger button.
function blkTag(b, { what = 0, span = false } = {}) {
  const el = span ? 'span' : 'button';
  return `<${el} class="btag lane-${b.lane}${b.iss ? '' : ' untracked'}"${span ? '' : ` data-blk="${esc(b.uid)}" title="${esc(tagTitle(b))}"`}><img src="${esc(b.repo.logo)}" alt=""><b>${esc(b.tag)}</b>${b.closed ? '<i class="bt-closed">closed</i>' : ''}${what ? `<span class="bt-what">${esc(cut(b.title, what))}</span>` : ''}</${el}>`;
}
function closedPrompt(b) {
  return [
    `In ${b.repo.repo}: the Atlas lists a blocker whose issue is closed — ${b.iss.full}#${b.iss.n}: "${b.what}". The Atlas's tag for it: ${b.uid}.`,
    '',
    `Read the issue and its last comments. If the blocker is cleared, take it out of status.blocked in ${manifestWhere(b.repo)}; if part of it is left, rewrite it to say what is left and point it at an open issue (file one if there is none). Then update anything it \`holds\`.`,
    '',
    `Read ${b.repo.repo}'s CLAUDE.md first and follow it. Recommended: Sonnet5 / Low.`,
  ].join('\n');
}
function whoChip(b) {
  if (b.lane === 'human') return term('Only you', 'Only you can clear this: hardware, money or a judgment call — what an agent can\'t do even signed in as you.', 'human');
  if (b.lane === 'computer') return term('On your computer', ON_COMPUTER, 'computer');
  if (b.lane === 'agent') return term('An agent can clear it', 'Nobody has to decide anything: hand it to a session with the prompt.', 'acc');
  const on = R.get(b.who);
  return `<span class="chip waits" title="Clears when ${esc(on.name)} moves">waits on <img src="${esc(on.logo)}" alt="">${esc(on.label || on.name)}</span>`;
}

function optsHtml(b) {
  const opts = b.options.length ? b.options : [{ what: 'No way through recorded yet. Ask an agent in this repository to list the options.', by: 'agent', model: 'Sonnet5/Low' }];
  // A step of yours in a blocker that needs only your sign-in can go to an agent on your computer too.
  const btns = o => o.by === 'computer' ? doItBtn(b, o)
    : o.by === 'human' ? `${b.lane === 'computer' ? doItBtn(b, o) : ''}${promptBtn(helpPrompt(b, o), 'Help me')}`
    : promptBtn(optionPrompt(b, o), 'Prompt');
  return `<ol class="opts" aria-label="Ways through">${opts.map(o => `<li class="opt ${o.recommended ? 'rec' : ''}">
      <div class="opt-head">${byBadge(o)}${o.effort ? `<span class="chip" title="Rough effort">${esc(o.effort)}</span>` : ''}${o.recommended ? '<span class="chip good" title="The option the repository would pick">suggested</span>' : ''}
        ${btns(o)}</div>
      <div class="opt-what">${rich(o.what, (R.get(o.by) || b.repo).repo)}${o.issue && o.issue !== b.issue ? ` ${rich(o.issue, b.repo.repo)}` : ''}</div>
      ${o.pros || o.cons ? `<div class="opt-pc">${o.pros ? `<span><b>+</b> ${esc(o.pros)}</span>` : ''}${o.cons ? `<span><b>−</b> ${esc(o.cons)}</span>` : ''}</div>` : ''}
    </li>`).join('')}</ol>`;
}

function blockerCard(b, { compact = false } = {}) {
  const r = b.repo;
  const src = { recorded: '', issue: term('from an issue', 'A [Human] issue the repository\'s status does not list yet.'), drift: term('behind upstream', 'Worked out by the Atlas: the other repository has changed something this one copies or follows, since this one last caught up. Open "Why it\'s behind" for the commits.', 'bad'), ask: term('an ask', 'Something this repository asked of another.', 'warn'), ci: term('CI', 'The latest run of this workflow failed.', 'warn'), stale: term('old status', 'Nobody has checked this repository\'s atlas.json status for a month.', 'warn') }[b.source];
  const on = b.lane === 'repo' ? R.get(b.who) : null;
  return `<article class="blk lane-${b.lane}" data-key="${esc(b.key)}">
    <div class="blk-top">${blkTag(b)}${compact ? '' : `<button class="linkish" data-go-repo="${esc(r.id)}">${esc(r.label || r.name)}</button>`}
      ${b.kind ? `<span class="chip" title="${esc(KIND[b.kind] || '')}">${esc(b.kind)}</span>` : ''}${src}
      ${b.age !== null ? `<span class="chip" title="Blocking since ${esc(b.since)}">${ageWords(b.age)}</span>` : ''}
      ${on ? `<span class="chip waits" title="Clears when ${esc(on.name)} moves">waits on <img src="${esc(on.logo)}" alt="">${esc(on.label || on.name)}</span>` : ''}</div>
    <h4 class="blk-what">${rich(b.title, r.repo)}${b.url ? ` <a href="${esc(b.url)}" target="_blank" rel="noopener">log ↗</a>` : ''}</h4>
    ${b.lk ? driftHtml(b, { compact: true }) : ''}
    ${b.context ? `<p class="blk-ctx" title="The opening of the issue">${esc(b.context)}</p>` : ''}
    ${b.parents.length ? `<div class="holds"><span class="holds-l" title="Blockers that have to clear first">Waits for</span>${b.parents.map(p => blkTag(p)).join('')}</div>` : ''}
    ${b.holds.length ? `<div class="holds"><span class="holds-l" title="What clearing this would unblock">Holds up</span>${b.holds.map(h => holdChip(h, r)).join('')}</div>` : ''}
    ${optsHtml(b)}
  </article>`;
}

// The one place that says everything about a blocker: what it is, what has to clear first,
// what it frees, the ways through, and how to give it an issue when it has none.
function newIssueTitle(b) {
  return `[Standalone] ${b.lane === 'human' ? '[Human]' : b.lane === 'computer' ? '[Human] [Computer]' : `[${b.rec?.model || 'Sonnet5/Med'}]`} ${cut(b.title, 110)}`;
}
const issueHome = b => b.source === 'ask' ? R.get(b.target) : b.lane === 'repo' && R.get(b.who) ? R.get(b.who) : b.repo;
const pageLink = b => `https://${D.owner}.github.io/atlas/#blockers/${b.uid}`;
function newIssueUrl(b) {
  const where = issueHome(b);
  const opt = (o, k) => `${k + 1}. ${o.recommended ? '**Suggested.** ' : ''}${o.by === 'human' ? 'You' : o.by === 'computer' ? 'An agent on your computer, signed in as you' : o.by === 'agent' ? `Agent${o.model ? ` (${o.model})` : ''}` : (R.get(o.by)?.name || o.by)}${o.effort ? `, ${o.effort}` : ''}: ${cut(o.what, 420)}`
    + (o.pros ? `\n   + ${cut(o.pros, 160)}` : '') + (o.cons ? `\n   − ${cut(o.cons, 160)}` : '');
  const record = b.source === 'ask' ? `\`issue\` on this ask (\`asks\`) in ${manifestWhere(b.repo)}, as ${where.repo}#N` : `\`issue\` on the blocker \`${b.slug}\` (\`status.blocked\`) in ${manifestWhere(b.repo)}`;
  let body = [
    `Atlas blocker: ${b.uid}`, '',
    `**${where === b.repo ? 'Blocked' : `${b.repo.name} is waiting on`}:** ${b.what}`,
    b.since ? `**Since:** ${b.since}` : null,
    b.holds.length ? `\n**Holds up**\n${b.holds.map(h => `- ${h}`).join('\n')}` : null,
    b.lk ? `\n**Upstream commits since it last caught up**\n${(b.lk.drift?.commits || []).map(x => `- ${x.url ? `[${x.sha}](${x.url})` : x.sha} ${x.date?.slice(0, 10) || ''} ${x.msg}`).join('\n')}` : null,
    b.options.length ? `\n**Ways through** (from atlas.json)\n${b.options.map(opt).join('\n')}` : null,
    '', '---',
    `From the Atlas: ${pageLink(b)}`,
    b.source === 'drift'
      ? `It clears when the catch-up point for \`${b.lk.entry}\` (\`consumes\`) moves in ${manifestWhere(b.repo)}: close this issue then. Keep the first line: the Atlas matches this issue to the blocker by it.`
      : `Once this is filed, put its number in ${record}. Keep the first line: until then the Atlas matches this issue to the blocker by it.`,
  ].filter(x => x !== null).join('\n');
  if (body.length > 3600) body = body.slice(0, 3580) + '\n…';
  return `https://github.com/${where.repo}/issues/new?title=${encodeURIComponent(newIssueTitle(b))}&body=${encodeURIComponent(body)}`;
}
function fileIssuePrompt(b) {
  const where = issueHome(b);
  return [
    `In ${where.repo}: file a blocker from the Atlas as an issue, then record the issue on the blocker.`,
    '',
    `The blocker (${b.repo.name}, ${b.source === 'ask' ? 'an ask in atlas.json\'s asks' : `status.blocked${b.named ? ` id \`${b.slug}\`` : ''}`}): "${b.what}"${b.since ? `, since ${b.since}` : ''}.`,
    b.holds.length ? `It holds up: ${b.holds.join('; ')}.` : '',
    '',
    `1. Open an issue in ${where.repo} titled like "${newIssueTitle(b)}" (a short plain title is fine). Start its body with the line "Atlas blocker: ${b.uid}", then what is blocked, what it holds up and the ways through as atlas.json lists them${b.lane === 'human' ? ', with the owner\'s part click by click' : b.lane === 'computer' ? ', with the signed-in steps click by click so an agent on the owner\'s computer can follow them' : ''}.`,
    `2. Put the new issue in ${b.source === 'ask' ? `\`issue\` on that ask, as ${where.repo}#N,` : '`issue` on that blocker'}${b.source === 'recorded' && !b.named ? ` and give the blocker "id": "${b.slug}"` : ''} in ${manifestWhere(b.repo)}, and push.`,
    '',
    `Read ${where.repo}'s CLAUDE.md first and follow it. Recommended: Sonnet5 / Low.`,
  ].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n');
}
function trackedHtml(b) {
  if (b.iss) {
    const t = repoByFull(b.iss.full), i = (t?.issues || []).find(x => x.n === b.iss.n);
    return `<p><a href="https://github.com/${esc(b.iss.full)}/issues/${b.iss.n}" target="_blank" rel="noopener"><b>${esc(b.iss.full.split('/')[1])}#${b.iss.n}</b>${i ? ' ' + esc(i.title) : ''} ↗</a></p>
      ${b.closed ? `<div class="box warn"><b>That issue is closed</b>, but ${esc(b.repo.name)} still lists this as a blocker. It may be cleared: check the issue, then take it out of ${manifestLink(b.repo)} or say what is left.<div class="chips">${promptBtn(closedPrompt(b), 'Prompt: check it')}</div></div>` : ''}
      ${b.found ? `<p class="muted">Found by the issue's first line (<code>Atlas blocker: ${esc(b.uid)}</code>). Put the number in ${b.source === 'ask' ? '<code>issue</code> on this ask' : '<code>issue</code> on this blocker'} in ${manifestLink(b.repo)} to make it stick.</p>` : ''}`;
  }
  if (b.source === 'drift' && b.lk?.drift_issue) return `<p>None yet. ${esc(b.repo.name)}'s daily Atlas check opens one by itself at its next run (<i>Upstream moved: …</i>), with the upstream commits and how to catch up.</p>`;
  if (b.source === 'ci') return `<p>None needed: the failing run is the record. <a href="${esc(b.url)}" target="_blank" rel="noopener">Open its log ↗</a></p>`;
  if (b.source === 'stale') return '<p>None needed: an agent refreshes the status in atlas.json.</p>';
  const where = issueHome(b);
  const lead = b.source === 'drift' ? `<p>None, and none will open by itself: the daily Atlas check only keeps an issue for a link marked <code>drift_issue: true</code>, and <code>${esc(b.lk.entry)}</code> isn't, in ${manifestLink(b.repo)}. The commits above are the cause.</p>` : '';
  const why = `<p class="muted">Until it has a number, find it by its dashed tag <span class="btag untracked lane-${b.lane} demo"><b>${esc(b.slug)}</b></span>: it is in the search box, on every view, and at the end of this blocker's address.${b.source === 'recorded' && !b.named ? ' The tag is made from its first words: give the blocker an <code>id</code> in atlas.json to keep it fixed.' : ''}</p>`;
  if (where.gh?.archived) return `${lead}<div class="box untracked-box"><b>No issue, and ${esc(where.name)} is archived</b>, so it can't take one.</div>${why}`;
  return `${lead}<div class="box untracked-box"><b>No issue yet.</b> Give it one:
    <div class="chips"><a class="copy" href="${esc(newIssueUrl(b))}" target="_blank" rel="noopener" title="Opens GitHub's new-issue page in ${esc(where.repo)}, filled in with what it holds up and the ways through">Make the issue on GitHub ↗</a>${promptBtn(fileIssuePrompt(b), 'Prompt: file it for me')}</div>
    <p class="muted" style="margin:8px 0 0">The issue opens with the line <code>Atlas blocker: ${esc(b.uid)}</code>. ${where.private ? `The Atlas can't read issues in a private repository, so put the number in ${manifestLink(b.repo)} afterwards.` : `Keep it: at its next collect (every three hours) the Atlas links the issue to this blocker by itself, until the number is in ${manifestLink(b.repo)}.`}</p></div>${why}`;
}
function sourceHtml(b) {
  const r = b.repo;
  if (b.source === 'recorded') return `Recorded in ${manifestLink(r)} under <code>status.blocked</code>${b.named ? `, id <code>${esc(b.slug)}</code>` : ''}.${b.reframed ? ` It is on <code>"human"</code> there, but what it needs is your sign-in (<code>access</code>), so the Atlas puts it with an agent on your computer. Write <code>"on": "computer"</code> to say so in the file, or another kind if it needs more of you.` : ''}`;
  if (b.source === 'issue') return `A <code>[Human]</code> issue that ${esc(r.name)}'s atlas.json doesn't list as a blocker yet.${b.lane === 'computer' ? ` ${b.tagged ? 'Its title is tagged <code>[Computer]</code>' : 'Its title is about a sign-in, a setting or a dashboard'}, so the Atlas puts it with an agent on your computer.` : ''}`;
  if (b.source === 'drift') return `Worked out by the Atlas from <code>${esc(b.lk.entry)}</code> under <code>consumes</code> in ${manifestLink(r)}: ${esc(R.get(b.lk.from).name)} has changed a file it watches since ${esc(r.name)} last caught up.`;
  if (b.source === 'ask') return `${esc(r.name)} asked this of ${esc(R.get(b.target).name)} in ${manifestLink(r)} under <code>asks</code>.`;
  if (b.source === 'ci') return `The latest run of ${esc(r.name)}'s workflow failed.`;
  return `Nobody has checked ${esc(r.name)}'s status in atlas.json for over a month.`;
}
function outHtml(o, b) {
  if (o.type === 'issue') {
    const t = repoByFull(o.iss.full), i = (t?.issues || []).find(x => x.n === o.iss.n);
    return `<a href="https://github.com/${esc(o.iss.full)}/issues/${o.iss.n}" target="_blank" rel="noopener" title="${esc(i?.title || 'Issue')}">${o.iss.local ? '' : esc(o.iss.full.split('/')[1])}#${o.iss.n}</a>${i ? ' ' + esc(cut(i.title, 80)) : ''}${o.note ? ` <span class="muted">(${esc(o.note)})</span>` : ''}`;
  }
  if (o.type === 'repo') { const t = R.get(o.id); return `<button class="linkish" data-go-repo="${esc(t.id)}"><img src="${esc(t.logo)}" alt="">${esc(t.label || t.name)}</button>`; }
  return rich(o.text, b.repo.repo);
}
function blockerPanel(b) {
  if (!b) return `<div class="p-head"><div class="row1"><div><h2>No blocker by that name</h2><div class="sub">It may have been cleared since the link was made.</div></div><button class="icon-btn p-close" aria-label="Close">✕</button></div></div>
    <div class="p-body"><p>Every blocker there is now is on the Blockers view.</p></div>`;
  const r = b.repo;
  const effort = b.rec?.effort ? `<span class="chip" title="Size of the suggested way through">${esc(b.rec.effort)}</span>` : '';
  return `
  <div class="p-head"><div class="row1"><img src="${esc(r.logo)}" alt=""><div style="min-width:0"><div class="bp-tag">${blkTag(b, { span: true })}</div><h2 class="bp-title">${rich(b.title, r.repo)}</h2>
    <div class="sub">${esc(r.name)}${b.since ? ` · blocking since ${esc(b.since)} (${ageWords(b.age)})` : ''}</div></div>
    <button class="icon-btn p-close" aria-label="Close">✕</button></div>
    <div class="chips">${whoChip(b)}${b.kind ? `<span class="chip" title="${esc((KIND[b.kind] || '') + (b.kindGuessed ? ' Guessed from the issue title.' : ''))}">${esc(b.kind)}</span>` : ''}${effort}</div></div>
  <div class="p-body">
    ${b.title.length > 150 ? `<p class="bp-full">${rich(b.title, r.repo)}</p>` : ''}
    ${b.context ? `<p class="blk-ctx" title="The opening of the issue">${esc(b.context)}</p>` : ''}
    ${b.lk ? `<h3>Why it's behind</h3>${driftHtml(b)}` : ''}
    <h3>Tracked in</h3>${trackedHtml(b)}
    ${b.parents.length ? `<h3 title="Blockers that have to clear before this one can">Waits for these first</h3><div class="bp-list">${b.parents.map(p => blkTag(p, { what: 90 })).join('')}</div>` : ''}
    ${b.kids.length || b.outs.length ? `<h3 title="What clearing it would unblock">Clearing it frees${b.frees ? ` · ${b.frees} thing${b.frees === 1 ? '' : 's'}` : ''}</h3>
      ${b.kids.length ? `<div class="bp-list">${b.kids.map(k => `${blkTag(k.b, { what: 90 })}${k.note ? `<div class="bp-note">${esc(k.note)}</div>` : ''}`).join('')}</div>` : ''}
      ${b.outs.length ? `<ul class="bp-outs">${b.outs.map(o => `<li>${outHtml(o, b)}</li>`).join('')}</ul>` : ''}` : ''}
    <h3>Ways through</h3>${optsHtml(b)}
    <h3>Where it comes from</h3><p>${sourceHtml(b)}</p>
    <div class="chips"><button class="copy" data-copy-link="${esc(b.uid)}" title="A link straight to this blocker">Copy a link to it</button>${b.link ? `<button class="copy" data-go-link="${esc(b.link)}">Show the link on the map</button>` : ''}<button class="copy" data-go-repo="${esc(r.id)}">Show ${esc(r.label || r.name)} on the map</button></div>
  </div>`;
}
function openBlocker(uid) { select({ type: 'blocker', uid }); }
function markSelected() {
  const uid = selected?.type === 'blocker' ? selected.uid : null;
  $$('#blockers-view [data-blk]').forEach(e => e.classList.toggle('sel', e.dataset.blk === uid));
  const key = selected?.type === 'item' ? selected.key : null;
  $$('#priorities-view [data-open-item]').forEach(e => e.classList.toggle('sel', e.dataset.openItem === key));
}

function wireCards(el) {
  $$('[data-copy]', el).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); copyText(PROMPTS.get(b.dataset.copy), b); }));
  $$('[data-go-repo]', el).forEach(b => b.addEventListener('click', () => goRepo(b.dataset.goRepo)));
  $$('[data-go-link]', el).forEach(b => b.addEventListener('click', () => { showView('map'); select({ type: 'link', id: b.dataset.goLink }); }));
  $$('[data-blk]', el).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openBlocker(b.dataset.blk); }));
}

// ------------------------------------------------------------------ blockers view
// Four ways to look at the same blockers: by who can clear them (lanes), by what each frees
// (chains), by what clearing each takes (a grid of repositories against needs), and by how
// big the way through is against how much it frees (quick wins).
const ICON = {
  lanes: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="2" width="4" height="12" rx="1"/><rect x="6" y="2" width="4" height="9" rx="1"/><rect x="11" y="2" width="4" height="6" rx="1"/></svg>',
  chains: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="2.2"/><circle cx="13" cy="3.5" r="2.2"/><circle cx="13" cy="12.5" r="2.2"/><path d="M5 8h2.5L11 4M7.5 8 11 12" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  needs: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="4" height="4" rx="1"/><rect x="6" y="1" width="4" height="4" rx="1" opacity=".4"/><rect x="11" y="1" width="4" height="4" rx="1"/><rect x="1" y="6" width="4" height="4" rx="1" opacity=".4"/><rect x="6" y="6" width="4" height="4" rx="1"/><rect x="11" y="6" width="4" height="4" rx="1" opacity=".4"/><rect x="1" y="11" width="4" height="4" rx="1"/><rect x="6" y="11" width="4" height="4" rx="1" opacity=".4"/><rect x="11" y="11" width="4" height="4" rx="1"/></svg>',
  quick: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 1v13.5H15" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="4.5" r="1.8"/><circle cx="8.5" cy="8" r="1.8"/><circle cx="12.5" cy="11" r="1.8"/><circle cx="5" cy="10" r="1.8" opacity=".4"/></svg>',
};
const BMODES = [
  { id: 'lanes', name: 'Who clears it', tip: 'Four lanes: only you, on your computer, an agent can, waiting on another repository',
    about: 'Every blocker as a card, in four lanes by who can clear it, most-freeing first. Each card has its tag, what it holds up and the ways through — <b>Prompt</b> hands an option to a new session; <b>Do it for me</b> hands one to a Claude session on your computer, which does it signed in as you; <b>Help me</b> asks one to walk you through yours.' },
  { id: 'chains', name: 'What frees what', tip: 'Each blocker, then what clearing it frees, left to right',
    about: 'Read each row left to right: who can clear it, the blocker, then what clearing it frees — another blocker first where there is one (sometimes in another repository), then the work it holds up. Chains, where one blocker stands in front of another, come first.' },
  { id: 'needs', name: 'What it takes', tip: 'A grid: each repository against what clearing its blockers takes',
    about: 'Every blocker by what clearing it takes, one row per repository. Read down a column to do them in one go: the decisions you could make in one sitting, the sign-ins one session on your computer could work through, what needs the bench.' },
  { id: 'quick', name: 'Quick wins', tip: 'How big the way through is, against how much it frees',
    about: 'Across: how big the suggested way through is. Up: how much clearing it frees, counting what the blockers behind it hold up too. Start top left — small jobs that free a lot. Blue tags are agent jobs and indigo ones are for an agent on your computer: your part is handing over the prompt.' },
];
let bmode = store.get('bmode', 'lanes');
if (!BMODES.some(m => m.id === bmode)) bmode = 'lanes';
const blkMatch = (b, q) => !q || `${b.tag} ${b.uid} ${b.what} ${b.repo.name} ${b.options.map(o => o.what).join(' ')}`.toLowerCase().includes(q);

function blkKey(mode) {
  return `<div class="bkey" aria-label="Key">
    <span><i class="sw lane-human"></i>only you</span><span title="${esc(ON_COMPUTER)}"><i class="sw lane-computer"></i>on your computer: an agent, signed in as you</span><span><i class="sw lane-agent"></i>an agent can</span><span><i class="sw lane-repo"></i>waits on another repo</span>
    <span><span class="btag lane-human demo"><b>#237</b></span> its issue</span>
    <span><span class="btag lane-human untracked demo"><b>bench-first-run</b></span> no issue yet: the Atlas's name for it</span>
    ${BLOCKERS.some(b => b.closed) ? `<span><span class="btag lane-human demo"><b>${esc(BLOCKERS.find(b => b.closed).tag)}</b><i class="bt-closed">closed</i></span> its issue is closed: it may be cleared</span>` : ''}
    ${mode === 'quick' ? '<span><i class="sw win"></i>start here: half an hour or less, frees three or more</span>' : ''}
    <span class="muted">Click a tag for everything about it. Type one in the search box to find it.</span></div>`;
}

let blockFilter = { repos: null, lane: null };
function renderBlockers() {
  const el = $('#blockers-view');
  const withB = D.repos.filter(r => r.blockers.length);
  if (!blockFilter.repos) blockFilter.repos = new Set(withB.map(r => r.id));
  const q = ($('#search').value || '').trim().toLowerCase();
  const all = BLOCKERS.filter(b => blockFilter.repos.has(b.repo.id) && blkMatch(b, q));
  const pick = all.filter(b => !blockFilter.lane || b.lane === blockFilter.lane);
  const count = id => all.filter(b => b.lane === id).length;
  const mode = BMODES.find(m => m.id === bmode) || BMODES[0];
  const body = mode.id === 'chains' ? chainsHtml(pick) : mode.id === 'needs' ? needsHtml(pick) : mode.id === 'quick' ? quickHtml(pick) : lanesHtml(all);
  el.innerHTML = `<div class="page bpage"><h2>Blockers</h2>
    <div class="bmodes" role="tablist" aria-label="Ways to look at the blockers">${BMODES.map(m => `<button role="tab" data-mode="${m.id}" aria-selected="${m.id === mode.id}" title="${esc(m.tip)}">${ICON[m.id]}${esc(m.name)}</button>`).join('')}</div>
    <p class="intro">${mode.about}</p>
    ${blkKey(mode.id)}
    <div class="lane-sum">${LANES.map(l => `<button class="lane-pill lane-${l.id}" data-lane="${l.id}" aria-pressed="${blockFilter.lane === l.id}"><b>${count(l.id)}</b> ${esc(l.name.toLowerCase())}</button>`).join('')}<button class="lane-pill" data-lane="" aria-pressed="${!blockFilter.lane}">all <b>${all.length}</b></button></div>
    <div class="filters">${withB.map(r => `<button data-repo="${esc(r.id)}" aria-pressed="${blockFilter.repos.has(r.id)}"><img src="${esc(r.logo)}" alt="">${esc(r.label || r.name)} <b>${r.blockers.length}</b></button>`).join('')}</div>
    ${pick.length ? body : '<div class="empty">No blockers match.</div>'}</div>`;
  $$('.bmodes [data-mode]', el).forEach(b => b.addEventListener('click', () => { bmode = b.dataset.mode; store.set('bmode', bmode); renderBlockers(); setHash(); }));
  $$('.filters button', el).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.repo, n = withB.length;
    if (blockFilter.repos.size === n) blockFilter.repos = new Set([id]);
    else if (blockFilter.repos.has(id)) { blockFilter.repos.delete(id); if (!blockFilter.repos.size) blockFilter.repos = new Set(withB.map(r => r.id)); }
    else blockFilter.repos.add(id);
    renderBlockers();
  }));
  $$('.lane-pill', el).forEach(b => b.addEventListener('click', () => { blockFilter.lane = b.dataset.lane || null; renderBlockers(); }));
  $$('.most [data-key]', el).forEach(a => a.addEventListener('click', () => $(`.blk[data-key="${CSS.escape(a.dataset.key)}"]`, el)?.scrollIntoView({ behavior: 'smooth', block: 'center' })));
  wireCards(el);
  markSelected();
}

function lanesHtml(all) {
  const holdsMost = [...all].filter(b => b.frees).sort((a, b) => b.frees - a.frees).slice(0, 3);
  return `${holdsMost.length ? `<div class="box most"><b>Clears the most:</b> ${holdsMost.map(b => `${blkTag(b)} <a href="#" data-key="${esc(b.key)}" onclick="return false">${esc(b.repo.label || b.repo.name)} — ${esc(cut(b.title, 70))}</a> <span class="chip">frees ${b.frees}</span>`).join(' · ')}</div>` : ''}
    <div class="lanes">${LANES.filter(l => !blockFilter.lane || blockFilter.lane === l.id).map(l => {
      const items = all.filter(b => b.lane === l.id);
      return `<section class="lane lane-${l.id}"><h3><span>${esc(l.name)}</span><span>${items.length}</span></h3><p class="sub">${esc(l.about)}</p>${items.map(b => blockerCard(b)).join('') || '<div class="empty">Nothing here.</div>'}</section>`;
    }).join('')}</div>`;
}

// What frees what: one row per blocker that nothing in view stands in front of, branching to
// the blockers it holds up and the work it frees.
function chainsHtml(pick) {
  const P = new Set(pick);
  const byFrees = (a, b) => b.frees - a.frees || b.score - a.score;
  const roots = pick.filter(b => !b.parents.some(p => P.has(p))).sort(byFrees);
  const reach = new Set(), walk = b => { if (reach.has(b)) return; reach.add(b); b.kids.forEach(k => P.has(k.b) && walk(k.b)); };
  roots.forEach(walk);
  for (const b of pick) if (!reach.has(b)) { roots.push(b); walk(b); } // a ring of blockers has no first one
  const chained = roots.filter(b => b.kids.some(k => P.has(k.b)));
  const single = roots.filter(b => !chained.includes(b));
  const row = b => `<div class="crow">${leadHtml(b)}${chainNode(b, P, new Set(), '')}</div>`;
  return `${chained.length ? `<h3 class="bsec">Chains: clearing one frees the next <span>${chained.length}</span></h3><div class="chains">${chained.map(row).join('')}</div>` : ''}
    <h3 class="bsec">One step: clearing it frees what is listed <span>${single.length}</span></h3><div class="chains singles">${single.map(row).join('') || '<div class="empty">Nothing here.</div>'}</div>`;
}
function leadHtml(b) {
  if (b.lane === 'repo') { const t = R.get(b.who); return `<div class="clead lane-repo" title="Waits on ${esc(t.name)} to move"><img src="${esc(t.logo)}" alt=""><span>${esc(cut(t.label || t.name, 14))}</span></div>`; }
  const [tip, word] = { human: ['Only you can clear it', 'You'], computer: ['An agent on your computer can clear it, signed in as you', 'Your computer'], agent: ['An agent can clear it', 'Agent'] }[b.lane];
  return `<div class="clead lane-${b.lane}" title="${tip}"><span>${word}</span></div>`;
}
function chainNode(b, P, seen, note) {
  seen.add(b);
  const kids = b.kids.filter(k => P.has(k.b) && !seen.has(k.b));
  const meta = [b.rec?.effort ? `<span title="Size of the suggested way through">${esc(b.rec.effort)}</span>` : '', b.age !== null ? `<span title="Blocking since ${esc(b.since)}">${ageWords(b.age)}</span>` : ''].filter(Boolean).join(' · ');
  const node = `<button class="cnode lane-${b.lane}" data-blk="${esc(b.uid)}" title="${esc(tagTitle(b))}">${blkTag(b, { span: true })}<span class="cn-what">${esc(cut(b.title, 120))}</span>${note ? `<span class="cn-note">${esc(note)}</span>` : ''}${meta ? `<span class="cn-meta">${meta}</span>` : ''}</button>`;
  const kidHtml = kids.map(k => seen.has(k.b) ? '' : chainNode(k.b, P, seen, k.note)).join('');
  const outs = b.outs.length ? `<div class="cbranch"><ul class="couts" aria-label="Frees"><li class="cap">frees</li>${b.outs.map(o => `<li>${outHtml(o, b)}</li>`).join('')}</ul></div>` : '';
  return `<div class="cbranch">${node}${kidHtml || outs ? `<div class="ckids">${kidHtml}${outs}</div>` : ''}</div>`;
}

// What it takes: repositories down the side, needs across the top.
function needsHtml(pick) {
  const cols = NEEDS.filter(n => pick.some(b => b.need === n.id));
  const rows = D.repos.filter(r => pick.some(b => b.repo === r));
  const sized = (a, b) => (a.mins ?? 1e6) - (b.mins ?? 1e6) || b.frees - a.frees;
  const item = b => `<button class="nitem lane-${b.lane}" data-blk="${esc(b.uid)}" title="${esc(tagTitle(b))}">${blkTag(b, { span: true })}<span class="ni-what">${esc(cut(b.title, 90))}</span>${b.rec?.effort ? `<span class="ni-eff">${esc(b.rec.effort)}</span>` : ''}</button>`;
  const grid = `<div class="needs" style="--cols:${cols.length}" role="table" aria-label="Blockers by repository and what clearing them takes">
    <div class="nh corner" role="columnheader">Repository</div>${cols.map(n => `<div class="nh" role="columnheader" title="${esc(n.about)}"><b>${esc(n.name)}</b><span>${pick.filter(b => b.need === n.id).length}</span></div>`).join('')}
    ${rows.map(r => { const mine = pick.filter(b => b.repo === r); return `<div class="nr" role="rowheader"><button class="linkish" data-go-repo="${esc(r.id)}"><img src="${esc(r.logo)}" alt="">${esc(r.label || r.name)}</button><span class="muted">${mine.length} blocker${mine.length === 1 ? '' : 's'}</span></div>${cols.map(n => `<div class="nc" role="cell">${mine.filter(b => b.need === n.id).sort(sized).map(item).join('')}</div>`).join('')}`; }).join('')}
  </div>`;
  const list = `<div class="needs-list">${cols.map(n => { const items = pick.filter(b => b.need === n.id).sort(sized); return `<section class="nl"><h4>${esc(n.name)} <span>${items.length}</span></h4><p class="sub">${esc(n.about)}</p>${items.map(item).join('')}</section>`; }).join('')}</div>`;
  return `<p class="needs-about">${cols.map(n => `<b>${esc(n.name)}</b> — ${esc(n.about.replace(/\.$/, ''))}`).join(' · ')}.</p>${grid}${list}`;
}

// Quick wins: how big the suggested way through is, against how much clearing it frees.
function quickHtml(pick) {
  const top = Math.max(3, ...pick.map(b => b.frees));
  const ys = Array.from({ length: top + 1 }, (_, k) => top - k);
  const cells = (y, c) => pick.filter(b => b.effort === c.id && b.frees === y).sort((a, b) => b.score - a.score);
  const win = (ci, y) => ci <= 2 && y >= 3;
  const chart = `<div class="qaxis"><span><b>Across →</b> size of the suggested way through</span><span><b>Up ↑</b> how much clearing it frees (the number at the left)</span></div>
    <div class="qchart" style="--cols:${EFFORT.length}" role="table" aria-label="Blockers by the size of the way through and how much clearing them frees">
    <div class="qy qx" role="columnheader" title="How much clearing it frees">frees</div>${EFFORT.map(c => `<div class="qx" role="columnheader">${esc(c.label)}</div>`).join('')}
    ${ys.map(y => `<div class="qy" role="rowheader">${y}</div>${EFFORT.map((c, ci) => `<div class="qc${win(ci, y) ? ' win' : ''}${c.id === 'none' ? ' unsized' : ''}" role="cell">${cells(y, c).map(b => blkTag(b)).join('')}</div>`).join('')}`).join('')}
  </div>`;
  const list = `<div class="qlist">${EFFORT.map(c => { const items = pick.filter(b => b.effort === c.id).sort((a, b) => b.frees - a.frees); return items.length ? `<section class="qrow"><h4>${esc(c.label)} <span>${items.length}</span></h4><div class="qrow-items">${items.map(b => `<span class="qitem">${blkTag(b)}<span class="qfr" title="What clearing it frees">frees ${b.frees}</span></span>`).join('')}</div></section>` : ''; }).join('')}</div>`;
  const best = pick.filter(b => b.effort !== 'none' && b.frees > 0).sort((a, b) => EFFORT.findIndex(x => x.id === a.effort) - EFFORT.findIndex(x => x.id === b.effort) || b.frees - a.frees).slice(0, 8);
  const order = best.length ? `<h3 class="bsec">Start with these <span>${best.length}</span></h3><ol class="qbest">${best.map(b => `<li>${blkTag(b)} <span>${esc(cut(b.title, 110))}</span> <span class="chip">${esc(b.rec.effort)}</span> <span class="chip good" title="What clearing it frees">frees ${b.frees}</span></li>`).join('')}</ol>` : '';
  return chart + list + order;
}

// The provider end of a link may name a `provides` entry (which names a component) or a component.
function providerComp(l) {
  const r = R.get(l.from);
  if (!l.provider) return null;
  const p = (r.m.provides || []).find(x => x.id === l.provider);
  const cid = p?.component || l.provider;
  return r.comps.find(c => c.id === cid) || null;
}
function consumerComp(l) {
  const r = R.get(l.to);
  return l.into ? r.comps.find(c => c.id === l.into) || null : null;
}

// ------------------------------------------------------------------ map
const view = { x: 0, y: 0, k: 1 };
const expanded = new Set(store.get('expanded', []));
let selected = null; // { type: 'repo'|'link'|'comp', id }
let gWorld, gZones, gLinks, gNodes, gComps, gBlock;
let showBlockers = store.get('blockers', false);
// Where "You", "Your computer" and "Agents" stand on the map when blockers are shown: below everything.
function actors() {
  const xs = D.repos.map(r => r.x), maxY = Math.max(...D.repos.map(r => r.y + r.r));
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  return { human: { x: mid - 260, y: maxY + 170, r: 46, name: 'You' }, computer: { x: mid, y: maxY + 170, r: 46, name: 'Your computer' }, agent: { x: mid + 260, y: maxY + 170, r: 46, name: 'Agents' } };
}

function buildMap() {
  const el = $('#map');
  el.innerHTML = '';
  const defs = svg('defs', {}, el);
  const f = svg('filter', { id: 'glow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  svg('feGaussianBlur', { stdDeviation: '2.2', result: 'b' }, f);
  const mg = svg('feMerge', {}, f); svg('feMergeNode', { in: 'b' }, mg); svg('feMergeNode', { in: 'SourceGraphic' }, mg);
  for (const k of ['copy', 'live', 'release', 'protocol', 'reference', 'behind', 'stale']) {
    const m = svg('marker', { id: `arrow-${k}`, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    svg('path', { d: 'M0,1 L9,5 L0,9 z', style: `fill: var(--${k === 'behind' ? 'bad' : k === 'stale' ? 'warn' : 'k-' + k})` }, m);
  }
  for (const [k, v] of [['human', 'human'], ['computer', 'computer'], ['agent', 'accent'], ['repo', 'bad']]) {
    const m = svg('marker', { id: `arrow-b-${k}`, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' }, defs);
    svg('path', { d: 'M0,1 L9,5 L0,9 z', style: `fill: var(--${v})` }, m);
  }
  const pat = svg('pattern', { id: 'dots', width: 28, height: 28, patternUnits: 'userSpaceOnUse' }, defs);
  svg('circle', { cx: 2, cy: 2, r: 1.3, style: 'fill: var(--dot)' }, pat);
  for (const r of D.repos) {
    const cp = svg('clipPath', { id: `clip-${r.id}` }, defs);
    svg('circle', { cx: 0, cy: 0, r: r.r - 3 }, cp);
  }
  svg('rect', { x: -5000, y: -5000, width: 12000, height: 12000, fill: 'url(#dots)', class: 'bgrect' }, el);
  gWorld = svg('g', { id: 'world' }, el);
  gZones = svg('g', { class: 'zones' }, gWorld);
  gLinks = svg('g', { class: 'links' }, gWorld);
  gBlock = svg('g', { class: 'blockers' }, gWorld);
  gComps = svg('g', { class: 'comps' }, gWorld);
  gNodes = svg('g', { class: 'nodes' }, gWorld);
  drawAll();
  wireMap(el);
}

function drawAll() {
  drawZones(); drawNodes(); drawComps(); drawLinks(); drawBlockers(); applyView(); applyHighlight();
}

// One line per repository and per whoever can clear its blockers: to You, to Your computer
// (an agent there, signed in as you), to Agents, or to the repository it waits on. Thickness is how many; the badge says how many.
function drawBlockers() {
  gBlock.innerHTML = '';
  $('#map').classList.toggle('show-blockers', showBlockers);
  if (!showBlockers) return;
  const A = actors();
  const groups = new Map();
  for (const b of BLOCKERS) {
    const key = `${b.repo.id}>${b.who}`;
    if (!groups.has(key)) groups.set(key, { repo: b.repo, who: b.who, list: [] });
    groups.get(key).list.push(b);
  }
  for (const g of groups.values()) {
    const a = g.repo, tgt = A[g.who] || R.get(g.who);
    if (!tgt) continue;
    const dx = tgt.x - a.x, dy = tgt.y - a.y, dist = Math.hypot(dx, dy) || 1;
    const cx = (a.x + tgt.x) / 2 - dy / dist * dist * 0.12, cy = (a.y + tgt.y) / 2 + dx / dist * dist * 0.12;
    const t1 = Math.hypot(cx - a.x, cy - a.y) || 1, t2 = Math.hypot(tgt.x - cx, tgt.y - cy) || 1;
    const sx = a.x + (cx - a.x) / t1 * (a.r + 4), sy = a.y + (cy - a.y) / t1 * (a.r + 4);
    const ex = tgt.x - (tgt.x - cx) / t2 * (tgt.r + 8), ey = tgt.y - (tgt.y - cy) / t2 * (tgt.r + 8);
    const lane = A[g.who] ? g.who : 'repo';
    const el = svg('g', { class: `bline lane-${lane}`, 'data-repo': a.id, 'data-who': g.who }, gBlock);
    const d = `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
    svg('path', { class: 'vis', d, style: `stroke-width:${Math.min(2 + g.list.length * 0.8, 9)}px`, 'marker-end': `url(#arrow-b-${lane})` }, el);
    svg('path', { class: 'hit', d }, el);
    const mx = 0.25 * sx + 0.5 * cx + 0.25 * ex, my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
    svg('path', { class: 'oct', d: octagon(mx, my, 11) }, el);
    const t = svg('text', { class: 'oct-tx', x: mx, y: my }, el); t.textContent = g.list.length;
  }
  for (const [id, p] of Object.entries(A)) {
    const n = BLOCKERS.filter(b => b.lane === id).length;
    const g = svg('g', { class: `actor actor-${id}`, 'data-lane': id, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${p.name}: ${n} blockers` }, gBlock);
    svg('circle', { r: p.r }, g);
    if (id === 'human') { svg('circle', { class: 'glyph', cx: 0, cy: -11, r: 10 }, g); svg('path', { class: 'glyph', d: 'M-20,22 C-20,4 20,4 20,22 Z' }, g); }
    else if (id === 'computer') { svg('rect', { class: 'glyph', x: -19, y: -19, width: 38, height: 26, rx: 4 }, g); svg('rect', { class: 'glyph-eye', x: -15, y: -15, width: 30, height: 18, rx: 2 }, g); svg('path', { class: 'glyph', d: 'M-25,10 L25,10 L21,17 L-21,17 Z' }, g); svg('circle', { class: 'glyph', cx: 0, cy: -9, r: 3.6 }, g); svg('path', { class: 'glyph', d: 'M-7,1 C-7,-5 7,-5 7,1 Z' }, g); }
    else { svg('rect', { class: 'glyph', x: -17, y: -15, width: 34, height: 28, rx: 7 }, g); svg('circle', { class: 'glyph-eye', cx: -7, cy: -2, r: 4 }, g); svg('circle', { class: 'glyph-eye', cx: 7, cy: -2, r: 4 }, g); svg('path', { class: 'glyph', d: 'M-2,-15 L-2,-22 L2,-22 L2,-15 Z' }, g); }
    const name = svg('text', { class: 'name', y: p.r + 19 }, g); name.textContent = p.name;
    const sub = svg('text', { class: 'tag', y: p.r + 33 }, g); sub.textContent = `${n} blocker${n === 1 ? '' : 's'} to clear`;
  }
}
const octagon = (x, y, r) => {
  const k = r * 0.4142;
  return `M${x - k},${y - r} L${x + k},${y - r} L${x + r},${y - k} L${x + r},${y + k} L${x + k},${y + r} L${x - k},${y + r} L${x - r},${y + k} L${x - r},${y - k} Z`;
};

function drawZones() {
  gZones.innerHTML = '';
  for (const g of D.groups) {
    const members = D.repos.filter(r => r.group === g.id);
    if (!members.length) continue;
    const pad = 44;
    const x0 = Math.min(...members.map(r => r.x - r.r)) - pad, x1 = Math.max(...members.map(r => r.x + r.r)) + pad;
    const y0 = Math.min(...members.map(r => r.y - r.r)) - pad - 22, y1 = Math.max(...members.map(r => r.y + r.r)) + pad + 18;
    const z = svg('g', { class: 'zone' }, gZones);
    svg('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 28, style: `fill: color-mix(in srgb, ${g.color} 7%, transparent); stroke: color-mix(in srgb, ${g.color} 45%, transparent)` }, z);
    const t = svg('text', { x: x0 + 18, y: y0 + 24, style: `fill: ${g.color}` }, z);
    t.textContent = g.name;
    const title = svg('title', {}, z); title.textContent = g.about || g.name;
  }
}

function drawNodes() {
  gNodes.innerHTML = '';
  for (const r of D.repos) {
    const g = svg('g', { class: `node ${r.phase === 'archived' ? 'archived' : ''}`, 'data-id': r.id, transform: `translate(${r.x},${r.y})`, tabindex: 0, role: 'button', 'aria-label': `${r.name}: ${r.m.tagline || ''}` }, gNodes);
    svg('circle', { class: 'halo', r: r.r + 9 }, g);
    svg('circle', { class: 'ring', r: r.r, style: `stroke: ${PHASE[r.phase]?.color || '#888'}` }, g);
    if (r.logo) svg('image', { class: 'face', href: r.logo, x: -r.r + 3, y: -r.r + 3, width: (r.r - 3) * 2, height: (r.r - 3) * 2, 'clip-path': `url(#clip-${r.id})`, preserveAspectRatio: 'xMidYMid slice' }, g);
    const name = svg('text', { class: 'name', y: r.r + 19 }, g); name.textContent = r.label || r.name;
    if (r.m.tagline) { const t = svg('text', { class: 'tag', y: r.r + 33 }, g); t.textContent = r.m.tagline.length > 46 ? r.m.tagline.slice(0, 44) + '…' : r.m.tagline; }
    const bubble = (cx, cy, fill, text, tip) => {
      const b = svg('g', {}, g);
      svg('circle', { class: 'bubble', cx, cy, r: 11, style: `fill: ${fill}` }, b);
      const t = svg('text', { class: 'bubble-tx', x: cx, y: cy }, b); t.textContent = text;
      const tt = svg('title', {}, b); tt.textContent = tip;
    };
    const a = r.r * 0.72;
    if (r.issueCount) bubble(a, -a, 'var(--accent)', r.issueCount > 99 ? '99+' : r.issueCount, `${r.issueCount} open issue${r.issueCount === 1 ? '' : 's'}`);
    if (r.behindIn.length) bubble(-a, -a, 'var(--bad)', '!', `Behind upstream on ${r.behindIn.length} link${r.behindIn.length === 1 ? '' : 's'}: ${r.behindIn.map(l => R.get(l.from).name).join(', ')}`);
    if (r.humans.length) bubble(-a, a, 'var(--human)', r.humans.length, `${r.humans.length} issue${r.humans.length === 1 ? '' : 's'} waiting on you`);
    if (r.ciFail.length) bubble(a, a, 'var(--warn)', '✕', `CI failing: ${r.ciFail.map(c => c.name).join(', ')}`);
    if (r.private) { const t = svg('text', { class: 'tag lock', y: -r.r - 8 }, g); t.textContent = '🔒 private'; }
  }
}

function compPositions(r) {
  const n = r.comps.length;
  const R0 = r.r + 34 + Math.max(0, n - 6) * 5;
  r.comps.forEach((c, i) => {
    const ang = -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / n);
    c.x = r.x + Math.cos(ang) * R0; c.y = r.y + Math.sin(ang) * R0; c.ang = ang; c.R0 = R0;
  });
}

function drawComps() {
  gComps.innerHTML = '';
  for (const r of D.repos) {
    if (!expanded.has(r.id) || !r.comps.length) continue;
    compPositions(r);
    const g = svg('g', { class: 'comp-group', 'data-repo': r.id }, gComps);
    svg('circle', { class: 'comp-backdrop', cx: r.x, cy: r.y, r: r.comps[0].R0 + 10 }, g);
    for (const c of r.comps) {
      const cg = svg('g', { class: `comp st-${c.status || 'live'}`, 'data-repo': r.id, 'data-comp': c.id }, g);
      svg('line', { class: 'spoke', x1: r.x + Math.cos(c.ang) * r.r, y1: r.y + Math.sin(c.ang) * r.r, x2: c.x, y2: c.y }, cg);
      svg('circle', { cx: c.x, cy: c.y, r: 7, style: `fill: ${COMP_STATUS[c.status || 'live']}` }, cg);
      const right = Math.cos(c.ang) >= -0.01;
      const t = svg('text', { x: c.x + (right ? 11 : -11), y: c.y + 4, 'text-anchor': right ? 'start' : 'end' }, cg);
      t.textContent = c.name;
      const tt = svg('title', {}, cg); tt.textContent = `${c.name}: ${c.what}`;
    }
  }
}

function endpoint(repo, comp, other) {
  if (comp && expanded.has(repo.id) && comp.x !== undefined) return { x: comp.x, y: comp.y, r: 9 };
  return { x: repo.x, y: repo.y, r: repo.r + 5 };
}

function drawLinks() {
  gLinks.innerHTML = '';
  // Zoomed out, the links between two repositories in one direction draw as one line;
  // zoom in, or open either repository, to see each one.
  const items = [];
  const bundles = new Map();
  for (const l of L) {
    const split = view.k >= 1.25 || expanded.has(l.from) || expanded.has(l.to);
    if (split) { items.push({ links: [l] }); continue; }
    const key = l.from + '>' + l.to;
    if (!bundles.has(key)) { bundles.set(key, { links: [] }); items.push(bundles.get(key)); }
    bundles.get(key).links.push(l);
  }
  const rank = { copy: 0, protocol: 1, live: 2, release: 3, reference: 4 };
  const pairs = new Map();
  for (const it of items) {
    const l = it.links[0];
    it.from = l.from; it.to = l.to;
    it.kind = it.links.map(x => x.kind).sort((a, b) => rank[a] - rank[b])[0];
    const states = it.links.map(stateOf);
    it.state = states.includes('behind') ? 'behind' : states.includes('stale') ? 'stale' : states.includes('unknown') && states.every(s => s === 'unknown') ? 'unknown' : 'ok';
    it.behind = it.links.filter(x => stateOf(x) === 'behind').reduce((n, x) => n + (x.drift.behind || 1), 0);
    const key = [l.from, l.to].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(it);
  }
  for (const list of pairs.values()) {
    list.forEach((it, i) => {
      const l = it.links[0], single = it.links.length === 1;
      const a = R.get(it.from), b = R.get(it.to);
      const pa = endpoint(a, single ? providerComp(l) : null), pb = endpoint(b, single ? consumerComp(l) : null);
      const dx = pb.x - pa.x, dy = pb.y - pa.y, dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist, ny = dx / dist;
      const dirSign = it.from < it.to ? 1 : -1;
      const same = list.filter(x => x.from === it.from), idx = same.indexOf(it);
      const spread = idx - (same.length - 1) / 2;
      const bend = (dist * 0.09 + 10) * dirSign + spread * 30 * dirSign;
      const cx = (pa.x + pb.x) / 2 + nx * bend, cy = (pa.y + pb.y) / 2 + ny * bend;
      const t1 = Math.hypot(cx - pa.x, cy - pa.y) || 1, t2 = Math.hypot(pb.x - cx, pb.y - cy) || 1;
      const sx = pa.x + (cx - pa.x) / t1 * pa.r, sy = pa.y + (cy - pa.y) / t1 * pa.r;
      const ex = pb.x - (pb.x - cx) / t2 * (pb.r + 4), ey = pb.y - (pb.y - cy) / t2 * (pb.r + 4);
      const d = `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      const sCls = it.state === 'behind' ? 's-behind' : it.state === 'stale' ? 's-stale' : it.state === 'unknown' ? 's-unknown' : '';
      const g = svg('g', { class: `link k-${it.kind} ${sCls}`, 'data-ids': it.links.map(x => x.id).join(' '), 'data-from': it.from, 'data-to': it.to }, gLinks);
      const w = single ? null : Math.min(2.4 + (it.links.length - 1) * 1.3, 8);
      svg('path', { class: 'vis', d, 'marker-end': `url(#arrow-${it.state === 'behind' ? 'behind' : it.state === 'stale' ? 'stale' : it.kind})`, style: w ? `stroke-width:${w}px` : null }, g);
      svg('path', { class: 'hit', d }, g);
      const mx = 0.25 * sx + 0.5 * cx + 0.25 * ex, my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
      const badge = (text, cls) => {
        const bw = 10 + text.length * 7;
        svg('rect', { class: `badge-bg ${cls}`, x: mx - bw / 2, y: my - 9, width: bw, height: 18, rx: 9 }, g);
        const t = svg('text', { class: 'badge-tx', x: mx, y: my }, g); t.textContent = text;
      };
      const near = view.k >= 1.25;
      if (it.state === 'behind') badge(`⚠${it.behind || ''}${single ? '' : ' · ' + it.links.length}`, '');
      else if (!near) { /* the whole map: a bundle's width says how many, the colour says stale */ }
      else if (it.state === 'stale') badge(single ? '?' : `? · ${it.links.length}`, 'stale');
      else if (!single) badge(`${it.links.length}`, 'count');
      else if (view.k >= 1.35) {
        const t = svg('text', { class: 'lbl', x: mx, y: my - 6 }, g);
        t.textContent = (l.what || '').length > 38 ? l.what.slice(0, 36) + '…' : l.what;
      }
    });
  }
}

// Level of detail. Zoomed out to the whole map (0), each repository is its name and
// each line one curve, marked only when it is behind; zoom in for the one-line
// descriptions, the counts on bundled lines and the citations' "?" (1), and each
// link's name (2).
function applyView() {
  gWorld.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const lod = view.k >= 1.35 ? 2 : view.k >= 1.25 ? 1 : 0;
  if (lod !== applyView.lod) {
    applyView.lod = lod;
    const m = $('#map'); m.classList.remove('lod-0', 'lod-1', 'lod-2'); m.classList.add(`lod-${lod}`);
    drawLinks(); applyHighlight();
  }
}

function fit(ids, animate = true) {
  const el = $('#map'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  const set = ids ? D.repos.filter(r => ids.includes(r.id)) : showBlockers ? [...D.repos, ...Object.values(actors())] : D.repos;
  const pad = ids ? 160 : 70;
  const x0 = Math.min(...set.map(r => r.x - r.r)) - pad, x1 = Math.max(...set.map(r => r.x + r.r)) + pad;
  const y0 = Math.min(...set.map(r => r.y - r.r)) - pad, y1 = Math.max(...set.map(r => r.y + r.r)) + pad;
  // The buttons float over the map's top edge and the Key over its foot: fit the map
  // between them (the Key folded; open, it is read over the map).
  const top = ($('#map-view .map-tools')?.offsetHeight || 0) + 6;
  const foot = Math.min($('#legend')?.offsetHeight || 0, 60) + 6;
  const k = Math.min(w / (x1 - x0), (h - top - foot) / (y1 - y0), ids ? 1.6 : 1.4);
  const target = { k, x: w / 2 - k * (x0 + x1) / 2, y: top + (h - top - foot) / 2 - k * (y0 + y1) / 2 };
  fit.done = true;
  animateTo(target, animate);
}
function animateTo(t, animate) {
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { Object.assign(view, t); applyView(); return; }
  const s = { ...view }, t0 = performance.now(), dur = 420;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    view.x = s.x + (t.x - s.x) * e; view.y = s.y + (t.y - s.y) * e; view.k = s.k + (t.k - s.k) * e;
    applyView();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function zoomBy(f, cx, cy) {
  const el = $('#map');
  if (cx === undefined) { cx = el.clientWidth / 2; cy = el.clientHeight / 2; }
  const k = Math.max(0.25, Math.min(4, view.k * f));
  view.x = cx - (cx - view.x) * (k / view.k); view.y = cy - (cy - view.y) * (k / view.k); view.k = k;
  applyView();
}

function wireMap(el) {
  const pointers = new Map();
  let drag = null, moved = false, pinch = null, downTarget = null;
  const pt = e => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const toWorld = p => ({ x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k });

  el.addEventListener('wheel', e => {
    e.preventDefault();
    const p = pt(e);
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y);
  }, { passive: false });

  el.addEventListener('pointerdown', e => {
    downTarget = e.target;
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pt(e));
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, view: { ...view }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      drag = null; return;
    }
    const nodeEl = e.target.closest('.node');
    const p = pt(e);
    if (nodeEl && e.button === 0) {
      const r = R.get(nodeEl.dataset.id), w = toWorld(p);
      drag = { type: 'node', r, dx: w.x - r.x, dy: w.y - r.y, start: p };
    } else drag = { type: 'pan', start: p, view: { ...view } };
  });
  el.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), k = Math.max(0.25, Math.min(4, pinch.k * d / pinch.d));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.k = k;
      view.x = mid.x - (pinch.mid.x - pinch.view.x) * (k / pinch.view.k);
      view.y = mid.y - (pinch.mid.y - pinch.view.y) * (k / pinch.view.k);
      moved = true; applyView(); return;
    }
    if (!drag) { hover(e); return; }
    const p = pt(e);
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4) moved = true;
    if (!moved) return;
    hideTip();
    if (drag.type === 'pan') {
      el.classList.add('dragging');
      view.x = drag.view.x + p.x - drag.start.x; view.y = drag.view.y + p.y - drag.start.y; applyView();
    } else {
      const w = toWorld(p);
      drag.r.x = Math.round(w.x - drag.dx); drag.r.y = Math.round(w.y - drag.dy);
      drawZones(); drawNodes(); drawComps(); drawLinks(); drawBlockers(); applyHighlight();
    }
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    el.classList.remove('dragging');
    if (drag && drag.type === 'node' && moved) {
      custom[drag.r.id] = { x: drag.r.x, y: drag.r.y }; store.set(layoutStore(), custom);
      $('#btn-reset').hidden = false;
    }
    if (drag && !moved) click(downTarget || e.target);
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); drag = null; pinch = null; });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('dblclick', e => {
    const nodeEl = e.target.closest('.node');
    if (nodeEl) { toggleExpand(nodeEl.dataset.id); return; }
    const p = pt(e); zoomBy(1.6, p.x, p.y);
  });
  el.addEventListener('keydown', e => {
    const nodeEl = e.target.closest?.('.node');
    if (nodeEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select({ type: 'repo', id: nodeEl.dataset.id }); }
  });
}

function click(t) {
  hideTip();
  const actor = t.closest('.actor'), bline = t.closest('.bline');
  if (actor) { blockFilter.lane = actor.dataset.lane; blockFilter.repos = null; showView('blockers'); return; }
  if (bline) return select({ type: 'blocked', repo: bline.dataset.repo, who: bline.dataset.who });
  const comp = t.closest('.comp'), node = t.closest('.node'), link = t.closest('.link');
  if (comp) return select({ type: 'comp', id: comp.dataset.comp, repo: comp.dataset.repo });
  if (node) {
    const id = node.dataset.id;
    if (!expanded.has(id)) toggleExpand(id, true);
    return select({ type: 'repo', id });
  }
  if (link) {
    const ids = link.dataset.ids.split(' ');
    return select(ids.length === 1 ? { type: 'link', id: ids[0] } : { type: 'pair', from: link.dataset.from, to: link.dataset.to });
  }
  select(null);
}

function toggleExpand(id, on) {
  if (on === undefined) on = !expanded.has(id);
  if (on) expanded.add(id); else expanded.delete(id);
  store.set('expanded', [...expanded]);
  drawComps(); drawLinks(); applyHighlight();
}

// ------------------------------------------------------------------ hover + highlight
let hoverKey = null;
function hover(e) {
  const t = e.target;
  const bline = t.closest?.('.bline'), actor = t.closest?.('.actor');
  if (bline || actor) {
    const list = bline ? BLOCKERS.filter(b => b.repo.id === bline.dataset.repo && b.who === bline.dataset.who) : BLOCKERS.filter(b => b.lane === actor.dataset.lane);
    const WHO = { human: 'you', computer: 'an agent on your computer', agent: 'an agent' }, HEAD = { human: 'Waiting on you', computer: 'An agent on your computer can clear, signed in as you', agent: 'An agent can clear' };
    const head = bline ? `${esc(R.get(bline.dataset.repo).name)} → ${esc(WHO[bline.dataset.who] || R.get(bline.dataset.who).name)}` : esc(HEAD[actor.dataset.lane]);
    showTip(e, `<b>${head} · ${list.length}</b><ul style="margin:4px 0 0;padding-left:16px">${list.slice(0, 6).map(b => `<li>${esc(b.what.length > 70 ? b.what.slice(0, 68) + '…' : b.what)}</li>`).join('')}${list.length > 6 ? `<li class="muted">and ${list.length - 6} more</li>` : ''}</ul><span class="muted">Click for the ways through.</span>`);
    return;
  }
  const node = t.closest?.('.node'), link = t.closest?.('.link'), comp = t.closest?.('.comp');
  const key = node ? 'n:' + node.dataset.id : link ? 'l:' + link.dataset.ids : comp ? 'c:' + comp.dataset.repo + ':' + comp.dataset.comp : null;
  if (key !== hoverKey) { hoverKey = key; applyHighlight(); }
  if (!key) { hideTip(); return; }
  let html = '';
  if (node) {
    const r = R.get(node.dataset.id);
    html = `<b>${esc(r.name)}</b><span class="muted">${esc(r.m.status?.summary || r.m.tagline || '')}</span>`;
  } else if (link) {
    const ls = link.dataset.ids.split(' ').map(id => L.find(x => x.id === id));
    const l = ls[0];
    if (ls.length > 1) html = `<b>${esc(R.get(l.from).name)} → ${esc(R.get(l.to).name)} · ${ls.length} links</b><ul style="margin:4px 0 0;padding-left:16px">${ls.map(x => `<li>${esc(x.what.length > 70 ? x.what.slice(0, 68) + '…' : x.what)} <span class="muted">(${esc(STATE[stateOf(x)].label)})</span></li>`).join('')}</ul><span class="muted">Click for all of them; zoom in to see each.</span>`;
    else { const st = STATE[stateOf(l)];
      html = `<b>${esc(R.get(l.from).name)} → ${esc(R.get(l.to).name)}</b>${esc(l.what)}<br><span class="muted">${esc(HOW[l.how]?.label || l.how)} · ${esc(st.label)}${l.drift?.note ? ' — ' + esc(l.drift.note) : ''}</span>`; }
  } else if (comp) {
    const r = R.get(comp.dataset.repo), c = r.comps.find(x => x.id === comp.dataset.comp);
    html = `<b>${esc(c.name)}</b><span class="muted">${esc(c.what)}</span>`;
  }
  showTip(e, html);
}
function showTip(e, html) {
  const tip = $('#tip'), host = $('#map-view').getBoundingClientRect();
  tip.innerHTML = html; tip.style.display = 'block';
  const x = e.clientX - host.left + 14, y = e.clientY - host.top + 14;
  tip.style.left = Math.min(x, host.width - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(y, host.height - tip.offsetHeight - 8) + 'px';
}
function hideTip() { $('#tip').style.display = 'none'; if (hoverKey) { hoverKey = null; applyHighlight(); } }

function applyHighlight() {
  const root = $('#map');
  let focus = null;
  if (hoverKey) {
    const kind = hoverKey.slice(0, 1), rest = hoverKey.slice(2);
    if (kind === 'n') focus = { type: 'repo', id: rest };
    else if (kind === 'l') focus = { type: 'links', ids: rest.split(' ') };
    else { const [id, cid] = rest.split(':'); focus = { type: 'comp', repo: id, id: cid }; }
  } else if (selected?.type === 'blocker') { const b = BLK.get(selected.uid); focus = b ? { type: 'repo', id: b.repo.id } : null; }
  else if (selected?.type === 'item') { const it = ITEM.get(selected.key); focus = it ? { type: 'repo', id: it.repo.id } : null; }
  else if (selected) focus = selected;
  $$('.hl', root).forEach(el => el.classList.remove('hl'));
  $$('.node.selected', root).forEach(el => el.classList.remove('selected'));
  if (selected?.type === 'repo') $(`.node[data-id="${selected.id}"]`, root)?.classList.add('selected');
  if (!focus) { root.classList.remove('dim'); return; }
  root.classList.add('dim');
  const mark = (sel) => $$(sel, root).forEach(el => el.classList.add('hl'));
  const markLink = id => $$('.link', root).forEach(el => { if (el.dataset.ids.split(' ').includes(id)) el.classList.add('hl'); });
  if (focus.type === 'repo') {
    mark(`.node[data-id="${focus.id}"]`); mark(`.comp[data-repo="${focus.id}"]`);
    for (const l of L) if (l.from === focus.id || l.to === focus.id) { markLink(l.id); mark(`.node[data-id="${l.from}"]`); mark(`.node[data-id="${l.to}"]`); }
  } else if (focus.type === 'link' || focus.type === 'links' || focus.type === 'pair') {
    const ids = focus.type === 'link' ? [focus.id] : focus.type === 'links' ? focus.ids : L.filter(x => x.from === focus.from && x.to === focus.to).map(x => x.id);
    for (const l of L.filter(x => ids.includes(x.id))) { markLink(l.id); mark(`.node[data-id="${l.from}"]`); mark(`.node[data-id="${l.to}"]`);
      const pc = providerComp(l), cc = consumerComp(l);
      if (pc) mark(`.comp[data-repo="${l.from}"][data-comp="${pc.id}"]`); if (cc) mark(`.comp[data-repo="${l.to}"][data-comp="${cc.id}"]`); }
  } else if (focus.type === 'comp') {
    mark(`.node[data-id="${focus.repo}"]`); mark(`.comp[data-repo="${focus.repo}"][data-comp="${focus.id}"]`);
    for (const l of L) {
      const pc = l.from === focus.repo && providerComp(l)?.id === focus.id;
      const cc = l.to === focus.repo && consumerComp(l)?.id === focus.id;
      if (pc || cc) { markLink(l.id); mark(`.node[data-id="${l.from}"]`); mark(`.node[data-id="${l.to}"]`); }
    }
  }
}

// ------------------------------------------------------------------ side panel
function select(s) {
  selected = s;
  applyHighlight();
  const panel = $('#panel');
  if (!s) { panel.classList.remove('open'); setHash(); return; }
  panel.innerHTML = s.type === 'repo' ? repoPanel(R.get(s.id)) : s.type === 'link' ? linkPanel(L.find(l => l.id === s.id)) : s.type === 'pair' ? pairPanel(s.from, s.to) : s.type === 'blocked' ? blockedPanel(s.repo, s.who) : s.type === 'blocker' ? blockerPanel(BLK.get(s.uid)) : s.type === 'item' ? itemPanel(ITEM.get(s.key)) : compPanel(R.get(s.repo), s.id);
  panel.classList.add('open');
  panel.scrollTop = 0;
  setHash();
  wirePanel(panel);
  markSelected();
}

function wirePanel(panel) {
  $$('[data-copy]', panel).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); copyText(PROMPTS.get(b.dataset.copy), b); }));
  $$('[data-go-repo]', panel).forEach(b => b.addEventListener('click', () => goRepo(b.dataset.goRepo)));
  $$('[data-go-link]', panel).forEach(b => b.addEventListener('click', () => { showView('map'); select({ type: 'link', id: b.dataset.goLink }); }));
  $$('[data-go-comp]', panel).forEach(b => b.addEventListener('click', () => { const [r, c] = b.dataset.goComp.split(':'); expanded.add(r); drawComps(); drawLinks(); select({ type: 'comp', repo: r, id: c }); }));
  $('.p-close', panel)?.addEventListener('click', () => select(null));
  $('[data-expand]', panel)?.addEventListener('click', e => { toggleExpand(e.currentTarget.dataset.expand); select(selected); });
  $$('[data-blk]', panel).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openBlocker(b.dataset.blk); }));
  $$('[data-copy-link]', panel).forEach(b => b.addEventListener('click', () => copyText(`${location.origin}${location.pathname}#blockers/${b.dataset.copyLink}`, b, 'Link copied')));
  if (selected?.type === 'item') wireItemPanel(panel, ITEM.get(selected.key));
}

function goRepo(id) {
  showView('map');
  if (!expanded.has(id)) toggleExpand(id, true);
  select({ type: 'repo', id });
  fit([id, ...R.get(id).in.map(l => l.from), ...R.get(id).out.map(l => l.to)]);
}

const PROMPTS = new Map();
let promptSeq = 0;
function promptBtn(text, label = 'Copy prompt', title = 'Copies a ready-made brief for a new Claude Code session (or Dispatch), so an agent can pick this up cold.', cls = '') {
  const id = 'p' + (++promptSeq); PROMPTS.set(id, text);
  return `<button class="copy${cls ? ' ' + cls : ''}" data-copy="${id}" title="${esc(title)}">${label}</button>`;
}
const doItBtn = (b, o) => promptBtn(computerPrompt(b, o), 'Do it for me', 'Copies a brief for a Claude session on your computer (Dispatch, or the desktop app with Claude in Chrome). It does this signed in as you; you approve each site, type any password, and say yes before anything that spends, deletes or can\'t be undone.', 'copy-computer');

function issuePrompt(r, i) {
  const s = r.m.status || {};
  return [
    `Work on ${r.repo}#${i.n}: "${i.title}"`,
    `${i.url}`,
    '',
    `Repository: https://github.com/${r.repo} — attach or clone it if this session doesn't have it.`,
    `Read its CLAUDE.md first and follow it.${i.model ? ` Recommended: ${i.model} / ${i.effort}.` : ''}`,
    s.summary ? `Where ${r.name} is up to (from the Atlas): ${s.summary}` : '',
    '',
    'Before you finish: if what you did changes what other repositories rely on, follow the "Atlas" section of CLAUDE.md (tell the consumers), and update atlas.json\'s status if Now/Next changed.',
  ].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n');
}

function switchPrompt(r) {
  const s = r.m.status || {};
  const lines = [
    `I'm switching back to ${r.name} (${r.repo}). Get me up to speed and then carry on.`,
    '',
    `Where it is up to (Atlas, checked ${s.updated || 'unknown'}): ${s.summary || '—'}`,
  ];
  if (s.now?.length) lines.push('', 'Now:', ...s.now.map(x => `- ${x}`));
  if (s.next?.length) lines.push('', 'Next:', ...s.next.map(x => `- ${x}`));
  if (s.blocked?.length) lines.push('', 'Blocked:', ...s.blocked.map(b => `- ${b.what} (on ${b.on})`));
  if (r.behindIn.length) lines.push('', 'Behind upstream:', ...r.behindIn.map(l => `- ${R.get(l.from).name}: ${l.what} — ${l.drift.note} ${l.on_change ? 'To catch up: ' + l.on_change : ''}`));
  const mine = r.humans.filter(i => issueLane(r, i) === 'human'), asMe = r.humans.filter(i => issueLane(r, i) === 'computer');
  if (mine.length) lines.push('', 'Waiting on me:', ...mine.map(i => `- #${i.n} ${i.title}`));
  if (asMe.length) lines.push('', 'Behind my sign-in (if you can use my computer, do these signed in as me, with me approving):', ...asMe.map(i => `- #${i.n} ${i.title}`));
  lines.push('', `Read CLAUDE.md, then the open issues, and tell me in five lines what you'd do first. Repository: https://github.com/${r.repo}`);
  return lines.join('\n');
}

function issueRow(r, i, showRepo) {
  const tags = [];
  const lane = i.human ? issueLane(r, i) : null;
  if (i.human) tags.push(lane === 'computer' ? term('Your computer', ON_COMPUTER, 'computer') : term('Human', 'Tagged [Human]: it needs you. What only needs your sign-in an agent on your computer can do as you; hardware, money and judgment calls stay yours.', 'human'));
  if (i.model) tags.push(`<span class="chip model" title="The model and effort recommended for an agent picking this up.">${esc(i.model)}/${esc(i.effort)}</span>`);
  if (i.structure === 'epic') tags.push(term('Epic', 'A larger issue that groups sub-issues.', 'acc'));
  if (i.structure === 'sub') tags.push(`<span class="chip" title="Part of a larger epic.">of #${i.parent}</span>`);
  tags.push(`<span class="chip" title="Last updated">${esc(ago(i.updated))}</span>`);
  return `<div class="issue">
    <span class="n">${showRepo ? `<img src="${esc(r.logo)}" alt="" style="width:16px;height:16px;border-radius:4px;vertical-align:-3px"> ` : ''}#${i.n}</span>
    <div class="t"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><div class="meta">${tags.join('')}</div></div>
    ${!i.human ? promptBtn(issuePrompt(r, i), 'Prompt') : lane === 'computer' && issueBlocker(r, i) ? doItBtn(issueBlocker(r, i), issueBlocker(r, i).options.find(o => o.by === 'computer') || issueBlocker(r, i).rec) : ''}
  </div>`;
}

function repoPanel(r) {
  const m = r.m, s = m.status || {};
  const stale = daysSince(s.updated) > 30;
  const phase = PHASE[r.phase] || {};
  const chips = [
    `<span class="chip" style="background: color-mix(in srgb, ${phase.color} 20%, transparent); color: ${phase.color}" title="${esc(phase.means || '')}">${esc(r.phase)}</span>`,
    r.version ? `<span class="chip" title="Current version">v${esc(r.version)}</span>` : '',
    r.lastCommit ? `<span class="chip" title="Last commit on ${esc(r.branch)}">pushed ${esc(ago(r.lastCommit.date))}</span>` : '',
    r.private ? term('private', 'A private repository: the Atlas shows counts, not titles or commit messages.') : '',
    r.manifestSource === 'fallback' ? term('described by the Atlas', 'This repository has no atlas.json of its own yet; the Atlas carries a description for it in data/fallback/.', 'warn') : '',
    r.manifestSource === 'none' ? term('not described', 'No atlas.json found anywhere for this repository.', 'bad') : '',
  ].join('');
  const list = (items, empty) => items?.length ? `<ul>${items.map(x => `<li>${rich(x, r.repo)}</li>`).join('')}</ul>` : `<div class="empty">${empty}</div>`;
  const inL = r.in, outL = r.out;
  const linkRow = (l, dir) => {
    const o = R.get(dir === 'in' ? l.from : l.to), st = STATE[stateOf(l)];
    return `<div class="linkrow" data-go-link="${esc(l.id)}"><img src="${esc(o.logo)}" alt=""><div class="what">${esc(o.name)} <small>${esc(l.what)}</small></div>
      <span class="chip" title="${esc(HOW[l.how]?.means || '')}">${esc(HOW[l.how]?.label || l.how)}</span><span class="chip ${st.cls}" title="${esc(st.means)}">${esc(st.label)}</span></div>`;
  };
  const issues = r.issues || [];
  const groups = [
    ['Waiting on you', issues.filter(i => i.human && issueLane(r, i) === 'human')],
    ['On your computer', issues.filter(i => i.human && issueLane(r, i) === 'computer')],
    ['Ready for an agent', issues.filter(i => !i.human && i.model && i.structure !== 'epic')],
    ['Epics', issues.filter(i => i.structure === 'epic')],
    ['Untagged', issues.filter(i => !i.human && !i.model && i.structure !== 'epic')],
  ];
  const docs = Object.entries(m.docs || {}).map(([k, p]) => `<a href="https://github.com/${r.repo}/blob/${r.branch || 'main'}/${esc(p)}" target="_blank" rel="noopener">${esc(k)}</a>`);
  return `
  <div class="p-head"><div class="row1">
    <img src="${esc(r.logo)}" alt="">
    <div style="min-width:0"><h2>${esc(r.name)}</h2>
      <div class="sub"><a href="https://github.com/${esc(r.repo)}" target="_blank" rel="noopener">${esc(r.repo)}</a>${m.site ? ` · <a href="${esc(m.site)}" target="_blank" rel="noopener">open the site ↗</a>` : ''}</div></div>
    <button class="icon-btn p-close" aria-label="Close">✕</button></div>
    <div class="chips">${chips}</div>
  </div>
  <div class="p-body">
    <p class="lead">${esc(s.summary || m.tagline || r.gh?.description || '')}</p>
    ${s.updated ? `<div class="muted" style="font-size:12px">Status checked ${esc(s.updated)}${stale ? ' — <b style="color:var(--warn)">over a month ago; ask an agent to refresh atlas.json</b>' : ''}</div>` : ''}
    ${m.about ? `<p>${rich(m.about, r.repo)}</p>` : ''}
    <div class="chips">${promptBtn(switchPrompt(r), 'Copy a “switch back in” brief')}${r.comps.length ? `<button class="copy" data-expand="${esc(r.id)}">${expanded.has(r.id) ? 'Hide parts on the map' : 'Show parts on the map'}</button>` : ''}</div>
    ${r.behindIn.length ? `<div class="box bad"><b>Behind upstream</b><ul>${r.behindIn.map(l => `<li><a href="#" data-go-link="${esc(l.id)}" onclick="return false">${esc(R.get(l.from).name)}: ${esc(l.what)}</a> — ${esc(l.drift.note)}</li>`).join('')}</ul></div>` : ''}
    ${r.ciFail.length ? `<div class="box warn"><b>CI failing</b>: ${r.ciFail.map(c => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>`).join(', ')}</div>` : ''}
    ${r.problems?.length ? `<div class="box warn"><b>atlas.json problems</b><ul>${r.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    <div class="cols2">
      <div><h3>Now</h3>${list(s.now, 'Nothing recorded.')}</div>
      <div><h3>Next</h3>${list(s.next, 'Nothing recorded.')}</div>
    </div>
    ${s.later?.length ? `<h3>Later</h3>${list(s.later)}` : ''}
    ${r.blockers.length ? `<h3>Blocked (${r.blockers.length}) — and the ways through</h3>${r.blockers.map(b => blockerCard(b, { compact: true })).join('')}` : ''}
    ${(m.asks || []).length ? `<h3>Asks of other repos</h3><ul>${m.asks.map(a => `<li><b>${esc(R.get(a.to)?.name || a.to)}</b>: ${rich(a.what)} ${a.issue ? rich(a.issue) : term('not filed', 'Not yet an issue in the other repository.', 'warn')}</li>`).join('')}</ul>` : ''}
    <h3>Takes from (${inL.length})</h3>${inL.length ? inL.map(l => linkRow(l, 'in')).join('') : '<div class="empty">Nothing from the other repositories.</div>'}
    <h3>Gives to (${outL.length})</h3>${outL.length ? outL.map(l => linkRow(l, 'out')).join('') : '<div class="empty">Nothing the other repositories rely on.</div>'}
    <h3>Open issues (${r.issueCount ?? '—'})</h3>
    ${r.private && r.issueCount ? '<div class="empty">Private repository: titles are not shown here.</div>' : ''}
    ${groups.filter(g => g[1].length).map(([name, items]) => `<details ${name === 'Waiting on you' || items.length <= 6 ? 'open' : ''}><summary><b>${name}</b> · ${items.length}</summary>${items.map(i => issueRow(r, i)).join('')}</details>`).join('') || (r.private ? '' : '<div class="empty">None open.</div>')}
    ${r.comps.length ? `<h3>Parts (${r.comps.length})</h3>${r.comps.map(c => `<div class="linkrow" data-go-comp="${esc(r.id)}:${esc(c.id)}"><span style="width:10px;height:10px;border-radius:50%;background:${COMP_STATUS[c.status || 'live']};flex:none"></span><div class="what">${esc(c.name)}<small>${esc(c.what)}</small></div></div>`).join('')}` : ''}
    ${(r.ci || []).length ? `<h3>CI on ${esc(r.branch)}</h3><div class="ci">${r.ci.map(c => `<a class="chip ${c.conclusion === 'success' ? 'good' : c.conclusion === 'failure' ? 'bad' : ''}" href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.conclusion || c.status)} · ${esc(ago(c.date))}">${esc(c.name)}</a>`).join('')}</div>` : ''}
    ${(r.commits || []).length ? `<h3>Recent commits</h3>${r.commits.slice(0, 8).map(c => `<div class="commit"><time>${esc(ago(c.date))}</time><span><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.msg)}</a></span></div>`).join('')}` : ''}
    ${docs.length ? `<h3>Docs</h3><div class="chips">${docs.join(' · ')}</div>` : ''}
  </div>`;
}

function linkPanel(l) {
  if (!l) return '';
  const a = R.get(l.from), b = R.get(l.to), d = l.drift || {}, st = STATE[stateOf(l)];
  const how = HOW[l.how] || { label: l.how, means: '' };
  const pc = providerComp(l), cc = consumerComp(l);
  const watch = (l.watch || []).map(w => `<li><a href="https://github.com/${a.repo}/${w.endsWith('/') ? 'tree' : 'blob'}/${a.branch || 'main'}/${esc(w.replace(/\*.*$/, ''))}" target="_blank" rel="noopener"><code>${esc(w)}</code></a></li>`).join('');
  const cross = (D.crossIssues || []).filter(x => (x.in === l.from && x.about === l.to) || (x.in === l.to && x.about === l.from));
  const asks = (D.asks || []).filter(x => (x.from === l.to && x.to === l.from) || (x.from === l.from && x.to === l.to));
  const since = d.since?.commit ? `commit <code>${esc(d.since.commit.slice(0, 7))}</code>${d.since.date ? ` (${esc(d.since.date.slice(0, 10))})` : ''}` : d.since?.version ? `version ${esc(d.since.version)}${d.since.latest ? ` — latest is ${esc(d.since.latest)}` : ''}` : d.since?.date ? `reviewed ${esc(d.since.date)}` : '—';
  const catchUp = [
    `In ${b.repo}: catch up with ${a.repo} — ${l.what}.`,
    `${d.note || ''}`,
    d.commits?.length ? `Upstream changes:\n${d.commits.slice(0, 10).map(c => `- ${c.sha} ${c.date.slice(0, 10)} ${c.msg}`).join('\n')}` : '',
    `How to catch up: ${l.on_change || 'bring it in line, then update the pin in atlas.json.'}`,
    `Read ${b.repo}'s CLAUDE.md first. When done, the pin moves and the Atlas shows the link as current.`,
  ].filter(Boolean).join('\n\n');
  return `
  <div class="p-head"><div class="row1">
    <img src="${esc(a.logo)}" alt=""><span style="font-size:22px">→</span><img src="${esc(b.logo)}" alt="">
    <button class="icon-btn p-close" aria-label="Close">✕</button></div>
    <h2 style="margin-top:8px">${esc(a.name)} → ${esc(b.name)}</h2>
    <div class="chips"><span class="chip" title="${esc(how.means)}">${esc(how.label)}</span><span class="chip ${st.cls}" title="${esc(st.means)}">${esc(st.label)}</span></div>
  </div>
  <div class="p-body">
    <p class="lead">${rich(l.what)}</p>
    <p class="muted" style="font-size:12.5px">${esc(how.means)}</p>
    <div class="box ${d.state === 'behind' ? 'bad' : ''}"><b>${esc(st.label)}</b> — ${esc(d.note || st.means)}<br><span class="muted">Caught up at: ${since}</span>
      ${d.state === 'behind' ? `<div style="margin-top:8px">${promptBtn(catchUp, 'Copy a catch-up prompt')}</div>` : ''}</div>
    ${d.commits?.length ? `<h3>Upstream changes to watched files</h3>${d.commits.slice(0, 12).map(c => `<div class="commit"><time>${esc(ago(c.date))}</time><span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.sha)}</a>` : esc(c.sha)} ${esc(c.msg)}</span></div>`).join('')}` : ''}
    ${l.on_change ? `<h3>When ${esc(a.name)} changes it</h3><p>${rich(l.on_change, b.repo)}</p>` : ''}
    <div class="cols2">
      <div><h3>Comes from</h3><div class="linkrow" data-go-repo="${esc(a.id)}"><img src="${esc(a.logo)}" alt=""><div class="what">${esc(a.name)}${pc ? `<small>${esc(pc.name)}</small>` : ''}</div></div></div>
      <div><h3>Goes into</h3><div class="linkrow" data-go-repo="${esc(b.id)}"><img src="${esc(b.logo)}" alt=""><div class="what">${esc(b.name)}${cc ? `<small>${esc(cc.name)}</small>` : ''}</div></div></div>
    </div>
    ${watch ? `<h3>Watched in ${esc(a.name)}</h3><ul>${watch}</ul>` : ''}
    ${l.url ? `<h3>Read from</h3><p><a href="${esc(l.url)}" target="_blank" rel="noopener"><code>${esc(l.url)}</code></a></p>` : ''}
    ${cross.length ? `<h3>Issues between them</h3>${cross.map(x => `<div class="issue"><span class="n">${esc(R.get(x.in).name)}</span><div class="t"><a href="${esc(x.url)}" target="_blank" rel="noopener">#${x.n} ${esc(x.title)}</a></div></div>`).join('')}` : ''}
    ${asks.length ? `<h3>Asks</h3><ul>${asks.map(x => `<li><b>${esc(R.get(x.from).name)}</b> asks ${esc(R.get(x.to)?.name)}: ${rich(x.what)} ${x.issue ? rich(x.issue) : term('not filed', 'Not yet an issue in the other repository.', 'warn')}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function blockedPanel(repoId, who) {
  const r = R.get(repoId), list = BLOCKERS.filter(b => b.repo.id === repoId && b.who === who);
  const whoName = who === 'human' ? 'you' : who === 'computer' ? 'an agent on your computer' : who === 'agent' ? 'an agent' : R.get(who)?.name;
  return `
  <div class="p-head"><div class="row1"><img src="${esc(r.logo)}" alt=""><div><h2>${esc(r.name)}</h2><div class="sub">${list.length} blocker${list.length === 1 ? '' : 's'} waiting on ${esc(whoName)}</div></div>
    <button class="icon-btn p-close" aria-label="Close">✕</button></div></div>
  <div class="p-body">${list.map(b => blockerCard(b, { compact: true })).join('')}</div>`;
}

function pairPanel(from, to) {
  const a = R.get(from), b = R.get(to), ls = L.filter(l => l.from === from && l.to === to);
  return `
  <div class="p-head"><div class="row1">
    <img src="${esc(a.logo)}" alt=""><span style="font-size:22px">→</span><img src="${esc(b.logo)}" alt="">
    <button class="icon-btn p-close" aria-label="Close">✕</button></div>
    <h2 style="margin-top:8px">${esc(a.name)} → ${esc(b.name)}</h2><div class="sub">${ls.length} things ${esc(b.name)} takes from ${esc(a.name)}</div></div>
  <div class="p-body">${ls.map(l => { const st = STATE[stateOf(l)]; return `<div class="linkrow" data-go-link="${esc(l.id)}"><div class="what">${esc(l.what)}<small>${esc(l.drift?.note || '')}</small></div><span class="chip" title="${esc(HOW[l.how]?.means || '')}">${esc(HOW[l.how]?.label || l.how)}</span><span class="chip ${st.cls}" title="${esc(st.means)}">${esc(st.label)}</span></div>`; }).join('')}</div>`;
}

function compPanel(r, cid) {
  const c = r.comps.find(x => x.id === cid);
  if (!c) return '';
  const links = L.filter(l => (l.from === r.id && providerComp(l)?.id === cid) || (l.to === r.id && consumerComp(l)?.id === cid));
  const provides = (r.m.provides || []).filter(p => p.component === cid);
  return `
  <div class="p-head"><div class="row1"><img src="${esc(r.logo)}" alt=""><div><h2>${esc(c.name)}</h2><div class="sub">part of <a href="#" data-go-repo="${esc(r.id)}" onclick="return false">${esc(r.name)}</a></div></div>
    <button class="icon-btn p-close" aria-label="Close">✕</button></div>
    <div class="chips"><span class="chip" style="color:${COMP_STATUS[c.status || 'live']}">${esc(c.status || 'live')}</span></div></div>
  <div class="p-body">
    <p class="lead">${rich(c.what, r.repo)}</p>
    ${c.url ? `<p><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></p>` : ''}
    ${(c.paths || []).length ? `<h3>Where it lives</h3><ul>${c.paths.map(p => `<li><a href="https://github.com/${r.repo}/${p.endsWith('/') ? 'tree' : 'blob'}/${r.branch || 'main'}/${esc(p.replace(/\*.*$/, ''))}" target="_blank" rel="noopener"><code>${esc(p)}</code></a></li>`).join('')}</ul>` : ''}
    ${provides.length ? `<h3>Offers other repos</h3><ul>${provides.map(p => `<li><b>${esc(p.name)}</b> — ${rich(p.what, r.repo)}</li>`).join('')}</ul>` : ''}
    ${links.length ? `<h3>Links</h3>${links.map(l => { const o = R.get(l.from === r.id ? l.to : l.from); const st = STATE[stateOf(l)]; return `<div class="linkrow" data-go-link="${esc(l.id)}"><img src="${esc(o.logo)}" alt=""><div class="what">${l.from === r.id ? 'to' : 'from'} ${esc(o.name)}<small>${esc(l.what)}</small></div><span class="chip ${st.cls}">${esc(st.label)}</span></div>`; }).join('')}` : ''}
  </div>`;
}

// ------------------------------------------------------------------ priorities
// Every open issue and blocker in one list, weighed against the others: how much its repository
// matters, how bad it is if it's left, what doing it opens up and how soon it's needed — against
// what it costs in your time, agent time and money. assets/triage.js does the sums;
// docs/priorities.md says how, in words. Each part is the owner's word where they gave one (in
// this browser, on the issue's "Atlas triage:" line, or a weight in the registry) and the Atlas's
// guess otherwise; the item's page says which, and how to make a change stick.
const T = window.AtlasTriage;
const todayIso = () => { if (window.ATLAS_TODAY) return window.ATLAS_TODAY; const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const cap = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const FACETS = {
  repo: { name: 'How much the repository matters', short: 'Repo', means: 'How much this repository matters right now, 1 to 5. The Atlas guesses from its phase and how many repositories rely on it until you set it.' },
  severity: { name: 'How bad if it’s left', short: 'How bad', means: 'How bad it is if nobody does it, 1 to 5: 5 is broken, unsafe or losing data; 3 is ordinary work; 1 is a nice-to-have. The repository and this count together, multiplied: a bad problem where it matters little can rank below a smaller one where it matters most.' },
  opportunity: { name: 'What it opens up', short: 'Opens up', means: 'How much other work doing it frees, 0 to 5: what it holds up (counting what the blockers behind it hold up too), and one more when another repository waits on it.' },
  urgency: { name: 'How soon', short: 'How soon', means: 'How soon it is needed, 0 to 5: a deadline close by counts most (from a date in its words, or one you set); being on its repository’s Now or Next list, and having held work up for a month or more, add to it.' },
};
const WHO = {
  human: { name: 'You', plural: 'you', means: 'You do it: it needs your hands, your money or your say.' },
  computer: { name: 'Your computer', plural: 'your computer', means: ON_COMPUTER },
  agent: { name: 'An agent', plural: 'agents', means: 'An agent session can do it from anywhere: hand it the prompt, then check what comes back. A few minutes of your time.' },
};
const SRC = {
  guessed: ['guess', 'The Atlas’s guess from what it can see. Change it on this item’s page, or write it on the issue.'],
  recorded: ['on the issue', 'From the issue: its “Atlas triage:” line, or a label such as bug or p1.'],
  set: ['in the registry', 'Set for everyone in the Atlas’s data/registry.json.'],
  yours: ['yours', 'You set it in this browser. Its page has a button to make it stick for everyone.'],
};
const srcChip = src => `<span class="chip src-${src}" title="${esc(SRC[src][1])}">${esc(SRC[src][0])}</span>`;
const meter = v => `<span class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= v ? 'on' : ''}"></i>`).join('')}</span>`;
const fmtH = h => h < 1 ? `${Math.max(5, Math.round(h * 12) * 5)} min` : h < 10 ? `${+h.toFixed(1)} h` : `${Math.round(h)} h`;
const fmt$ = v => v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;
const dayAt = n => new Date(Date.now() + n * 864e5);
// Day n from today (0 = today), as words.
function dayWords(n) {
  const k = Math.max(0, Math.floor(n));
  if (k === 0) return 'today';
  if (k === 1) return 'tomorrow';
  return dayAt(k).toLocaleDateString(undefined, k < 7 ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
}
const doneDay = it => Math.max(0, Math.ceil(it.finish - 1e-6) - 1); // a job that fills today's hours is done today
const isEpic = i => i.structure === 'epic' || /^epic\b/i.test(i.title);
const tset = () => T.settings(D.triage, store.get('triage-set', {}));

// How much a repository matters (1–5): yours, else the registry's, else the Atlas's guess (base).
function repoBase(r) {
  if (Number.isInteger(r.weight)) return { v: Math.max(1, Math.min(5, r.weight)), why: 'set for everyone in the Atlas’s registry', src: 'set' };
  const relyOn = new Set(r.out.filter(l => l.kind !== 'reference').map(l => l.to)).size;
  return { ...T.repoGuess({ phase: r.phase, relyOn, cited: r.out.length }), src: 'guessed' };
}
function repoWeight(r) {
  const mine = store.get('triage-repos', {})[r.id], base = repoBase(r);
  return Number.isInteger(mine) ? { v: mine, why: 'you set it in this browser', src: 'yours', base } : { ...base, base };
}
// "#12" and "owner/repo#12" on each repository's Now and Next lists.
function plannedRefs() {
  const m = new Map();
  for (const r of D.repos) {
    const s = r.m.status || {};
    for (const [list, word] of [[s.now, 'now'], [s.next, 'next']]) for (const t of list || []) for (const x of String(t).matchAll(/(?:\b([\w.-]+\/[\w.-]+))?#(\d+)\b/g)) {
      const key = `${(x[1] || r.repo).toLowerCase()}#${x[2]}`;
      if (m.get(key) !== 'now') m.set(key, word);
    }
  }
  return m;
}

let ITEMS = [], ITEM = new Map(), BEST = [];
// One item per open issue (an epic with open sub-issues is made of them, so it is left out), and
// one per blocker no open issue stands for. A blocker an issue stands for adds what it frees and
// its ways through to that issue.
function buildItems() {
  if (!T) return;
  const today = todayIso(), own = store.get('triage-own', {}), plan = plannedRefs();
  const items = [], byKey = new Map();
  for (const r of D.repos) for (const i of r.issues || []) {
    if (/^roadmap\b/i.test(i.title)) continue;
    if (isEpic(i) && (r.issues || []).some(c => c.structure === 'sub' && c.parent === i.n)) continue;
    const it = { key: `${r.repo.toLowerCase()}#${i.n}`, type: 'issue', repo: r, i, tag: `#${i.n}`, title: i.title, url: i.url, blockers: [], isEpic: isEpic(i),
      epic: i.structure === 'sub' ? (r.issues || []).find(e => e.n === i.parent) || null : null };
    items.push(it); byKey.set(it.key, it);
  }
  for (const b of BLOCKERS) {
    if (b.closed) continue;
    const home = b.iss && byKey.get(b.iss.key);
    if (home) { home.blockers.push(b); continue; }
    const it = { key: `blk:${b.uid}`, type: 'blocker', repo: b.repo, tag: b.tag, title: b.title, url: b.iss ? `https://github.com/${b.iss.full}/issues/${b.iss.n}` : null, blockers: [b] };
    items.push(it); byKey.set(it.key, it);
  }
  for (const it of items) facts(it, today, own[it.key] || {}, plan);
  // What waits for what: what a blocker holds up starts after it.
  const ofBlk = new Map();
  for (const it of items) { it.after = []; for (const b of it.blockers) ofBlk.set(b, it); }
  const tie = (first, then) => { if (then && then !== first && !then.after.includes(first)) then.after.push(first); };
  for (const it of items) for (const b of it.blockers) {
    for (const k of b.kids) tie(it, ofBlk.get(k.b));
    for (const o of b.outs) if (o.type === 'issue') tie(it, byKey.get(o.iss.key));
  }
  ITEMS = items; ITEM = byKey;
  rank();
}

// The parts of the weighing for one item, each with where it came from and why.
function facts(it, today, own, plan) {
  const r = it.repo, i = it.i || null, bs = it.blockers, tri = i?.triage || {};
  const main = bs.find(b => b.repo === r) || bs[0] || null, rec = main?.rec || null;
  it.main = main; it.rec = rec;
  // Who takes the next step: the suggested way through, else the issue's own tags. A step of
  // yours in a blocker that needs only your sign-in can go to your computer.
  let who = i ? (i.human ? issueLane(r, i) : 'agent') : 'agent';
  if (rec) who = rec.by === 'human' ? (main.lane === 'computer' ? 'computer' : 'human') : rec.by === 'computer' ? 'computer' : 'agent';
  it.who = who;
  // Each part: what the issue says or the Atlas guesses (its base), then yours on top.
  const mine = (k, base) => own[k] !== undefined ? { v: own[k], why: 'you set it', src: 'yours', base } : { ...base, base };
  const f = {};
  f.repo = repoWeight(r);

  const words = [it.title, main && main.what !== it.title ? main.what : ''].join(' ');
  let sev;
  if (tri.severity) sev = { v: tri.severity, why: 'written on the issue', src: 'recorded' };
  else {
    const g = T.severityGuess({ text: words, labels: i?.labels, source: main?.source });
    sev = { ...g, src: /^labelled/.test(g.why) ? 'recorded' : 'guessed' };
    if (sev.src === 'guessed' && g.v < 3 && main?.frees) sev = { v: 3, why: 'it holds other work up', src: 'guessed' };
  }
  f.severity = mine('severity', sev);

  const frees = Math.max(0, ...bs.map(b => b.frees || 0));
  const others = [...new Set(bs.filter(b => b.repo !== r).map(b => b.repo))];
  let opp;
  if (Number.isFinite(tri.opportunity)) opp = { v: tri.opportunity, why: 'written on the issue', src: 'recorded' };
  else {
    const why = [];
    if (frees) why.push(`clearing it frees ${frees} thing${frees === 1 ? '' : 's'}`);
    if (others.length) why.push(`${others.map(x => x.label || x.name).join(' and ')} wait${others.length === 1 ? 's' : ''} on it too`);
    opp = { v: T.opportunityOf(frees, others.length), why: why.join('; ') || 'nothing is recorded as waiting on it', src: 'guessed' };
  }
  f.opportunity = mine('opportunity', opp);

  const baseDue = tri.due || T.deadlineIn([it.title, i?.excerpt, main?.what].filter(Boolean).join(' '), today);
  const due = own.due || baseDue;
  const dueSrc = own.due ? 'yours' : tri.due ? 'recorded' : baseDue ? 'words' : null;
  const waited = main && (main.source === 'recorded' || main.frees > 0) ? (main.age || 0) : 0;
  const u = T.urgencyOf({ due, today, planned: plan.get(it.key) || null, waited });
  f.urgency = { v: u.v, why: u.why.join('; ') || 'no deadline in its words, and not on a Now or Next list', src: dueSrc === 'yours' ? 'yours' : dueSrc === 'recorded' ? 'recorded' : 'guessed',
    due, daysLeft: u.daysLeft, dueSrc, baseDue, baseDueSrc: tri.due ? 'recorded' : baseDue ? 'words' : null };

  const tagH = i?.effort && T.TAG_HOURS[i.effort], recModel = rec?.model && T.TAG_HOURS[String(rec.model).split('/')[1]];
  let hrs;
  if (tri.effort && T.minutesOf(tri.effort) !== null) hrs = { v: T.minutesOf(tri.effort) / 60, why: `written on the issue: “${tri.effort}”`, src: 'recorded' };
  else if (rec?.effort && T.minutesOf(rec.effort) !== null) hrs = { v: T.minutesOf(rec.effort) / 60, why: `the suggested way through says “${rec.effort}”`, src: 'guessed' };
  else if (tagH) hrs = { v: tagH, why: `from its [${i.model}/${i.effort}] tag`, src: 'guessed' };
  else if (recModel) hrs = { v: recModel, why: `from the suggested way through (${rec.model})`, src: 'guessed' };
  else {
    const k = main?.kind;
    const v = who === 'agent' ? (it.isEpic ? 8 : 1.5) : who === 'computer' ? 0.5 : k === 'decision' || k === 'money' ? 0.25 : k === 'access' ? 0.5 : k === 'hardware' ? 4 : 1;
    hrs = { v, why: 'no size is written down, so a guess', src: 'guessed' };
  }
  hrs.v = Math.max(hrs.v, 1 / 12);
  f.hours = mine('hours', hrs);
  f.hours.v = Math.max(f.hours.v, 1 / 12);

  let money;
  const recText = rec ? [rec.what, rec.pros, rec.cons].filter(Boolean).join(' ') : '';
  if (Number.isFinite(tri.cost)) money = { v: tri.cost, why: 'written on the issue', src: 'recorded' };
  else {
    const m = rec ? T.moneyIn(recText) : T.moneyIn([it.title, i?.excerpt].filter(Boolean).join(' '));
    if (m) money = { v: m.amount, why: `${rec ? 'the suggested way through' : 'its words'} say “${m.text}”${m.monthly ? ' (one month counted)' : ''}`, src: 'guessed' };
    else if (T.SPEND.test(rec ? rec.what : it.title)) money = { v: 0, unknown: true, why: 'it means buying something, and no price is written down', src: 'guessed' };
    else money = { v: 0, why: 'no money in it that the Atlas can see', src: 'guessed' };
  }
  f.money = mine('money', money);
  it.f = f;
}

const PSORTS = [
  { id: 'best', name: 'Best next', tip: 'Importance for what it costs: the most good for the least of your time and money', fn: (a, b) => b.s.best - a.s.best },
  { id: 'worth', name: 'Most important', tip: 'Importance alone, whatever it costs', fn: (a, b) => b.s.worth - a.s.worth || b.s.best - a.s.best },
  { id: 'soon', name: 'Most urgent', tip: 'How soon it is needed first (the nearest deadline first), then importance', fn: (a, b) => b.f.urgency.v - a.f.urgency.v || (a.f.urgency.daysLeft ?? 1e4) - (b.f.urgency.daysLeft ?? 1e4) || b.s.worth - a.s.worth },
  { id: 'opens', name: 'Opens up most', tip: 'What frees the most other work first, then best next', fn: (a, b) => b.f.opportunity.v - a.f.opportunity.v || b.s.best - a.s.best },
  { id: 'cheap', name: 'Cheapest first', tip: 'What costs least first, then importance', fn: (a, b) => a.c.total - b.c.total || b.s.worth - a.s.worth },
];
const PMODES = [
  { id: 'list', name: 'Ranked list', tip: 'Every item in order, with what it weighs and what it costs' },
  { id: 'chart', name: 'Chart', tip: 'Bars you can switch between when, effort, your time, cost and importance' },
];
const DOMAINS = [
  { id: 'when', name: 'When', tip: 'When each could be done if you work down the list in this order: yours one after another at your hours a day, agents side by side', axis: 'Days from today' },
  { id: 'effort', name: 'Effort', tip: 'Hours of work, whoever does it', axis: 'Hours of work' },
  { id: 'yours', name: 'Your time', tip: 'Hours of your own time: doing it yourself, sitting with your computer while an agent does it, or handing it to an agent and checking', axis: 'Hours of your time' },
  { id: 'cost', name: 'Cost', tip: 'Dollars: your time at what your hour is worth, agent time, and any money it needs', axis: 'Dollars' },
  { id: 'worth', name: 'Importance', tip: 'Out of 100: the repository and how bad, what it opens up, how soon', axis: 'Importance' },
];
const PGROUPS = [{ id: 'none', name: 'One list' }, { id: 'who', name: 'By who' }, { id: 'repo', name: 'By repository' }];
// How the bars are laid out, per measure: a running total suits hours and dollars, not importance.
let psort = store.get('psort', 'best'), pmode = store.get('pmode', 'list'), pdomain = store.get('pdomain', 'when'), pgroup = store.get('pgroup', 'none');
let playouts = { effort: 'line', yours: 'line', cost: 'line', worth: 'zero', ...store.get('playouts', {}) };
let pwho = null, pall = false;
if (!PSORTS.some(x => x.id === psort)) psort = 'best';
if (!PMODES.some(x => x.id === pmode)) pmode = 'list';
if (!DOMAINS.some(x => x.id === pdomain)) pdomain = 'when';

// Cost and score for each item under the settings in force; BEST is them by best next.
function rank() {
  const s = tset();
  for (const it of ITEMS) {
    const f = it.f;
    it.money = f.money.unknown ? s.unknownPurchase : f.money.v;
    it.c = T.costOf({ hours: f.hours.v, who: it.who, money: it.money }, s);
    it.yourHours = it.c.yourHours; it.agentHours = it.c.agentHours;
    it.s = T.scoreOf({ repo: f.repo.v, severity: f.severity.v, opportunity: f.opportunity.v, urgency: f.urgency.v, cost: it.c.total }, s);
  }
  BEST = [...ITEMS].sort(PSORTS[0].fn);
  BEST.forEach((it, k) => { it.bestRank = k + 1; });
}
// The items in the order picked, laid out in time in that order.
function ordered() {
  const list = [...ITEMS].sort((PSORTS.find(x => x.id === psort) || PSORTS[0]).fn);
  T.schedule(list, tset());
  list.forEach((it, k) => { it.rank = k + 1; it.late = it.f.urgency.due && it.f.urgency.daysLeft !== null && doneDay(it) > it.f.urgency.daysLeft; });
  return list;
}
const topPicks = () => {
  const yours = BEST.find(it => it.who !== 'agent') || null, agent = BEST.find(it => it.who === 'agent') || null;
  const big = [...ITEMS].sort(PSORTS[1].fn).find(it => it !== yours && it !== agent) || null;
  return { yours, agent, big };
};

const itemTag = it => it.type === 'blocker' ? blkTag(it.main, { span: true })
  : `<span class="btag lane-${it.who}" title="${esc(`${it.repo.repo}#${it.i.n}`)}"><img src="${esc(it.repo.logo)}" alt=""><b>#${it.i.n}</b></span>`;
const whoTag = it => `<span class="chip who-${it.who}" title="${esc(WHO[it.who].means)}">${esc(WHO[it.who].name)}</span>`;
function whyShort(it) {
  const f = it.f, out = [`${it.repo.label || it.repo.name} matters ${f.repo.v}/5`];
  if (f.severity.v !== 3) out.push(f.severity.why.replace(/ \(“[^”]*”\)$/, ''));
  if (f.opportunity.v) out.push(f.opportunity.why);
  if (f.urgency.v) out.push(f.urgency.why);
  return cap(out.join(' · '));
}
const costTitle = it => `About ${fmt$(it.c.total)} in all — ${fmtH(it.c.yourHours)} of your time (${fmt$(it.c.parts.your)})${it.c.agentHours ? `, ${fmtH(it.c.agentHours)} of agent time (${fmt$(it.c.parts.agent)})` : ''}${it.money ? `, ${it.f.money.unknown ? 'a purchase with no price written down, counted as ' : ''}${fmt$(it.money)} to spend` : ''}.`;
const scoreChips = it => `<span class="chip score" title="Importance, out of 100: how much the repository matters and how bad it is, what it opens up and how soon. Best next weighs it against what it costs.">importance ${Math.round(it.s.worth)}</span><span class="chip" title="${esc(costTitle(it))}">${fmtH(it.c.yourHours)} of yours${it.money ? ` · ${fmt$(it.money)}` : ''}</span>${it.f.urgency.due ? `<span class="chip ${it.f.urgency.daysLeft <= 7 ? 'warn' : ''}" title="${esc(`Due ${it.f.urgency.due}${it.f.urgency.dueSrc === 'words' ? ', from a date in its words' : ''}`)}">due ${esc(day(it.f.urgency.due))}</span>` : ''}`;

// The buttons that get it done: a prompt for an agent, a brief for your computer, or a
// walk-through for you; the issue; the blocker's own page.
function actionsHtml(it) {
  const b = it.main, rec = it.rec, out = [];
  if (it.i && it.who === 'agent' && !it.i.human) out.push(promptBtn(issuePrompt(it.repo, it.i), 'Prompt'));
  else if (b && it.who === 'computer') out.push(doItBtn(b, b.options.find(o => o.by === 'computer') || rec || { what: b.what, by: 'computer' }));
  else if (b && it.who === 'human') out.push(promptBtn(helpPrompt(b, rec || { what: b.what, by: 'human' }), 'Help me', 'Copies a brief for a Claude session to walk you through it, one step at a time.'));
  else if (b) out.push(promptBtn(optionPrompt(b, rec || { what: b.what, by: 'agent' }), 'Prompt'));
  else if (it.i) out.push(promptBtn(issuePrompt(it.repo, it.i), 'Prompt'));
  if (it.url) out.push(`<a class="copy" href="${esc(it.url)}" target="_blank" rel="noopener" title="Open the issue on GitHub">Issue ↗</a>`);
  if (b) out.push(`<button class="copy" data-blk="${esc(b.uid)}" title="Its page as a blocker: what has to clear first, what it frees, and every way through">As a blocker</button>`);
  return out.join('');
}

// The suggested way through, when it says more than the title: what the next step actually is.
const stepHtml = (it, cls) => it.rec?.what && it.main?.source !== 'issue' && it.rec.what !== it.title
  ? `<p class="${cls}"><b>${it.who === 'agent' ? 'The agent’s step' : it.who === 'computer' ? 'The step, on your computer' : 'Your step'}:</b> ${rich(cut(it.rec.what, 180), (R.get(it.rec.by) || it.repo).repo)}</p>` : '';
function picksHtml() {
  const { yours, agent, big } = topPicks();
  const card = (it, kick, about) => it ? `<article class="pick who-${it.who}" data-open-item="${esc(it.key)}" tabindex="0" role="button" aria-label="${esc(`${kick}: ${it.title}`)}">
      <div class="pick-kick" title="${esc(about)}">${esc(kick)}</div>
      <div class="pick-top">${itemTag(it)}<span class="pick-repo">${esc(it.repo.label || it.repo.name)}</span>${whoTag(it)}</div>
      <h3 class="pick-what">${esc(cut(it.title, 150))}</h3>
      ${stepHtml(it, 'pick-step')}
      <p class="pick-why">${esc(whyShort(it))}</p>
      <div class="chips">${scoreChips(it)}</div>
      <div class="chips pick-act">${actionsHtml(it)}</div>
    </article>` : '';
  return `<div class="picks">
    ${card(yours, 'Your next step', 'The best next item that needs you — your hands, money or say, or your sign-in on your computer: the most importance for the least of your time and money.')}
    ${card(agent, 'Hand to an agent', 'The best next item an agent can do from anywhere. Copy its prompt into a new session; it works while you do yours.')}
    ${card(big, 'Most important', 'The most important item of the rest, whatever it costs: worth planning time for even when it is not the quickest win.')}
  </div>`;
}

function facetMeters(it) {
  return ['repo', 'severity', 'opportunity', 'urgency'].map(k => {
    const x = it.f[k];
    return `<span class="fm" title="${esc(`${FACETS[k].name}: ${x.v} of 5 — ${x.why}${x.src === 'guessed' ? ' (a guess)' : ''}`)}"><small>${esc(FACETS[k].short)}</small>${meter(x.v)}</span>`;
  }).join('') + `<span class="fm fm-cost" title="${esc(costTitle(it))}"><small>Costs</small><b>${fmt$(it.c.total)}</b></span>`;
}
function listHtml(shown) {
  const rows = pall ? shown : shown.slice(0, 40);
  return `<ol class="plist">${rows.map(it => `<li class="prow who-${it.who}" data-open-item="${esc(it.key)}" tabindex="0" role="button" aria-label="${esc(`${it.rank}. ${it.title}`)}">
      <span class="pr-n" title="Its place in this order">${it.rank}</span>
      <div class="pr-main"><div class="pr-top">${itemTag(it)}<span class="pr-repo">${esc(it.repo.label || it.repo.name)}</span>${whoTag(it)}${it.epic ? `<span class="chip" title="${esc(`Part of the epic #${it.epic.n}: ${it.epic.title}`)}">of #${it.epic.n}</span>` : ''}${it.f.urgency.due ? `<span class="chip ${it.late ? 'bad' : it.f.urgency.daysLeft <= 7 ? 'warn' : ''}" title="${esc(`Due ${it.f.urgency.due}${it.late ? ' — at this pace, in this order, it is done after that' : ''}`)}">due ${esc(day(it.f.urgency.due))}${it.late ? ' ⚠' : ''}</span>` : ''}</div>
        <div class="pr-what">${esc(cut(it.title, 160))}</div></div>
      <div class="pr-facets">${facetMeters(it)}</div>
      <div class="pr-score" title="Importance out of 100, and what it costs in all">${Math.round(it.s.worth)}<small>importance</small></div>
    </li>`).join('')}</ol>${!pall && shown.length > rows.length ? `<button class="copy more" data-pall>Show all ${shown.length}</button>` : ''}`;
}

// The bars of one item in one domain, laid end to end.
function segsOf(it, dom) {
  if (dom === 'when') return [{ len: it.finish - it.start, cls: `w-${it.who}`, title: `${WHO[it.who].name}: ${it.who === 'agent' ? `${fmtH(it.agentHours)} of agent work` : `${fmtH(it.yourHours)} of your time`}; from ${dayWords(it.start)}, done ${dayWords(doneDay(it))}` }];
  if (dom === 'effort') return [{ len: it.c.hours, cls: `w-${it.who}`, title: `${fmtH(it.c.hours)} of work (${it.f.hours.why})` }];
  if (dom === 'yours') return [{ len: it.c.yourHours, cls: `w-${it.who}`, title: `${fmtH(it.c.yourHours)} of your time` }];
  if (dom === 'cost') return [
    { len: it.c.parts.your, cls: 'c-your', title: `Your time: ${fmtH(it.c.yourHours)}, ${fmt$(it.c.parts.your)}` },
    { len: it.c.parts.agent, cls: 'c-agent', title: `Agent time: ${fmtH(it.c.agentHours)}, ${fmt$(it.c.parts.agent)}` },
    { len: it.c.parts.money, cls: `c-money${it.f.money.unknown ? ' guess' : ''}`, title: `Money: ${fmt$(it.c.parts.money)}${it.f.money.unknown ? ' — no price is written down, so this is the guess for a purchase' : ''}` },
  ].filter(x => x.len > 0);
  return [
    { len: it.s.parts.importance, cls: 'p-imp', title: `The repository and how bad: ${Math.round(it.s.parts.importance)}` },
    { len: it.s.parts.opportunity, cls: 'p-opp', title: `What it opens up: ${Math.round(it.s.parts.opportunity)}` },
    { len: it.s.parts.urgency, cls: 'p-urg', title: `How soon: ${Math.round(it.s.parts.urgency)}` },
  ].filter(x => x.len > 0);
}
const valWords = (dom, v) => dom === 'when' ? dayWords(v) : dom === 'cost' ? fmt$(v) : dom === 'worth' ? String(Math.round(v)) : fmtH(v);
function chartKey(dom) {
  const sw = (cls, t) => `<span><i class="g-sw ${cls}"></i>${t}</span>`;
  const who = sw('w-human', 'you') + sw('w-computer', 'your computer') + sw('w-agent', 'an agent');
  if (dom === 'when') return `${who}<span><i class="g-due demo"></i>its deadline</span><span><i class="g-sw w-human late"></i>done after its deadline</span><span class="muted">You do yours one after another at ${fmtH(tset().yourHoursADay)} a day; ${tset().agentsAtOnce} agent session${tset().agentsAtOnce === 1 ? '' : 's'} work side by side. Something that waits for another starts when that is done.</span>`;
  if (dom === 'cost') return sw('c-your', 'your time') + sw('c-agent', 'agent time') + sw('c-money', 'money') + sw('c-money guess', 'a purchase with no price written down');
  if (dom === 'worth') return sw('p-imp', 'the repository and how bad') + sw('p-opp', 'what it opens up') + sw('p-urg', 'how soon');
  return who;
}
function chartHtml(shown) {
  const d = DOMAINS.find(x => x.id === pdomain) || DOMAINS[0];
  const rows = pall ? shown : shown.slice(0, 30);
  const groups = pgroup === 'who' ? ['human', 'computer', 'agent'].map(w => ({ name: WHO[w].name, items: rows.filter(it => it.who === w) }))
    : pgroup === 'repo' ? D.repos.map(r => ({ name: r.label || r.name, logo: r.logo, items: rows.filter(it => it.repo === r) }))
    : [{ name: '', items: rows }];
  const playout = playouts[d.id] || 'line', line = d.id !== 'when' && playout === 'line';
  let max = 0;
  for (const g of groups) {
    let run = 0;
    for (const it of g.items) {
      const segs = segsOf(it, d.id), len = segs.reduce((n, x) => n + x.len, 0);
      it.g = { segs, len, x0: d.id === 'when' ? it.start : line ? run : 0 };
      if (line) run += len;
      max = Math.max(max, it.g.x0 + len);
    }
    g.total = run || g.items.reduce((n, it) => n + it.g.len, 0);
  }
  let marks;
  if (d.id === 'when') {
    const span = Math.max(1, Math.ceil(max)), step = [1, 2, 7, 14, 28, 56, 91, 182].find(x => span / x <= 7) || 365;
    max = Math.ceil(span / step) * step;
    marks = Array.from({ length: max / step + 1 }, (_, k) => k * step);
  } else { marks = T.ticks(max, 5); max = marks[marks.length - 1]; }
  const pct = v => Math.max(0, Math.min(100, v / max * 100)).toFixed(3);
  const tickLab = v => d.id === 'when' ? (v === 0 ? 'today' : dayAt(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })) : d.id === 'cost' ? fmt$(v) : d.id === 'worth' ? String(v) : `${v} h`;
  const grid = marks.map(v => `<i class="g-tick" style="left:${pct(v)}%"></i>`).join('');
  const row = it => {
    const { segs, len, x0 } = it.g;
    let x = x0;
    const bars = segs.map(sg => { const h = `<span class="g-seg ${sg.cls}${it.late && d.id === 'when' ? ' late' : ''}" style="left:${pct(x)}%;width:${pct(sg.len)}%" title="${esc(sg.title)}"></span>`; x += sg.len; return h; }).join('');
    const end = x0 + len, endPct = +pct(end), startPct = +pct(x0);
    // The value goes after the bar; near the right edge, before it, or inside a long one.
    const at = endPct <= 70 ? '' : startPct >= 24 ? ' before' : ' inside';
    const u = it.f.urgency;
    const due = d.id === 'when' && u.due && u.daysLeft !== null ? (u.daysLeft + 1 <= max
      ? `<i class="g-due${it.late ? ' late' : ''}" style="left:${pct(Math.max(0, u.daysLeft + 1))}%" title="${esc(`Due ${u.due}${it.late ? ' — done after it at this pace' : ''}`)}"></i>`
      : `<i class="g-due off" title="${esc(`Due ${u.due}, past the end of this chart`)}"></i>`) : '';
    const val = d.id === 'when' ? `done ${dayWords(doneDay(it))}` : line ? `${valWords(d.id, len)} → ${valWords(d.id, end)}` : valWords(d.id, len);
    return `<div class="g-row who-${it.who}" data-open-item="${esc(it.key)}" tabindex="0" role="button" aria-label="${esc(`${it.rank}. ${it.title}: ${val}`)}">
      <div class="g-lab"><span class="g-n">${it.rank}</span>${itemTag(it)}<span class="g-t" title="${esc(it.title)}">${esc(it.title)}</span></div>
      <div class="g-track">${grid}${bars}${due}<span class="g-val${at}" style="left:${at === ' before' ? startPct : endPct}%">${esc(val)}</span></div></div>`;
  };
  const axis = `<div class="g-row g-axis" aria-hidden="true"><div class="g-lab">${esc(line ? `${d.axis}, running total in this order` : d.axis)}</div><div class="g-track">${marks.map(v => `<span class="g-mark${v === 0 ? ' first' : v === max ? ' last' : ''}" style="left:${pct(v)}%">${esc(tickLab(v))}</span>`).join('')}</div></div>`;
  const body = groups.filter(g => g.items.length).map(g => `${g.name ? `<div class="g-group">${g.logo ? `<img src="${esc(g.logo)}" alt="">` : ''}<b>${esc(g.name)}</b><span>${g.items.length} · ${esc(d.id === 'when' ? `done ${dayWords(Math.max(...g.items.map(doneDay)))}` : `${valWords(d.id, g.total)} in all`)}</span></div>` : ''}${g.items.map(row).join('')}`).join('');
  return `<div class="gtools">
      <div class="seg" role="tablist" aria-label="What the bars measure">${DOMAINS.map(x => `<button role="tab" data-domain="${x.id}" aria-selected="${x.id === d.id}" title="${esc(x.tip)}">${esc(x.name)}</button>`).join('')}</div>
      <div class="seg" aria-label="How the bars are laid out">${d.id === 'when' ? '<button aria-pressed="true" disabled title="In the When view each bar sits where it would happen">Where it falls in time</button>' : `<button data-layout="line" aria-pressed="${playout === 'line'}" title="Each bar starts where the one before it ends, like a plan: the end of the last is the total">One after another</button><button data-layout="zero" aria-pressed="${playout === 'zero'}" title="Every bar starts at zero, to compare sizes">Side by side</button>`}</div>
      <div class="seg" aria-label="Group the rows">${PGROUPS.map(x => `<button data-group="${x.id}" aria-pressed="${pgroup === x.id}">${esc(x.name)}</button>`).join('')}</div>
    </div>
    <p class="gabout">${esc(d.tip)}. Rows stay in the order above, so switching what the bars measure shows how the same work compares another way. Click a row for its page.</p>
    <div class="bkey gkey">${chartKey(d.id)}</div>
    <div class="gantt">${axis}${body || '<div class="empty">Nothing matches.</div>'}</div>
    ${!pall && shown.length > rows.length ? `<button class="copy more" data-pall>Show all ${shown.length} rows</button>` : ''}`;
}

// How it's weighed — what counts and how much, how much each repository matters, your time and
// agents', and what money each costs — changed in this browser, and a prompt to keep the change.
function weightsHtml() {
  const s = tset(), mine = store.get('triage-set', {}), mineRepos = store.get('triage-repos', {});
  const slider = (k, label, means) => `<label class="tw-row" title="${esc(means)}"><span>${esc(label)}</span><input type="range" min="0" max="4" step="0.5" value="${s.weights[k]}" data-weight="${k}" aria-label="${esc(label)}"><b>${s.weights[k]}</b></label>`;
  const numIn = (k, label, means, step, pre = '', post = '') => `<label class="tw-row" title="${esc(means)}"><span>${esc(label)}</span><span class="tw-num">${pre}<input type="number" min="${T.LIMITS[k][0]}" max="${T.LIMITS[k][1]}" step="${step}" value="${s[k]}" data-set="${k}" aria-label="${esc(label)}">${post}</span></label>`;
  const repos = D.repos.map(r => { const w = repoWeight(r); return `<label class="tw-repo" title="${esc(cap(w.why))}"><img src="${esc(r.logo)}" alt=""><span>${esc(r.label || r.name)}</span><select data-repo-weight="${esc(r.id)}" aria-label="${esc(`How much ${r.label || r.name} matters`)}">${[1, 2, 3, 4, 5].map(v => `<option value="${v}"${v === w.v ? ' selected' : ''}>${v}</option>`).join('')}</select>${srcChip(w.src)}</label>`; }).join('');
  const changed = Object.keys(mine).length + Object.keys(mineRepos).length > 0;
  return `<details class="box tweights" ${store.get('tw-open', false) ? 'open' : ''}><summary><b>How it’s weighed</b> — change what counts${changed ? ' <span class="chip src-yours">changed in this browser</span>' : ''}</summary>
    <p class="muted">Each change re-ranks everything at once. It stays in this browser; <b>Keep these for everyone</b> copies a prompt that writes it into the Atlas, so it holds on every device and for the weekday brief.</p>
    <h4>What counts, and how much</h4>
    ${slider('importance', 'The repository and how bad', 'How much the repository matters, multiplied by how bad it is if it is left. 0 leaves it out.')}
    ${slider('opportunity', 'What it opens up', 'How much other work doing it frees. 0 leaves it out.')}
    ${slider('urgency', 'How soon', 'Deadlines, Now and Next lists, and how long it has held work up. 0 leaves it out.')}
    ${slider('cost', 'What it costs', 'How hard cost holds a thing back in Best next: 0 ignores cost, 1 is even, 2 or more puts cheap things first.')}
    <h4>How much each repository matters (1–5)</h4><div class="tw-repos">${repos}</div>
    <h4>Time, for the When chart</h4>
    ${numIn('yourHoursADay', 'Your hours a day on this', 'Hours of your own time a day for this work, every day of the week.', 0.25, '', ' h')}
    ${numIn('agentsAtOnce', 'Agent sessions at once', 'How many agent sessions you run side by side.', 1)}
    ${numIn('agentHoursADay', 'An agent session’s hours a day', 'Hours of work one agent session gets through in a day.', 1, '', ' h')}
    <h4>Money, for the Cost chart and Best next</h4>
    ${numIn('yourHour', 'An hour of your time is worth', 'What an hour of your own time is worth to you, in dollars: it is what makes your time count against agent time.', 5, '$')}
    ${numIn('agentHour', 'An hour of agent time costs', 'What an hour of agent time costs you, in dollars. On a flat Claude plan it is close to 0.', 1, '$')}
    ${numIn('unknownPurchase', 'A purchase with no price written down', 'What to count for something that means buying, when no price is written down.', 5, '$')}
    <div class="chips">${changed ? `<button class="copy" data-tw-reset title="Forget the changes made in this browser">Back to the Atlas’s</button>${promptBtn(keepPrompt(), 'Keep these for everyone', 'Copies a prompt for a Claude session to write these weights and settings into the Atlas’s data/registry.json.')}` : '<span class="muted">Nothing changed in this browser.</span>'}</div>
  </details>`;
}
function keepPrompt() {
  const s = tset();
  const t = { weights: s.weights, yourHoursADay: s.yourHoursADay, agentsAtOnce: s.agentsAtOnce, agentHoursADay: s.agentHoursADay, yourHour: s.yourHour, agentHour: s.agentHour, unknownPurchase: s.unknownPurchase };
  return [
    `In ${D.owner}/atlas: record how I want open work weighed on the Atlas's Priorities view, in data/registry.json.`,
    '',
    `1. Give each repository a "weight" — how much it matters now, 1 to 5: ${D.repos.map(r => `${r.id} ${repoWeight(r).v}`).join(', ')}. Keep each repository on its one line.`,
    `2. Set the top-level "triage" to: ${JSON.stringify(t)}`,
    '',
    `Read the Atlas's CLAUDE.md first; docs/priorities.md says what each setting does. Run node test/check.mjs, then push to main.`,
  ].join('\n');
}
function wordsHtml() {
  return `<details class="box pwords"><summary><b>What the words here mean</b></summary><ul>
    ${Object.values(FACETS).map(F => `<li><b>${esc(F.name)}</b> — ${esc(F.means)}</li>`).join('')}
    <li><b>Importance</b> — the four above together, out of 100. The weights in <i>How it’s weighed</i> say how much each counts.</li>
    <li><b>Effort</b> — hours of work, whoever does it: from the suggested way through, the issue’s <code>[Model/Effort]</code> tag, or a guess.</li>
    <li><b>Your time</b> — the part of it that is yours: all of it when you do it, about half when an agent at your computer does it while you approve, and ten minutes to half an hour to hand a job to an agent and check it.</li>
    <li><b>Cost</b> — your time at what your hour is worth, agent time, and any money it needs, in dollars.</li>
    <li><b>Best next</b> — importance for what it costs: the most good for the least of your time and money. A five-minute decision that frees three jobs beats a week of work that frees none.</li>
    <li><b>Guess</b>, <b>on the issue</b>, <b>in the registry</b>, <b>yours</b> — where a number came from. The Atlas guesses from titles, labels, dates, money and sizes in the words, and what each blocker holds up. An issue can say for itself with a line of its own in its body: <code>Atlas triage: severity 4 · due 2026-11-25 · effort 2h · cost $40</code>.</li>
    <li><b>You</b>, <b>Your computer</b>, <b>An agent</b> — who takes the next step: you by hand; an agent at your computer, signed in as you while you approve; or an agent session from anywhere.</li>
  </ul></details>`;
}

function renderPriorities() {
  const el = $('#priorities-view');
  if (!T) { el.innerHTML = '<div class="page"><h2>Priorities</h2><div class="empty">The weighing script (assets/triage.js) did not load.</div></div>'; return; }
  const list = ordered();
  const q = ($('#search').value || '').trim().toLowerCase();
  const match = it => !q || `${it.tag} ${it.title} ${it.repo.name} ${it.repo.label || ''} ${it.repo.repo}`.toLowerCase().includes(q);
  const shown = list.filter(it => (!pwho || it.who === pwho) && match(it));
  const count = w => list.filter(it => it.who === w && match(it)).length;
  const sort = PSORTS.find(x => x.id === psort) || PSORTS[0];
  el.innerHTML = `<div class="page ppage"><h2>Priorities</h2>
    <p class="intro">Every open issue and blocker, weighed: how much its repository matters, how bad it is if it’s left, what doing it opens up and how soon it’s needed — against what it costs in your time, agent time and money. Start with the cards. Every number is the Atlas’s guess until you or the issue says otherwise: click anything for why it ranks where it does, and to change it.</p>
    ${picksHtml()}
    <div class="bmodes" role="tablist" aria-label="Ways to look at the priorities">${PMODES.map(m => `<button role="tab" data-pmode="${m.id}" aria-selected="${m.id === pmode}" title="${esc(m.tip)}">${esc(m.name)}</button>`).join('')}</div>
    <div class="ptools">
      <div class="seg" aria-label="Order">${PSORTS.map(x => `<button data-sort="${x.id}" aria-pressed="${x.id === sort.id}" title="${esc(x.tip)}">${esc(x.name)}</button>`).join('')}</div>
      <div class="lane-sum">${['human', 'computer', 'agent'].map(w => `<button class="lane-pill lane-${w}" data-who="${w}" aria-pressed="${pwho === w}" title="${esc(WHO[w].means)}"><b>${count(w)}</b> ${esc(WHO[w].plural)}</button>`).join('')}<button class="lane-pill" data-who="" aria-pressed="${!pwho}">all <b>${list.filter(match).length}</b></button></div>
    </div>
    <p class="gabout"><b>${esc(sort.name)}:</b> ${esc(sort.tip)}.</p>
    ${shown.length ? (pmode === 'chart' ? chartHtml(shown) : listHtml(shown)) : '<div class="empty">Nothing matches.</div>'}
    ${weightsHtml()}
    ${wordsHtml()}
  </div>`;
  wirePriorities(el);
  markSelected();
}
function rerank() { rank(); renderStrip(); if (current === 'priorities') renderPriorities(); if (selected?.type === 'item') select(selected); }
function wirePriorities(el) {
  const redo = () => { renderPriorities(); setHash(); };
  $$('[data-pmode]', el).forEach(b => b.addEventListener('click', () => { pmode = b.dataset.pmode; store.set('pmode', pmode); redo(); }));
  $$('[data-sort]', el).forEach(b => b.addEventListener('click', () => { psort = b.dataset.sort; store.set('psort', psort); redo(); }));
  $$('[data-who]', el).forEach(b => b.addEventListener('click', () => { pwho = b.dataset.who || null; redo(); }));
  $$('[data-domain]', el).forEach(b => b.addEventListener('click', () => { pdomain = b.dataset.domain; store.set('pdomain', pdomain); redo(); }));
  $$('[data-layout]', el).forEach(b => b.addEventListener('click', () => { playouts = { ...playouts, [pdomain]: b.dataset.layout }; store.set('playouts', playouts); redo(); }));
  $$('[data-group]', el).forEach(b => b.addEventListener('click', () => { pgroup = b.dataset.group; store.set('pgroup', pgroup); redo(); }));
  $$('[data-pall]', el).forEach(b => b.addEventListener('click', () => { pall = true; redo(); }));
  $$('[data-open-item]', el).forEach(x => {
    x.addEventListener('click', e => { if (e.target.closest('a, button, select, input')) return; select({ type: 'item', key: x.dataset.openItem }); });
    x.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === x) { e.preventDefault(); select({ type: 'item', key: x.dataset.openItem }); } });
  });
  const tw = $('.tweights', el);
  tw?.addEventListener('toggle', () => store.set('tw-open', tw.open));
  $$('[data-weight]', el).forEach(i => {
    i.addEventListener('input', () => { i.nextElementSibling.textContent = i.value; });
    i.addEventListener('change', () => { const m = store.get('triage-set', {}); m.weights = { ...(m.weights || {}), [i.dataset.weight]: +i.value }; store.set('triage-set', m); rerank(); });
  });
  $$('[data-set]', el).forEach(i => i.addEventListener('change', () => { if (i.value === '') return; const m = store.get('triage-set', {}); m[i.dataset.set] = +i.value; store.set('triage-set', m); rerank(); }));
  $$('[data-repo-weight]', el).forEach(i => i.addEventListener('change', () => setRepoWeight(i.dataset.repoWeight, i.value)));
  $('[data-tw-reset]', el)?.addEventListener('click', () => { store.set('triage-set', {}); store.set('triage-repos', {}); buildItems(); rerank(); });
  wireCards(el);
}
function setRepoWeight(id, v) {
  const m = store.get('triage-repos', {});
  if (v === '' || v == null) delete m[id]; else m[id] = +v;
  store.set('triage-repos', m);
  buildItems(); rerank();
}

// One item's page: why it ranks where it does, part by part, each changeable here; what it costs;
// when it could be done; what it waits for and frees; the buttons that get it done; and how to
// make a change stick.
const SEV_OPTS = [[5, '5 — broken, unsafe or losing data'], [4, '4 — something is failing or running out'], [3, '3 — ordinary work'], [2, '2 — a nice-to-have'], [1, '1 — someday']];
const HOUR_OPTS = [[1 / 12, '5 min'], [0.25, '15 min'], [0.5, '30 min'], [1, '1 hour'], [2, '2 hours'], [4, 'half a day'], [8, 'a day'], [16, 'two days'], [40, 'a week']];
function itemPanel(it) {
  if (!it) return `<div class="p-head"><div class="row1"><div><h2>Nothing by that name</h2><div class="sub">It may have been done since the link was made.</div></div><button class="icon-btn p-close" aria-label="Close">✕</button></div></div><div class="p-body"><p>Everything open is on the Priorities view.</p></div>`;
  const r = it.repo, f = it.f, own = store.get('triage-own', {})[it.key] || {}, s = tset();
  const opt = (v, label, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const auto = (k, label) => opt('', `${f[k].base.src === 'recorded' ? 'The issue’s' : 'The Atlas’s'}: ${label}`, !(k in own));
  const facet = (k, ctl) => { const x = f[k], F = FACETS[k]; return `<div class="ipf"><div class="ipf-h"><b title="${esc(F.means)}">${esc(F.name)}</b>${meter(x.v)}<span class="ipf-v">${x.v}<small> of 5</small></span>${srcChip(x.src)}</div><div class="ipf-why">${esc(cap(x.why))}.</div>${ctl}</div>`; };
  const rb = f.repo.base;
  const repoCtl = `<label class="ipf-set">Set it <select data-repo-weight="${esc(r.id)}">${opt('', `${rb.src === 'set' ? 'The registry’s' : 'The Atlas’s'}: ${rb.v}`, f.repo.src !== 'yours')}${[5, 4, 3, 2, 1].map(v => opt(v, String(v), f.repo.src === 'yours' && f.repo.v === v)).join('')}</select><span class="muted">for everything in ${esc(r.label || r.name)}</span></label>`;
  const sevCtl = `<label class="ipf-set">Set it <select data-own="severity">${auto('severity', String(f.severity.base.v))}${SEV_OPTS.map(([v, l]) => opt(v, l, own.severity === v)).join('')}</select></label>`;
  const oppCtl = `<label class="ipf-set">Set it <select data-own="opportunity">${auto('opportunity', String(f.opportunity.base.v))}${[5, 4, 3, 2, 1, 0].map(v => opt(v, String(v), own.opportunity === v)).join('')}</select></label>`;
  const u = f.urgency;
  const dueCtl = `<label class="ipf-set">Deadline <input type="date" data-own="due" value="${esc(own.due || '')}" aria-label="Deadline">${own.due ? '<button class="copy" data-own-clear="due">Clear</button>' : ''}${u.baseDue ? `<span class="muted">${own.due ? 'instead of ' : ''}${esc(day(u.baseDue))}, ${u.baseDueSrc === 'words' ? 'from a date in its words' : 'written on the issue'}</span>` : ''}</label>`;
  const c = it.c, mb = f.money.base;
  const hoursCtl = `<label class="ipf-set">Size <select data-own="hours">${auto('hours', fmtH(f.hours.base.v))}${HOUR_OPTS.map(([v, l]) => opt(v, l, own.hours !== undefined && Math.abs(own.hours - v) < 1e-6)).join('')}</select></label>`;
  const moneyCtl = `<label class="ipf-set">Money <span class="tw-num">$<input type="number" min="0" step="1" data-own="money" value="${'money' in own ? own.money : ''}" placeholder="${Math.round(mb.unknown ? s.unknownPurchase : mb.v)}" aria-label="Money it needs, in dollars"></span>${'money' in own ? '<button class="copy" data-own-clear="money">Clear</button>' : ''}</label>`;
  const whenText = it.who === 'agent'
    ? `An agent could start ${dayWords(it.start)} and be done ${dayWords(doneDay(it))}`
    : `You could start ${dayWords(it.start)} and be done ${dayWords(doneDay(it))}`;
  const kids = it.blockers.flatMap(b => b.kids.map(k => k.b)).filter((b, k, a) => a.indexOf(b) === k && !it.blockers.includes(b));
  const outs = it.blockers.flatMap(b => b.outs.map(o => ({ o, b })));
  const line = T.triageLine({ ...own });
  const hasOwn = Object.keys(own).length > 0;
  const sort = PSORTS.find(x => x.id === psort) || PSORTS[0];
  return `
  <div class="p-head"><div class="row1"><img src="${esc(r.logo)}" alt=""><div style="min-width:0"><div class="bp-tag">${itemTag(it)}</div><h2 class="bp-title">${esc(it.title)}</h2>
    <div class="sub">${esc(r.label || r.name)} · #${it.rank} in ${esc(sort.name.toLowerCase())}${psort !== 'best' ? `, #${it.bestRank} in best next` : ''}</div></div>
    <button class="icon-btn p-close" aria-label="Close">✕</button></div>
    <div class="chips">${whoTag(it)}${scoreChips(it)}</div></div>
  <div class="p-body">
    ${it.title.length > 150 ? `<p class="bp-full">${esc(it.title)}</p>` : ''}
    ${it.i?.excerpt ? `<p class="blk-ctx" title="The opening of the issue">${esc(it.i.excerpt)}</p>` : ''}
    ${stepHtml(it, 'ip-step box')}
    <div class="chips">${actionsHtml(it)}</div>
    <h3>Why it ranks here</h3>
    <div class="box ipsum">Importance <b>${Math.round(it.s.worth)}</b> of 100 — the repository and how bad ${Math.round(it.s.parts.importance)}, what it opens up ${Math.round(it.s.parts.opportunity)}, how soon ${Math.round(it.s.parts.urgency)} — for about <b>${fmt$(c.total)}</b>: best-next score ${it.s.best.toFixed(1)}.</div>
    ${facet('repo', repoCtl)}${facet('severity', sevCtl)}${facet('opportunity', oppCtl)}${facet('urgency', dueCtl)}
    <h3>What it costs</h3>
    <ul class="ipc">
      <li><b>${fmtH(c.hours)}</b> of work — ${esc(f.hours.why)} ${srcChip(f.hours.src)}${hoursCtl}</li>
      <li><b>${fmtH(c.yourHours)}</b> of your time × $${s.yourHour} an hour = ${fmt$(c.parts.your)} <span class="muted">(${it.who === 'human' ? 'you do it' : it.who === 'computer' ? 'you sit with your computer while an agent does it, approving' : 'to hand it over and check what comes back'})</span></li>
      ${c.agentHours ? `<li><b>${fmtH(c.agentHours)}</b> of agent time × $${s.agentHour} an hour = ${fmt$(c.parts.agent)}</li>` : ''}
      <li><b>${fmt$(c.parts.money)}</b> to spend — ${esc(f.money.unknown ? `${f.money.why}: counted as ${fmt$(s.unknownPurchase)}` : f.money.why)} ${srcChip(f.money.src)}${moneyCtl}</li>
    </ul>
    <h3>When</h3>
    <p>${esc(whenText)}, working down the list in ${esc(sort.name.toLowerCase())} order at ${fmtH(s.yourHoursADay)} a day of yours${it.who === 'agent' ? ` and ${s.agentsAtOnce} agent session${s.agentsAtOnce === 1 ? '' : 's'}` : ''}.${u.due ? ` It is due ${esc(day(u.due))}${it.late ? ' — <b class="bad-t">at this pace it is done after that</b>: move it up (set a deadline, or order by Most urgent) or give it more hours' : ''}.` : ''}</p>
    ${it.after.length ? `<h3 title="What has to be done before this can start">Waits for</h3><ul class="ipl">${it.after.map(a => `<li><button class="linkish" data-open-item="${esc(a.key)}">${itemTag(a)} ${esc(cut(a.title, 90))}</button> <span class="muted">done ${esc(dayWords(doneDay(a)))}</span></li>`).join('')}</ul>` : ''}
    ${kids.length || outs.length ? `<h3 title="What doing it would unblock">Doing it frees</h3>${kids.length ? `<div class="bp-list">${kids.map(b => blkTag(b, { what: 90 })).join('')}</div>` : ''}${outs.length ? `<ul class="bp-outs">${outs.slice(0, 12).map(({ o, b }) => `<li>${outHtml(o, b)}</li>`).join('')}</ul>` : ''}` : ''}
    ${it.epic ? `<h3>Part of</h3><p><a href="${esc(it.epic.url)}" target="_blank" rel="noopener">#${it.epic.n} ${esc(it.epic.title)} ↗</a></p>` : ''}
    <h3>Make it stick</h3>
    ${hasOwn ? `<p>Your changes are in this browser only. For everyone, put this line in the ${it.i ? 'issue' : 'blocker’s issue'} on a line of its own:</p>
      <p><code class="tline">${esc(line)}</code></p>
      <div class="chips"><button class="copy" data-copy-line="${esc(line)}" title="Copies the line, to paste into the issue on GitHub">Copy the line</button>${it.i ? `<a class="copy" href="${esc(it.url)}" target="_blank" rel="noopener" title="Open the issue: use … then Edit to change its body">Edit the issue ↗</a>` : ''}${promptBtn(stickPrompt(it, line), 'Prompt: write it for me', 'Copies a brief for a Claude session to put the line in the issue.')}<button class="copy" data-own-clear="*">Forget my changes</button></div>`
      : `<p class="muted">These are ${it.type === 'issue' && Object.keys(it.i.triage || {}).length ? 'what the issue says and ' : ''}the Atlas’s guesses. Change any part above to see where it lands; this page then says how to make it stick for everyone. An issue can also say for itself, with a line of its own in its body: <code>Atlas triage: severity 4 · due 2026-11-25 · effort 2h · cost $40</code>.</p>`}
    <div class="chips"><button class="copy" data-go-repo="${esc(r.id)}">Show ${esc(r.label || r.name)} on the map</button></div>
  </div>`;
}
function stickPrompt(it, line) {
  if (it.i) return [
    `In ${it.repo.repo}: put this line in the body of issue #${it.i.n} ("${it.i.title}"), on a line of its own near the top (under the "Recommended:" line, if it has one). If the body already has an "Atlas triage:" line, replace that one. Change nothing else.`,
    '', line, '', it.url, '',
    `The Atlas reads it at its next collect (every three hours) and weighs the issue by it on its Priorities view.`,
  ].join('\n');
  return [fileIssuePrompt(it.main), '', `In the new issue's body, put this line straight under the "Atlas blocker:" line:`, line].join('\n');
}
function wireItemPanel(panel, it) {
  const setOwn = (k, v) => {
    const all = store.get('triage-own', {}), mine = { ...(all[it.key] || {}) };
    if (k === '*') { delete all[it.key]; store.set('triage-own', all); }
    else {
      if (v === '' || v == null || (typeof v === 'number' && !Number.isFinite(v))) delete mine[k]; else mine[k] = v;
      if (Object.keys(mine).length) all[it.key] = mine; else delete all[it.key];
      store.set('triage-own', all);
    }
    buildItems(); rerank();
  };
  $$('[data-own]', panel).forEach(i => i.addEventListener('change', () => {
    const k = i.dataset.own;
    setOwn(k, k === 'due' ? (/^\d{4}-\d{2}-\d{2}$/.test(i.value) ? i.value : '') : i.value === '' ? '' : +i.value);
  }));
  $$('[data-own-clear]', panel).forEach(b => b.addEventListener('click', () => setOwn(b.dataset.ownClear, '')));
  $$('[data-repo-weight]', panel).forEach(i => i.addEventListener('change', () => setRepoWeight(i.dataset.repoWeight, i.value)));
  $$('[data-copy-line]', panel).forEach(b => b.addEventListener('click', () => copyText(b.dataset.copyLine, b, 'Copied — paste it into the issue on GitHub')));
  $$('[data-open-item]', panel).forEach(b => b.addEventListener('click', () => select({ type: 'item', key: b.dataset.openItem })));
}

// ------------------------------------------------------------------ roadmap view
function renderRoadmap() {
  const el = $('#roadmap-view');
  const rows = [];
  for (const g of D.groups) {
    const members = D.repos.filter(r => r.group === g.id);
    if (!members.length) continue;
    rows.push(`<div class="group-row" style="color:${g.color}">${esc(g.name)}</div>`);
    for (const r of members) {
      const s = r.m.status || {};
      const ul = (items, col, fmt = x => rich(x, r.repo)) => `<div data-col="${col}">${items?.length ? `<ul>${items.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : ''}</div>`;
      rows.push(`<div class="who" data-go-repo="${esc(r.id)}"><img src="${esc(r.logo)}" alt=""><div><b>${esc(r.name)}</b><span class="chip" style="color:${PHASE[r.phase]?.color}" title="${esc(PHASE[r.phase]?.means || '')}">${esc(r.phase)}</span><div class="muted" style="font-size:12px;margin-top:3px">${esc(s.summary || '')}</div>${daysSince(s.updated) > 30 ? '<div style="font-size:11.5px;color:var(--warn)">status over a month old</div>' : ''}</div></div>`);
      rows.push(ul(s.now, 'Now'));
      rows.push(ul(s.next, 'Next'));
      rows.push(ul(s.later, 'Later'));
      const blocked = r.blockers.filter(b => b.source === 'recorded' || b.source === 'drift').map(b => `${rich(b.what, r.repo)} ${b.lane === 'human' ? term('you', 'Only you can clear this.', 'human') : b.lane === 'computer' ? term('your computer', ON_COMPUTER, 'computer') : b.lane === 'agent' ? term('agent', 'An agent can clear this.', 'acc') : `<span class="chip">${esc(R.get(b.who)?.name || b.who)}</span>`}${b.options.length ? ` <button class="chip linkish-chip" data-blk-open="${esc(b.uid)}" title="Open this blocker: what it frees and the ways through">${b.options.length} way${b.options.length === 1 ? '' : 's'} through</button>` : ''}`);
      rows.push(`<div data-col="Blocked / behind">${blocked.length ? `<ul>${blocked.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`);
    }
  }
  el.innerHTML = `<div class="page"><h2>Roadmap</h2>
    <p class="intro">Every repository's Now / Next / Later, from the <code>status</code> in its own <code>atlas.json</code>. Each repository keeps its own detailed roadmap (linked in its panel); this is the one-screen summary they feed. Blocked items marked <span class="chip human">you</span> wait on you; <span class="chip computer" title="${esc(ON_COMPUTER)}">your computer</span> ones only need your sign-in, so an agent on your computer can do them as you.</p>
    <div class="road"><div class="hd">Repository</div><div class="hd">Now</div><div class="hd">Next</div><div class="hd">Later</div><div class="hd">Blocked / behind</div>${rows.join('')}</div></div>`;
  $$('[data-go-repo]', el).forEach(b => b.addEventListener('click', () => goRepo(b.dataset.goRepo)));
  $$('[data-blk-open]', el).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); selected = { type: 'blocker', uid: b.dataset.blkOpen }; showView('blockers'); select(selected); }));
}

// ------------------------------------------------------------------ board view
let boardRepos = null;
function renderBoard() {
  const el = $('#board-view');
  const withIssues = D.repos.filter(r => (r.issues || []).length);
  if (!boardRepos) boardRepos = new Set(withIssues.map(r => r.id));
  const q = ($('#search').value || '').toLowerCase();
  const pick = ISSUES.filter(i => boardRepos.has(i.repo.id) && (!q || `${i.title} ${i.repo.name} #${i.n}`.toLowerCase().includes(q)));
  // Blockers a repository records on you that no issue stands for, split the same way as the issues.
  const fromStatus = lane => BLOCKERS.filter(b => b.source === 'recorded' && b.lane === lane && boardRepos.has(b.repo.id) && !(b.iss && ISSUES.some(i => i.human && `${i.repo.repo.toLowerCase()}#${i.n}` === b.iss.key)));
  const statusCard = b => `<div class="card"><div class="top"><img src="${esc(b.repo.logo)}" alt="">${esc(b.repo.name)} · from its status</div><div class="t">${rich(b.what, b.repo.repo)}</div>${b.lane === 'computer' ? `<div class="meta">${doItBtn(b, b.options.find(o => o.by === 'computer') || b.rec || { what: b.what, by: 'computer' })}</div>` : ''}</div>`;
  const humanBlocked = fromStatus('human'), computerBlocked = fromStatus('computer');
  const drifting = L.filter(l => ['behind', 'stale'].includes(stateOf(l)));
  const card = i => {
    const tags = [];
    const lane = i.human ? issueLane(i.repo, i) : null, ib = lane === 'computer' ? issueBlocker(i.repo, i) : null;
    if (i.human) tags.push(lane === 'computer' ? term('Your computer', ON_COMPUTER, 'computer') : term('Human', 'Needs you: hardware, money or a judgment call.', 'human'));
    if (i.model) tags.push(`<span class="chip model" title="Recommended model / effort">${esc(i.model)}/${esc(i.effort)}</span>`);
    if (i.structure === 'epic') tags.push(term('Epic', 'Groups sub-issues.', 'acc'));
    if (i.structure === 'sub') tags.push(`<span class="chip">of #${i.parent}</span>`);
    tags.push(`<span class="chip">${esc(ago(i.updated))}</span>`);
    return `<div class="card"><div class="top"><img src="${esc(i.repo.logo)}" alt="">${esc(i.repo.name)} · #${i.n}</div>
      <div class="t"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></div>
      <div class="meta">${tags.join('')}${!i.human ? promptBtn(issuePrompt(i.repo, i), 'Prompt') : ib ? doItBtn(ib, ib.options.find(o => o.by === 'computer') || ib.rec) : ''}</div></div>`;
  };
  const byModel = {};
  for (const i of pick.filter(i => !i.human && i.model && i.structure !== 'epic')) (byModel[i.model] ||= []).push(i);
  const effortRank = { Low: 0, Med: 1, High: 2, XHigh: 3, Max: 4 };
  const human = pick.filter(i => i.human && issueLane(i.repo, i) === 'human'), asYouNow = pick.filter(i => i.human && issueLane(i.repo, i) === 'computer');
  const untagged = pick.filter(i => !i.human && !i.model && i.structure !== 'epic');
  const epics = pick.filter(i => i.structure === 'epic');
  el.innerHTML = `<div class="page"><h2>Board</h2>
    <p class="intro">Every open issue across the repositories, sorted by who can move it. Tags come from issue titles (<code>[Human]</code>, <code>[Computer]</code>, <code>[Sonnet5/Med]</code>, <code>[Epic]</code>…). <b>Prompt</b> copies a ready brief for a new Claude Code session or Dispatch; <b>Do it for me</b> copies one for a Claude session on your computer, which works signed in as you.</p>
    <div class="filters">${withIssues.map(r => `<button data-repo="${esc(r.id)}" aria-pressed="${boardRepos.has(r.id)}"><img src="${esc(r.logo)}" alt="">${esc(r.name)} <b>${r.issues.length}</b></button>`).join('')}</div>
    <div class="board">
      <div class="col"><h3 title="${esc(ON_COMPUTER)}"><span>💻 On your computer</span><span>${asYouNow.length + computerBlocked.length}</span></h3><div class="sub">Only your sign-in: an agent on your computer can do these as you. <b>Do it for me</b> copies its brief.</div>
        ${asYouNow.map(card).join('')}
        ${computerBlocked.map(statusCard).join('')}
        ${!asYouNow.length && !computerBlocked.length ? '<div class="empty">Nothing.</div>' : ''}
        <h3 style="margin-top:16px"><span>👤 Waiting on you</span><span>${human.length + humanBlocked.length}</span></h3><div class="sub">Only you can move these: hardware, money or a judgment call.</div>
        ${human.map(card).join('')}
        ${humanBlocked.map(statusCard).join('')}
        ${!human.length && !humanBlocked.length ? '<div class="empty">Nothing. Nice.</div>' : ''}</div>
      <div class="col"><h3><span>🤖 Ready for an agent</span><span>${Object.values(byModel).flat().length}</span></h3><div class="sub">Grouped by the recommended model.</div>
        ${Object.entries(byModel).sort((a, b) => b[1].length - a[1].length).map(([m, items]) => `<h3 style="margin-top:10px"><span class="chip model">${esc(m)}</span><span>${items.length}</span></h3>${items.sort((a, b) => (effortRank[a.effort] ?? 9) - (effortRank[b.effort] ?? 9)).map(card).join('')}`).join('') || '<div class="empty">None tagged.</div>'}</div>
      <div class="col"><h3><span>⚠ Behind upstream</span><span>${drifting.length}</span></h3><div class="sub">A repository another depends on has moved on.</div>
        ${drifting.map(l => `<div class="card"><div class="top"><img src="${esc(R.get(l.to).logo)}" alt="">${esc(R.get(l.to).name)} ← ${esc(R.get(l.from).name)}</div><div class="t"><a href="#" data-go-link="${esc(l.id)}" onclick="return false">${esc(l.what)}</a></div><div class="meta">${term(stateOf(l) === 'stale' ? 'may be stale' : l.drift.behind ? `${l.drift.behind} change${l.drift.behind === 1 ? '' : 's'}` : 'behind', l.drift.note, stateOf(l) === 'stale' ? 'warn' : 'bad')}</div></div>`).join('') || '<div class="empty">Everything is caught up.</div>'}
        <h3 style="margin-top:16px"><span>🗂 Epics</span><span>${epics.length}</span></h3>${epics.map(card).join('') || '<div class="empty">None.</div>'}</div>
      <div class="col"><h3><span>· Untagged</span><span>${untagged.length}</span></h3><div class="sub">No structure or model tag yet.</div>${untagged.map(card).join('') || '<div class="empty">None.</div>'}</div>
    </div></div>`;
  $$('.filters button', el).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.repo;
    if (boardRepos.size === withIssues.length) boardRepos = new Set([id]);
    else if (boardRepos.has(id)) { boardRepos.delete(id); if (!boardRepos.size) boardRepos = new Set(withIssues.map(r => r.id)); }
    else boardRepos.add(id);
    renderBoard();
  }));
  $$('[data-copy]', el).forEach(b => b.addEventListener('click', () => copyText(PROMPTS.get(b.dataset.copy), b)));
  $$('[data-go-link]', el).forEach(b => b.addEventListener('click', () => { showView('map'); select({ type: 'link', id: b.dataset.goLink }); }));
}

// ------------------------------------------------------------------ links view
function renderLinks() {
  const el = $('#links-view');
  const order = { behind: 0, stale: 1, unknown: 2, untracked: 3, current: 4 };
  const rows = [...L].sort((a, b) => (order[stateOf(a)] ?? 9) - (order[stateOf(b)] ?? 9) || a.from.localeCompare(b.from));
  const pair = (id) => { const r = R.get(id); return `<span class="pair"><img src="${esc(r.logo)}" alt="">${esc(r.name)}</span>`; };
  el.innerHTML = `<div class="page"><h2>Links</h2>
    <p class="intro">Everything one repository takes from another, as each consumer declares it in <code>consumes</code>. A link is <b>behind</b> when the provider has changed a watched file since the consumer last caught up — that is the Atlas's forward propagation: the consumer's own drift check opens an issue for it where asked to.</p>
    <div class="table-wrap"><table class="links"><thead><tr><th>From</th><th>To</th><th>What</th><th>How</th><th>State</th><th>Note</th></tr></thead><tbody>
    ${rows.map(l => { const st = STATE[stateOf(l)]; const how = HOW[l.how] || {}; return `<tr data-go-link="${esc(l.id)}"><td>${pair(l.from)}</td><td>${pair(l.to)}</td><td>${esc(l.what)}</td><td><span class="chip" title="${esc(how.means || '')}">${esc(how.label || l.how)}</span></td><td><span class="chip ${st.cls}" title="${esc(st.means)}">${esc(st.label)}</span></td><td class="muted">${esc(l.drift?.note || '')}</td></tr>`; }).join('')}
    </tbody></table></div>
    <details class="box" style="margin-top:16px"><summary><b>What the words on this page mean</b></summary>
      <h4>How a repository takes something</h4><ul>${Object.entries(HOW).map(([k, v]) => `<li><b>${esc(v.label)}</b> (<code>${k}</code>) — ${esc(v.means)}</li>`).join('')}</ul>
      <h4>State</h4><ul>${Object.values(STATE).map(v => `<li><b>${esc(v.label)}</b> — ${esc(v.means)}</li>`).join('')}</ul>
    </details></div>`;
  $$('[data-go-link]', el).forEach(b => b.addEventListener('click', () => { showView('map'); select({ type: 'link', id: b.dataset.goLink }); }));
}

// ------------------------------------------------------------------ activity view
function renderActivity() {
  const el = $('#activity-view');
  const all = D.repos.flatMap(r => (r.commits || []).map(c => ({ ...c, r }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
  let day = '', html = '';
  for (const c of all) {
    const d = new Date(c.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    if (d !== day) { html += `<div class="day">${esc(d)}</div>`; day = d; }
    html += `<div class="act"><img src="${esc(c.r.logo)}" alt=""><div class="m"><b data-go-repo="${esc(c.r.id)}" style="cursor:pointer">${esc(c.r.name)}</b> — <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.msg)}</a></div><time>${esc(new Date(c.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</time></div>`;
  }
  el.innerHTML = `<div class="page"><h2>Activity</h2><p class="intro">The latest commits across every public repository, newest first.</p>${html || '<div class="empty">No commits collected yet.</div>'}</div>`;
  $$('[data-go-repo]', el).forEach(b => b.addEventListener('click', () => goRepo(b.dataset.goRepo)));
}

// ------------------------------------------------------------------ guide view
function renderGuide() {
  const el = $('#guide-view');
  el.innerHTML = `<div class="page guide"><h2>How the Atlas works</h2>
  <p class="intro">One map of every repository: what each is, where it is up to, and what it takes from the others — so you can switch into any of them cold, and so a change in one reaches the ones that depend on it.</p>
  <div class="flow">
    <div class="box"><h4>1 · Each repo describes itself</h4>An <code>atlas.json</code> at its root: what it is, its parts, its status (Now / Next / Blocked), what it offers, and what it takes from the others (<code>consumes</code>). Agents keep it current — it's in each repo's CLAUDE.md.</div>
    <div class="box"><h4>2 · The Atlas collects</h4>Every three hours <code>tools/collect.mjs</code> reads every <code>atlas.json</code>, plus commits, open issues, releases and CI from GitHub, works out drift on every link, and commits <code>data/map.json</code>.</div>
    <div class="box"><h4>3 · Forward: changes travel downstream</h4>A consumer records where it last caught up (a pinned commit, a version, a review date). When the provider changes a watched file after that, the link turns <b style="color:var(--bad)">behind</b>, and the consumer's daily <code>atlas.yml</code> check opens an issue there with the upstream commits and how to catch up.</div>
    <div class="box"><h4>4 · Back: asks travel upstream</h4>When a repo needs another to change, its agent files an issue in the other repo (or records it under <code>asks</code> until it can). Issues that name another repo show on the line between the two.</div>
  </div>
  <h3>Priorities: what to work on next</h3>
  <p>The <b>Priorities</b> view weighs every open issue and blocker against the others, so there is one place to look for what matters most right now. The Atlas opens on it. <b>▶ Start here</b>, at the top of every view, is its pick for you — and the first line of the weekday message to your phone, worked out by the same code.</p>
  <ul>
    <li><b>What it weighs.</b> How much its repository matters (1–5) times how bad it is if it's left (1–5) — so a bad problem in a repository that matters little can rank below a smaller one where it matters most — plus what doing it opens up (what it frees, counting the blockers behind it) and how soon it's needed (a deadline in its words, its repository's Now or Next list, how long it has held work up). Together that is its <b>importance</b>, out of 100.</li>
    <li><b>What it costs.</b> Your time (all of it when you do it; about half when an agent at your computer does it while you approve; minutes to hand a job to an agent and check it), agent time, and any money it needs, in dollars. <b>Best next</b> is importance for what it costs: a five-minute decision that frees three jobs beats a week of work that frees none.</li>
    <li><b>Three cards</b>: your next step, the best job to hand to an agent while you do it, and the most important of the rest whatever it costs.</li>
    <li><b>The chart</b> lays the same rows out as bars, measured one of five ways: <b>When</b> (yours one after another at your hours a day, agents side by side, each deadline marked), <b>Effort</b>, <b>Your time</b>, <b>Cost</b> and <b>Importance</b>. <b>One after another</b> starts each bar where the last ended, so the end is the total; <b>Side by side</b> starts them all at zero to compare sizes.</li>
    <li><b>Guesses, and your word.</b> Every number starts as the Atlas's guess from what it can see: titles, labels, dates and money in the words, sizes in the ways through, what each blocker holds up, and each repository's phase and how many rely on it. Click an item to see why it ranks where it does and to change any part; <b>How it’s weighed</b> changes what counts and how much each repository matters. Changes stay in your browser until you make them stick: an issue can carry a line of its own, <code>Atlas triage: severity 4 · due 2026-11-25 · effort 2h · cost $40</code>, and repository weights and settings go in <code>data/registry.json</code> (each page has a button that copies the prompt).</li>
  </ul>
  <h3>Blockers</h3>
  <p>Press <b>Blockers</b> on the map to see what is stopping work: a line from each repository to <b>You</b>, to <b>Your computer</b>, to <b>Agents</b>, or to the repository it waits on, as thick as the number of blockers on it. Click a line, or open the <b>Blockers</b> view, for each blocker, what it holds up, and the ways through it, each marked with who can do it, the effort and the one the repository would pick. Repositories record blockers and options in <code>status.blocked</code>; the Atlas adds <code>[Human]</code> issues, links behind upstream, asks nobody has filed and failing CI by itself.</p>
  <p>The Blockers view shows them four ways:</p>
  <ul>
    <li><b>Who clears it</b> — a card for each, in four lanes: only you, on your computer, an agent can, waiting on another repository.</li>
    <li><b>What frees what</b> — each blocker as a row read left to right: who can clear it, the blocker, then what clearing it frees. Where one blocker stands in front of another (its issue is in the other's <code>holds</code>, or it is the same issue seen from a second repository) the row branches into a chain.</li>
    <li><b>What it takes</b> — a grid of repositories against what clearing each blocker takes: a decision, your sign-in, hardware or a site, money, time, someone else, or agent work. Read down a column to clear several in one sitting.</li>
    <li><b>Quick wins</b> — how big the suggested way through is, against how much clearing it frees. Start top left.</li>
  </ul>
  <h4>You, your computer, or an agent</h4>
  <p><b>Only you</b> is what needs your hands, your money or your say: the bench, a site visit, an order, a decision. <b>On your computer</b> is what needs only your sign-in — a dashboard, a setting, an account page, a repository to create. A Claude session at your computer does it signed in as you: Claude in Chrome (or the Claude app's own browser) for websites, computer use for desktop apps, Claude Code in a folder you share through Remote Control for a shell. <b>Do it for me</b> copies its brief: paste it into Dispatch, or a Claude desktop session with Claude in Chrome. You approve each site and app, type any password or two-factor code, and say yes before anything that deletes, publishes or can't be undone; orders and payments stay yours. A blocker a repository records on you with kind <code>access</code> goes here by itself, as does a <code>[Human]</code> issue tagged <code>[Computer]</code> or whose title is about a sign-in, a setting or a dashboard. <b>An agent can clear</b> is what any session can do from anywhere.</p>
  <h4>Tags: how to find a blocker</h4>
  <p>Every blocker has a tag. When it has an issue the tag is the issue number (<code>#237</code>, or <code>MegaNet#239</code> for an issue in another repository). When it has none, the tag is the Atlas's name for it, drawn <b>dashed</b>: the <code>id</code> it has in <code>status.blocked</code> (<code>bench-first-run</code>), or a name made from its first words. A tag marked <b>closed</b> points at an issue that has been closed, so the blocker may be cleared. A blocker marked <b>behind upstream</b> has no issue behind it: open <b>Why it's behind</b> on it for when its repository last caught up and the upstream commits since, which are the cause. Click any tag for one page with everything about the blocker: what it is, what has to clear first, what it frees, the ways through, and where it is recorded. Type a tag in the search box (Enter opens it), or link straight to one: <code>#blockers/rpi-alert/bench-first-run</code>.</p>
  <p>A blocker with no issue has <b>Make the issue on GitHub</b> in its page: it opens GitHub's new-issue form in the right repository, filled in with what it holds up and the ways through, starting with the line <code>Atlas blocker: rpi-alert/bench-first-run</code>. Keep that line: at its next collect the Atlas links the issue to the blocker by it, and the dashed tag becomes the issue number. Then put the number in <code>issue</code> on the blocker in atlas.json (or hand that to an agent with <b>Prompt: file it for me</b>).</p>
  <h3>Reading the map</h3>
  <ul>
    <li><b>Arrows</b> point from the repository that provides to the one that relies on it — the way a change travels.</li>
    <li><b>Colour</b> says how it is taken: <span style="color:var(--k-copy)">■</span> copied / generated / built at a commit, <span style="color:var(--k-live)">■</span> read live, <span style="color:var(--k-protocol)">■</span> a shared protocol, <span style="color:var(--k-release)">■</span> a release, <span style="color:var(--k-reference)">┄</span> cited or ported. <span style="color:var(--bad)">Red with ⚠</span> is behind.</li>
    <li><b>Ring colour</b> is the phase (${Object.entries(PHASE).map(([k, v]) => `<span style="color:${v.color}" title="${esc(v.means)}">${k}</span>`).join(', ')}).</li>
    <li><b>Bubbles</b>: <span style="color:var(--accent)">●</span> open issues, <span style="color:var(--human)">●</span> waiting on you, <span style="color:var(--bad)">●!</span> behind upstream, <span style="color:var(--warn)">●✕</span> CI failing.</li>
    <li><b>Click</b> a repository to open it and show its parts around it; click a part or a line for its detail. <b>Drag</b> a repository to rearrange the map — your layout stays in this browser. Double-click to zoom.</li>
  </ul>
  <h3>Adding a repository</h3>
  <p>Add it to <code>data/registry.json</code> in <a href="https://github.com/${esc(D.owner)}/atlas" target="_blank" rel="noopener">${esc(D.owner)}/atlas</a> (where it sits and which zone), give it an <code>atlas.json</code> (see <code>docs/adding-a-repo.md</code>), and add the Atlas section to its CLAUDE.md.</p>
  <p class="muted">Map built ${esc(ago(D.generated))} (${esc(new Date(D.generated).toLocaleString())}).</p></div>`;
}

// ------------------------------------------------------------------ chrome
const VIEWS = ['map', 'priorities', 'blockers', 'roadmap', 'board', 'links', 'activity', 'guide'];
let current = 'map';
function showView(v) {
  if (!VIEWS.includes(v)) v = 'priorities';
  current = v;
  for (const id of VIEWS) $(`#${id}-view`).hidden = id !== v;
  $$('nav.views button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  if (v === 'priorities') renderPriorities();
  if (v === 'blockers') renderBlockers();
  if (v === 'roadmap') renderRoadmap();
  if (v === 'board') renderBoard();
  if (v === 'links') renderLinks();
  if (v === 'activity') renderActivity();
  if (v === 'guide') renderGuide();
  $('#panel').classList.toggle('open', !!selected && (v === 'map' || (v === 'blockers' && selected.type === 'blocker') || (v === 'priorities' && (selected.type === 'item' || selected.type === 'blocker'))));
  // The page opens on Priorities, with the map hidden: it fits itself the first time it shows.
  if (v === 'map' && D && !placeIfTurned() && !fit.done) fit(null, false);
  setHash();
}
function setHash() {
  if (current === 'priorities') {
    // #priorities/list, #priorities/chart/<item key>: the key's / and # written as %2F and %23
    const h = `#priorities/${pmode}${selected?.type === 'item' ? '/' + encodeURIComponent(selected.key) : ''}`;
    if (location.hash !== h) history.replaceState(null, '', h);
    return;
  }
  if (current === 'blockers') {
    const h = `#blockers/${bmode}${selected?.type === 'blocker' ? '/' + selected.uid : ''}`;
    if (location.hash !== h) history.replaceState(null, '', h);
    return;
  }
  const sel = current === 'map' && selected && selected.type !== 'blocked' && selected.type !== 'blocker' ? '/' + (selected.type === 'comp' ? `${selected.repo}.${selected.id}` : selected.type === 'link' ? 'link:' + selected.id : selected.type === 'pair' ? `pair:${selected.from}>${selected.to}` : selected.id) : '';
  const h = '#' + current + sel;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function readHash() {
  const parts = location.hash.replace(/^#/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  const [v, rest] = parts;
  if (v === 'priorities') {
    if (PMODES.some(m => m.id === parts[1])) { pmode = parts[1]; store.set('pmode', pmode); }
    const key = parts.slice(2).join('/');
    if (key) selected = { type: 'item', key };
    else if (selected?.type === 'item') selected = null;
    showView('priorities');
    if (key) select(selected);
    return;
  }
  if (v === 'blockers') {
    // #blockers, #blockers/chains, #blockers/rpi-alert/bench-first-run, #blockers/chains/flood-net/237
    let k = 1;
    if (BMODES.some(m => m.id === parts[1])) { bmode = parts[1]; store.set('bmode', bmode); k = 2; }
    const uid = parts.slice(k).join('/');
    if (uid) selected = { type: 'blocker', uid };
    else if (selected?.type === 'blocker') selected = null;
    showView('blockers');
    if (uid) select(selected);
    return;
  }
  showView(v || 'priorities');
  if (v === 'map' && rest) {
    // #map/link:rpi-alert:quansheng-v1-serial; an older address names only the entry
    // (#map/link:station-table): take the first link with that entry, as it always did.
    if (rest.startsWith('link:')) { const id = rest.slice(5); select({ type: 'link', id: L.some(l => l.id === id) ? id : L.find(l => l.entry === id)?.id || id }); }
    else if (rest.startsWith('pair:')) { const [f, t] = rest.slice(5).split('>'); select({ type: 'pair', from: f, to: t }); }
    else if (rest.includes('.')) { const [r, c] = rest.split('.'); if (R.has(r)) { expanded.add(r); drawComps(); drawLinks(); select({ type: 'comp', repo: r, id: c }); } }
    else if (R.has(rest)) goRepo(rest);
  }
}

function renderStrip() {
  const issues = D.repos.reduce((n, r) => n + (r.issueCount || 0), 0);
  const humans = ISSUES.filter(i => i.human).length + D.repos.reduce((n, r) => n + (r.m.status?.blocked || []).filter(b => b.on === 'human').length, 0);
  const behind = L.filter(l => stateOf(l) === 'behind').length, stale = L.filter(l => stateOf(l) === 'stale').length;
  const ci = D.repos.reduce((n, r) => n + r.ciFail.length, 0);
  const old = D.repos.filter(r => daysSince(r.m.status?.updated) > 30).length;
  const first = T && topPicks().yours;
  $('#strip').innerHTML = [
    first ? `<button class="stat start" data-go="priorities" data-item="${esc(first.key)}" title="${esc(`Your best next step, from the Priorities view: ${first.repo.label || first.repo.name} ${first.tag} — ${first.title}. ${whyShort(first)}.`)}">▶ <b>Start here</b> ${esc(first.repo.label || first.repo.name)} ${esc(first.tag)} <span class="start-t">${esc(cut(first.title, 46))}</span></button>` : '',
    `<span class="stat muted" title="Repositories on the map"><b>${D.repos.length}</b> repos · <b>${L.length}</b> links</span>`,
    `<button class="stat" data-go="board"><b>${issues}</b> open issues</button>`,
    `<button class="stat human" data-go="blockers" data-lane="human" title="Blockers only you can clear — hardware, money or a judgment call: recorded ones and [Human] issues"><b>${BLOCKERS.filter(b => b.lane === 'human').length}</b> waiting on you</button>`,
    `<button class="stat computer" data-go="blockers" data-lane="computer" title="Blockers that need only your sign-in. ${esc(ON_COMPUTER)}"><b>${BLOCKERS.filter(b => b.lane === 'computer').length}</b> on your computer</button>`,
    `<button class="stat" data-go="blockers" title="Everything stopping work, with the ways through"><b>${BLOCKERS.length}</b> blockers</button>`,
    `<button class="stat ${behind ? 'bad' : ''}" data-go="links" title="Links where the provider has moved on since the consumer last caught up"><b>${behind}</b> behind upstream</button>`,
    stale ? `<button class="stat warn" data-go="links" title="Citations whose source has changed since they were last reviewed"><b>${stale}</b> may be stale</button>` : '',
    ci ? `<button class="stat warn" data-go="map" title="Repositories whose latest run of a workflow failed"><b>${ci}</b> CI failing</button>` : '',
    old ? `<span class="stat warn muted" title="Repositories whose atlas.json status is over a month old"><b>${old}</b> old status</span>` : '',
    `<span class="stat muted" title="${esc(new Date(D.generated).toLocaleString())}">built ${esc(ago(D.generated))}</span>`,
  ].join('');
  $$('#strip [data-go]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.go === 'blockers') blockFilter = { repos: null, lane: b.dataset.lane || null };
    showView(b.dataset.go);
    if (b.dataset.item) select({ type: 'item', key: b.dataset.item });
  }));
}

function legend() {
  const line = (k, dash = '') => `<svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" style="stroke: var(--${k}); stroke-width: 3; ${dash ? 'stroke-dasharray:' + dash : ''}"/></svg>`;
  $('#legend').innerHTML = `<details ${store.get('legend', false) ? 'open' : ''}><summary>Key</summary><div class="body">
    <div class="row">${line('k-copy')}<span title="${esc(HOW.vendored.means)}">copied, generated or built at a commit</span></div>
    <div class="row">${line('k-live')}<span title="${esc(HOW.live.means)}">read live (site, API)</span></div>
    <div class="row">${line('k-protocol')}<span title="${esc(HOW.protocol.means)}">speaks its protocol</span></div>
    <div class="row">${line('k-release')}<span title="${esc(HOW.release.means)}">checks its release</span></div>
    <div class="row">${line('k-reference', '2 5')}<span title="${esc(HOW.reference.means)}">cites it / ported from it</span></div>
    <div class="row">${line('bad')}<span title="${esc(STATE.behind.means)}"><b>behind</b> — upstream moved on</span></div>
    <div class="row">${line('warn', '2 5')}<span title="${esc(STATE.stale.means)}"><b>may be stale</b> — a citation's source changed</span></div>
    <h4>Arrows</h4><div>From the repo that provides to the one that relies on it.</div>
    <h4>Zoom in</h4><div>for each repo's one-line description, how many links a thick line holds, a citation's <b>?</b> and each link's name. A line <b>behind</b> is marked ⚠ at any zoom.</div>
    <h4>Bubbles</h4><div><span style="color:var(--accent)">●</span> issues <span style="color:var(--human)">●</span> on you <span style="color:var(--bad)">●</span> behind <span style="color:var(--warn)">●</span> CI</div>
    <h4>Ring</h4><div>${Object.entries(PHASE).filter(([k]) => k !== 'maintenance').map(([k, v]) => `<span style="color:${v.color}" title="${esc(v.means)}">● ${k}</span>`).join(' ')}</div>
  </div></details>`;
  $('#legend details').addEventListener('toggle', e => store.set('legend', e.target.open));
}

function wireChrome() {
  $$('nav.views button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#btn-in').addEventListener('click', () => zoomBy(1.3));
  $('#btn-out').addEventListener('click', () => zoomBy(1 / 1.3));
  $('#btn-fit').addEventListener('click', () => fit());
  const anim = $('#btn-anim');
  const setAnim = on => { $('#map').classList.toggle('animate', on); anim.setAttribute('aria-pressed', on); store.set('animate', on); };
  setAnim(store.get('animate', true));
  anim.addEventListener('click', () => setAnim(anim.getAttribute('aria-pressed') !== 'true'));
  $('#btn-expand').addEventListener('click', () => {
    const any = expanded.size > 0;
    expanded.clear(); if (!any) D.repos.forEach(r => r.comps.length && expanded.add(r.id));
    store.set('expanded', [...expanded]); drawComps(); drawLinks(); applyHighlight();
    $('#btn-expand').textContent = expanded.size ? 'Hide parts' : 'Show all parts';
  });
  $('#btn-expand').textContent = expanded.size ? 'Hide parts' : 'Show all parts';
  const bb = $('#btn-blockers');
  bb.setAttribute('aria-pressed', showBlockers);
  bb.addEventListener('click', () => {
    showBlockers = !showBlockers; store.set('blockers', showBlockers); bb.setAttribute('aria-pressed', showBlockers);
    drawBlockers(); applyHighlight(); fit();
  });
  const reset = $('#btn-reset');
  reset.hidden = !Object.keys(custom).length;
  reset.addEventListener('click', () => {
    store.set(layoutStore(), {});
    place(); drawAll(); fit();
  });
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store.set('theme', next);
  });
  $('#search').addEventListener('input', () => {
    const q = $('#search').value.trim().toLowerCase();
    if (current === 'board') { renderBoard(); return; }
    if (current === 'blockers') { renderBlockers(); return; }
    if (current === 'priorities') { renderPriorities(); return; }
    if (!q) { select(null); return; }
    const hit = D.repos.find(r => `${r.name} ${r.repo} ${r.m.tagline || ''}`.toLowerCase().includes(q))
      || D.repos.find(r => r.comps.some(c => `${c.name} ${c.what}`.toLowerCase().includes(q)));
    if (hit) { showView('map'); goRepo(hit.id); }
  });
  $('#search').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (current === 'blockers') {
      const q = $('#search').value.trim().toLowerCase();
      const hit = q && (BLOCKERS.find(b => b.tag.toLowerCase() === q || b.slug === q || b.uid === q) || BLOCKERS.find(b => blkMatch(b, q)));
      if (hit) openBlocker(hit.uid);
      return;
    }
    if (current === 'priorities') return;
    if (current !== 'board') { showView('board'); renderBoard(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });
  window.addEventListener('resize', () => { if (current === 'map' && !placeIfTurned()) applyView(); });
  window.addEventListener('hashchange', readHash);
}

async function load() {
  const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  let data = window.ATLAS_DATA;
  if (!data) {
    try { const res = await fetch('data/map.json', { cache: 'no-cache' }); data = await res.json(); }
    catch (e) { for (const id of VIEWS) $(`#${id}-view`).hidden = id !== 'map'; $('#map-view').innerHTML = `<div class="page"><h2>Could not load the map</h2><p>${esc(e.message)}</p><p>Open this page through a web server (GitHub Pages, or <code>python3 -m http.server</code>), not as a file.</p></div>`; return; }
  }
  data.registryPos = Object.fromEntries(data.repos.map(r => [r.id, { x: r.x, y: r.y }]));
  prepare(data);
  renderStrip(); legend(); wireChrome(); buildMap();
  requestAnimationFrame(() => { fit(null, false); readHash(); });
}
// tools/brief.mjs runs this file with no page (window.ATLAS_HEADLESS) for the Priorities view's
// pick for the owner — "Your next step", the Start here button — so the phone and the page agree.
// Only prepare() runs: keep it free of anything that needs a page.
if (window.ATLAS_HEADLESS) {
  window.ATLAS_HEADLESS.rank = data => {
    prepare(data);
    const it = topPicks().yours, b = it?.main;
    if (!it) return null;
    return {
      key: it.type === 'issue' ? it.key : b?.iss ? b.iss.key : b.uid,
      repo: it.repo.name, tag: it.type === 'issue' || b?.iss ? it.tag : '', title: it.title, who: it.who,
      yourMinutes: Math.round(it.c.yourHours * 60), importance: Math.round(it.s.worth), why: whyShort(it),
    };
  };
} else load();
})();
