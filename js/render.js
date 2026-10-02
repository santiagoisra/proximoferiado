// View-models and HTML-string renderers. No DOM access: everything returns plain data or strings so it can
// be tested with `node --test`. Every dynamic value goes through esc() before it reaches an HTML string.
import {
  MONTHS,
  MONTHS_SHORT,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  addDays,
  daysInMonth,
  diffDays,
  dow,
  fmtDayMonth,
  fmtLong,
  isWeekend,
  month,
  toISO,
  weekdayName,
  year as yearOf,
} from './dates.js';
import {
  TIPO_LABEL,
  esFeriado,
  feriadosEn,
  finesDeSemanaLargos,
  proximoFeriado,
  proximoFinDeSemanaLargo,
  proximosFeriados,
} from './feriados.js';

// ---------------------------------------------------------------- helpers

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML content and attribute values. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const unitDias = (n) => (n === 1 ? 'día' : 'días');

/** "hoy", "mañana", "en 5 días". */
export function relativeLabel(n) {
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  return `en ${n} días`;
}

/** "jueves 9 al domingo 12 de julio" / "sábado 28 de febrero al martes 3 de marzo". */
export function rangoLabel(desde, hasta) {
  const w = (iso) => WEEKDAYS[dow(iso)];
  const d = (iso) => Number(iso.slice(8, 10));
  const sameYear = yearOf(desde) === yearOf(hasta);
  if (sameYear && month(desde) === month(hasta)) {
    return `${w(desde)} ${d(desde)} al ${w(hasta)} ${d(hasta)} de ${MONTHS[month(hasta) - 1]}`;
  }
  if (sameYear) return `${w(desde)} ${fmtDayMonth(desde)} al ${w(hasta)} ${fmtDayMonth(hasta)}`;
  return `${fmtLong(desde)} al ${fmtLong(hasta)}`;
}

/**
 * Working days from `today` (included) up to the day before `target`: weekdays that are not national
 * holidays. Bridges and Holy Thursday are optional for employers, so they still count as working days.
 */
export function diasHabilesAntes(today, target) {
  let n = 0;
  for (let d = today; d < target; d = addDays(d, 1)) {
    if (!isWeekend(d) && !esFeriado(d)) n++;
  }
  return n;
}

const CHIP_LABEL = {
  puente: TIPO_LABEL.puente,
  no_laborable: `${TIPO_LABEL.no_laborable} (optativo)`,
};

const isNacional = (f) => f.tipo === 'inamovible' || f.tipo === 'trasladable';

const weekendNote = (iso) => (dow(iso) === 6 ? 'Cae sábado' : dow(iso) === 0 ? 'Cae domingo' : '');

function workdaysText(n) {
  if (n === 0) return 'Antes de ese día no hay días hábiles.';
  return `Antes de ese día hay ${n} ${n === 1 ? 'día hábil' : 'días hábiles'} contando hoy.`;
}

// ---------------------------------------------------------------- view-models

/** Everything the hero needs to know about one holiday, relative to `today`. */
function describeHoliday(today, f, { withWorkdays = true } = {}) {
  const dias = diffDays(today, f.fecha);
  const largo = finesDeSemanaLargos(yearOf(f.fecha)).find((w) => w.desde <= f.fecha && f.fecha <= w.hasta);

  const chips = [];
  if (f.origen) chips.push({ kind: 'traslado', text: `Trasladado desde el ${fmtDayMonth(f.origen)}` });
  const weekend = weekendNote(f.fecha);
  if (weekend) chips.push({ kind: 'weekend', text: weekend });
  if (largo) chips.push({ kind: 'long', text: `Fin de semana largo de ${largo.dias} días` });

  // Bridges and optional days next to the holiday (or inside its long weekend) explain the "extra" days off.
  const from = addDays(largo ? largo.desde : f.fecha, -1);
  const to = addDays(largo ? largo.hasta : f.fecha, 1);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const e of feriadosEn(d)) {
      if (e.tipo === 'puente' || e.tipo === 'no_laborable') {
        chips.push({ kind: e.tipo, text: `${CHIP_LABEL[e.tipo]}: ${weekdayName(d)} ${fmtDayMonth(d)}` });
      }
    }
  }

  return {
    fecha: f.fecha,
    nombre: f.nombre,
    tipo: f.tipo,
    dias,
    unit: unitDias(dias),
    fechaLarga: fmtLong(f.fecha),
    chips,
    workdays: withWorkdays ? workdaysText(diasHabilesAntes(today, f.fecha)) : null,
  };
}

/**
 * Model of the hero card.
 * - `mode`: 'normal' | 'tomorrow' | 'today' | 'none'.
 * - `holiday`: the next national holiday as is (a weekend holiday is not replaced by another one).
 * - `following`: only when today is a holiday, the one after it.
 * - `target`: the holiday that the "add to calendar" and "share" actions refer to.
 */
export function heroModel(today) {
  const f = proximoFeriado(today);
  if (!f) return { mode: 'none', label: 'Próximo feriado', holiday: null, following: null, target: null };

  const dias = diffDays(today, f.fecha);
  if (dias === 0) {
    const next = proximoFeriado(addDays(today, 1));
    const following = next ? describeHoliday(today, next) : null;
    const holiday = describeHoliday(today, f, { withWorkdays: false });
    return { mode: 'today', label: 'Hoy es feriado', holiday, following, target: following ?? holiday };
  }
  const holiday = describeHoliday(today, f);
  return {
    mode: dias === 1 ? 'tomorrow' : 'normal',
    label: dias === 1 ? 'Es mañana' : 'Próximo feriado',
    holiday,
    following: null,
    target: holiday,
  };
}

/** Model of the "next long weekend" card, or null when there is none. */
export function largoModel(today) {
  const w = proximoFinDeSemanaLargo(today);
  if (!w) return null;
  const enCurso = w.desde <= today;
  const diasHasta = Math.max(0, diffDays(today, w.desde));
  let rel;
  if (enCurso) rel = `Termina el ${weekdayName(w.hasta)} ${fmtDayMonth(w.hasta)}`;
  else rel = diasHasta === 1 ? 'Empieza mañana' : `Empieza en ${diasHasta} días`;
  const tiles = [];
  for (let d = w.desde; d <= w.hasta; d = addDays(d, 1)) {
    const entries = feriadosEn(d);
    const kind = entries.some(isNacional) ? 'holiday' : entries.some((e) => e.tipo === 'puente') ? 'puente' : 'weekend';
    tiles.push({ fecha: d, weekday: WEEKDAYS_SHORT[dow(d)], day: Number(d.slice(8, 10)), kind });
  }
  return {
    desde: w.desde,
    hasta: w.hasta,
    dias: w.dias,
    tiles,
    rango: rangoLabel(w.desde, w.hasta),
    motivos: w.motivos,
    incluyePuente: w.incluyePuente,
    enCurso,
    diasHasta,
    rel,
  };
}

/** Start date of the first long weekend that begins after `today` (the one in progress is skipped). */
export function proximoInicioLargo(today) {
  const y = yearOf(today);
  for (const yy of [y, y + 1]) {
    const w = finesDeSemanaLargos(yy).find((x) => x.desde > today);
    if (w) return w.desde;
  }
  return null;
}

function upcomingItem(today, f) {
  return {
    fecha: f.fecha,
    nombre: f.nombre,
    day: Number(f.fecha.slice(8, 10)),
    mon: MONTHS_SHORT[month(f.fecha) - 1],
    weekday: weekdayName(f.fecha),
    rel: relativeLabel(diffDays(today, f.fecha)),
    note: f.origen ? `Trasladado desde el ${fmtDayMonth(f.origen)}` : weekendNote(f.fecha),
  };
}

/** Whole "Inicio" view: hero, long weekend and the next five holidays after the ones the hero shows. */
export function inicioModel(today) {
  const hero = heroModel(today);
  const skip = hero.mode === 'today' && hero.following ? 2 : 1;
  const despues = proximosFeriados(today, skip + 5)
    .slice(skip)
    .map((f) => upcomingItem(today, f));
  return { hero, largo: largoModel(today), despues };
}

/** Plain-text summary used by the Web Share API (and the copy-link fallback). */
export function shareText(hero) {
  const h = hero.holiday;
  if (!h) return 'Próximo Feriado en Argentina';
  if (hero.mode === 'today') {
    const n = hero.following;
    if (!n) return `Hoy es feriado: ${h.nombre}.`;
    const faltan = n.dias === 1 ? 'es mañana' : `faltan ${n.dias} días`;
    return `Hoy es feriado: ${h.nombre}. El próximo es ${n.nombre}, ${n.fechaLarga} (${faltan}).`;
  }
  const cuando = hero.mode === 'tomorrow' ? 'Es mañana.' : `Faltan ${h.dias} ${h.unit}.`;
  return `Próximo feriado: ${h.nombre}, ${h.fechaLarga}. ${cuando}`;
}

/** Notice for future years that have no bridge yet (the government publishes them during the year). */
export function proyeccionAviso(y, thisYear, list) {
  if (y <= thisYear || list.some((f) => f.tipo === 'puente')) return '';
  return `Proyección: los puentes turísticos de ${y} todavía no fueron definidos por el Gobierno.`;
}

// ---------------------------------------------------------------- renderers: decoration

/**
 * Sol de Mayo as a decorative SVG: a disc with 16 straight and 16 wavy rays. Colors come from CSS
 * (.sun-fill / .sun-stroke) so it follows the light and dark themes.
 */
export function sunSvg() {
  const pt = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  };
  const rays = [];
  for (let i = 0; i < 16; i++) {
    const deg = i * 22.5;
    rays.push(`<polygon class="sun-fill" points="${pt(34, deg - 3.4)} ${pt(34, deg + 3.4)} ${pt(99, deg)}"/>`);
    const mid = deg + 11.25;
    rays.push(`<path class="sun-stroke" d="M${pt(35, mid)} Q${pt(52, mid + 5)} ${pt(66, mid)} T${pt(96, mid)}"/>`);
  }
  return (
    '<svg class="hero-sun" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">' +
    `<circle class="sun-fill" r="26"/>${rays.join('')}</svg>`
  );
}

// ---------------------------------------------------------------- renderers: inicio

const chipsHtml = (chips) =>
  chips.length
    ? `<ul class="chips" aria-label="Detalles">${chips.map((c) => `<li class="chip chip--${esc(c.kind)}">${esc(c.text)}</li>`).join('')}</ul>`
    : '';

const timeHtml = (iso, text) => `<time datetime="${esc(iso)}">${esc(text)}</time>`;

const workHtml = (text) => (text ? `<p class="hero-work">${esc(text)}</p>` : '');

const actionsHtml = (target) =>
  '<div class="actions">' +
  `<button type="button" class="btn btn--light" data-action="add-ics" data-fecha="${esc(target.fecha)}">Agregar al calendario</button>` +
  '<button type="button" class="btn btn--ghost" data-action="share">Compartir</button>' +
  '</div>';

/** Hero card: the next national holiday (or today's, with the next one below). */
export function renderHero(model) {
  const h = model.holiday;
  if (!h) {
    return (
      '<article class="hero" data-mode="none" aria-labelledby="hero-name">' +
      sunSvg() +
      `<p class="hero-label">${esc(model.label)}</p>` +
      '<h2 class="hero-name" id="hero-name">No encontramos el próximo feriado. Intentá de nuevo más tarde.</h2>' +
      '</article>'
    );
  }

  const isToday = model.mode === 'today';
  const count = isToday
    ? ''
    : `<p class="hero-count"><span class="sr-only">${h.dias === 1 ? 'Falta' : 'Faltan'} </span><span class="hero-num">${h.dias}</span> <span class="hero-unit">${esc(h.unit)}</span></p>`;

  let following = '';
  if (isToday && model.following) {
    const n = model.following;
    following =
      '<div class="hero-next">' +
      '<p class="hero-next-label">El próximo es</p>' +
      `<p class="hero-next-name">${esc(n.nombre)}</p>` +
      `<p class="hero-next-meta">${timeHtml(n.fecha, n.fechaLarga)}, ${esc(relativeLabel(n.dias))}</p>` +
      chipsHtml(n.chips) +
      workHtml(n.workdays) +
      '</div>';
  }

  return (
    `<article class="hero" data-mode="${esc(model.mode)}" aria-labelledby="hero-name">` +
    sunSvg() +
    `<p class="hero-label">${esc(model.label)}</p>` +
    count +
    `<h2 class="hero-name${isToday ? ' hero-name--xl' : ''}" id="hero-name">${esc(h.nombre)}</h2>` +
    `<p class="hero-date">${timeHtml(h.fecha, h.fechaLarga)}</p>` +
    chipsHtml(h.chips) +
    (isToday ? '' : workHtml(h.workdays)) +
    following +
    actionsHtml(model.target) +
    '</article>'
  );
}

/** Long-weekend card ("Próximo..." or "...en curso" while in progress). Empty string when there is none. */
export function renderLargoCard(m) {
  if (!m) return '';
  const badges = [
    m.enCurso ? '<span class="badge badge--sol">En curso</span>' : '',
    m.incluyePuente ? '<span class="badge badge--outline">Incluye puente</span>' : '',
  ].join('');
  return (
    '<article class="lw" aria-labelledby="lw-range">' +
    `<p class="card-label">${m.enCurso ? 'Fin de semana largo en curso' : 'Próximo fin de semana largo'}</p>` +
    `<h2 class="lw-range" id="lw-range">${esc(m.rango)}</h2>` +
    `<p class="lw-days"><span class="lw-num">${m.dias}</span> días seguidos</p>` +
    `<ol class="strip" aria-hidden="true">${m.tiles
      .map((t) => `<li class="tile tile--${esc(t.kind)}"><span class="tile-wd">${esc(t.weekday)}</span><span class="tile-day">${t.day}</span></li>`)
      .join('')}</ol>` +
    (badges ? `<p class="lw-badges">${badges}</p>` : '') +
    `<p class="lw-why"><span class="sr-only">Motivos: </span>${esc(m.motivos.join(', '))}</p>` +
    `<p class="lw-rel">${esc(m.rel)}</p>` +
    '</article>'
  );
}

/** "Después de este": the next holidays after the hero one. Empty string for an empty list. */
export function renderDespues(items) {
  if (!items.length) return '';
  const rows = items
    .map(
      (d) =>
        `<li class="upc-item" data-fecha="${esc(d.fecha)}">` +
        `<div class="datechip" aria-hidden="true"><span class="datechip-day">${d.day}</span><span class="datechip-mon">${esc(d.mon)}</span></div>` +
        '<div class="upc-body">' +
        `<p class="upc-name">${esc(d.nombre)}</p>` +
        `<p class="upc-meta"><span class="sr-only">${esc(fmtDayMonth(d.fecha))}: </span>${esc(d.weekday)}, ${esc(d.rel)}</p>` +
        (d.note ? `<p class="upc-note">${esc(d.note)}</p>` : '') +
        '</div></li>',
    )
    .join('');
  return `<section class="after" aria-labelledby="after-title"><h2 class="section-title" id="after-title">Después de este</h2><ol class="upc">${rows}</ol></section>`;
}

/** Whole "Inicio" view. */
export function renderInicio(m) {
  return `<div class="inicio-grid">${renderHero(m.hero)}${renderLargoCard(m.largo)}</div>${renderDespues(m.despues)}`;
}

// ---------------------------------------------------------------- renderers: year calendar

const CAL_DIAS = [
  ['L', 'lunes'],
  ['M', 'martes'],
  ['X', 'miércoles'],
  ['J', 'jueves'],
  ['V', 'viernes'],
  ['S', 'sábado'],
  ['D', 'domingo'],
];

/** Visual class of a day: filled holiday, dashed bridge, dotted optional day. */
function dayClass(fs) {
  if (fs.some(isNacional)) return 'is-f';
  if (fs.some((f) => f.tipo === 'puente')) return 'is-p';
  if (fs.some((f) => f.tipo === 'no_laborable')) return 'is-n';
  return '';
}

/** Small parenthesis after a name in the monthly list (empty for a plain holiday). */
function listNote(f) {
  if (!isNacional(f)) return TIPO_LABEL[f.tipo].toLowerCase();
  if (f.origen) return `trasladado desde el ${fmtDayMonth(f.origen)}`;
  const w = weekendNote(f.fecha);
  return w ? w.toLowerCase() : '';
}

/**
 * The 12 months of a year as tables (Monday first). Marked days carry their type as text for screen readers
 * and each month lists the names, so meaning never depends on color or border style alone.
 * @param {number} y
 * @param {import('./feriados.js').Feriado[]} list
 * @param {{today?: string|null}} o
 */
export function renderCalendario(y, list, { today = null } = {}) {
  const porDia = new Map();
  for (const f of list) porDia.set(f.fecha, [...(porDia.get(f.fecha) ?? []), f]);

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const cells = Array.from({ length: (dow(toISO(y, m, 1)) + 6) % 7 }, () => '<td class="d is-empty"></td>');
    const items = [];
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const iso = toISO(y, m, d);
      const fs = porDia.get(iso) ?? [];
      const cls = ['d', isWeekend(iso) && 'is-we', dayClass(fs), today === iso && 'is-today'].filter(Boolean).join(' ');
      const sr = fs.length
        ? `<span class="sr-only">, ${esc(fs.map((f) => `${TIPO_LABEL[f.tipo].toLowerCase()}: ${f.nombre}`).join('; '))}</span>`
        : '';
      cells.push(`<td class="${cls}"${today === iso ? ' aria-current="date"' : ''}>${d}${sr}</td>`);
      for (const f of fs) {
        const note = listNote(f);
        const redundant = note && f.nombre.toLowerCase().includes(note);
        items.push(
          `<li><span class="ml-day">${d}</span> <span class="ml-text"><span class="ml-name">${esc(f.nombre)}</span>${note && !redundant ? `<span class="ml-type"> (${esc(note)})</span>` : ''}</span></li>`,
        );
      }
    }
    while (cells.length % 7) cells.push('<td class="d is-empty"></td>');
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);

    const id = `mes-${m}`;
    const name = MONTHS[m - 1];
    months.push(
      `<section class="month" aria-labelledby="${id}">` +
        `<h3 class="month-title" id="${id}">${name[0].toUpperCase()}${name.slice(1)}</h3>` +
        `<table class="mt" aria-labelledby="${id}"><thead><tr>${CAL_DIAS.map(([l, n]) => `<th scope="col"><abbr title="${n}">${l}</abbr></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` +
        (items.length ? `<ul class="month-list">${items.join('')}</ul>` : '<p class="month-none">Sin feriados.</p>') +
        '</section>',
    );
  }
  return `<div class="months">${months.join('')}</div>`;
}

// ---------------------------------------------------------------- renderers: long weekends

/**
 * Long weekends of a year.
 * @param {import('./feriados.js').FinDeSemanaLargo[]} list
 * @param {{today?: string|null, nextDesde?: string|null}} o `nextDesde` is the start of the next long weekend overall
 */
export function renderLargos(list, { today = null, nextDesde = null } = {}) {
  if (!list.length) return '<p class="empty">No hay fines de semana largos en este año.</p>';
  const rows = list
    .map((w) => {
      const past = today !== null && w.hasta < today;
      const current = today !== null && w.desde <= today && w.hasta >= today;
      const next = !past && !current && nextDesde === w.desde;
      const cls = ['row', 'lw-row', past && 'is-past', current && 'is-current', next && 'is-next'].filter(Boolean).join(' ');
      const tags = [
        current ? '<span class="badge badge--sol">En curso</span>' : '',
        next ? '<span class="badge badge--sol">Próximo</span>' : '',
        w.incluyePuente ? '<span class="badge badge--outline">Incluye puente</span>' : '',
      ].join('');
      return (
        `<li class="${cls}" data-desde="${esc(w.desde)}">` +
        `<div class="datechip datechip--num" aria-hidden="true"><span class="datechip-day">${w.dias}</span><span class="datechip-mon">días</span></div>` +
        '<div class="row-body">' +
        `<p class="row-name">${esc(rangoLabel(w.desde, w.hasta))}${past ? '<span class="sr-only"> (ya pasó)</span>' : ''}</p>` +
        `<p class="row-meta"><span class="sr-only">${w.dias} días seguidos. </span>${esc(w.motivos.join(', '))}</p>` +
        '</div>' +
        (tags ? `<div class="row-tags">${tags}</div>` : '') +
        '</li>'
      );
    })
    .join('');
  return `<ol class="rows">${rows}</ol>`;
}
