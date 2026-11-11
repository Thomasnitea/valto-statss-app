// Export helpers: build a stats table for a finished match and trigger
// a download as either .xlsx (via the SheetJS global `XLSX`) or .md.

function formatPct(goals, misses) {
  const total = goals + misses;
  if (total === 0) return '-';
  return `${((goals / total) * 100).toFixed(1)}%`;
}

function safeFilenamePart(text) {
  return (text || '').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'onbekend';
}

function periodStats(s) {
  return {
    goals: s.goals,
    misses: s.misses,
    total: s.goals + s.misses,
    pct: formatPct(s.goals, s.misses),
    xg: s.xg || 0,
    locShots: s.locShots || 0,
  };
}

// squadIds: player ids to include as rows (in display order)
// playersSplit: { [id]: { half1, half2, total } } — zie computeHalfSplit in app.js
function buildSplitStatsRows(squadIds, playersSplit, getPlayerName) {
  const empty = { goals: 0, misses: 0 };
  return squadIds.map((id) => {
    const p = playersSplit[id] || { half1: empty, half2: empty, total: empty };
    return {
      id,
      name: getPlayerName(id),
      half1: periodStats(p.half1),
      half2: periodStats(p.half2),
      total: periodStats(p.total),
    };
  });
}

function baseFilename(match) {
  return `wedstrijd_${match.date}_vs_${safeFilenamePart(match.opponent)}`;
}

function sortedByPeriod(rows, periodKey) {
  return [...rows].sort((a, b) => b[periodKey].goals - a[periodKey].goals || a.name.localeCompare(b.name));
}

function xgCell(s, show) {
  return show ? (s.locShots > 0 ? formatXg(s.xg) : '-') : null;
}

function timelineText(it) {
  const time = it.t == null ? '--:--' : formatClock(it.t);
  if (it.kind === 'halftime') return `${time} Rust (stand ${it.own}-${it.opp})`;
  if (it.kind === 'sub') return `${time} Wissel: ${it.label}`;
  const who = it.kind === 'goal' ? `Valto — ${it.label}` : 'Tegenstander';
  const xg = it.xg != null ? ` (xG ${formatXg(it.xg)})` : '';
  return `${time} Doelpunt ${who}${xg}, stand ${it.own}-${it.opp}`;
}

// split: resultaat van computeHalfSplit (own/opponent elk met half1/half2/total)
// extras: { showOwnXg, showOppXg, poss (of null), timeline }
function exportToMarkdown(match, rows, split, extras) {
  const { showOwnXg, showOppXg, poss, timeline } = extras;
  const lines = [];
  lines.push(`# Wedstrijdverslag`);
  lines.push('');
  lines.push(`- **Datum:** ${match.date}`);
  lines.push(`- **Tegenstander:** ${match.opponent || 'Onbekend'}`);
  lines.push(`- **Eindstand:** ${match.finalScore.own} - ${match.finalScore.opponent}`);
  lines.push('');

  const teamSummary = (periodKey) => {
    const s = split.own[periodKey];
    const xg = showOwnXg && s.locShots > 0 ? ` · xG ${formatXg(s.xg)}` : '';
    lines.push(`Valto: ${s.goals}/${s.goals + s.misses} kansen · ${formatPct(s.goals, s.misses)}${xg}`);
    if (poss) lines.push(`Balbezit (Valto – Tegenstander): ${formatPossession(poss[periodKey])}`);
    lines.push('');
  };

  const playerSection = (title, periodKey) => {
    lines.push(`## ${title}`);
    lines.push('');
    teamSummary(periodKey);
    lines.push(`| Speler | Gemaakt | Gemist | Totaal | %${showOwnXg ? ' | xG' : ''} |`);
    lines.push(`|---|---|---|---|---${showOwnXg ? '|---' : ''}|`);
    sortedByPeriod(rows, periodKey).forEach((r) => {
      const p = r[periodKey];
      lines.push(`| ${r.name} | ${p.goals} | ${p.misses} | ${p.total} | ${p.pct}${showOwnXg ? ` | ${xgCell(p, true)}` : ''} |`);
    });
    lines.push('');
  };

  playerSection('Totaal', 'total');

  lines.push('## Tegenstander');
  lines.push('');
  lines.push(`| | Gemaakt | Gemist | Totaal | %${showOppXg ? ' | xG' : ''} |`);
  lines.push(`|---|---|---|---|---${showOppXg ? '|---' : ''}|`);
  const teamLine = (label, s) => lines.push(`| ${label} | ${s.goals} | ${s.misses} | ${s.goals + s.misses} | ${formatPct(s.goals, s.misses)}${showOppXg ? ` | ${xgCell(s, true)}` : ''} |`);
  teamLine('Helft 1', split.opponent.half1);
  teamLine('Helft 2', split.opponent.half2);
  teamLine('Totaal', split.opponent.total);
  lines.push('');

  playerSection('Helft 1', 'half1');
  playerSection('Helft 2', 'half2');

  lines.push('## Tijdlijn');
  lines.push('');
  if (timeline.length === 0) lines.push('Geen doelpunten.');
  timeline.forEach((it) => lines.push(`- ${timelineText(it)}`));
  lines.push('');

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${baseFilename(match)}.md`);
}

// split: resultaat van computeHalfSplit (own/opponent elk met half1/half2/total)
// extras: { showOwnXg, showOppXg, poss (of null), timeline }
function exportToExcel(match, rows, split, extras) {
  const { showOwnXg, showOppXg, poss, timeline } = extras;
  const pctRow = (label, s, showXg) => {
    const base = [label, s.goals, s.misses, s.goals + s.misses, formatPct(s.goals, s.misses)];
    if (showXg) base.push(xgCell(s, true));
    return base;
  };
  const playerHeader = ['Speler', 'Gemaakt', 'Gemist', 'Totaal', '%', ...(showOwnXg ? ['xG'] : [])];
  const playerRows = (periodKey) => sortedByPeriod(rows, periodKey).map((r) => {
    const p = r[periodKey];
    return [r.name, p.goals, p.misses, p.total, p.pct, ...(showOwnXg ? [xgCell(p, true)] : [])];
  });
  const possRow = (key) => (poss ? [['Balbezit (Valto – Tegenstander)', formatPossession(poss[key])]] : []);

  const section = (title, key) => [
    [title],
    pctRow('Valto', split.own[key], showOwnXg),
    ...possRow(key),
    [],
    playerHeader,
    ...playerRows(key),
    [],
  ];

  const aoa = [
    ['Wedstrijdverslag'],
    ['Datum', match.date],
    ['Tegenstander', match.opponent || 'Onbekend'],
    ['Eindstand', `${match.finalScore.own} - ${match.finalScore.opponent}`],
    [],
    ...section('Totaal', 'total'),
    ['Tegenstander'],
    ['', 'Gemaakt', 'Gemist', 'Totaal', '%', ...(showOppXg ? ['xG'] : [])],
    pctRow('Helft 1', split.opponent.half1, showOppXg),
    pctRow('Helft 2', split.opponent.half2, showOppXg),
    pctRow('Totaal', split.opponent.total, showOppXg),
    [],
    ...section('Helft 1', 'half1'),
    ...section('Helft 2', 'half2'),
    ['Tijdlijn'],
    ...(timeline.length === 0 ? [['Geen doelpunten']] : timeline.map((it) => [timelineText(it)])),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Wedstrijd');
  XLSX.writeFile(wb, `${baseFilename(match)}.xlsx`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
