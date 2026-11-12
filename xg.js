// Schotlocatie en expected goals (xG).
// Het veld wordt getekend in een vaste coördinatenruimte (viewBox) met de korf op (bx, by).
// Een kans is een punt {x, y} in die ruimte; de zone (ring + sector) en de xG volgen daaruit.
// Locaties worden opgeslagen, de zone/xG wordt telkens berekend: aanpassingen aan de
// tabel hieronder werken dus ook terugwerkend voor al vastgelegde kansen.

const FIELD = { w: 945, h: 995, bx: 505, by: 320 };

// Grenzen van de ringen rond de korf (afstand in veldeenheden).
const RING_RADII = [125, 235];

// Sectorgrenzen in graden, met de klok mee vanaf boven (0 = recht boven de korf).
// Sector 0 = boven (320-40), 1 = rechtsboven, 2 = rechts, 3 = rechtsonder,
// 4 = onder, 5 = linksonder, 6 = links, 7 = linksboven.
const SECTOR_BOUNDS = [40, 72, 120, 150, 210, 240, 288, 320];
const SECTOR_MID_ANGLES = [0, 56, 96, 135, 180, 225, 264, 304];

// xG per zone: [ring][sector]. Ring 0 = dicht bij de korf, ring 2 = ver weg.
// Waarden overgenomen uit het aangeleverde screenshot.
// LET OP: voor ring 0, sector 0 (recht boven, binnenste cirkel) stond geen waarde in het
// screenshot; voorlopig het gemiddelde van de buursectoren (0,85 en 0,60). Controleren.
const XG_TABLE = [
  [0.72, 0.60, 0.39, 0.50, 0.15, 0.62, 0.20, 0.85],
  [0.40, 0.23, 0.22, 0.33, 0.12, 0.38, 0.11, 0.32],
  [0.26, 0.21, 0.17, 0.18, 0.09, 0.20, 0.16, 0.24],
];

function sectorOfAngle(a) {
  if (a >= SECTOR_BOUNDS[7] || a < SECTOR_BOUNDS[0]) return 0;
  for (let i = 1; i < 8; i++) {
    if (a < SECTOR_BOUNDS[i]) return i;
  }
  return 0;
}

function zoneFromPoint(x, y) {
  const dx = x - FIELD.bx;
  const dy = y - FIELD.by;
  const r = Math.hypot(dx, dy);
  let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (a < 0) a += 360;
  const ring = r < RING_RADII[0] ? 0 : r < RING_RADII[1] ? 1 : 2;
  return { ring, sector: sectorOfAngle(a) };
}

function xgForLoc(loc) {
  if (!loc) return null;
  const z = zoneFromPoint(loc.x, loc.y);
  return XG_TABLE[z.ring][z.sector];
}

// Vaste xG voor kansen zonder plek op het veld: strafworp en vrije bal.
const SPECIAL_SHOTS = {
  penalty: { label: 'Strafworp', xg: 0.8 },
  free: { label: 'Vrije bal', xg: 0.33 },
};

function xgForEvent(ev) {
  if (ev.special && SPECIAL_SHOTS[ev.special]) return SPECIAL_SHOTS[ev.special].xg;
  return xgForLoc(ev.loc);
}

function formatXg(v) {
  return (v || 0).toFixed(2).replace('.', ',');
}

function xgColor(v) {
  if (v >= 0.5) return '#2e7d32';
  if (v >= 0.3) return '#43a047';
  if (v >= 0.2) return '#8bc34a';
  if (v >= 0.15) return '#e6d62c';
  if (v >= 0.11) return '#f0a030';
  return '#d9363e';
}

function rayExtent(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (FIELD.w - FIELD.bx) / dx);
  else if (dx < 0) t = Math.min(t, (0 - FIELD.bx) / dx);
  if (dy > 0) t = Math.min(t, (FIELD.h - FIELD.by) / dy);
  else if (dy < 0) t = Math.min(t, (0 - FIELD.by) / dy);
  return t;
}

function polar(angleDeg, r) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: FIELD.bx + Math.sin(rad) * r, y: FIELD.by - Math.cos(rad) * r };
}

// opts: { interactive, labels (default true), shots: [{ loc, type: 'goal' | 'miss' }] }
function renderFieldSvg(opts = {}) {
  const showLabels = opts.labels !== false;
  const shots = opts.shots || [];

  const lines = SECTOR_BOUNDS.map((b) => {
    const end = polar(b, rayExtent(b));
    return `<line x1="${FIELD.bx}" y1="${FIELD.by}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" class="field-line"/>`;
  }).join('');

  const circles = RING_RADII.map((r) => `<circle cx="${FIELD.bx}" cy="${FIELD.by}" r="${r}" class="field-ring"/>`).join('');

  let labels = '';
  if (showLabels) {
    for (let ring = 0; ring < 3; ring++) {
      for (let s = 0; s < 8; s++) {
        const mid = SECTOR_MID_ANGLES[s];
        const r = ring === 0 ? 78 : ring === 1 ? 182 : (RING_RADII[1] + rayExtent(mid)) / 2;
        const p = polar(mid, r);
        const v = XG_TABLE[ring][s];
        const lab = opts.labelFn
          ? opts.labelFn(ring, s)
          : { text: formatXg(v), fill: xgColor(v) };
        const two = !!lab.sub;
        const w = ring === 0 ? 70 : 104;
        const h = (ring === 0 ? 36 : 50) + (two ? (ring === 0 ? 14 : 20) : 0);
        const fs = ring === 0 ? 22 : 30;
        const subFs = ring === 0 ? 14 : 19;
        const textY = two ? p.y - h / 2 + fs * 0.95 + 2 : p.y + fs * 0.36;
        labels += `
          <g>
            <rect x="${(p.x - w / 2).toFixed(1)}" y="${(p.y - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="9" fill="${lab.fill}" opacity="0.92"/>
            <text x="${p.x.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" class="field-label" style="font-size:${fs}px">${lab.text}</text>
            ${two ? `<text x="${p.x.toFixed(1)}" y="${(textY + subFs + 4).toFixed(1)}" text-anchor="middle" class="field-label" style="font-size:${subFs}px;font-weight:600">${lab.sub}</text>` : ''}
          </g>`;
      }
    }
  }

  const dots = shots.map((s) => {
    if (!s.loc) return '';
    const fill = s.type === 'goal' ? '#1b5e20' : '#c62828';
    return `<circle cx="${s.loc.x}" cy="${s.loc.y}" r="15" fill="${fill}" stroke="#fff" stroke-width="4"/>`;
  }).join('');

  return `
    <svg class="field-svg${opts.interactive ? ' field-interactive' : ''}" viewBox="0 0 ${FIELD.w} ${FIELD.h}" ${opts.interactive ? 'data-shotfield="1"' : ''} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${FIELD.w}" height="${FIELD.h}" rx="18" class="field-bg"/>
      ${lines}
      ${circles}
      ${labels}
      <circle cx="${FIELD.bx}" cy="${FIELD.by}" r="16" class="field-basket"/>
      ${dots}
    </svg>`;
}

// Zone-heatmap: per zone het werkelijke scoringspercentage, gekleurd t.o.v. de verwachte xG.
// zones: { 'ring-sector': { goals, misses } }
function renderZoneHeatmap(zones) {
  const labelFn = (ring, s) => {
    const z = zones[`${ring}-${s}`];
    const n = z ? z.goals + z.misses : 0;
    if (n === 0) return { text: '–', fill: '#b9c4bf' };
    const actual = z.goals / n;
    const diff = actual - XG_TABLE[ring][s];
    let fill = '#e6d62c';
    if (diff > 0.1) fill = '#2e7d32';
    else if (diff > 0.03) fill = '#7cb342';
    else if (diff < -0.1) fill = '#d9363e';
    else if (diff < -0.03) fill = '#f0a030';
    return { text: `${Math.round(actual * 100)}%`, sub: `${z.goals}/${n}`, fill };
  };
  return renderFieldSvg({ labelFn });
}

function fieldPointFromEvent(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  if (p.x < 0 || p.y < 0 || p.x > FIELD.w || p.y > FIELD.h) return null;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
