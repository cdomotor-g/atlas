// Usage snapshot: where this week's Claude Code usage went.
//
// Runs in a browser tab on https://claude.ai that is signed in as the owner (Claude in Chrome's
// javascript tool, or pasted into the browser console). It reads the same lists the Claude Code
// pages show, adds them up and returns a short plain-text report. It reads only; it changes
// nothing. README.md in this folder says how the daily usage watch uses it.
//
// What it reports:
//   - the weekly allowance used so far, from the most recent session's own record of the limit;
//   - each session active in the last day and since the weekly reset, with the model, effort
//     and what it would have cost at list price (cost_usd, the figure each session keeps);
//   - warnings for the patterns that burn the allowance (Max effort, very long conversations).
// A session that started before the reset is counted whole, so the since-reset total runs a
// little high when one carried over; the report says which ones did.
(async () => {
  const H = { credentials: 'include', headers: { 'anthropic-version': '2023-06-01' } };
  const get = async u => { const r = await fetch(u, H); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); };
  const local = t => new Date(t).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const usd = n => `US$${(n || 0).toFixed(n >= 10 ? 0 : 2)}`;
  const PER_PERCENT = 14; // about US$14 of list price is 1% of the week on Max (measured 9 Nov 2026)

  // Sessions, newest first, back about eight days.
  const sessions = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const j = await get('/v1/code/sessions?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    sessions.push(...j.data);
    cursor = j.next_cursor;
    const last = j.data[j.data.length - 1];
    if (!cursor || !last || Date.now() - new Date(last.updated_at) > 8 * 864e5) break;
  }
  if (!sessions.length) return 'Usage snapshot: no Claude Code sessions found.';

  // The weekly window and how much of it is used, from the newest session's rate-limit events.
  let week = null;
  for (const s of sessions.slice(0, 5)) {
    const ev = await get(`/v1/code/sessions/${s.id}/events?limit=300`).catch(() => ({ data: [] }));
    const rl = ev.data.filter(e => e.event_type === 'rate_limit_event')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    const w = rl?.payload?.rate_limit_info?.unifiedWindows?.seven_day;
    if (w) { week = { used: w.utilization, resets: new Date(w.resetsAt * 1000), at: rl.created_at }; break; }
  }
  const weekStart = week ? new Date(week.resets - 7 * 864e5) : new Date(Date.now() - 7 * 864e5);
  const dayAgo = new Date(Date.now() - 864e5);
  const active = s => new Date(s.last_event_at || s.updated_at);

  // A session that began before a window started: what it had cost by then, from its own
  // turn records ("result" events carry the running total). Events come newest first, so read
  // back only as far as the window's start.
  const costBefore = async (s, cutoff) => {
    let cur = null;
    for (let i = 0; i < 40; i++) {
      const j = await get(`/v1/code/sessions/${s.id}/events?limit=500` + (cur ? '&cursor=' + encodeURIComponent(cur) : ''));
      const before = j.data.filter(e => e.event_type === 'result' && new Date(e.created_at) < cutoff && e.payload?.total_cost_usd != null)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      if (before) return before.payload.total_cost_usd;
      cur = j.next_cursor || j.next_page;
      if (!cur || !j.data.length) return 0;
    }
    return 0;
  };
  const rows = async cutoff => {
    const list = [];
    for (const s of sessions.filter(x => active(x) >= cutoff)) {
      const u = s.external_metadata?.usage || {};
      const carried = new Date(s.created_at) < cutoff;
      const base = carried ? await costBefore(s, cutoff).catch(() => 0) : 0;
      list.push({
        title: (s.title || 'untitled').slice(0, 48),
        repo: (s.config?.sources || []).map(x => (x.url || '').split('/').pop()).filter(Boolean).join('+') || '—',
        setup: `${(s.config?.model || '?').replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2')} / ${s.config?.effort_level || 'default'}`,
        cost: Math.max(0, (u.cost_usd || 0) - base),
        carried,
      });
    }
    return list.sort((a, b) => b.cost - a.cost);
  };
  const sinceReset = await rows(weekStart);
  const today = await rows(dayAgo);
  const sum = l => l.reduce((t, r) => t + r.cost, 0);

  const out = [];
  if (week) {
    const hours = (Date.now() - weekStart) / 36e5;
    const pace = hours > 6 ? (week.used / hours) * 168 : null;
    out.push(`Weekly allowance: ${Math.round(week.used * 100)}% used (as of ${local(week.at)}), resets ${local(week.resets)}.`);
    if (pace) out.push(pace > 1
      ? `At this pace it runs out ${local(new Date(weekStart.getTime() + (168 / (pace)) * 36e5))}, before the reset. To last, keep to about ${Math.round(((1 - week.used) / ((week.resets - Date.now()) / 864e5)) * 100)}% a day.`
      : `On pace to finish the week at about ${Math.round(pace * 100)}%.`);
  } else out.push('Weekly allowance: not found in the recent sessions (check claude.ai → Settings → Usage).');
  out.push('', `Last 24 hours: ${usd(sum(today))} at list price (about ${Math.round(sum(today) / PER_PERCENT)}% of the week), ${today.length} sessions.`);
  for (const r of today.slice(0, 5)) out.push(`  ${usd(r.cost)}  ${r.title} (${r.repo}, ${r.setup})`);
  out.push('', `Since the reset: ${usd(sum(sinceReset))}, ${sinceReset.length} sessions. Biggest:`);
  for (const r of sinceReset.slice(0, 5)) out.push(`  ${usd(r.cost)}  ${r.title} (${r.repo}, ${r.setup})${r.carried ? ' — the part since the reset' : ''}`);

  const warn = [];
  const max = sinceReset.filter(r => /max/i.test(r.setup) && r.cost > 1);
  if (max.length) warn.push(`${max.length} session(s) on Max effort (3.5× or more usage): ${max.map(r => r.title).join('; ')}.`);
  const long = sessions.filter(s => s.status !== 'archived' && (s.external_metadata?.context_usage?.used_tokens || 0) > 200000);
  if (long.length) warn.push(`Still open with a very long conversation (each message re-reads it all; time for a fresh session): ${long.map(s => `${(s.title || 'untitled').slice(0, 48)} (${Math.round(s.external_metadata.context_usage.used_tokens / 1000)}k tokens)`).join('; ')}.`);
  const opusShare = sum(sinceReset.filter(r => /opus/.test(r.setup))) / (sum(sinceReset) || 1);
  if (opusShare > 0.8) warn.push(`${Math.round(opusShare * 100)}% of it ran on Opus. Most coding with a clear brief is fine on Sonnet.`);
  if (warn.length) out.push('', 'Watch out:', ...warn.map(w => '  • ' + w));
  return out.join('\n');
})();
