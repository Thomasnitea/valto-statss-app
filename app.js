const STORAGE_KEY = 'korfbal-app-data';
const THEME_KEY = 'korfbal-app-theme';

const THEMES = [
  { id: 'default', label: 'Standaard', dots: ['#243f3d', '#3ab09e', '#f95831'] },
  { id: 'ckv-valto', label: 'CKV Valto', dots: ['#1a1a1a', '#f2650a', '#2856c7'] },
  { id: 'pink', label: 'Roze', dots: ['#f283af', '#7d2350', '#f4a068'] },
];

const ICONS = {
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
  swap: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px;margin-right:6px;"><path d="M7 3v12"></path><path d="M3 11l4 4 4-4"></path><path d="M17 21V9"></path><path d="M21 13l-4-4-4 4"></path></svg>',
};

const DEFAULT_SETTINGS = { shotLocation: false, opponentShotLocation: false, possession: false };

let data = loadData();
let route = { name: 'home' };
let subModalOpen = false;
let pendingShot = null;
let statsFilter = 'all';
let shotMapMode = 'dots';
let toast = null;
let toastTimer = null;

function matchSettings(m) {
  return { ...DEFAULT_SETTINGS, ...(m.settings || {}) };
}

// ---- Wedstrijdklok: verstreken tijd pauzeert bij Rust of handmatig ----
function clockElapsed(m) {
  const c = m.clock;
  if (!c) return 0;
  return c.elapsedMs + (c.running && c.startedAt ? Date.now() - c.startedAt : 0);
}

function clockRunning(m) {
  return !!(m.clock && m.clock.running);
}

function startClock(m) {
  if (!m.clock) m.clock = { running: false, elapsedMs: 0, startedAt: null };
  if (m.clock.running) return;
  m.clock.running = true;
  m.clock.startedAt = Date.now();
}

function pauseClock(m) {
  if (!m.clock || !m.clock.running) return;
  m.clock.elapsedMs = clockElapsed(m);
  m.clock.running = false;
  m.clock.startedAt = null;
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatEventTime(ev) {
  return ev.t == null ? '--:--' : formatClock(ev.t);
}

function pushEvent(m, ev) {
  m.events.push({ ...ev, t: clockElapsed(m), ts: Date.now() });
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Kon opgeslagen data niet lezen', e);
  }
  return { players: [], matches: [] };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'default';
  } catch (e) {
    return 'default';
  }
}

function setTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch (e) {
    console.error('Kon thema niet opslaan', e);
  }
  if (id === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function getPlayer(id) {
  return data.players.find((p) => p.id === id);
}

function getPlayerName(id) {
  const p = getPlayer(id);
  return p ? p.name : 'Onbekende speler';
}

function currentMatch() {
  return data.matches.find((m) => m.id === route.matchId);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function statLine(id, st, showXg) {
  const s = st.stats[id] || { goals: 0, misses: 0, xg: 0, locShots: 0 };
  const total = s.goals + s.misses;
  const xg = showXg && s.locShots > 0 ? ` · xG ${formatXg(s.xg)}` : '';
  return `<div class="stat-line">${s.goals}/${total} kansen · <span class="stat-pct">${formatPct(s.goals, s.misses)}</span>${xg}</div>`;
}

// ---- Wedstrijd-engine: state wordt volledig afgeleid uit het event-log ----
function computeMatchState(squad, initialLineup, events) {
  let attackers = [...initialLineup.attackers];
  let defenders = [...initialLineup.defenders];
  let own = 0;
  let opponent = 0;
  let ownMisses = 0;
  let opponentMisses = 0;
  let ownXg = 0;
  let ownLocShots = 0;
  let oppXg = 0;
  let oppLocShots = 0;
  let counter = 0;
  const stats = {};
  squad.forEach((id) => { stats[id] = { goals: 0, misses: 0, xg: 0, locShots: 0, locGoals: 0 }; });
  let lastEventWasSwap = false;

  events.forEach((ev) => {
    lastEventWasSwap = false;
    if (ev.type === 'goal' || ev.type === 'miss') {
      const x = xgForEvent(ev);
      const isGoal = ev.type === 'goal';
      const s = stats[ev.playerId];
      if (s) {
        if (isGoal) s.goals++; else s.misses++;
        if (x != null) { s.xg += x; s.locShots++; if (isGoal) s.locGoals++; }
      }
      if (x != null) { ownXg += x; ownLocShots++; }
      if (isGoal) { own++; counter++; } else { ownMisses++; }
    } else if (ev.type === 'opponentGoal' || ev.type === 'opponentMiss') {
      const x = xgForEvent(ev);
      if (x != null) { oppXg += x; oppLocShots++; }
      if (ev.type === 'opponentGoal') { opponent++; counter++; } else { opponentMisses++; }
    } else if (ev.type === 'substitution') {
      let idx = attackers.indexOf(ev.playerOut);
      if (idx !== -1) {
        attackers[idx] = ev.playerIn;
      } else {
        idx = defenders.indexOf(ev.playerOut);
        if (idx !== -1) defenders[idx] = ev.playerIn;
      }
    }
    if ((ev.type === 'goal' || ev.type === 'opponentGoal') && counter === 2) {
      const tmp = attackers;
      attackers = defenders;
      defenders = tmp;
      counter = 0;
      lastEventWasSwap = true;
    }
  });

  const bench = squad.filter((id) => !attackers.includes(id) && !defenders.includes(id));
  return {
    attackers, defenders, bench, score: { own, opponent }, ownMisses, opponentMisses,
    ownXg, ownLocShots, oppXg, oppLocShots, counter, stats, lastEventWasSwap,
  };
}

function findHalftimeIndex(events) {
  return events.findIndex((ev) => ev.type === 'halftime');
}

// Splitst de wedstrijd in helft 1 / helft 2 / totaal voor eigen team en tegenstander.
// Helft 2 wordt afgeleid als totaal - helft 1 (geen aparte opstelling-berekening nodig).
const PERIOD_KEYS = ['goals', 'misses', 'xg', 'locShots', 'locGoals'];

function periodOf(s) {
  const r = {};
  PERIOD_KEYS.forEach((k) => { r[k] = (s && s[k]) || 0; });
  return r;
}

function diffPeriod(a, b) {
  const r = {};
  PERIOD_KEYS.forEach((k) => { r[k] = a[k] - b[k]; });
  return r;
}

function computeHalfSplit(squad, initialLineup, events) {
  const htIndex = findHalftimeIndex(events);
  const totalState = computeMatchState(squad, initialLineup, events);
  const half1Events = htIndex === -1 ? events : events.slice(0, htIndex);
  const half1State = computeMatchState(squad, initialLineup, half1Events);

  const team = (state, own) => periodOf(own
    ? { goals: state.score.own, misses: state.ownMisses, xg: state.ownXg, locShots: state.ownLocShots }
    : { goals: state.score.opponent, misses: state.opponentMisses, xg: state.oppXg, locShots: state.oppLocShots });

  const ownTotal = team(totalState, true);
  const ownHalf1 = team(half1State, true);
  const oppTotal = team(totalState, false);
  const oppHalf1 = team(half1State, false);

  const players = {};
  squad.forEach((id) => {
    const total = periodOf(totalState.stats[id]);
    const half1 = periodOf(half1State.stats[id]);
    players[id] = { half1, half2: diffPeriod(total, half1), total };
  });

  return {
    hasHalftime: htIndex !== -1,
    hasOwnShotData: totalState.ownLocShots > 0,
    hasOppShotData: totalState.oppLocShots > 0,
    hasShotData: totalState.ownLocShots + totalState.oppLocShots > 0,
    own: { half1: ownHalf1, half2: diffPeriod(ownTotal, ownHalf1), total: ownTotal },
    opponent: { half1: oppHalf1, half2: diffPeriod(oppTotal, oppHalf1), total: oppTotal },
    players,
  };
}

// Balbezit in ms per helft en totaal, op basis van 'possession'-events en de wedstrijdklok.
function computePossession(m) {
  const res = { half1: { own: 0, opp: 0 }, half2: { own: 0, opp: 0 } };
  let half = 'half1';
  let side = null;
  let since = 0;
  const close = (t) => {
    if (side) res[half][side === 'own' ? 'own' : 'opp'] += Math.max(0, t - since);
  };
  m.events.forEach((ev) => {
    if (ev.t == null) return;
    if (ev.type === 'possession') {
      close(ev.t);
      side = ev.side;
      since = ev.t;
    } else if (ev.type === 'halftime') {
      close(ev.t);
      side = null;
      half = 'half2';
    }
  });
  close(clockElapsed(m));
  res.total = { own: res.half1.own + res.half2.own, opp: res.half1.opp + res.half2.opp };
  return res;
}

function possessionPct(p) {
  const sum = p.own + p.opp;
  if (sum <= 0) return null;
  return Math.round((p.own / sum) * 100);
}

function currentPossessionSide(m) {
  for (let i = m.events.length - 1; i >= 0; i--) {
    const ev = m.events[i];
    if (ev.type === 'halftime') return null;
    if (ev.type === 'possession') return ev.side;
  }
  return null;
}

function formatPossession(p) {
  const own = possessionPct(p);
  if (own == null) return '–';
  return `${own}% – ${100 - own}%`;
}

// Tijdlijn van goals, rust en wissels met de lopende stand.
function buildTimeline(m) {
  let own = 0;
  let opp = 0;
  const items = [];
  m.events.forEach((ev) => {
    if (ev.type === 'goal') {
      own++;
      items.push({ kind: 'goal', t: ev.t, label: getPlayerName(ev.playerId), own, opp, xg: xgForEvent(ev) });
    } else if (ev.type === 'opponentGoal') {
      opp++;
      items.push({ kind: 'opponentGoal', t: ev.t, label: 'Tegenstander', own, opp, xg: xgForEvent(ev) });
    } else if (ev.type === 'halftime') {
      items.push({ kind: 'halftime', t: ev.t, label: 'Rust', own, opp });
    } else if (ev.type === 'substitution') {
      items.push({ kind: 'sub', t: ev.t, label: `${getPlayerName(ev.playerOut)} eruit, ${getPlayerName(ev.playerIn)} erin`, own, opp });
    }
  });
  return items;
}

function renderTimeline(items, newestFirst) {
  if (items.length === 0) return '<div class="empty-state">Nog geen doelpunten.</div>';
  const list = newestFirst ? [...items].reverse() : items;
  return `<div class="timeline">${list.map((it) => {
    const time = it.t == null ? '--:--' : formatClock(it.t);
    if (it.kind === 'halftime') {
      return `<div class="tl-row tl-break"><span class="tl-time">${time}</span><span class="tl-text">Rust · stand ${it.own}-${it.opp}</span></div>`;
    }
    if (it.kind === 'sub') {
      return `<div class="tl-row tl-sub"><span class="tl-time">${time}</span><span class="tl-text">Wissel: ${escapeHtml(it.label)}</span></div>`;
    }
    const mine = it.kind === 'goal';
    const xg = it.xg != null ? ` <span class="tl-xg">xG ${formatXg(it.xg)}</span>` : '';
    return `<div class="tl-row ${mine ? 'tl-own' : 'tl-opp'}"><span class="tl-time">${time}</span><span class="tl-dot"></span><span class="tl-text">Doelpunt ${escapeHtml(it.label)}${xg}</span><span class="tl-score">${it.own}-${it.opp}</span></div>`;
  }).join('')}</div>`;
}

function renderScoreboardSide(label, split, alignClass, xgTotal) {
  const row = (rowLabel, s) => `
    <div class="side-row">
      <span class="side-row-label">${rowLabel}</span>
      <span class="side-row-value">${s.goals}/${s.goals + s.misses}</span>
      <span class="side-row-pct">${formatPct(s.goals, s.misses)}</span>
    </div>`;
  const xgRow = xgTotal == null ? '' : `
    <div class="side-row">
      <span class="side-row-label">xG</span>
      <span class="side-row-value">${formatXg(xgTotal)}</span>
      <span class="side-row-pct"></span>
    </div>`;
  return `
    <div class="scoreboard-side ${alignClass}">
      <div class="side-label">${escapeHtml(label)}</div>
      ${row('H1', split.half1)}
      ${row('H2', split.half2)}
      ${row('Tot', split.total)}
      ${xgRow}
    </div>`;
}

// ---------------------------- Rendering ----------------------------------

function render() {
  const app = document.getElementById('app');
  if (route.name !== 'live') pendingShot = null;
  let html;
  switch (route.name) {
    case 'players': html = renderPlayers(); break;
    case 'setup': html = renderSetup(route.matchId); break;
    case 'live': html = renderLive(route.matchId); break;
    case 'summary': html = renderSummary(route.matchId); break;
    default: html = renderHome();
  }
  app.innerHTML = html + (toast ? `<div class="toast">${escapeHtml(toast)}</div>` : '');
}

function renderHome() {
  const matches = [...data.matches].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const rows = matches.map((m) => {
    const state = m.status === 'setup' ? null : computeMatchState(m.squad, m.initialLineup, m.events);
    const scoreText = m.status === 'finished'
      ? `${m.finalScore.own} - ${m.finalScore.opponent}`
      : (state ? `${state.score.own} - ${state.score.opponent}` : '');
    const badge = m.status === 'live'
      ? '<span class="badge badge-live">Live</span>'
      : m.status === 'finished'
        ? '<span class="badge badge-finished">Afgerond</span>'
        : '<span class="badge">Opstelling</span>';
    return `
      <div class="swipe-wrap">
        <div class="swipe-delete" data-action="delete-match" data-id="${m.id}">
          ${ICONS.trash}<span>Verwijderen</span>
        </div>
        <div class="swipe-content">
          <div class="match-card-tap" data-action="open-match" data-id="${m.id}">
            <div class="match-card-top">
              <strong>${escapeHtml(m.opponent || 'Onbekende tegenstander')}</strong>
              ${badge}
            </div>
            <div class="meta">${formatDate(m.date)}${scoreText ? ' · ' + scoreText : ''}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  const currentTheme = getTheme();
  const themeButtons = THEMES.map((t) => `
    <button type="button" class="theme-swatch ${t.id === currentTheme ? 'active' : ''}" data-action="set-theme" data-id="${t.id}">
      <span class="theme-dots">${t.dots.map((c) => `<span class="theme-dot" style="background:${c}"></span>`).join('')}</span>
      <span>${escapeHtml(t.label)}</span>
      ${t.id === currentTheme ? '<span class="theme-check">✓</span>' : ''}
    </button>`).join('');

  return `
    <div class="topbar">
      <h1>Korfbal Wedstrijdtracker</h1>
      <button class="link-btn" data-action="go-players">Spelers</button>
    </div>

    <div class="card">
      <h2>Thema</h2>
      <div class="theme-row">${themeButtons}</div>
    </div>

    <div class="card">
      <h2>Nieuwe wedstrijd</h2>
      <form class="inline" data-form="new-match">
        <div>
          <label>Datum</label>
          <input type="date" name="date" value="${todayISO()}" required>
        </div>
        <div>
          <label>Tegenstander (optioneel)</label>
          <input type="text" name="opponent" placeholder="Naam tegenstander">
        </div>
        <button type="submit" class="btn btn-primary btn-block">Wedstrijd toevoegen</button>
      </form>
    </div>

    <h2 class="section-title">Wedstrijden</h2>
    <div class="card-grid">
      ${rows || '<div class="empty-state">Nog geen wedstrijden toegevoegd.</div>'}
    </div>
  `;
}

function renderPlayers() {
  const tab = route.tab || 'stats';
  if (route.playerId && tab === 'stats') return renderPlayerDetail(route.playerId);
  const tabs = `
    <div class="tabs">
      <button type="button" class="tab ${tab === 'stats' ? 'active' : ''}" data-action="players-tab" data-id="stats">Statistieken</button>
      <button type="button" class="tab ${tab === 'manage' ? 'active' : ''}" data-action="players-tab" data-id="manage">Beheren</button>
    </div>`;
  return `
    <div class="topbar">
      <button class="link-btn" data-action="go-home">&larr; Terug</button>
      <h1>Spelers</h1>
      <span></span>
    </div>
    ${tabs}
    ${tab === 'stats' ? renderPlayerDashboard() : renderPlayersManage()}
  `;
}

// ---------------------------- Spelers-dashboard ----------------------------

const SHOT_RING_LABELS = ['Dichtbij', 'Midden', 'Ver'];

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'numeric' });
}

function fmtSigned(v) {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2).replace('.', ',')}`;
}

function pctNum(goals, misses) {
  const n = goals + misses;
  return n === 0 ? null : (goals / n) * 100;
}

function perGame(v, games) {
  return games === 0 ? '–' : (v / games).toFixed(1).replace('.', ',');
}

function statsMatches() {
  const finished = data.matches.filter((m) => m.status === 'finished')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let selected = finished;
  if (statsFilter === 'last5') selected = finished.slice(-5);
  else if (statsFilter !== 'all') selected = finished.filter((m) => m.id === statsFilter);
  return { finished, selected };
}

function emptyAgg() {
  return {
    games: 0, goals: 0, misses: 0, xg: 0, locShots: 0, locGoals: 0,
    h1: { goals: 0, misses: 0 }, h2: { goals: 0, misses: 0 },
    rings: [{ goals: 0, misses: 0 }, { goals: 0, misses: 0 }, { goals: 0, misses: 0 }],
    zones: {}, shots: [], perMatch: [],
  };
}

function playerAggregates() {
  const { finished, selected } = statsMatches();
  const agg = {};
  selected.forEach((m) => {
    const split = computeHalfSplit(m.squad, m.initialLineup, m.events);
    m.squad.forEach((id) => {
      const p = split.players[id];
      if (!p) return;
      const a = agg[id] = agg[id] || emptyAgg();
      a.games++;
      a.goals += p.total.goals;
      a.misses += p.total.misses;
      a.xg += p.total.xg;
      a.locShots += p.total.locShots;
      a.locGoals += p.total.locGoals;
      a.h1.goals += p.half1.goals;
      a.h1.misses += p.half1.misses;
      a.h2.goals += p.half2.goals;
      a.h2.misses += p.half2.misses;
      a.perMatch.push({ match: m, ...p.total });
    });
    m.events.forEach((ev) => {
      if ((ev.type !== 'goal' && ev.type !== 'miss') || !ev.loc || !agg[ev.playerId]) return;
      const a = agg[ev.playerId];
      const z = zoneFromPoint(ev.loc.x, ev.loc.y);
      const kind = ev.type === 'goal' ? 'goals' : 'misses';
      const key = `${z.ring}-${z.sector}`;
      a.zones[key] = a.zones[key] || { goals: 0, misses: 0 };
      a.zones[key][kind]++;
      a.rings[z.ring][kind]++;
      a.shots.push({ loc: ev.loc, type: ev.type });
    });
  });

  const team = { goals: 0, misses: 0, xg: 0, locShots: 0, locGoals: 0, playerGames: 0 };
  Object.values(agg).forEach((a) => {
    team.goals += a.goals;
    team.misses += a.misses;
    team.xg += a.xg;
    team.locShots += a.locShots;
    team.locGoals += a.locGoals;
    team.playerGames += a.games;
  });
  return { finished, selected, agg, team };
}

function xgBadge(a) {
  if (a.locShots === 0) return '';
  const d = a.locGoals - a.xg;
  return `<span class="xg-badge ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${fmtSigned(d)} xG</span>`;
}

function vsTeamBadge(a, team) {
  const mine = pctNum(a.goals, a.misses);
  const ref = pctNum(team.goals, team.misses);
  if (mine == null || ref == null) return '';
  const d = Math.round(mine - ref);
  return `<span class="vs-team ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}% t.o.v. team</span>`;
}

function renderPlayerDashboard() {
  const { finished, selected, agg, team } = playerAggregates();
  if (finished.length === 0) {
    return '<div class="card"><div class="empty-state">Nog geen afgeronde wedstrijden. Zodra je een wedstrijd beëindigt, verschijnen hier de spelerstatistieken.</div></div>';
  }
  if (!['all', 'last5'].includes(statsFilter) && !finished.some((m) => m.id === statsFilter)) statsFilter = 'all';

  const chip = (id, label) => `<button type="button" class="chip ${statsFilter === id ? 'active' : ''}" data-action="stats-filter" data-id="${id}">${label}</button>`;
  const matchOptions = [...finished].reverse().map((m) =>
    `<option value="${m.id}" ${statsFilter === m.id ? 'selected' : ''}>${formatDate(m.date)} · ${escapeHtml(m.opponent || 'Onbekend')}</option>`).join('');
  const filterRow = `
    <div class="chip-row">
      ${chip('all', 'Alle wedstrijden')}
      ${finished.length > 1 ? chip('last5', 'Laatste 5') : ''}
      <select class="filter-select ${!['all', 'last5'].includes(statsFilter) ? 'active' : ''}" data-change="stats-match" aria-label="Kies een wedstrijd">
        <option value="" ${['all', 'last5'].includes(statsFilter) ? 'selected' : ''}>Per wedstrijd…</option>
        ${matchOptions}
      </select>
    </div>`;

  // Vaste volgorde (op naam), geen rangschikking op prestaties.
  const ids = Object.keys(agg).filter((id) => getPlayer(id))
    .sort((x, y) => getPlayerName(x).localeCompare(getPlayerName(y)));

  // Teamstrook: over/under t.o.v. verwachte goals
  const teamTile = (num, lbl) => `<div class="tile"><span class="tile-num">${num}</span><span class="tile-lbl">${lbl}</span></div>`;
  const teamDiff = team.locGoals - team.xg;
  const strip = `
    <div class="tiles tiles-auto">
      ${teamTile(selected.length, selected.length === 1 ? 'Wedstrijd' : 'Wedstrijden')}
      ${teamTile(team.goals, 'Goals')}
      ${teamTile(formatPct(team.goals, team.misses), 'Schotpercentage')}
      ${team.locShots > 0 ? teamTile(formatXg(team.xg), 'xG') : ''}
      ${team.locShots > 0 ? teamTile(`<span class="${teamDiff >= 0 ? 'pos' : 'neg'}">${fmtSigned(teamDiff)}</span>`, teamDiff >= 0 ? 'Over xG' : 'Onder xG') : ''}
    </div>`;

  const cards = ids.map((id) => {
    const a = agg[id];
    const attempts = a.goals + a.misses;
    return `
      <div class="pstat-card" data-action="open-player" data-id="${id}">
        <div class="pstat-head">
          <span class="avatar">${escapeHtml(initials(getPlayerName(id)))}</span>
          <div class="pstat-name">
            <div class="name">${escapeHtml(getPlayerName(id))}</div>
            <div class="meta">${a.games} wedstrijd${a.games === 1 ? '' : 'en'}</div>
          </div>
          ${chartDonut(pctNum(a.goals, a.misses), 66)}
        </div>
        <div class="pstat-grid">
          <div><span class="pstat-num">${a.goals}</span><span class="pstat-lbl">Goals</span></div>
          <div><span class="pstat-num">${perGame(a.goals, a.games)}</span><span class="pstat-lbl">Goals/wed</span></div>
          <div><span class="pstat-num">${perGame(attempts, a.games)}</span><span class="pstat-lbl">Kansen/wed</span></div>
          <div><span class="pstat-num">${a.locShots > 0 ? formatXg(a.xg) : '–'}</span><span class="pstat-lbl">xG</span></div>
        </div>
        <div class="pstat-badges">${xgBadge(a)}${selected.length > 0 && ids.length > 1 ? vsTeamBadge(a, team) : ''}</div>
      </div>`;
  }).join('');

  return `
    ${filterRow}
    ${strip}
    <div class="pstat-grid-wrap">${cards || '<div class="empty-state">Geen spelergegevens voor deze selectie.</div>'}</div>
  `;
}

function renderPlayerDetail(playerId) {
  const { agg, team } = playerAggregates();
  const a = agg[playerId];
  const name = getPlayerName(playerId);
  const back = `
    <div class="topbar">
      <button class="link-btn" data-action="close-player">&larr; Spelers</button>
      <h1>${escapeHtml(name)}</h1>
      <span></span>
    </div>`;
  if (!a) return `${back}<div class="card"><div class="empty-state">Geen gegevens voor deze speler in de gekozen selectie.</div></div>`;

  const attempts = a.goals + a.misses;
  const pct = pctNum(a.goals, a.misses);
  const tile = (num, lbl, extra) => `<div class="tile"><span class="tile-num">${num}</span><span class="tile-lbl">${lbl}</span>${extra || ''}</div>`;
  const diff = a.locGoals - a.xg;
  const tiles = `
    <div class="tiles tiles-auto">
      <div class="tile tile-donut">${chartDonut(pct, 84)}<span class="tile-lbl">Schotpercentage</span>${vsTeamBadge(a, team)}</div>
      ${tile(a.goals, 'Goals')}
      ${tile(perGame(a.goals, a.games), 'Goals/wedstrijd')}
      ${tile(perGame(attempts, a.games), 'Kansen/wedstrijd')}
      ${tile(a.locShots > 0 ? formatXg(a.xg) : '–', 'xG')}
      ${tile(a.locShots > 0 ? `<span class="${diff >= 0 ? 'pos' : 'neg'}">${fmtSigned(diff)}</span>` : '–', 'Goals − xG')}
    </div>`;

  const matchesAsc = [...a.perMatch].sort((x, y) => (x.match.date || '').localeCompare(y.match.date || ''));

  const barsCard = `
    <div class="card">
      <h2>Goals per wedstrijd</h2>
      ${chartBarsXg(matchesAsc.map((r) => ({ label: shortDate(r.match.date), value: r.goals, marker: r.locShots > 0 ? r.xg : null })))}
      <div class="legend"><span class="lg-bar"></span> Goals ${a.locShots > 0 ? '<span class="lg-dot"></span> xG (verwacht)' : ''}</div>
    </div>`;

  const lineCard = `
    <div class="card">
      <h2>Schotpercentage per wedstrijd</h2>
      ${matchesAsc.length >= 2
    ? chartLine(matchesAsc.map((r) => ({ label: shortDate(r.match.date), value: pctNum(r.goals, r.misses) })), pct)
    : '<div class="empty-state">Vanaf twee wedstrijden zie je hier het verloop.</div>'}
    </div>`;

  const halvesCard = `
    <div class="card">
      <h2>Helft 1 versus helft 2</h2>
      ${chartStackRow('Helft 1', a.h1.goals, a.h1.misses)}
      ${chartStackRow('Helft 2', a.h2.goals, a.h2.misses)}
      <p class="muted mt-8">Aandeel gemaakt van alle kansen. Zo zie je wie sterk start of juist sterk eindigt.</p>
    </div>`;

  const hasRings = a.rings.some((r) => r.goals + r.misses > 0);
  const ringsCard = `
    <div class="card">
      <h2>Percentage per afstand</h2>
      ${hasRings
    ? a.rings.map((r, i) => chartStackRow(SHOT_RING_LABELS[i], r.goals, r.misses)).join('')
    : '<div class="empty-state">Alleen beschikbaar als schotlocaties zijn vastgelegd.</div>'}
    </div>`;

  const modeChips = `
    <div class="chip-row">
      <button type="button" class="chip ${shotMapMode === 'dots' ? 'active' : ''}" data-action="shotmap-mode" data-id="dots">Schoten</button>
      <button type="button" class="chip ${shotMapMode === 'zones' ? 'active' : ''}" data-action="shotmap-mode" data-id="zones">Zones</button>
    </div>`;
  const mapCard = a.shots.length > 0 ? `
    <div class="card">
      <h2>Schotkaart</h2>
      ${modeChips}
      <p class="muted">${shotMapMode === 'dots'
    ? `Groen = goal, rood = gemist (${a.shots.length} schot${a.shots.length === 1 ? '' : 'ten'} met locatie).`
    : 'Per zone: werkelijk percentage en gemaakt/schoten. Groen = beter dan de verwachte xG, rood = slechter, grijs = geen schoten.'}</p>
      <div class="field-wrap">${shotMapMode === 'dots' ? renderFieldSvg({ labels: false, shots: a.shots }) : renderZoneHeatmap(a.zones)}</div>
    </div>` : '';

  const rows = [...matchesAsc].reverse().map((r) => {
    const d = r.locGoals - r.xg;
    const chip = r.locShots > 0 ? `<span class="xg-badge ${d >= 0 ? 'up' : 'down'}">${fmtSigned(d)}</span>` : '–';
    return `
    <tr class="row-link" data-action="open-match" data-id="${r.match.id}">
      <td>${formatDate(r.match.date)}</td>
      <td>${escapeHtml(r.match.opponent || 'Onbekend')}</td>
      <td>${r.goals}</td>
      <td>${r.goals + r.misses}</td>
      <td>${formatPct(r.goals, r.misses)}</td>
      <td>${r.locShots > 0 ? formatXg(r.xg) : '–'}</td>
      <td>${chip}</td>
    </tr>`;
  }).join('');

  return `
    ${back}
    ${tiles}
    ${barsCard}
    ${lineCard}
    <div class="detail-two">${halvesCard}${ringsCard}</div>
    ${mapCard}
    <div class="card">
      <h2>Per wedstrijd</h2>
      <div class="table-scroll">
        <table class="stats">
          <thead><tr><th>Datum</th><th>Tegenstander</th><th>Goals</th><th>Kansen</th><th>%</th><th>xG</th><th>+/− xG</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPlayersManage() {
  const rows = data.players.map((p) => `
    <div class="swipe-wrap">
      <div class="swipe-delete" data-action="delete-player" data-id="${p.id}">
        ${ICONS.trash}<span>Verwijderen</span>
      </div>
      <div class="swipe-content">
        <div class="player-card-tap">
          <span class="avatar">${escapeHtml(initials(p.name))}</span>
          <span class="player-name">${escapeHtml(p.name)}</span>
        </div>
      </div>
    </div>`).join('');

  return `
    <div class="card">
      <h2>Nieuwe speler</h2>
      <form class="inline" data-form="add-player">
        <input type="text" name="name" placeholder="Naam speler" required>
        <button type="submit" class="btn btn-primary btn-block">Toevoegen</button>
      </form>
    </div>
    <h2 class="section-title">Spelerslijst</h2>
    <div class="card-grid">
      ${rows || '<div class="empty-state">Nog geen spelers toegevoegd.</div>'}
    </div>
  `;
}

function renderSettingsCard(m) {
  const s = matchSettings(m);
  const rows = [
    ['shotLocation', 'Schotlocatie vastleggen', 'Tik na elk schot van Valto op het veld waar het genomen werd (expected goals).'],
    ['opponentShotLocation', 'Schotlocatie tegenstander', 'Zelfde, maar voor schoten van de tegenstander.'],
    ['possession', 'Balbezit bijhouden', 'Twee knoppen om te wisselen wie in balbezit is; geeft balbezit-% per helft.'],
  ].map(([key, title, hint]) => `
    <label class="switch-row">
      <input type="checkbox" data-action="toggle-setting" data-id="${key}" ${s[key] ? 'checked' : ''}>
      <span class="switch-text"><strong>${title}</strong><span class="muted">${hint}</span></span>
    </label>`).join('');
  return `
    <div class="card">
      <h2>Extra's bijhouden</h2>
      <div class="switch-list">${rows}</div>
    </div>`;
}

function renderSetup(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return renderHome();

  const squadSet = new Set(m.squad);
  const squadCheckboxes = data.players.map((p) => `
    <label class="checkline">
      <input type="checkbox" data-action="toggle-squad" data-id="${p.id}" ${squadSet.has(p.id) ? 'checked' : ''}>
      <span>${escapeHtml(p.name)}</span>
    </label>`).join('');

  const squadCount = m.squad.length;
  const canAssignRoles = squadCount >= 8;
  let roleSection = '';

  if (canAssignRoles) {
    const { attackers, defenders } = m.initialLineup;
    const chips = m.squad.map((id) => {
      const role = attackers.includes(id) ? 'aanval' : defenders.includes(id) ? 'verdediging' : 'bank';
      const roleClass = role === 'aanval' ? 'role-aanval' : role === 'verdediging' ? 'role-verdediging' : '';
      const roleLabel = role === 'aanval' ? 'Aanval' : role === 'verdediging' ? 'Verdediging' : 'Bank';
      return `
        <div class="role-chip ${roleClass}" data-action="cycle-role" data-id="${id}">
          <span>${escapeHtml(getPlayerName(id))}</span>
          <span class="tag">${roleLabel}</span>
        </div>`;
    }).join('');

    const startEnabled = attackers.length === 4 && defenders.length === 4;

    roleSection = `
      <div class="card">
        <h2>Rollen toewijzen</h2>
        <p class="muted">Tik op een speler om te wisselen tussen Aanval, Verdediging en Bank. Precies 4 aanvallers en 4 verdedigers nodig.</p>
        <div class="counts-row">
          <span>Aanval: <strong>${attackers.length}/4</strong></span>
          <span>Verdediging: <strong>${defenders.length}/4</strong></span>
          <span>Bank: <strong>${squadCount - attackers.length - defenders.length}</strong></span>
        </div>
        <div class="role-grid">${chips}</div>
        <button class="btn btn-primary btn-block mt-16" data-action="start-match" data-id="${m.id}" ${startEnabled ? '' : 'disabled'}>Start wedstrijd</button>
      </div>`;
  } else {
    roleSection = '<div class="card"><p class="muted">Selecteer minimaal 8 spelers om rollen toe te wijzen.</p></div>';
  }

  return `
    <div class="topbar">
      <button class="link-btn" data-action="go-home">&larr; Terug</button>
      <h1>Opstelling</h1>
      <span></span>
    </div>
    <div class="card">
      <h2>${escapeHtml(m.opponent || 'Onbekende tegenstander')} · ${formatDate(m.date)}</h2>
      <h3>Selecteer spelers (minimaal 8)</h3>
      <div class="checklist-grid">
        ${squadCheckboxes || '<div class="empty-state">Voeg eerst spelers toe via "Spelers" (tab Beheren).</div>'}
      </div>
      <p class="muted mt-8">${squadCount} geselecteerd</p>
    </div>
    ${renderSettingsCard(m)}
    ${roleSection}
  `;
}

function renderLive(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return renderHome();

  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  const untilSwap = 2 - st.counter;
  const split = computeHalfSplit(m.squad, m.initialLineup, m.events);
  const settings = matchSettings(m);
  const poss = settings.possession ? computePossession(m) : null;
  const possSide = settings.possession ? currentPossessionSide(m) : null;

  const attackerCards = st.attackers.map((id) => `
    <div class="player-card">
      <div class="player-card-head">
        <span class="avatar avatar-sm">${escapeHtml(initials(getPlayerName(id)))}</span>
        <div>
          <div class="name">${escapeHtml(getPlayerName(id))}</div>
          ${statLine(id, st, settings.shotLocation)}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-miss" data-action="miss" data-id="${id}">Kans gemist</button>
        <button class="btn btn-primary" data-action="goal" data-id="${id}">Doelpunt</button>
      </div>
    </div>`).join('');

  const defenderCards = st.defenders.map((id) => `
    <div class="player-card">
      <div class="player-card-head">
        <span class="avatar avatar-sm">${escapeHtml(initials(getPlayerName(id)))}</span>
        <div>
          <div class="name">${escapeHtml(getPlayerName(id))}</div>
          ${statLine(id, st, settings.shotLocation)}
        </div>
      </div>
    </div>`).join('');

  const benchPills = st.bench.map((id) => `<span class="pill">${escapeHtml(getPlayerName(id))}</span>`).join('');

  const undoDisabled = m.events.length === 0 ? 'disabled' : '';
  const subDisabled = st.bench.length === 0 ? 'disabled' : '';
  const halftimeDisabled = split.hasHalftime ? 'disabled' : '';

  return `
    <div class="topbar">
      <button class="link-btn" data-action="go-home">&larr; Terug</button>
      <h1>Live</h1>
      <span></span>
    </div>

    <div class="scoreboard">
      <div class="clock-row">
        <span class="clock-half">${split.hasHalftime ? 'Helft 2' : 'Helft 1'}</span>
        <span class="clock-time" data-clock="${m.id}">${formatClock(clockElapsed(m))}</span>
        <button type="button" class="btn btn-sm clock-btn" data-action="clock-toggle">${clockRunning(m) ? 'Pauze' : 'Start'}</button>
      </div>
      <div class="scoreboard-grid">
        ${renderScoreboardSide('Valto', split.own, 'scoreboard-side-own', settings.shotLocation ? split.own.total.xg : null)}
        <div class="scoreboard-center">
          <div class="score-main">
            <span>${st.score.own}</span><span class="score-dash">-</span><span>${st.score.opponent}</span>
          </div>
        </div>
        ${renderScoreboardSide('Tegenstander', split.opponent, 'scoreboard-side-opp', settings.opponentShotLocation ? split.opponent.total.xg : null)}
      </div>
      <div class="swap-progress">Nog ${untilSwap} doelpunt${untilSwap === 1 ? '' : 'en'} tot rolwissel</div>
    </div>

    ${settings.possession ? `
    <div class="possession">
      <button type="button" class="poss-btn ${possSide === 'own' ? 'active-own' : ''}" data-action="possession" data-id="own">
        <span>Valto in balbezit</span><strong data-poss="own" data-match="${m.id}">${possessionPct(poss.total) == null ? '–' : possessionPct(poss.total) + '%'}</strong>
      </button>
      <button type="button" class="poss-btn ${possSide === 'opp' ? 'active-opp' : ''}" data-action="possession" data-id="opp">
        <span>Tegenstander in balbezit</span><strong data-poss="opp" data-match="${m.id}">${possessionPct(poss.total) == null ? '–' : (100 - possessionPct(poss.total)) + '%'}</strong>
      </button>
    </div>` : ''}

    <div class="live-grid">
      <div class="section section-attack">
        <h3>Aanval</h3>
        ${attackerCards || '<p class="muted">Geen aanvallers</p>'}
      </div>

      <div class="section section-opponent">
        <h3>Tegenstander</h3>
        <div class="opponent-row">
          <button class="btn btn-miss" data-action="opponent-miss">Kans gemist</button>
          <button class="btn btn-danger" data-action="opponent-goal">Goal tegenstander</button>
        </div>
      </div>

      <div class="section section-defense">
        <h3>Verdediging</h3>
        ${defenderCards || '<p class="muted">Geen verdedigers</p>'}
      </div>
    </div>

    <div class="section section-bench">
      <h3>Bank</h3>
      <div class="bench-list">${benchPills || '<span class="muted">Geen bankspelers</span>'}</div>
      <button class="btn btn-block mt-8" data-action="open-sub-modal" ${subDisabled}>${ICONS.swap}Wissel speler</button>
    </div>

    <div class="card">
      <h2>Tijdlijn</h2>
      ${renderTimeline(buildTimeline(m), true)}
    </div>

    <div class="btn-row">
      <button class="btn" data-action="undo" ${undoDisabled}>Ongedaan maken</button>
      <button class="btn" data-action="halftime" ${halftimeDisabled}>Rust</button>
      <button class="btn btn-danger btn-block" data-action="finish-match" data-id="${m.id}">Wedstrijd beëindigen</button>
    </div>

    ${subModalOpen ? renderSubModal(st) : ''}
    ${pendingShot ? renderShotModal() : ''}
    ${m.inBreak ? renderBreakOverlay(m, split, poss, settings) : ''}
  `;
}

function renderSubModal(st) {
  const fieldOptions = [
    ...st.attackers.map((id) => ({ id, label: `${getPlayerName(id)} (Aanval)` })),
    ...st.defenders.map((id) => ({ id, label: `${getPlayerName(id)} (Verdediging)` })),
  ];

  return `
    <div class="modal-overlay">
      <div class="modal-sheet">
        <h2>Speler wisselen</h2>
        <form class="inline" data-form="substitution">
          <div>
            <label>Speler eruit (veld)</label>
            <select name="playerOut">
              ${fieldOptions.map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Speler erin (bank)</label>
            <select name="playerIn">
              ${st.bench.map((id) => `<option value="${id}">${escapeHtml(getPlayerName(id))}</option>`).join('')}
            </select>
          </div>
          <div class="btn-row">
            <button type="button" class="btn" data-action="close-sub-modal">Annuleren</button>
            <button type="submit" class="btn btn-primary">Wissel uitvoeren</button>
          </div>
        </form>
      </div>
    </div>`;
}

function renderShotModal() {
  const own = pendingShot.kind === 'goal' || pendingShot.kind === 'miss';
  const label = {
    goal: 'Doelpunt', miss: 'Kans gemist', opponentGoal: 'Doelpunt tegenstander', opponentMiss: 'Kans tegenstander gemist',
  }[pendingShot.kind];
  const who = own ? getPlayerName(pendingShot.playerId) : 'Tegenstander';
  return `
    <div class="modal-overlay modal-center">
      <div class="modal-sheet modal-wide">
        <h2>${label} · ${escapeHtml(who)}</h2>
        <p class="muted">Tik op het veld waar het schot genomen werd. De korf staat in het midden; de cijfers zijn de xG per zone.</p>
        <div class="field-wrap">${renderFieldSvg({ interactive: true })}</div>
        <div class="btn-row">
          <button type="button" class="btn" data-action="cancel-shot">Annuleren</button>
          <button type="button" class="btn" data-action="skip-shot">Zonder locatie</button>
        </div>
      </div>
    </div>`;
}

function renderCompareTable(key, split, poss, settings) {
  const o = split.own[key];
  const t = split.opponent[key];
  const row = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
  let rows = row('Doelpunten', o.goals, t.goals)
    + row('Kansen', o.goals + o.misses, t.goals + t.misses)
    + row('Schotpercentage', formatPct(o.goals, o.misses), formatPct(t.goals, t.misses));
  if (settings.shotLocation || settings.opponentShotLocation) {
    rows += row('xG',
      settings.shotLocation && o.locShots > 0 ? formatXg(o.xg) : '–',
      settings.opponentShotLocation && t.locShots > 0 ? formatXg(t.xg) : '–');
  }
  if (poss) rows += `<tr><td>Balbezit</td><td colspan="2" class="cell-center">${formatPossession(poss[key])}</td></tr>`;
  return `
    <table class="stats compare">
      <thead><tr><th></th><th>Valto</th><th>Tegenstander</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderBreakOverlay(m, split, poss, settings) {
  const rows = buildSplitStatsRows(m.squad, split.players, getPlayerName);
  const subInfo = computeSubstitutionInfo(m.events);
  const showXg = settings.shotLocation && split.hasOwnShotData;
  return `
    <div class="break-overlay">
      <div class="break-sheet">
        <div class="break-head">
          <h2>Rust · eerste helft</h2>
          <div class="score-main"><span>${split.own.half1.goals}</span><span class="vs">stand</span><span>${split.opponent.half1.goals}</span></div>
          <div class="muted cell-center">Gespeelde tijd ${formatClock(clockElapsed(m))}</div>
        </div>
        <h3>Team</h3>
        ${renderCompareTable('half1', split, poss, settings)}
        <h3 class="mt-16">Spelers</h3>
        <div class="table-scroll">${renderPlayerPeriodTable(rows, 'half1', subInfo, showXg)}</div>
        <h3 class="mt-16">Tijdlijn</h3>
        ${renderTimeline(buildTimeline(m), false)}
        <button type="button" class="btn btn-primary btn-block mt-16" data-action="end-break">Tweede helft starten</button>
      </div>
    </div>`;
}

function computeSubstitutionInfo(events) {
  const info = {};
  events.forEach((ev) => {
    if (ev.type !== 'substitution') return;
    info[ev.playerIn] = info[ev.playerIn] || { in: false, out: false };
    info[ev.playerIn].in = true;
    info[ev.playerOut] = info[ev.playerOut] || { in: false, out: false };
    info[ev.playerOut].out = true;
  });
  return info;
}

function renderPlayerPeriodTable(rows, periodKey, subInfo, showXg) {
  const sorted = [...rows].sort((a, b) => b[periodKey].goals - a[periodKey].goals || a.name.localeCompare(b.name));
  const tableRows = sorted.map((r) => {
    const p = r[periodKey];
    const s = subInfo[r.id];
    const badges = s
      ? `${s.in ? '<span class="sub-badge sub-in" title="Ingevallen tijdens de wedstrijd">↑ In</span>' : ''}${s.out ? '<span class="sub-badge sub-out" title="Gewisseld tijdens de wedstrijd">↓ Uit</span>' : ''}`
      : '';
    return `
    <tr>
      <td>${escapeHtml(r.name)}${badges}</td>
      <td>${p.goals}</td>
      <td>${p.misses}</td>
      <td>${p.total}</td>
      <td>${p.pct}</td>
      ${showXg ? `<td>${p.locShots > 0 ? formatXg(p.xg) : '–'}</td>` : ''}
    </tr>`;
  }).join('');

  return `
    <table class="stats">
      <thead><tr><th>Speler</th><th>Gemaakt</th><th>Gemist</th><th>Totaal</th><th>%</th>${showXg ? '<th>xG</th>' : ''}</tr></thead>
      <tbody>${tableRows || `<tr><td colspan="${showXg ? 6 : 5}" class="empty-state">Geen spelers</td></tr>`}</tbody>
    </table>`;
}

function renderTeamLine(label, s, showXg) {
  const xg = showXg && s.locShots > 0 ? ` · xG ${formatXg(s.xg)}` : '';
  return `<div class="stat-line">${escapeHtml(label)}: ${s.goals}/${s.goals + s.misses} kansen · <span class="stat-pct">${formatPct(s.goals, s.misses)}</span>${xg}</div>`;
}

function renderSummary(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return renderHome();

  const split = computeHalfSplit(m.squad, m.initialLineup, m.events);
  const rows = buildSplitStatsRows(m.squad, split.players, getPlayerName);
  const subInfo = computeSubstitutionInfo(m.events);
  const settings = matchSettings(m);
  const poss = settings.possession ? computePossession(m) : null;
  const showOwnXg = split.hasOwnShotData;
  const showOppXg = split.hasOppShotData;
  const possLine = (key) => (poss ? `<div class="stat-line">Balbezit: <span class="stat-pct">${formatPossession(poss[key])}</span> <span class="muted">(Valto – Tegenstander)</span></div>` : '');

  const oppRow = (label, s) => `<tr><td>${label}</td><td>${s.goals}</td><td>${s.misses}</td><td>${s.goals + s.misses}</td><td>${formatPct(s.goals, s.misses)}</td>${showOppXg ? `<td>${s.locShots > 0 ? formatXg(s.xg) : '–'}</td>` : ''}</tr>`;

  return `
    <div class="topbar">
      <button class="link-btn" data-action="go-home">&larr; Terug</button>
      <h1>Samenvatting</h1>
      <span></span>
    </div>
    <div class="card">
      <h2>${escapeHtml(m.opponent || 'Onbekende tegenstander')} · ${formatDate(m.date)}</h2>
      <div class="score-main"><span>${m.finalScore.own}</span><span class="vs">eindstand</span><span>${m.finalScore.opponent}</span></div>
    </div>

    <div class="card">
      <h2>Totaal</h2>
      ${renderTeamLine('Valto', split.own.total, showOwnXg)}
      ${possLine('total')}
      <div class="table-scroll mt-8">${renderPlayerPeriodTable(rows, 'total', subInfo, showOwnXg)}</div>
    </div>

    <div class="card">
      <h2>Tegenstander</h2>
      <table class="stats">
        <thead><tr><th></th><th>Gemaakt</th><th>Gemist</th><th>Totaal</th><th>%</th>${showOppXg ? '<th>xG</th>' : ''}</tr></thead>
        <tbody>
          ${oppRow('Helft 1', split.opponent.half1)}
          ${oppRow('Helft 2', split.opponent.half2)}
          ${oppRow('Totaal', split.opponent.total)}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Helft 1</h2>
      ${renderTeamLine('Valto', split.own.half1, showOwnXg)}
      ${possLine('half1')}
      <div class="table-scroll mt-8">${renderPlayerPeriodTable(rows, 'half1', subInfo, showOwnXg)}</div>
    </div>

    <div class="card">
      <h2>Helft 2</h2>
      ${renderTeamLine('Valto', split.own.half2, showOwnXg)}
      ${possLine('half2')}
      <div class="table-scroll mt-8">${renderPlayerPeriodTable(rows, 'half2', subInfo, showOwnXg)}</div>
    </div>

    <div class="card">
      <h2>Tijdlijn</h2>
      ${renderTimeline(buildTimeline(m), false)}
    </div>

    <div class="btn-row">
      <button class="btn btn-primary btn-block" data-action="export-excel" data-id="${m.id}">Exporteer naar Excel</button>
      <button class="btn btn-block" data-action="export-md" data-id="${m.id}">Exporteer naar Markdown</button>
    </div>
  `;
}

// ---------------------------- Acties --------------------------------------

function openMatch(id) {
  const m = data.matches.find((x) => x.id === id);
  if (!m) return;
  if (m.status === 'setup') route = { name: 'setup', matchId: id };
  else if (m.status === 'live') route = { name: 'live', matchId: id };
  else route = { name: 'summary', matchId: id };
  render();
}

function deleteMatch(id) {
  const m = data.matches.find((x) => x.id === id);
  if (!m) return;
  const label = m.opponent ? `tegen ${m.opponent}` : 'zonder tegenstander';
  if (!confirm(`Wedstrijd van ${formatDate(m.date)} ${label} verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
  data.matches = data.matches.filter((x) => x.id !== id);
  saveData();
  render();
}

function deletePlayer(id) {
  if (!confirm('Deze speler verwijderen uit de lijst?')) return;
  data.players = data.players.filter((p) => p.id !== id);
  saveData();
  render();
}

function toggleSquad(match, playerId, isChecked) {
  if (isChecked) {
    if (!match.squad.includes(playerId)) match.squad.push(playerId);
  } else {
    match.squad = match.squad.filter((id) => id !== playerId);
    match.initialLineup.attackers = match.initialLineup.attackers.filter((id) => id !== playerId);
    match.initialLineup.defenders = match.initialLineup.defenders.filter((id) => id !== playerId);
  }
}

function cycleRole(match, playerId) {
  const { attackers, defenders } = match.initialLineup;
  const inAttack = attackers.includes(playerId);
  const inDefense = defenders.includes(playerId);

  if (!inAttack && !inDefense) {
    if (attackers.length < 4) attackers.push(playerId);
    else if (defenders.length < 4) defenders.push(playerId);
    return;
  }
  if (inAttack) {
    match.initialLineup.attackers = attackers.filter((id) => id !== playerId);
    if (defenders.length < 4) defenders.push(playerId);
    return;
  }
  match.initialLineup.defenders = defenders.filter((id) => id !== playerId);
}

function startMatch(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return;
  if (m.initialLineup.attackers.length !== 4 || m.initialLineup.defenders.length !== 4) return;
  m.status = 'live';
  m.clock = { running: false, elapsedMs: 0, startedAt: null };
  startClock(m);
  saveData();
  route = { name: 'live', matchId };
  render();
}

function registerEvent(partial) {
  const m = currentMatch();
  if (!m || m.status !== 'live') return;
  pushEvent(m, partial);
  saveData();
  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  if (st.lastEventWasSwap) showToast('Gewisseld! Aanval en verdediging wisselen van rol.');
  render();
}

// Bij goals/kansen: eerst de schotlocatie vragen als die instelling aan staat.
function requestShot(kind, playerId) {
  const m = currentMatch();
  if (!m || m.status !== 'live') return;
  const s = matchSettings(m);
  const own = kind === 'goal' || kind === 'miss';
  if ((own && s.shotLocation) || (!own && s.opponentShotLocation)) {
    pendingShot = { kind, playerId };
    render();
  } else {
    registerEvent(playerId ? { type: kind, playerId } : { type: kind });
  }
}

function completeShot(loc) {
  if (!pendingShot) return;
  const { kind, playerId } = pendingShot;
  pendingShot = null;
  const ev = playerId ? { type: kind, playerId } : { type: kind };
  if (loc) ev.loc = loc;
  registerEvent(ev);
  if (loc) {
    const m = currentMatch();
    const st = computeMatchState(m.squad, m.initialLineup, m.events);
    if (!st.lastEventWasSwap) showToast(`Schot vastgelegd · xG ${formatXg(xgForLoc(loc))}`);
  }
}

function toggleClock() {
  const m = currentMatch();
  if (!m || m.status !== 'live') return;
  if (clockRunning(m)) pauseClock(m); else startClock(m);
  saveData();
  render();
}

function setPossession(side) {
  const m = currentMatch();
  if (!m || m.status !== 'live') return;
  if (currentPossessionSide(m) === side) return;
  registerEvent({ type: 'possession', side });
}

function startBreak() {
  const m = currentMatch();
  if (!m || m.status !== 'live' || findHalftimeIndex(m.events) !== -1) return;
  pauseClock(m);
  pushEvent(m, { type: 'halftime' });
  m.inBreak = true;
  saveData();
  render();
}

function endBreak() {
  const m = currentMatch();
  if (!m) return;
  m.inBreak = false;
  startClock(m);
  saveData();
  showToast('Tweede helft gestart');
  render();
}

function undoLastEvent() {
  const m = currentMatch();
  if (!m || m.events.length === 0) return;
  m.events.pop();
  saveData();
  render();
}

// Houdt klok en balbezit-percentages live bij zonder het hele scherm te hertekenen.
function updateLiveTicks() {
  const clocks = document.querySelectorAll('[data-clock]');
  clocks.forEach((el) => {
    const m = data.matches.find((x) => x.id === el.dataset.clock);
    if (m) el.textContent = formatClock(clockElapsed(m));
  });
  document.querySelectorAll('[data-poss]').forEach((el) => {
    const m = data.matches.find((x) => x.id === el.dataset.match);
    if (!m) return;
    const own = possessionPct(computePossession(m).total);
    el.textContent = own == null ? '–' : `${el.dataset.poss === 'own' ? own : 100 - own}%`;
  });
}

setInterval(updateLiveTicks, 500);

function finishMatch(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return;
  if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) return;
  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  m.finalScore = { own: st.score.own, opponent: st.score.opponent };
  pauseClock(m);
  m.inBreak = false;
  m.status = 'finished';
  saveData();
  route = { name: 'summary', matchId };
  render();
}

function showToast(msg) {
  toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast = null; render(); }, 2200);
}

function exportData(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return null;
  const split = computeHalfSplit(m.squad, m.initialLineup, m.events);
  const rows = buildSplitStatsRows(m.squad, split.players, getPlayerName);
  const extras = {
    showOwnXg: split.hasOwnShotData,
    showOppXg: split.hasOppShotData,
    poss: matchSettings(m).possession ? computePossession(m) : null,
    timeline: buildTimeline(m),
  };
  return { m, split, rows, extras };
}

function doExportExcel(matchId) {
  const d = exportData(matchId);
  if (d) exportToExcel(d.m, d.rows, d.split, d.extras);
}

function doExportMarkdown(matchId) {
  const d = exportData(matchId);
  if (d) exportToMarkdown(d.m, d.rows, d.split, d.extras);
}

// ---------------------------- Event delegatie ------------------------------

function onClick(e) {
  const fieldSvg = e.target.closest('svg[data-shotfield]');
  if (fieldSvg) {
    const loc = fieldPointFromEvent(fieldSvg, e);
    if (loc) completeShot(loc);
    return;
  }

  const swipedWrap = e.target.closest('.swipe-wrap');
  const onDeleteButton = !!e.target.closest('.swipe-delete');
  if (swipedWrap && swipedWrap.dataset.suppressClick) {
    delete swipedWrap.dataset.suppressClick;
    if (!onDeleteButton) return;
  }

  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case 'go-home': route = { name: 'home' }; render(); break;
    case 'go-players': route = { name: 'players', tab: 'stats', playerId: null }; render(); break;
    case 'players-tab': route = { name: 'players', tab: id, playerId: null }; render(); break;
    case 'stats-filter': statsFilter = id; render(); break;
    case 'shotmap-mode': shotMapMode = id; render(); break;
    case 'open-player': route = { name: 'players', tab: 'stats', playerId: id }; render(); break;
    case 'close-player': route = { name: 'players', tab: 'stats', playerId: null }; render(); break;
    case 'toggle-setting': {
      const m = currentMatch();
      if (m) { m.settings = { ...matchSettings(m), [id]: el.checked }; saveData(); render(); }
      break;
    }
    case 'clock-toggle': toggleClock(); break;
    case 'possession': setPossession(id); break;
    case 'end-break': endBreak(); break;
    case 'cancel-shot': pendingShot = null; render(); break;
    case 'skip-shot': completeShot(null); break;
    case 'set-theme': setTheme(id); render(); break;
    case 'open-match': openMatch(id); break;
    case 'delete-match': deleteMatch(id); break;
    case 'delete-player': deletePlayer(id); break;
    case 'toggle-squad': {
      const m = currentMatch();
      if (m) { toggleSquad(m, id, el.checked); saveData(); render(); }
      break;
    }
    case 'cycle-role': {
      const m = currentMatch();
      if (m) { cycleRole(m, id); saveData(); render(); }
      break;
    }
    case 'start-match': startMatch(id); break;
    case 'goal': requestShot('goal', id); break;
    case 'miss': requestShot('miss', id); break;
    case 'opponent-goal': requestShot('opponentGoal', null); break;
    case 'opponent-miss': requestShot('opponentMiss', null); break;
    case 'halftime': startBreak(); break;
    case 'undo': undoLastEvent(); break;
    case 'open-sub-modal': subModalOpen = true; render(); break;
    case 'close-sub-modal': subModalOpen = false; render(); break;
    case 'finish-match': finishMatch(id); break;
    case 'export-excel': doExportExcel(id); break;
    case 'export-md': doExportMarkdown(id); break;
    default: break;
  }
}

function onChange(e) {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  if (el.dataset.change === 'stats-match') {
    statsFilter = el.value || 'all';
    render();
  }
}

function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const type = form.dataset.form;

  if (type === 'new-match') {
    const date = form.elements.date.value;
    const opponent = form.elements.opponent.value.trim();
    const match = {
      id: uid(),
      date,
      opponent,
      status: 'setup',
      squad: [],
      initialLineup: { attackers: [], defenders: [] },
      events: [],
      finalScore: null,
      settings: { ...DEFAULT_SETTINGS },
      clock: { running: false, elapsedMs: 0, startedAt: null },
      inBreak: false,
    };
    data.matches.push(match);
    saveData();
    route = { name: 'setup', matchId: match.id };
    render();
  } else if (type === 'add-player') {
    const name = form.elements.name.value.trim();
    if (!name) return;
    data.players.push({ id: uid(), name });
    saveData();
    render();
  } else if (type === 'substitution') {
    const playerOut = form.elements.playerOut.value;
    const playerIn = form.elements.playerIn.value;
    const m = currentMatch();
    if (m && playerOut && playerIn && playerOut !== playerIn) {
      pushEvent(m, { type: 'substitution', playerOut, playerIn });
      saveData();
    }
    subModalOpen = false;
    render();
  }
}

// ---------------------------- Druk-feedback --------------------------------
// CSS :active is onbetrouwbaar op tablets (o.a. iPad Safari toont het vaak niet
// zonder een touch-listener) — daarom sturen we de "ingedrukt"-status via JS.

const PRESSABLE_SELECTOR = '.btn, .role-chip, .theme-swatch, .poss-btn';

function onPressStart(e) {
  const el = e.target.closest(PRESSABLE_SELECTOR);
  if (el && !el.disabled) el.classList.add('is-pressed');
}

function clearPressed() {
  document.querySelectorAll('.is-pressed').forEach((el) => el.classList.remove('is-pressed'));
}

document.addEventListener('pointerdown', onPressStart);
document.addEventListener('pointerup', clearPressed);
document.addEventListener('pointercancel', clearPressed);

// ---------------------------- Swipe-to-delete ------------------------------

const SWIPE_OPEN_X = -84;
const SWIPE_OPEN_THRESHOLD = -42;
const SWIPE_MOVE_THRESHOLD = 6;

let swipeDrag = null;
let openSwipeWrap = null;

function closeOpenSwipe() {
  if (!openSwipeWrap) return;
  const content = openSwipeWrap.querySelector('.swipe-content');
  if (content) content.style.transform = '';
  openSwipeWrap.classList.remove('swiped-open');
  openSwipeWrap = null;
}

function onSwipePointerDown(e) {
  if (e.target.closest('.swipe-delete')) return;

  const wrap = e.target.closest('.swipe-wrap');
  if (openSwipeWrap && openSwipeWrap !== wrap) closeOpenSwipe();
  if (!wrap) return;

  if (wrap.classList.contains('swiped-open')) {
    closeOpenSwipe();
    wrap.dataset.suppressClick = '1';
    return;
  }

  const content = wrap.querySelector('.swipe-content');
  if (!content) return;
  swipeDrag = { wrap, content, startX: e.clientX, moved: false };
}

function onSwipePointerMove(e) {
  if (!swipeDrag) return;
  const dx = e.clientX - swipeDrag.startX;
  if (Math.abs(dx) > SWIPE_MOVE_THRESHOLD) swipeDrag.moved = true;
  const clamped = Math.max(SWIPE_OPEN_X, Math.min(0, dx));
  swipeDrag.wrap.classList.add('swiping');
  swipeDrag.content.style.transform = `translateX(${clamped}px)`;
  swipeDrag.dx = clamped;
}

function onSwipePointerUp() {
  if (!swipeDrag) return;
  const { wrap, content, dx, moved } = swipeDrag;
  wrap.classList.remove('swiping');
  if (dx < SWIPE_OPEN_THRESHOLD) {
    content.style.transform = `translateX(${SWIPE_OPEN_X}px)`;
    wrap.classList.add('swiped-open');
    openSwipeWrap = wrap;
  } else {
    content.style.transform = '';
    wrap.classList.remove('swiped-open');
  }
  if (moved) wrap.dataset.suppressClick = '1';
  swipeDrag = null;
}

document.addEventListener('pointerdown', onSwipePointerDown);
document.addEventListener('pointermove', onSwipePointerMove);
document.addEventListener('pointerup', onSwipePointerUp);
document.addEventListener('pointercancel', onSwipePointerUp);

const app = document.getElementById('app');
app.addEventListener('click', onClick);
app.addEventListener('submit', onSubmit);
app.addEventListener('change', onChange);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.error('Service worker registratie mislukt', e));
  });
}
