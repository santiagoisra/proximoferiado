import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { feriadosDelAnio, finesDeSemanaLargos, setExtras, setPuentes } from '../js/feriados.js';
import {
  LEGAL_NOTE,
  MIN_YEAR,
  VIEWS,
  clampYear,
  formatUpdatedAt,
  msUntilNextArgentineMidnight,
  nextTabIndex,
  parseUrlState,
  serializeUrlState,
  statusMessage,
  yearStep,
} from '../js/view-state.js';
import {
  diasHabilesAntes,
  esc,
  heroModel,
  inicioModel,
  largoModel,
  proximoInicioLargo,
  proyeccionAviso,
  rangoLabel,
  relativeLabel,
  renderCalendario,
  renderDespues,
  renderHero,
  renderInicio,
  renderLargoCard,
  renderLargos,
  shareText,
  sunSvg,
} from '../js/render.js';

// Keep the engine hooks pristine so no test depends on the order of the others.
const resetHooks = () => {
  for (let y = 2023; y <= 2031; y++) {
    setPuentes(y, null);
    setExtras(y, []);
  }
};
beforeEach(resetHooks);
afterEach(resetHooks);

// ---------------------------------------------------------------- view-state: URL state

test('parseUrlState: empty search is the inicio view of the current year', () => {
  assert.deepEqual(parseUrlState('', 2026), { view: 'inicio', year: 2026 });
});

test('parseUrlState: reads view and year, with or without the leading question mark', () => {
  assert.deepEqual(parseUrlState('?v=calendario&a=2027', 2026), { view: 'calendario', year: 2027 });
  assert.deepEqual(parseUrlState('v=largos&a=2025', 2026), { view: 'largos', year: 2025 });
  assert.deepEqual(parseUrlState('?v=inicio', 2026), { view: 'inicio', year: 2026 });
});

test('parseUrlState: accepts the legacy ?action=calendario link', () => {
  assert.deepEqual(parseUrlState('?action=calendario', 2026), { view: 'calendario', year: 2026 });
});

test('parseUrlState: the new view parameter wins over the legacy one', () => {
  assert.equal(parseUrlState('?v=largos&action=calendario', 2026).view, 'largos');
});

test('parseUrlState: ignores invalid values instead of failing', () => {
  assert.deepEqual(parseUrlState('?v=nope&a=abc', 2026), { view: 'inicio', year: 2026 });
  assert.equal(parseUrlState('?a=2022', 2026).year, 2026, 'below MIN_YEAR');
  assert.equal(parseUrlState('?a=2029', 2026).year, 2026, 'above thisYear + 2');
  assert.equal(parseUrlState('?a=20x6', 2026).year, 2026);
  assert.equal(parseUrlState('?a=2027.5', 2026).year, 2026);
  assert.equal(parseUrlState('?action=other', 2026).view, 'inicio');
});

test('parseUrlState: accepts the whole supported year range', () => {
  assert.equal(parseUrlState(`?a=${MIN_YEAR}`, 2026).year, MIN_YEAR);
  assert.equal(parseUrlState('?a=2028', 2026).year, 2028);
});

test('serializeUrlState: omits defaults', () => {
  assert.equal(serializeUrlState({ view: 'inicio', year: 2026 }, 2026), '');
  assert.equal(serializeUrlState({ view: 'calendario', year: 2026 }, 2026), '?v=calendario');
});

test('serializeUrlState: writes view and a non-current year', () => {
  assert.equal(serializeUrlState({ view: 'largos', year: 2027 }, 2026), '?v=largos&a=2027');
  assert.equal(serializeUrlState({ view: 'calendario', year: 2025 }, 2026), '?v=calendario&a=2025');
});

test('serializeUrlState: the inicio view has no year, so it never writes one', () => {
  assert.equal(serializeUrlState({ view: 'inicio', year: 2027 }, 2026), '');
});

test('serializeUrlState and parseUrlState round-trip', () => {
  for (const view of VIEWS) {
    for (const year of [2023, 2026, 2028]) {
      const parsed = parseUrlState(serializeUrlState({ view, year }, 2026), 2026);
      assert.equal(parsed.view, view);
      if (view !== 'inicio') assert.equal(parsed.year, year);
    }
  }
});

test('clampYear and yearStep keep the year between 2023 and thisYear + 2', () => {
  assert.equal(clampYear(2000, 2026), 2023);
  assert.equal(clampYear(2100, 2026), 2028);
  assert.equal(clampYear(2026, 2026), 2026);
  assert.equal(yearStep(2023, -1, 2026), 2023);
  assert.equal(yearStep(2028, 1, 2026), 2028);
  assert.equal(yearStep(2026, 1, 2026), 2027);
  assert.equal(yearStep(2026, -1, 2026), 2025);
});

// ---------------------------------------------------------------- view-state: tabs, clock, status

test('nextTabIndex: arrows wrap around, Home and End jump, other keys are ignored', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('ArrowLeft', 2, 3), 1);
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('Enter', 1, 3), null);
  assert.equal(nextTabIndex('a', 1, 3), null);
});

test('msUntilNextArgentineMidnight: counts to 00:00 in UTC-3', () => {
  assert.equal(msUntilNextArgentineMidnight(Date.UTC(2026, 9, 2, 2, 59, 0)), 60_000, '23:59 in Buenos Aires');
  assert.equal(msUntilNextArgentineMidnight(Date.UTC(2026, 9, 2, 3, 0, 0)), 86_400_000, 'exactly midnight: a full day');
  assert.equal(msUntilNextArgentineMidnight(Date.UTC(2026, 9, 2, 15, 0, 0)), 12 * 3_600_000, 'noon in Buenos Aires');
});

test('formatUpdatedAt: dd/mm/yyyy hh:mm in Argentina time', () => {
  assert.equal(formatUpdatedAt(Date.UTC(2026, 9, 2, 15, 5)), '02/10/2026 12:05');
  assert.equal(formatUpdatedAt(Date.UTC(2026, 0, 1, 2, 30)), '31/12/2025 23:30', 'crosses the UTC date line');
});

test('statusMessage: verified data shows the update time', () => {
  assert.equal(
    statusMessage({ status: 'ok', updatedAt: Date.UTC(2026, 9, 2, 15, 5) }),
    'Datos verificados con ArgentinaDatos, actualizado el 02/10/2026 12:05',
  );
});

test('statusMessage: offline and partial results show the saved-data notice', () => {
  const saved = 'Sin conexión: se muestran los últimos datos guardados.';
  assert.equal(statusMessage({ status: 'offline', updatedAt: Date.UTC(2026, 9, 2, 15, 5) }), saved);
  assert.equal(statusMessage({ status: 'partial', updatedAt: Date.UTC(2026, 9, 2, 15, 5) }), saved);
});

test('statusMessage: offline with nothing ever saved says the calendar is computed locally', () => {
  assert.equal(
    statusMessage({ status: 'offline', updatedAt: null }),
    'Sin conexión: se muestran los feriados calculados en este dispositivo.',
  );
});

test('statusMessage: pending state and the legal note', () => {
  assert.equal(statusMessage({ status: 'pending', updatedAt: null }), 'Verificando datos con ArgentinaDatos…');
  assert.match(LEGAL_NOTE, /Ley 27\.399/);
  assert.match(LEGAL_NOTE, /provincias y municipios/);
});

// ---------------------------------------------------------------- render: pure helpers

test('esc: escapes the five HTML-significant characters and coerces non-strings', () => {
  assert.equal(esc('<b>"a" & \'b\'</b>'), '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
  assert.equal(esc(12), '12');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('relativeLabel: today, tomorrow, plural and singular', () => {
  assert.equal(relativeLabel(0), 'hoy');
  assert.equal(relativeLabel(1), 'mañana');
  assert.equal(relativeLabel(2), 'en 2 días');
  assert.equal(relativeLabel(52), 'en 52 días');
});

test('rangoLabel: same month, month change, year change', () => {
  assert.equal(rangoLabel('2026-07-09', '2026-07-12'), 'jueves 9 al domingo 12 de julio');
  assert.equal(rangoLabel('2026-02-28', '2026-03-03'), 'sábado 28 de febrero al martes 3 de marzo');
  assert.equal(
    rangoLabel('2026-12-31', '2027-01-03'),
    'jueves 31 de diciembre de 2026 al domingo 3 de enero de 2027',
  );
});

test('diasHabilesAntes: counts weekdays from today up to the day before, today included', () => {
  // Fri 2 Oct .. Fri 9 Oct are the working days before Monday 12 Oct.
  assert.equal(diasHabilesAntes('2026-10-02', '2026-10-12'), 6);
  assert.equal(diasHabilesAntes('2026-10-09', '2026-10-12'), 1, 'Friday only');
});

test('diasHabilesAntes: weekends and today-as-weekend do not count', () => {
  assert.equal(diasHabilesAntes('2026-10-11', '2026-10-12'), 0, 'Sunday before a Monday holiday');
});

test('diasHabilesAntes: national holidays in between do not count', () => {
  // Wed 1 Apr counts; Thu 2 Apr (Malvinas) and Fri 3 Apr (Viernes Santo) are holidays; then a weekend.
  assert.equal(diasHabilesAntes('2026-04-01', '2026-04-06'), 1);
});

test('diasHabilesAntes: the target day itself is excluded and past targets give 0', () => {
  assert.equal(diasHabilesAntes('2026-10-12', '2026-10-12'), 0);
  assert.equal(diasHabilesAntes('2026-10-12', '2026-10-01'), 0);
});

// ---------------------------------------------------------------- render: heroModel

test('heroModel: normal state shows the days to go and the working-day context', () => {
  const m = heroModel('2026-10-02');
  assert.equal(m.mode, 'normal');
  assert.equal(m.label, 'Próximo feriado');
  assert.equal(m.holiday.fecha, '2026-10-12');
  assert.equal(m.holiday.nombre, 'Día del Respeto a la Diversidad Cultural');
  assert.equal(m.holiday.dias, 10);
  assert.equal(m.holiday.unit, 'días');
  assert.equal(m.holiday.fechaLarga, 'lunes 12 de octubre de 2026');
  assert.equal(m.holiday.workdays, 'Antes de ese día hay 6 días hábiles contando hoy.');
  assert.equal(m.following, null);
  assert.deepEqual(m.holiday.chips, [{ kind: 'long', text: 'Fin de semana largo de 3 días' }]);
});

test('heroModel: tomorrow gets its own label and the singular unit', () => {
  const m = heroModel('2026-10-11');
  assert.equal(m.mode, 'tomorrow');
  assert.equal(m.label, 'Es mañana');
  assert.equal(m.holiday.dias, 1);
  assert.equal(m.holiday.unit, 'día');
  assert.equal(m.holiday.workdays, 'Antes de ese día no hay días hábiles.');
});

test('heroModel: a single working day uses the singular form', () => {
  const m = heroModel('2026-10-09');
  assert.equal(m.holiday.workdays, 'Antes de ese día hay 1 día hábil contando hoy.');
});

test('heroModel: when today is a holiday it says so and also carries the next one', () => {
  const m = heroModel('2026-10-12');
  assert.equal(m.mode, 'today');
  assert.equal(m.label, 'Hoy es feriado');
  assert.equal(m.holiday.fecha, '2026-10-12');
  assert.equal(m.holiday.dias, 0);
  assert.equal(m.holiday.workdays, null);
  assert.equal(m.following.fecha, '2026-11-23');
  assert.equal(m.following.nombre, 'Día de la Soberanía Nacional');
  assert.equal(m.following.dias, 42);
  assert.equal(m.following.workdays, 'Antes de ese día hay 29 días hábiles contando hoy.');
});

test('heroModel: a holiday on Saturday is shown as is, with a clear chip and no substitution', () => {
  const m = heroModel('2027-04-25');
  assert.equal(m.mode, 'normal');
  assert.equal(m.holiday.fecha, '2027-05-01');
  assert.equal(m.holiday.nombre, 'Día del Trabajador');
  assert.deepEqual(m.holiday.chips, [{ kind: 'weekend', text: 'Cae sábado' }]);
});

test('heroModel: a Sunday holiday that is part of a long weekend carries both chips', () => {
  const m = heroModel('2027-06-10');
  assert.equal(m.holiday.fecha, '2027-06-20');
  assert.deepEqual(m.holiday.chips, [
    { kind: 'weekend', text: 'Cae domingo' },
    { kind: 'long', text: 'Fin de semana largo de 3 días' },
  ]);
});

test('heroModel: bridges inside the long weekend are labeled as tourist bridges', () => {
  const m = heroModel('2026-07-02');
  assert.equal(m.holiday.fecha, '2026-07-09');
  assert.deepEqual(m.holiday.chips, [
    { kind: 'long', text: 'Fin de semana largo de 4 días' },
    { kind: 'puente', text: 'Puente turístico: viernes 10 de julio' },
  ]);
});

test('heroModel: an optional non-working day next to the holiday is labeled as such', () => {
  const m = heroModel('2027-03-20');
  assert.equal(m.holiday.fecha, '2027-03-24');
  assert.deepEqual(m.holiday.chips, [
    { kind: 'no_laborable', text: 'Día no laborable (optativo): jueves 25 de marzo' },
  ]);
});

test('heroModel: rolls over to the next year after the last holiday', () => {
  const m = heroModel('2026-12-26');
  assert.equal(m.holiday.fecha, '2027-01-01');
  assert.equal(m.holiday.nombre, 'Año Nuevo');
  assert.equal(m.holiday.dias, 6);
  assert.deepEqual(m.holiday.chips, [{ kind: 'long', text: 'Fin de semana largo de 3 días' }]);
});

test('heroModel: exposes a stable target for the calendar and share actions', () => {
  assert.equal(heroModel('2026-10-02').target.fecha, '2026-10-12');
  assert.equal(heroModel('2026-10-12').target.fecha, '2026-11-23', 'on the holiday itself the action points to the next one');
});

test('heroModel: a moved holiday says where it was moved from', () => {
  const m = heroModel('2026-11-10');
  assert.equal(m.holiday.fecha, '2026-11-23');
  assert.deepEqual(m.holiday.chips[0], { kind: 'traslado', text: 'Trasladado desde el 20 de noviembre' });
});

// ---------------------------------------------------------------- render: long weekend and upcoming list

test('largoModel: next long weekend with its range, reasons and countdown', () => {
  const m = largoModel('2026-10-02');
  assert.equal(m.desde, '2026-10-10');
  assert.equal(m.hasta, '2026-10-12');
  assert.equal(m.dias, 3);
  assert.equal(m.rango, 'sábado 10 al lunes 12 de octubre');
  assert.deepEqual(m.motivos, ['Día del Respeto a la Diversidad Cultural']);
  assert.equal(m.incluyePuente, false);
  assert.equal(m.enCurso, false);
  assert.equal(m.diasHasta, 8);
  assert.equal(m.rel, 'Empieza en 8 días');
});

test('largoModel: one in progress is flagged and says when it ends', () => {
  const m = largoModel('2026-07-10');
  assert.equal(m.desde, '2026-07-09');
  assert.equal(m.enCurso, true);
  assert.equal(m.incluyePuente, true);
  assert.equal(m.diasHasta, 0);
  assert.equal(m.rel, 'Termina el domingo 12 de julio');
});

test('largoModel: starting tomorrow and starting today', () => {
  assert.equal(largoModel('2026-10-09').rel, 'Empieza mañana');
  const today = largoModel('2026-10-10');
  assert.equal(today.enCurso, true);
  assert.equal(today.rel, 'Termina el lunes 12 de octubre');
});

test('largoModel: looks into the next year when the current one has no more', () => {
  const m = largoModel('2026-12-28');
  assert.equal(m.desde, '2027-01-01');
});

test('proximoInicioLargo: start of the next long weekend that has not started yet', () => {
  assert.equal(proximoInicioLargo('2026-10-02'), '2026-10-10');
  assert.equal(proximoInicioLargo('2026-07-10'), '2026-08-15', 'skips the one in progress');
  assert.equal(proximoInicioLargo('2026-12-28'), '2027-01-01', 'looks into the next year');
});

test('inicioModel: lists the next five holidays after the hero one', () => {
  const m = inicioModel('2026-10-02');
  assert.deepEqual(
    m.despues.map((d) => d.fecha),
    ['2026-11-23', '2026-12-08', '2026-12-25', '2027-01-01', '2027-02-08'],
  );
  const first = m.despues[0];
  assert.equal(first.nombre, 'Día de la Soberanía Nacional');
  assert.equal(first.day, 23);
  assert.equal(first.mon, 'nov');
  assert.equal(first.weekday, 'lunes');
  assert.equal(first.rel, 'en 52 días');
  assert.equal(first.note, 'Trasladado desde el 20 de noviembre');
});

test('inicioModel: when today is a holiday the list skips both the hero and the following one', () => {
  const m = inicioModel('2026-10-12');
  assert.equal(m.hero.mode, 'today');
  assert.deepEqual(
    m.despues.map((d) => d.fecha),
    ['2026-12-08', '2026-12-25', '2027-01-01', '2027-02-08', '2027-02-09'],
  );
});

test('inicioModel: weekend holidays in the list say so', () => {
  const m = inicioModel('2027-04-01');
  const labor = m.despues.find((d) => d.fecha === '2027-05-01');
  assert.equal(labor.note, 'Cae sábado');
});

// ---------------------------------------------------------------- render: share text and projection notice

test('shareText: normal and today variants', () => {
  assert.equal(
    shareText(heroModel('2026-10-02')),
    'Próximo feriado: Día del Respeto a la Diversidad Cultural, lunes 12 de octubre de 2026. Faltan 10 días.',
  );
  assert.equal(
    shareText(heroModel('2026-10-11')),
    'Próximo feriado: Día del Respeto a la Diversidad Cultural, lunes 12 de octubre de 2026. Es mañana.',
  );
  assert.equal(
    shareText(heroModel('2026-10-12')),
    'Hoy es feriado: Día del Respeto a la Diversidad Cultural. El próximo es Día de la Soberanía Nacional, lunes 23 de noviembre de 2026 (faltan 42 días).',
  );
});

test('proyeccionAviso: only future years without any bridge get the notice', () => {
  assert.equal(
    proyeccionAviso(2027, 2026, feriadosDelAnio(2027)),
    'Proyección: los puentes turísticos de 2027 todavía no fueron definidos por el Gobierno.',
  );
  assert.equal(proyeccionAviso(2026, 2026, []), '', 'the current year never gets the notice');
  assert.equal(proyeccionAviso(2025, 2026, []), '');
  setPuentes(2027, [{ fecha: '2027-08-16', nombre: 'Puente', tipo: 'puente' }]);
  assert.equal(proyeccionAviso(2027, 2026, feriadosDelAnio(2027)), '', 'a published bridge removes the notice');
});

// ---------------------------------------------------------------- renderers: hero

const count = (html, needle) => html.split(needle).length - 1;

test('renderHero: normal state has label, huge count, name, long date and both actions', () => {
  const html = renderHero(heroModel('2026-10-02'));
  assert.match(html, /class="hero-label">Próximo feriado</);
  assert.match(html, /<span class="sr-only">Faltan <\/span><span class="hero-num">10<\/span> <span class="hero-unit">días<\/span>/);
  assert.match(html, /<h2 class="hero-name"[^>]*>Día del Respeto a la Diversidad Cultural<\/h2>/);
  assert.match(html, /<time datetime="2026-10-12">lunes 12 de octubre de 2026<\/time>/);
  assert.match(html, /Fin de semana largo de 3 días/);
  assert.match(html, /Antes de ese día hay 6 días hábiles contando hoy\./);
  assert.match(html, /data-action="add-ics" data-fecha="2026-10-12"/);
  assert.match(html, /data-action="share"/);
  assert.match(html, />Agregar al calendario</);
  assert.match(html, />Compartir</);
  assert.doesNotMatch(html, /Calculando/);
});

test('renderHero: tomorrow uses the singular unit and the "Falta" reading', () => {
  const html = renderHero(heroModel('2026-10-11'));
  assert.match(html, /class="hero-label">Es mañana</);
  assert.match(html, /<span class="sr-only">Falta <\/span><span class="hero-num">1<\/span> <span class="hero-unit">día<\/span>/);
});

test('renderHero: today is a holiday shows no countdown and presents the next one below', () => {
  const html = renderHero(heroModel('2026-10-12'));
  assert.match(html, /data-mode="today"/);
  assert.match(html, /class="hero-label">Hoy es feriado</);
  assert.doesNotMatch(html, /hero-num/);
  assert.match(html, /<h2 class="hero-name hero-name--xl"[^>]*>Día del Respeto a la Diversidad Cultural<\/h2>/);
  assert.match(html, /El próximo es/);
  assert.match(html, /Día de la Soberanía Nacional/);
  assert.match(html, /lunes 23 de noviembre de 2026/);
  assert.match(html, /en 42 días/);
  assert.match(html, /data-action="add-ics" data-fecha="2026-11-23"/, 'actions target the next holiday');
});

test('renderHero: weekend holiday carries its chip as is', () => {
  const html = renderHero(heroModel('2027-04-25'));
  assert.match(html, /<li class="chip chip--weekend">Cae sábado<\/li>/);
  assert.match(html, /<time datetime="2027-05-01">sábado 1 de mayo de 2027<\/time>/);
});

test('renderHero: bridges and optional days are rendered with their semantic labels', () => {
  assert.match(renderHero(heroModel('2026-07-02')), /chip chip--puente">Puente turístico: viernes 10 de julio</);
  assert.match(renderHero(heroModel('2027-03-20')), /chip chip--no_laborable">Día no laborable \(optativo\): jueves 25 de marzo</);
});

test('renderHero: escapes every dynamic string', () => {
  const m = heroModel('2026-10-02');
  m.holiday.nombre = '<img src=x onerror=alert(1)> & "q"';
  m.holiday.chips = [{ kind: 'long', text: '<script>x</script>' }];
  const html = renderHero(m);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot;/);
});

test('renderHero: without a holiday it renders a calm fallback instead of crashing', () => {
  const html = renderHero({ mode: 'none', label: 'Próximo feriado', holiday: null, following: null, target: null });
  assert.match(html, /No encontramos el próximo feriado/);
});

test('sunSvg: 16 straight and 16 wavy rays, hidden from assistive tech', () => {
  const svg = sunSvg();
  assert.equal(count(svg, '<polygon'), 16);
  assert.equal(count(svg, '<path'), 16);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/);
});

// ---------------------------------------------------------------- renderers: long weekend card and upcoming list

test('renderLargoCard: range, days, reasons and countdown', () => {
  const html = renderLargoCard(largoModel('2026-10-02'));
  assert.match(html, /Próximo fin de semana largo/);
  assert.match(html, /sábado 10 al lunes 12 de octubre/);
  assert.match(html, /<span class="lw-num">3<\/span> días seguidos/);
  assert.match(html, /Día del Respeto a la Diversidad Cultural/);
  assert.match(html, /Empieza en 8 días/);
  assert.doesNotMatch(html, /En curso/);
  assert.doesNotMatch(html, /Incluye puente/);
});

test('renderLargoCard: in-progress and bridge badges', () => {
  const html = renderLargoCard(largoModel('2026-07-10'));
  assert.match(html, /badge badge--sol">En curso</);
  assert.match(html, /badge badge--outline">Incluye puente</);
  assert.match(html, /Termina el domingo 12 de julio/);
});

test('renderLargoCard: label says "en curso" instead of "próximo" while the weekend is in progress', () => {
  const inProgress = renderLargoCard(largoModel('2026-07-10'));
  assert.match(inProgress, /<p class="card-label">Fin de semana largo en curso<\/p>/);
  assert.doesNotMatch(inProgress, /Próximo fin de semana largo/);
  const upcoming = renderLargoCard(largoModel('2026-10-02'));
  assert.match(upcoming, /<p class="card-label">Próximo fin de semana largo<\/p>/);
});

test('renderLargoCard: null model renders nothing and reasons are escaped', () => {
  assert.equal(renderLargoCard(null), '');
  const m = largoModel('2026-10-02');
  m.motivos = ['<b>x</b>'];
  assert.doesNotMatch(renderLargoCard(m), /<b>/);
});

test('renderDespues: one list item per holiday with chip, weekday and relative time', () => {
  const html = renderDespues(inicioModel('2026-10-02').despues);
  assert.match(html, /Después de este/);
  assert.equal(count(html, '<li class="upc-item"'), 5);
  assert.match(html, /<span class="datechip-day">23<\/span><span class="datechip-mon">nov<\/span>/);
  assert.match(html, /lunes, en 52 días/);
  assert.match(html, /Trasladado desde el 20 de noviembre/);
});

test('renderDespues: empty list renders nothing; names are escaped', () => {
  assert.equal(renderDespues([]), '');
  const items = inicioModel('2026-10-02').despues.slice(0, 1);
  items[0].nombre = '<u>x</u>';
  assert.doesNotMatch(renderDespues(items), /<u>/);
});

test('renderInicio: hero, long weekend card and the list, in that order', () => {
  const html = renderInicio(inicioModel('2026-10-02'));
  const hero = html.indexOf('class="hero"');
  const lw = html.indexOf('class="lw"');
  const after = html.indexOf('class="after"');
  assert.ok(hero >= 0 && lw > hero && after > lw, 'order hero < long weekend < list');
});

test('largoModel: one tile per day, typed as holiday, bridge or plain weekend', () => {
  assert.deepEqual(largoModel('2026-10-02').tiles, [
    { fecha: '2026-10-10', weekday: 'sáb', day: 10, kind: 'weekend' },
    { fecha: '2026-10-11', weekday: 'dom', day: 11, kind: 'weekend' },
    { fecha: '2026-10-12', weekday: 'lun', day: 12, kind: 'holiday' },
  ]);
  assert.deepEqual(
    largoModel('2026-07-02').tiles.map((t) => [t.day, t.kind]),
    [
      [9, 'holiday'],
      [10, 'puente'],
      [11, 'weekend'],
      [12, 'weekend'],
    ],
  );
});

test('renderLargoCard: the tile strip is decorative (the range and reasons already say everything)', () => {
  const html = renderLargoCard(largoModel('2026-10-02'));
  assert.match(html, /<ol class="strip" aria-hidden="true">/);
  assert.equal(count(html, '<li class="tile '), 3);
  assert.match(html, /<li class="tile tile--holiday"><span class="tile-wd">lun<\/span><span class="tile-day">12<\/span><\/li>/);
  assert.match(html, /<li class="tile tile--weekend"><span class="tile-wd">sáb<\/span><span class="tile-day">10<\/span><\/li>/);
});

// ---------------------------------------------------------------- renderers: year calendar

test('renderCalendario: twelve month tables, Monday first, with accessible headers', () => {
  const html = renderCalendario(2026, feriadosDelAnio(2026), { today: '2026-10-02' });
  assert.equal(count(html, '<section class="month"'), 12);
  assert.equal(count(html, '<table class="mt"'), 12);
  assert.match(html, /<th scope="col"><abbr title="lunes">L<\/abbr><\/th>/);
  assert.match(html, /<th scope="col"><abbr title="domingo">D<\/abbr><\/th>/);
  assert.match(html, /<h3 class="month-title" id="mes-1">Enero<\/h3>/);
  assert.match(html, /<table class="mt" aria-labelledby="mes-1">/);
});

test('renderCalendario: January 2026 starts on Thursday, so three empty cells come first', () => {
  const html = renderCalendario(2026, feriadosDelAnio(2026), { today: null });
  const jan = html.slice(html.indexOf('id="mes-1"'), html.indexOf('id="mes-2"'));
  const beforeFirstDay = jan.slice(0, jan.indexOf('>1<'));
  assert.equal(count(beforeFirstDay, 'class="d is-empty"'), 3);
});

test('renderCalendario: day types are encoded as classes plus text, not only color', () => {
  const html = renderCalendario(2026, feriadosDelAnio(2026), { today: '2026-10-02' });
  assert.match(html, /<td class="d is-f">12<span class="sr-only">, feriado trasladable: Día del Respeto a la Diversidad Cultural<\/span><\/td>/);
  assert.match(html, /<td class="d is-p">10<span class="sr-only">, puente turístico: /);
});

test('renderCalendario: optional non-working days get the dotted class', () => {
  const html = renderCalendario(2027, feriadosDelAnio(2027), { today: null });
  assert.match(html, /<td class="d is-n">25<span class="sr-only">, día no laborable: Jueves Santo<\/span><\/td>/);
});

test('renderCalendario: weekends are muted and today is marked for assistive tech', () => {
  const html = renderCalendario(2026, feriadosDelAnio(2026), { today: '2026-10-02' });
  assert.match(html, /<td class="d is-we">3<\/td>/, 'Saturday 3 October');
  assert.match(html, /<td class="d is-today" aria-current="date">2<\/td>/);
});

test('renderCalendario: each month lists its holidays by name and says when one is not a plain holiday', () => {
  const html = renderCalendario(2026, feriadosDelAnio(2026), { today: null });
  assert.match(html, /<span class="ml-day">12<\/span> <span class="ml-text"><span class="ml-name">Día del Respeto a la Diversidad Cultural<\/span><\/span>/);
  assert.match(html, /<span class="ml-name">Día no laborable con fines turísticos<\/span><span class="ml-type"> \(puente turístico\)<\/span>/);
});

test('renderCalendario: the type note is dropped when the name already says it', () => {
  const list = [{ fecha: '2026-07-10', nombre: 'Puente turístico no laborable', tipo: 'puente' }];
  const html = renderCalendario(2026, list, { today: null });
  assert.match(html, /<span class="ml-name">Puente turístico no laborable<\/span><\/span><\/li>/);
});

test('renderCalendario: a month without holidays says so', () => {
  const html = renderCalendario(2026, feriadosDelAnio(2026), { today: null });
  const sep = html.slice(html.indexOf('id="mes-9"'), html.indexOf('id="mes-10"'));
  assert.match(sep, /Sin feriados\./);
});

test('renderCalendario: escapes holiday names from external data', () => {
  const list = [{ fecha: '2026-03-10', nombre: '<svg onload=x>', tipo: 'inamovible' }];
  const html = renderCalendario(2026, list, { today: null });
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /&lt;svg onload=x&gt;/);
});

// ---------------------------------------------------------------- renderers: long weekends list

test('renderLargos: past rows are dimmed and announced, the current one and the next one are badged', () => {
  const html = renderLargos(finesDeSemanaLargos(2026), { today: '2026-07-10', nextDesde: '2026-08-15' });
  assert.match(html, /<li class="row lw-row is-past" data-desde="2026-02-14">/);
  assert.match(html, /<span class="sr-only"> \(ya pasó\)<\/span>/);
  assert.match(html, /<li class="row lw-row is-current" data-desde="2026-07-09">/);
  assert.match(html, /badge badge--sol">En curso</);
  assert.match(html, /<li class="row lw-row is-next" data-desde="2026-08-15">/);
  assert.match(html, /badge badge--sol">Próximo</);
});

test('renderLargos: bridge badge, range label, days and reasons', () => {
  const html = renderLargos(finesDeSemanaLargos(2026), { today: '2026-01-01', nextDesde: '2026-02-14' });
  const row = html.slice(html.indexOf('data-desde="2026-07-09"'), html.indexOf('data-desde="2026-08-15"'));
  assert.match(row, /jueves 9 al domingo 12 de julio/);
  assert.match(row, /4 días seguidos/);
  assert.match(row, /badge badge--outline">Incluye puente</);
  assert.match(row, /Día de la Independencia/);
});

test('renderLargos: a future year has no past rows and an empty list says so', () => {
  const html = renderLargos(finesDeSemanaLargos(2027), { today: '2026-10-02', nextDesde: '2026-10-10' });
  assert.doesNotMatch(html, /is-past/);
  assert.match(renderLargos([], { today: '2026-10-02', nextDesde: null }), /No hay fines de semana largos/);
});

test('renderLargos: escapes reasons', () => {
  const list = [{ desde: '2026-05-01', hasta: '2026-05-03', dias: 3, motivos: ['<i>x</i>'], incluyePuente: false }];
  assert.doesNotMatch(renderLargos(list, { today: null, nextDesde: null }), /<i>/);
});
