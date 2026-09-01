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

function baseFilename(match) {
  return `wedstrijd_${match.date}_vs_${safeFilenamePart(match.opponent)}`;
}

function exportToMarkdown(match, rows, opponentStats) {
  const lines = [];
  lines.push(`# Wedstrijdverslag`);
  lines.push('');
  lines.push(`- **Datum:** ${match.date}`);
  lines.push(`- **Tegenstander:** ${match.opponent || 'Onbekend'}`);
  lines.push(`- **Eindstand:** ${match.finalScore.own} - ${match.finalScore.opponent}`);
  lines.push('');
  lines.push('## Statistieken per speler');
  lines.push('');
  lines.push('| Speler | Gemaakt | Gemist | Totaal kansen | Percentage |');
  lines.push('|---|---|---|---|---|');
  rows.forEach((r) => {
    lines.push(`| ${r.name} | ${r.goals} | ${r.misses} | ${r.total} | ${r.pct} |`);
  });
  lines.push('');
  lines.push('## Tegenstander');
  lines.push('');
  lines.push(`- Doelpunten: ${opponentStats.goals}`);
  lines.push(`- Gemiste kansen: ${opponentStats.misses}`);
  lines.push('');

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${baseFilename(match)}.md`);
}

function exportToExcel(match, rows, opponentStats) {
  const aoa = [
    ['Wedstrijdverslag'],
    ['Datum', match.date],
    ['Tegenstander', match.opponent || 'Onbekend'],
    ['Eindstand', `${match.finalScore.own} - ${match.finalScore.opponent}`],
    [],
    ['Speler', 'Gemaakt', 'Gemist', 'Totaal kansen', 'Percentage'],
    ...rows.map((r) => [r.name, r.goals, r.misses, r.total, r.pct]),
    [],
    ['Tegenstander', 'Doelpunten', opponentStats.goals, 'Gemiste kansen', opponentStats.misses],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
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
