// Kleine zelfgetekende SVG-grafieken (geen externe bibliotheek, werkt offline).
// Kleuren komen uit CSS-klassen zodat ze het gekozen thema volgen.

function chartDonut(pct, size) {
  const s = size || 76;
  const r = 40;
  const c = 2 * Math.PI * r;
  const has = pct != null;
  const dash = has ? (Math.max(0, Math.min(100, pct)) / 100) * c : 0;
  return `
    <svg class="ch-donut" width="${s}" height="${s}" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" class="ch-donut-bg"/>
      ${dash > 0.5 ? `<circle cx="50" cy="50" r="${r}" class="ch-donut-fg" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>` : ''}
      <text x="50" y="57" text-anchor="middle" class="ch-donut-text">${has ? Math.round(pct) + '%' : '–'}</text>
    </svg>`;
}


// items: [{ label, value, marker (xG of null) }]
function chartBarsXg(items) {
  const W = 600;
  const H = 230;
  const L = 34;
  const B = 34;
  const T = 18;
  const plotW = W - L - 8;
  const plotH = H - B - T;
  const maxVal = Math.max(1, ...items.map((i) => Math.max(i.value, i.marker || 0)));
  const top = Math.ceil(maxVal);
  const y = (v) => T + plotH - (v / top) * plotH;
  const slot = plotW / items.length;
  const bw = Math.min(46, slot * 0.55);

  let grid = '';
  for (let g = 0; g <= top; g++) {
    const gy = y(g).toFixed(1);
    grid += `<line x1="${L}" y1="${gy}" x2="${W - 8}" y2="${gy}" class="ch-grid"/><text x="${L - 6}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end" class="ch-axis">${g}</text>`;
  }

  const step = items.length > 8 ? 2 : 1;
  const bars = items.map((it, i) => {
    const cx = L + slot * i + slot / 2;
    const by = y(it.value);
    const bh = Math.max(2, T + plotH - by);
    const marker = it.marker != null
      ? `<circle cx="${cx.toFixed(1)}" cy="${y(it.marker).toFixed(1)}" r="7" class="ch-marker"/>`
      : '';
    const label = i % step === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" class="ch-axis">${it.label}</text>` : '';
    return `
      <rect x="${(cx - bw / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" class="ch-bar"/>
      <text x="${cx.toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" class="ch-val">${it.value}</text>
      ${marker}${label}`;
  }).join('');

  return `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals per wedstrijd">${grid}${bars}</svg>`;
}

// points: [{ label, value (0-100) of null }], avg: gemiddelde % (of null)
function chartLine(points, avg) {
  const W = 600;
  const H = 220;
  const L = 40;
  const B = 34;
  const T = 28;
  const plotW = W - L - 14;
  const plotH = H - B - T;
  const y = (v) => T + plotH - (v / 100) * plotH;
  const n = points.length;
  const x = (i) => (n === 1 ? L + plotW / 2 : L + (plotW * i) / (n - 1));

  let grid = '';
  [0, 50, 100].forEach((g) => {
    grid += `<line x1="${L}" y1="${y(g).toFixed(1)}" x2="${W - 14}" y2="${y(g).toFixed(1)}" class="ch-grid"/><text x="${L - 6}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end" class="ch-axis">${g}%</text>`;
  });

  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);
  const path = valid.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const dots = valid.map((p) => `
    <circle cx="${x(p.i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="6" class="ch-dot"/>
    <text x="${x(p.i).toFixed(1)}" y="${(y(p.value) - 12).toFixed(1)}" text-anchor="middle" class="ch-val">${Math.round(p.value)}</text>`).join('');
  const step = n > 8 ? 2 : 1;
  const labels = points.map((p, i) => (i % step === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="ch-axis">${p.label}</text>` : '')).join('');
  const avgLine = avg != null
    ? `<line x1="${L}" y1="${y(avg).toFixed(1)}" x2="${W - 14}" y2="${y(avg).toFixed(1)}" class="ch-avg"/><text x="${W - 16}" y="${(y(avg) - 6).toFixed(1)}" text-anchor="end" class="ch-avg-text">gem. ${Math.round(avg)}%</text>`
    : '';

  return `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schotpercentage per wedstrijd">${grid}${avgLine}<path d="${path}" class="ch-line"/>${dots}${labels}</svg>`;
}

// Horizontale gestapelde balk gemaakt/gemist met titel en cijfers.
function chartStackRow(title, goals, misses) {
  const total = goals + misses;
  const gp = total === 0 ? 0 : (goals / total) * 100;
  const pct = total === 0 ? '–' : `${Math.round(gp)}%`;
  return `
    <div class="stack-row">
      <div class="stack-head"><span>${title}</span><span class="muted">${goals}/${total} · <strong>${pct}</strong></span></div>
      <div class="stack-bar"><span class="stack-goals" style="width:${gp.toFixed(1)}%"></span></div>
    </div>`;
}
