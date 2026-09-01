const STORAGE_KEY = 'korfbal-app-data';

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

// ---- Wedstrijd-engine: state wordt volledig afgeleid uit het event-log ----
function computeMatchState(squad, initialLineup, events) {
  let attackers = [...initialLineup.attackers];
  let defenders = [...initialLineup.defenders];
  let own = 0;
  let opponent = 0;
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
  return { attackers, defenders, bench, score: { own, opponent }, opponentMisses, counter, stats, lastEventWasSwap };
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
      <div class="match-row" data-action="open-match" data-id="${m.id}">
        <div>
          <div><strong>${escapeHtml(m.opponent || 'Onbekende tegenstander')}</strong></div>
          <div class="meta">${formatDate(m.date)}${scoreText ? ' · ' + scoreText : ''}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');

  return `
    <div class="topbar">
      <h1>Korfbal Wedstrijdtracker</h1>
      <button class="link-btn" data-action="go-players">Spelers beheren</button>
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

    <div class="card">
      <h2>Wedstrijden</h2>
      ${rows || '<div class="empty-state">Nog geen wedstrijden toegevoegd.</div>'}
    </div>
  `;
}

function renderPlayers() {
  const rows = data.players.map((p) => `
    <div class="row">
      <span>${escapeHtml(p.name)}</span>
      <button class="btn btn-sm btn-danger" data-action="delete-player" data-id="${p.id}">Verwijder</button>
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
    <div class="card">
      <h2>Spelerslijst</h2>
      <div class="player-list">
        ${rows || '<div class="empty-state">Nog geen spelers toegevoegd.</div>'}
      </div>
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
        ${chips}
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
      <div class="player-list">
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

  const attackerCards = st.attackers.map((id) => `
    <div class="player-card">
      <div class="name">${escapeHtml(getPlayerName(id))}</div>
      <div class="actions">
        <button class="btn" data-action="miss" data-id="${id}">Kans gemist</button>
        <button class="btn btn-primary" data-action="goal" data-id="${id}">Doelpunt</button>
      </div>
    </div>`).join('');

  const defenderCards = st.defenders.map((id) => `
    <div class="player-card"><div class="name">${escapeHtml(getPlayerName(id))}</div></div>`).join('');

  const benchPills = st.bench.map((id) => `<span class="pill">${escapeHtml(getPlayerName(id))}</span>`).join('');

  const undoDisabled = m.events.length === 0 ? 'disabled' : '';
  const subDisabled = st.bench.length === 0 ? 'disabled' : '';

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
      <div class="swap-progress">Nog ${untilSwap} doelpunt${untilSwap === 1 ? '' : 'en'} tot rolwissel</div>
    </div>

    <div class="section section-attack">
      <h3>Aanval</h3>
      ${attackerCards || '<p class="muted">Geen aanvallers</p>'}
    </div>

    <div class="section section-opponent">
      <h3>Tegenstander</h3>
      <div class="opponent-row">
        <button class="btn" data-action="opponent-miss">Kans gemist</button>
        <button class="btn btn-danger" data-action="opponent-goal">Goal tegenstander</button>
      </div>
    </div>

    <div class="section section-defense">
      <h3>Verdediging</h3>
      ${defenderCards || '<p class="muted">Geen verdedigers</p>'}
    </div>

    <div class="section section-bench">
      <h3>Bank</h3>
      <div class="bench-list">${benchPills || '<span class="muted">Geen bankspelers</span>'}</div>
      <button class="btn btn-block mt-8" data-action="open-sub-modal" ${subDisabled}>Wissel speler</button>
    </div>

    <div class="btn-row">
      <button class="btn" data-action="undo" ${undoDisabled}>Ongedaan maken</button>
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

function renderSummary(matchId) {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return renderHome();

  const st = computeMatchState(m.squad, m.initialLineup, m.events);
  const rows = buildStatsRows(m.squad, st.stats, getPlayerName)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  const tableRows = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.goals}</td>
      <td>${r.misses}</td>
      <td>${r.total}</td>
      <td>${r.pct}</td>
    </tr>`).join('');

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
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case 'go-home': route = { name: 'home' }; render(); break;
    case 'go-players': route = { name: 'players' }; render(); break;
    case 'open-match': openMatch(id); break;
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

const app = document.getElementById('app');
app.addEventListener('click', onClick);
app.addEventListener('submit', onSubmit);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.error('Service worker registratie mislukt', e));
  });
}
