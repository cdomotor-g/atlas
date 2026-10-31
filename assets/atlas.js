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
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* nothing more to try */ } ta.remove();
  }
  if (btn) { btn.classList.add('done'); const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.classList.remove('done'); btn.textContent = old; }, 1400); }
  toast('Copied — paste it into a new Claude Code session or Dispatch');
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
const layoutKey = 'layout-v1';
let custom = store.get(layoutKey, {});

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
    r.humans = (r.issues || []).filter(i => i.human);
    r.ciFail = (r.ci || []).filter(c => c.conclusion === 'failure');
    const pos = custom[r.id];
    if (pos) { r.x = pos.x; r.y = pos.y; }
  }
  L = (D.links || []).filter(l => R.has(l.from) && R.has(l.to));
  for (const l of L) {
    l.kind = HOW[l.how]?.k || 'reference';
    R.get(l.from).out.push(l); R.get(l.to).in.push(l);
  }
  for (const r of D.repos) { r.behindIn = r.in.filter(l => stateOf(l) === 'behind'); r.staleIn = r.in.filter(l => stateOf(l) === 'stale'); }
  ISSUES = D.repos.flatMap(r => (r.issues || []).map(i => ({ ...i, repo: r })));
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
let gWorld, gZones, gLinks, gNodes, gComps;

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
  gComps = svg('g', { class: 'comps' }, gWorld);
  gNodes = svg('g', { class: 'nodes' }, gWorld);
  drawAll();
  wireMap(el);
}

function drawAll() {
  drawZones(); drawNodes(); drawComps(); drawLinks(); applyView(); applyHighlight();
}

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
    if (r.private) { const t = svg('text', { class: 'tag', y: -r.r - 8 }, g); t.textContent = '🔒 private'; }
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
      if (it.state === 'behind') badge(`⚠${it.behind || ''}${single ? '' : ' · ' + it.links.length}`, '');
      else if (it.state === 'stale') badge(single ? '?' : `? · ${it.links.length}`, 'stale');
      else if (!single) badge(`${it.links.length}`, 'count');
      else if (view.k >= 1.35) {
        const t = svg('text', { class: 'lbl', x: mx, y: my - 6 }, g);
        t.textContent = (l.what || '').length > 38 ? l.what.slice(0, 36) + '…' : l.what;
      }
    });
  }
}

function applyView() {
  gWorld.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const lod = view.k >= 1.35 ? 2 : view.k >= 1.25 ? 1 : 0;
  if (lod !== applyView.lod) { applyView.lod = lod; drawLinks(); applyHighlight(); }
}

function fit(ids, animate = true) {
  const el = $('#map'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  const set = ids ? D.repos.filter(r => ids.includes(r.id)) : D.repos;
  const pad = ids ? 160 : 70;
  const x0 = Math.min(...set.map(r => r.x - r.r)) - pad, x1 = Math.max(...set.map(r => r.x + r.r)) + pad;
  const y0 = Math.min(...set.map(r => r.y - r.r)) - pad, y1 = Math.max(...set.map(r => r.y + r.r)) + pad;
  const k = Math.min(w / (x1 - x0), h / (y1 - y0), ids ? 1.6 : 1.4);
  const target = { k, x: w / 2 - k * (x0 + x1) / 2, y: h / 2 - k * (y0 + y1) / 2 };
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
      drawZones(); drawNodes(); drawComps(); drawLinks(); applyHighlight();
    }
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    el.classList.remove('dragging');
    if (drag && drag.type === 'node' && moved) {
      custom[drag.r.id] = { x: drag.r.x, y: drag.r.y }; store.set(layoutKey, custom);
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
  } else if (selected) focus = selected;
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
  panel.innerHTML = s.type === 'repo' ? repoPanel(R.get(s.id)) : s.type === 'link' ? linkPanel(L.find(l => l.id === s.id)) : s.type === 'pair' ? pairPanel(s.from, s.to) : compPanel(R.get(s.repo), s.id);
  panel.classList.add('open');
  panel.scrollTop = 0;
  setHash();
  wirePanel(panel);
}

function wirePanel(panel) {
  $$('[data-copy]', panel).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); copyText(PROMPTS.get(b.dataset.copy), b); }));
  $$('[data-go-repo]', panel).forEach(b => b.addEventListener('click', () => goRepo(b.dataset.goRepo)));
  $$('[data-go-link]', panel).forEach(b => b.addEventListener('click', () => { showView('map'); select({ type: 'link', id: b.dataset.goLink }); }));
  $$('[data-go-comp]', panel).forEach(b => b.addEventListener('click', () => { const [r, c] = b.dataset.goComp.split(':'); expanded.add(r); drawComps(); drawLinks(); select({ type: 'comp', repo: r, id: c }); }));
  $('.p-close', panel)?.addEventListener('click', () => select(null));
  $('[data-expand]', panel)?.addEventListener('click', e => { toggleExpand(e.currentTarget.dataset.expand); select(selected); });
}

function goRepo(id) {
  showView('map');
  if (!expanded.has(id)) toggleExpand(id, true);
  select({ type: 'repo', id });
  fit([id, ...R.get(id).in.map(l => l.from), ...R.get(id).out.map(l => l.to)]);
}

const PROMPTS = new Map();
let promptSeq = 0;
function promptBtn(text, label = 'Copy prompt') {
  const id = 'p' + (++promptSeq); PROMPTS.set(id, text);
  return `<button class="copy" data-copy="${id}" title="Copies a ready-made brief for a new Claude Code session (or Dispatch), so an agent can pick this up cold.">${label}</button>`;
}

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
  if (r.humans.length) lines.push('', 'Waiting on me:', ...r.humans.map(i => `- #${i.n} ${i.title}`));
  lines.push('', `Read CLAUDE.md, then the open issues, and tell me in five lines what you'd do first. Repository: https://github.com/${r.repo}`);
  return lines.join('\n');
}

function issueRow(r, i, showRepo) {
  const tags = [];
  if (i.human) tags.push(term('Human', 'Needs you: credentials, physical access or a judgment call an agent cannot make.', 'human'));
  if (i.model) tags.push(`<span class="chip model" title="The model and effort recommended for an agent picking this up.">${esc(i.model)}/${esc(i.effort)}</span>`);
  if (i.structure === 'epic') tags.push(term('Epic', 'A larger issue that groups sub-issues.', 'acc'));
  if (i.structure === 'sub') tags.push(`<span class="chip" title="Part of a larger epic.">of #${i.parent}</span>`);
  tags.push(`<span class="chip" title="Last updated">${esc(ago(i.updated))}</span>`);
  return `<div class="issue">
    <span class="n">${showRepo ? `<img src="${esc(r.logo)}" alt="" style="width:16px;height:16px;border-radius:4px;vertical-align:-3px"> ` : ''}#${i.n}</span>
    <div class="t"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><div class="meta">${tags.join('')}</div></div>
    ${i.human ? '' : promptBtn(issuePrompt(r, i), 'Prompt')}
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
    ['Waiting on you', issues.filter(i => i.human)],
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
    ${s.blocked?.length ? `<h3>Blocked</h3><ul>${s.blocked.map(b => `<li>${rich(b.what, r.repo)} ${b.on === 'human' ? term('on you', 'Only you can do this.', 'human') : `<span class="chip">on ${esc(b.on)}</span>`}</li>`).join('')}</ul>` : ''}
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
      const blocked = [...(s.blocked || []).map(b => `${rich(b.what, r.repo)} ${b.on === 'human' ? term('you', 'Only you can do this.', 'human') : `<span class="chip">${esc(b.on)}</span>`}`), ...r.behindIn.map(l => `Behind ${esc(R.get(l.from).name)}: ${esc(l.what)} ${term('drift', l.drift.note, 'bad')}`)];
      rows.push(`<div data-col="Blocked / behind">${blocked.length ? `<ul>${blocked.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`);
    }
  }
  el.innerHTML = `<div class="page"><h2>Roadmap</h2>
    <p class="intro">Every repository's Now / Next / Later, from the <code>status</code> in its own <code>atlas.json</code>. Each repository keeps its own detailed roadmap (linked in its panel); this is the one-screen summary they feed. Blocked items marked <span class="chip human">you</span> wait on you.</p>
    <div class="road"><div class="hd">Repository</div><div class="hd">Now</div><div class="hd">Next</div><div class="hd">Later</div><div class="hd">Blocked / behind</div>${rows.join('')}</div></div>`;
  $$('[data-go-repo]', el).forEach(b => b.addEventListener('click', () => goRepo(b.dataset.goRepo)));
}

// ------------------------------------------------------------------ board view
let boardRepos = null;
function renderBoard() {
  const el = $('#board-view');
  const withIssues = D.repos.filter(r => (r.issues || []).length);
  if (!boardRepos) boardRepos = new Set(withIssues.map(r => r.id));
  const q = ($('#search').value || '').toLowerCase();
  const pick = ISSUES.filter(i => boardRepos.has(i.repo.id) && (!q || `${i.title} ${i.repo.name} #${i.n}`.toLowerCase().includes(q)));
  const humanBlocked = D.repos.flatMap(r => (r.m.status?.blocked || []).filter(b => b.on === 'human').map(b => ({ r, b })));
  const drifting = L.filter(l => ['behind', 'stale'].includes(stateOf(l)));
  const card = i => {
    const tags = [];
    if (i.human) tags.push(term('Human', 'Needs you.', 'human'));
    if (i.model) tags.push(`<span class="chip model" title="Recommended model / effort">${esc(i.model)}/${esc(i.effort)}</span>`);
    if (i.structure === 'epic') tags.push(term('Epic', 'Groups sub-issues.', 'acc'));
    if (i.structure === 'sub') tags.push(`<span class="chip">of #${i.parent}</span>`);
    tags.push(`<span class="chip">${esc(ago(i.updated))}</span>`);
    return `<div class="card"><div class="top"><img src="${esc(i.repo.logo)}" alt="">${esc(i.repo.name)} · #${i.n}</div>
      <div class="t"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></div>
      <div class="meta">${tags.join('')}${i.human ? '' : promptBtn(issuePrompt(i.repo, i), 'Prompt')}</div></div>`;
  };
  const byModel = {};
  for (const i of pick.filter(i => !i.human && i.model && i.structure !== 'epic')) (byModel[i.model] ||= []).push(i);
  const effortRank = { Low: 0, Med: 1, High: 2, XHigh: 3, Max: 4 };
  const human = pick.filter(i => i.human);
  const untagged = pick.filter(i => !i.human && !i.model && i.structure !== 'epic');
  const epics = pick.filter(i => i.structure === 'epic');
  el.innerHTML = `<div class="page"><h2>Board</h2>
    <p class="intro">Every open issue across the repositories, sorted by who can move it. Tags come from issue titles (<code>[Human]</code>, <code>[Sonnet5/Med]</code>, <code>[Epic]</code>…). <b>Prompt</b> copies a ready brief for a new Claude Code session or Dispatch.</p>
    <div class="filters">${withIssues.map(r => `<button data-repo="${esc(r.id)}" aria-pressed="${boardRepos.has(r.id)}"><img src="${esc(r.logo)}" alt="">${esc(r.name)} <b>${r.issues.length}</b></button>`).join('')}</div>
    <div class="board">
      <div class="col"><h3><span>👤 Waiting on you</span><span>${human.length + humanBlocked.length}</span></h3><div class="sub">Only you can move these.</div>
        ${human.map(card).join('')}
        ${humanBlocked.map(({ r, b }) => `<div class="card"><div class="top"><img src="${esc(r.logo)}" alt="">${esc(r.name)} · from its status</div><div class="t">${rich(b.what, r.repo)}</div></div>`).join('')}
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
const VIEWS = ['map', 'roadmap', 'board', 'links', 'activity', 'guide'];
let current = 'map';
function showView(v) {
  if (!VIEWS.includes(v)) v = 'map';
  current = v;
  for (const id of VIEWS) $(`#${id}-view`).hidden = id !== v;
  $$('nav.views button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  if (v === 'roadmap') renderRoadmap();
  if (v === 'board') renderBoard();
  if (v === 'links') renderLinks();
  if (v === 'activity') renderActivity();
  if (v === 'guide') renderGuide();
  if (v !== 'map') $('#panel').classList.remove('open'); else if (selected) $('#panel').classList.add('open');
  setHash();
}
function setHash() {
  const sel = current === 'map' && selected ? '/' + (selected.type === 'comp' ? `${selected.repo}.${selected.id}` : selected.type === 'link' ? 'link:' + selected.id : selected.type === 'pair' ? `pair:${selected.from}>${selected.to}` : selected.id) : '';
  const h = '#' + current + sel;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function readHash() {
  const [v, rest] = location.hash.replace(/^#/, '').split('/');
  showView(v || 'map');
  if (v === 'map' && rest) {
    if (rest.startsWith('link:')) select({ type: 'link', id: rest.slice(5) });
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
  $('#strip').innerHTML = [
    `<span class="stat muted" title="Repositories on the map"><b>${D.repos.length}</b> repos · <b>${L.length}</b> links</span>`,
    `<button class="stat" data-go="board"><b>${issues}</b> open issues</button>`,
    `<button class="stat human" data-go="board" title="Issues tagged [Human] plus status items blocked on you"><b>${humans}</b> waiting on you</button>`,
    `<button class="stat ${behind ? 'bad' : ''}" data-go="links" title="Links where the provider has moved on since the consumer last caught up"><b>${behind}</b> behind upstream</button>`,
    stale ? `<button class="stat warn" data-go="links" title="Citations whose source has changed since they were last reviewed"><b>${stale}</b> may be stale</button>` : '',
    ci ? `<button class="stat warn" data-go="map" title="Repositories whose latest run of a workflow failed"><b>${ci}</b> CI failing</button>` : '',
    old ? `<span class="stat warn muted" title="Repositories whose atlas.json status is over a month old"><b>${old}</b> old status</span>` : '',
    `<span class="stat muted" title="${esc(new Date(D.generated).toLocaleString())}">built ${esc(ago(D.generated))}</span>`,
  ].join('');
  $$('#strip [data-go]').forEach(b => b.addEventListener('click', () => showView(b.dataset.go)));
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
  const reset = $('#btn-reset');
  reset.hidden = !Object.keys(custom).length;
  reset.addEventListener('click', () => {
    custom = {}; store.set(layoutKey, custom);
    for (const r of D.repos) { const o = D.registryPos?.[r.id]; if (o) { r.x = o.x; r.y = o.y; } }
    reset.hidden = true; drawAll(); fit();
  });
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store.set('theme', next);
  });
  $('#search').addEventListener('input', () => {
    const q = $('#search').value.trim().toLowerCase();
    if (current === 'board') { renderBoard(); return; }
    if (!q) { select(null); return; }
    const hit = D.repos.find(r => `${r.name} ${r.repo} ${r.m.tagline || ''}`.toLowerCase().includes(q))
      || D.repos.find(r => r.comps.some(c => `${c.name} ${c.what}`.toLowerCase().includes(q)));
    if (hit) { showView('map'); goRepo(hit.id); }
  });
  $('#search').addEventListener('keydown', e => { if (e.key === 'Enter' && current !== 'board') { showView('board'); renderBoard(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });
  window.addEventListener('resize', () => { if (current === 'map') applyView(); });
  window.addEventListener('hashchange', readHash);
}

async function load() {
  const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  let data = window.ATLAS_DATA;
  if (!data) {
    try { const res = await fetch('data/map.json', { cache: 'no-cache' }); data = await res.json(); }
    catch (e) { $('#map-view').innerHTML = `<div class="page"><h2>Could not load the map</h2><p>${esc(e.message)}</p><p>Open this page through a web server (GitHub Pages, or <code>python3 -m http.server</code>), not as a file.</p></div>`; return; }
  }
  data.registryPos = Object.fromEntries(data.repos.map(r => [r.id, { x: r.x, y: r.y }]));
  prepare(data);
  renderStrip(); legend(); wireChrome(); buildMap();
  requestAnimationFrame(() => { fit(null, false); readHash(); });
}
load();
})();
