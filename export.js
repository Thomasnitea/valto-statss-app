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

// squadIds: player ids to include as rows (in display order)
function buildStatsRows(squadIds, playerStats, getPlayerName) {
  return squadIds.map((id) => {
    const s = playerStats[id] || { goals: 0, misses: 0 };
    const total = s.goals + s.misses;
    return {
      id,
      name: getPlayerName(id),
      goals: s.goals,
      misses: s.misses,
      total,
      pct: formatPct(s.goals, s.misses),
    };
  });
}

function periodStats(s) {
  return { goals: s.goals, misses: s.misses, total: s.goals + s.misses, pct: formatPct(s.goals, s.misses) };
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

// split: resultaat van computeHalfSplit (own/opponent elk met half1/half2/total)
function exportToMarkdown(match, rows, split) {
  const lines = [];
  lines.push(`# Wedstrijdverslag`);
  lines.push('');
  lines.push(`- **Datum:** ${match.date}`);
  lines.push(`- **Tegenstander:** ${match.opponent || 'Onbekend'}`);
  lines.push(`- **Eindstand:** ${match.finalScore.own} - ${match.finalScore.opponent}`);
  lines.push('');

  lines.push('## Teamtotalen');
  lines.push('');
  lines.push('| | Gemaakt | Gemist | Totaal kansen | Percentage |');
  lines.push('|---|---|---|---|---|');
  const teamLine = (label, s) => lines.push(`| ${label} | ${s.goals} | ${s.misses} | ${s.goals + s.misses} | ${formatPct(s.goals, s.misses)} |`);
  teamLine('Valto — Helft 1', split.own.half1);
  teamLine('Valto — Helft 2', split.own.half2);
  teamLine('Valto — Totaal', split.own.total);
  teamLine('Tegenstander — Helft 1', split.opponent.half1);
  teamLine('Tegenstander — Helft 2', split.opponent.half2);
  teamLine('Tegenstander — Totaal', split.opponent.total);
  lines.push('');

  lines.push('## Statistieken per speler');
  lines.push('');
  lines.push('| Speler | H1 Gemaakt | H1 Gemist | H1 Totaal | H1 % | H2 Gemaakt | H2 Gemist | H2 Totaal | H2 % | Tot Gemaakt | Tot Gemist | Tot Totaal | Tot % |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r) => {
    lines.push(`| ${r.name} | ${r.half1.goals} | ${r.half1.misses} | ${r.half1.total} | ${r.half1.pct} | ${r.half2.goals} | ${r.half2.misses} | ${r.half2.total} | ${r.half2.pct} | ${r.total.goals} | ${r.total.misses} | ${r.total.total} | ${r.total.pct} |`);
  });
  lines.push('');

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${baseFilename(match)}.md`);
}

// split: resultaat van computeHalfSplit (own/opponent elk met half1/half2/total)
function exportToExcel(match, rows, split) {
  const teamRow = (label, s) => [label, s.goals, s.misses, s.goals + s.misses, formatPct(s.goals, s.misses)];

  const aoa = [
    ['Wedstrijdverslag'],
    ['Datum', match.date],
    ['Tegenstander', match.opponent || 'Onbekend'],
    ['Eindstand', `${match.finalScore.own} - ${match.finalScore.opponent}`],
    [],
    ['Teamtotalen'],
    ['', 'Gemaakt', 'Gemist', 'Totaal kansen', 'Percentage'],
    teamRow('Valto - Helft 1', split.own.half1),
    teamRow('Valto - Helft 2', split.own.half2),
    teamRow('Valto - Totaal', split.own.total),
    teamRow('Tegenstander - Helft 1', split.opponent.half1),
    teamRow('Tegenstander - Helft 2', split.opponent.half2),
    teamRow('Tegenstander - Totaal', split.opponent.total),
    [],
    ['Statistieken per speler'],
    ['Speler', 'H1 Gemaakt', 'H1 Gemist', 'H1 Totaal', 'H1 %', 'H2 Gemaakt', 'H2 Gemist', 'H2 Totaal', 'H2 %', 'Tot Gemaakt', 'Tot Gemist', 'Tot Totaal', 'Tot %'],
    ...rows.map((r) => [
      r.name,
      r.half1.goals, r.half1.misses, r.half1.total, r.half1.pct,
      r.half2.goals, r.half2.misses, r.half2.total, r.half2.pct,
      r.total.goals, r.total.misses, r.total.total, r.total.pct,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 8 },
    { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 8 },
    { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
  ];
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
