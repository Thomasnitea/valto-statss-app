const STORAGE_KEY = 'korfbal-app-data';
const THEME_KEY = 'korfbal-app-theme';

const THEMES = [
  { id: 'default', label: 'Standaard', dots: ['#243f3d', '#3ab09e', '#f95831'] },
  { id: 'ckv-valto', label: 'CKV Valto', dots: ['#1a1a1a', '#f2650a', '#2856c7'] },
  { id: 'pink', label: 'Roze', dots: ['#c43670', '#f283af', '#1f9d63'] },
];

const ICONS = {
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
  swap: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px;margin-right:6px;"><path d="M7 3v12"></path><path d="M3 11l4 4 4-4"></path><path d="M17 21V9"></path><path d="M21 13l-4-4-4 4"></path></svg>',
};

let data = loadData();
let route = { name: 'home' };
let subModalOpen = false;
let toast = null;
let toastTimer = null;

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

function statLine(id, st) {
  const s = st.stats[id] || { goals: 0, misses: 0 };
  const total = s.goals + s.misses;
  return `<div class="stat-line">${s.goals}/${total} kansen · <span class="stat-pct">${formatPct(s.goals, s.misses)}</span></div>`;
}

// ---- Wedstrijd-engine: state wordt volledig afgeleid uit het event-log ----
function computeMatchState(squad, initialLineup, events) {
  let attackers = [...initialLineup.attackers];
  let defenders = [...initialLineup.defenders];
  let own = 0;
  let opponent = 0;
  let ownMisses = 0;
  let opponentMisses = 0;
  let counter = 0;
  const stats = {};
  squad.forEach((id) => { stats[id] = { goals: 0, misses: 0 }; });
  let lastEventWasSwap = false;

  events.forEach((ev) => {
    lastEventWasSwap = false;
    if (ev.type === 'goal') {
      if (stats[ev.playerId]) stats[ev.playerId].goals++;
      own++;
      counter++;
    } else if (ev.type === 'miss') {
      if (stats[ev.playerId]) stats[ev.playerId].misses++;
      ownMisses++;
    } else if (ev.type === 'opponentGoal') {
      opponent++;
      counter++;
    } else if (ev.type === 'opponentMiss') {
      opponentMisses++;
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
  return { attackers, defenders, bench, score: { own, opponent }, ownMisses, opponentMisses, counter, stats, lastEventWasSwap };
}

function findHalftimeIndex(events) {
  return events.findIndex((ev) => ev.type === 'halftime');
}

// Splitst de wedstrijd in helft 1 / helft 2 / totaal voor eigen team en tegenstander.
// Helft 2 wordt afgeleid als totaal - helft 1 (geen aparte opstelling-berekening nodig).
function computeHalfSplit(squad, initialLineup, events) {
  const htIndex = findHalftimeIndex(events);
  const totalState = computeMatchState(squad, initialLineup, events);
  const half1Events = htIndex === -1 ? events : events.slice(0, htIndex);
  const half1State = computeMatchState(squad, initialLineup, half1Events);

  const ownTotal = { goals: totalState.score.own, misses: totalState.ownMisses };
  const ownHalf1 = { goals: half1State.score.own, misses: half1State.ownMisses };
  const ownHalf2 = { goals: ownTotal.goals - ownHalf1.goals, misses: ownTotal.misses - ownHalf1.misses };

  const oppTotal = { goals: totalState.score.opponent, misses: totalState.opponentMisses };
  const oppHalf1 = { goals: half1State.score.opponent, misses: half1State.opponentMisses };
  const oppHalf2 = { goals: oppTotal.goals - oppHalf1.goals, misses: oppTotal.misses - oppHalf1.misses };

  return {
    hasHalftime: htIndex !== -1,
    own: { half1: ownHalf1, half2: ownHalf2, total: ownTotal },
    opponent: { half1: oppHalf1, half2: oppHalf2, total: oppTotal },
  };
}

function renderHalfStatsRow(split) {
  const cell = (label, s) => `
    <div class="half-cell">
      <div class="half-label">${label}</div>
      <div class="half-value">${s.goals}/${s.goals + s.misses}</div>
      <div class="half-pct">${formatPct(s.goals, s.misses)}</div>
    </div>`;
  return `
    <div class="half-stats-row">
      ${cell('Helft 1', split.half1)}
      ${cell('Helft 2', split.half2)}
      ${cell('Totaal', split.total)}
    </div>`;
}

// ---------------------------- Rendering ----------------------------------

function render() {
  const app = document.getElementById('app');
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
      <button class="link-btn" data-action="go-players">Spelers beheren</button>
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
    <div class="topbar">
      <button class="link-btn" data-action="go-home">&larr; Terug</button>
      <h1>Spelers</h1>
      <span></span>
    </div>
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
        ${squadCheckboxes || '<div class="empty-state">Voeg eerst spelers toe via "Spelers beheren".</div>'}
      </div>
      <p class="muted mt-8">${squadCount} geselecteerd</p>
    </div>
    ${roleSection}
  `;
}

function renderLive(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return renderHome();

  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  const untilSwap = 2 - st.counter;
  const split = computeHalfSplit(m.squad, m.initialLineup, m.events);

  const attackerCards = st.attackers.map((id) => `
    <div class="player-card">
      <div class="player-card-head">
        <span class="avatar avatar-sm">${escapeHtml(initials(getPlayerName(id)))}</span>
        <div>
          <div class="name">${escapeHtml(getPlayerName(id))}</div>
          ${statLine(id, st)}
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
          ${statLine(id, st)}
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
      <div class="score-main">
        <span>${st.score.own}</span><span class="vs">${escapeHtml(m.opponent || 'Tegenstander')}</span><span>${st.score.opponent}</span>
      </div>
      ${renderHalfStatsRow(split.own)}
      <div class="swap-progress">Nog ${untilSwap} doelpunt${untilSwap === 1 ? '' : 'en'} tot rolwissel</div>
    </div>

    <div class="live-grid">
      <div class="section section-attack">
        <h3>Aanval</h3>
        ${attackerCards || '<p class="muted">Geen aanvallers</p>'}
      </div>

      <div class="section section-opponent">
        <h3>Tegenstander</h3>
        ${renderHalfStatsRow(split.opponent)}
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

    <div class="btn-row">
      <button class="btn" data-action="undo" ${undoDisabled}>Ongedaan maken</button>
      <button class="btn" data-action="halftime" ${halftimeDisabled}>Rust</button>
      <button class="btn btn-danger btn-block" data-action="finish-match" data-id="${m.id}">Wedstrijd beëindigen</button>
    </div>

    ${subModalOpen ? renderSubModal(st) : ''}
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

function renderSummary(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return renderHome();

  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  const rows = buildStatsRows(m.squad, st.stats, getPlayerName)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  const subInfo = computeSubstitutionInfo(m.events);

  const tableRows = rows.map((r) => {
    const s = subInfo[r.id];
    const badges = s
      ? `${s.in ? '<span class="sub-badge sub-in" title="Ingevallen tijdens de wedstrijd">↑ In</span>' : ''}${s.out ? '<span class="sub-badge sub-out" title="Gewisseld tijdens de wedstrijd">↓ Uit</span>' : ''}`
      : '';
    return `
    <tr>
      <td>${escapeHtml(r.name)}${badges}</td>
      <td>${r.goals}</td>
      <td>${r.misses}</td>
      <td>${r.total}</td>
      <td>${r.pct}</td>
    </tr>`;
  }).join('');

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
      <h2>Statistieken per speler</h2>
      <table class="stats">
        <thead><tr><th>Speler</th><th>Gemaakt</th><th>Gemist</th><th>Totaal</th><th>%</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="5" class="empty-state">Geen spelers</td></tr>'}</tbody>
      </table>
      <p class="muted mt-8">Tegenstander: ${m.finalScore.opponent} doelpunten, ${st.opponentMisses} gemiste kansen</p>
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
  saveData();
  route = { name: 'live', matchId };
  render();
}

function registerEvent(partial) {
  const m = currentMatch();
  if (!m || m.status !== 'live') return;
  m.events.push({ ...partial, ts: Date.now() });
  saveData();
  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  if (st.lastEventWasSwap) showToast('Gewisseld! Aanval en verdediging wisselen van rol.');
  if (partial.type === 'halftime') showToast('Rust! Tweede helft begint.');
  render();
}

function undoLastEvent() {
  const m = currentMatch();
  if (!m || m.events.length === 0) return;
  m.events.pop();
  saveData();
  render();
}

function finishMatch(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return;
  if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) return;
  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  m.finalScore = { own: st.score.own, opponent: st.score.opponent };
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

function doExportExcel(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return;
  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  const rows = buildStatsRows(m.squad, st.stats, getPlayerName)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  exportToExcel(m, rows, { goals: m.finalScore.opponent, misses: st.opponentMisses });
}

function doExportMarkdown(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return;
  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  const rows = buildStatsRows(m.squad, st.stats, getPlayerName)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  exportToMarkdown(m, rows, { goals: m.finalScore.opponent, misses: st.opponentMisses });
}

// ---------------------------- Event delegatie ------------------------------

function onClick(e) {
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
    case 'go-players': route = { name: 'players' }; render(); break;
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
    case 'goal': registerEvent({ type: 'goal', playerId: id }); break;
    case 'miss': registerEvent({ type: 'miss', playerId: id }); break;
    case 'opponent-goal': registerEvent({ type: 'opponentGoal' }); break;
    case 'opponent-miss': registerEvent({ type: 'opponentMiss' }); break;
    case 'halftime': registerEvent({ type: 'halftime' }); break;
    case 'undo': undoLastEvent(); break;
    case 'open-sub-modal': subModalOpen = true; render(); break;
    case 'close-sub-modal': subModalOpen = false; render(); break;
    case 'finish-match': finishMatch(id); break;
    case 'export-excel': doExportExcel(id); break;
    case 'export-md': doExportMarkdown(id); break;
    default: break;
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
      m.events.push({ type: 'substitution', playerOut, playerIn, ts: Date.now() });
      saveData();
    }
    subModalOpen = false;
    render();
  }
}

// ---------------------------- Druk-feedback --------------------------------
// CSS :active is onbetrouwbaar op tablets (o.a. iPad Safari toont het vaak niet
// zonder een touch-listener) — daarom sturen we de "ingedrukt"-status via JS.

const PRESSABLE_SELECTOR = '.btn, .role-chip, .theme-swatch';

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
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.error('Service worker registratie mislukt', e));
  });
}
