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

function sortedByPeriod(rows, periodKey) {
  return [...rows].sort((a, b) => b[periodKey].goals - a[periodKey].goals || a.name.localeCompare(b.name));
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

  const playerTable = (periodKey) => {
    sortedByPeriod(rows, periodKey).forEach((r) => {
      const p = r[periodKey];
      lines.push(`| ${r.name} | ${p.goals} | ${p.misses} | ${p.total} | ${p.pct} |`);
    });
  };

  lines.push('## Totaal');
  lines.push('');
  lines.push(`Valto: ${split.own.total.goals}/${split.own.total.goals + split.own.total.misses} kansen · ${formatPct(split.own.total.goals, split.own.total.misses)}`);
  lines.push('');
  lines.push('| Speler | Gemaakt | Gemist | Totaal | % |');
  lines.push('|---|---|---|---|---|');
  playerTable('total');
  lines.push('');

  lines.push('## Tegenstander');
  lines.push('');
  lines.push('| | Gemaakt | Gemist | Totaal | % |');
  lines.push('|---|---|---|---|---|');
  const teamLine = (label, s) => lines.push(`| ${label} | ${s.goals} | ${s.misses} | ${s.goals + s.misses} | ${formatPct(s.goals, s.misses)} |`);
  teamLine('Helft 1', split.opponent.half1);
  teamLine('Helft 2', split.opponent.half2);
  teamLine('Totaal', split.opponent.total);
  lines.push('');

  lines.push('## Helft 1');
  lines.push('');
  lines.push(`Valto: ${split.own.half1.goals}/${split.own.half1.goals + split.own.half1.misses} kansen · ${formatPct(split.own.half1.goals, split.own.half1.misses)}`);
  lines.push('');
  lines.push('| Speler | Gemaakt | Gemist | Totaal | % |');
  lines.push('|---|---|---|---|---|');
  playerTable('half1');
  lines.push('');

  lines.push('## Helft 2');
  lines.push('');
  lines.push(`Valto: ${split.own.half2.goals}/${split.own.half2.goals + split.own.half2.misses} kansen · ${formatPct(split.own.half2.goals, split.own.half2.misses)}`);
  lines.push('');
  lines.push('| Speler | Gemaakt | Gemist | Totaal | % |');
  lines.push('|---|---|---|---|---|');
  playerTable('half2');
  lines.push('');

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${baseFilename(match)}.md`);
}

// split: resultaat van computeHalfSplit (own/opponent elk met half1/half2/total)
function exportToExcel(match, rows, split) {
  const teamRow = (label, s) => [label, s.goals, s.misses, s.goals + s.misses, formatPct(s.goals, s.misses)];
  const playerHeader = ['Speler', 'Gemaakt', 'Gemist', 'Totaal', '%'];
  const playerRows = (periodKey) => sortedByPeriod(rows, periodKey).map((r) => {
    const p = r[periodKey];
    return [r.name, p.goals, p.misses, p.total, p.pct];
  });

  const aoa = [
    ['Wedstrijdverslag'],
    ['Datum', match.date],
    ['Tegenstander', match.opponent || 'Onbekend'],
    ['Eindstand', `${match.finalScore.own} - ${match.finalScore.opponent}`],
    [],
    ['Totaal'],
    ['Valto', split.own.total.goals, split.own.total.misses, split.own.total.goals + split.own.total.misses, formatPct(split.own.total.goals, split.own.total.misses)],
    [],
    playerHeader,
    ...playerRows('total'),
    [],
    ['Tegenstander'],
    ['', 'Gemaakt', 'Gemist', 'Totaal', '%'],
    teamRow('Helft 1', split.opponent.half1),
    teamRow('Helft 2', split.opponent.half2),
    teamRow('Totaal', split.opponent.total),
    [],
    ['Helft 1'],
    ['Valto', split.own.half1.goals, split.own.half1.misses, split.own.half1.goals + split.own.half1.misses, formatPct(split.own.half1.goals, split.own.half1.misses)],
    [],
    playerHeader,
    ...playerRows('half1'),
    [],
    ['Helft 2'],
    ['Valto', split.own.half2.goals, split.own.half2.misses, split.own.half2.goals + split.own.half2.misses, formatPct(split.own.half2.goals, split.own.half2.misses)],
    [],
    playerHeader,
    ...playerRows('half2'),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
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
