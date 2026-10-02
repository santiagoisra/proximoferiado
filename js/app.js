// DOM controller: tabs, year navigation, URL state, data refresh and the daily re-render.
// All markup comes from render.js (escaped strings); the logic worth testing lives in render.js / view-state.js.
import { todayAR, year as yearOf } from './dates.js';
import { applyCached, refresh } from './data-source.js';
import { feriadosDelAnio, feriadosEn, finesDeSemanaLargos, toIcs } from './feriados.js';
import {
  heroModel,
  inicioModel,
  proximoInicioLargo,
  proyeccionAviso,
  renderCalendario,
  renderInicio,
  renderLargos,
  shareText,
} from './render.js';
import {
  MIN_YEAR,
  VIEWS,
  YEARS_AHEAD,
  clampYear,
  msUntilNextArgentineMidnight,
  nextTabIndex,
  parseUrlState,
  serializeUrlState,
  statusMessage,
  yearStep,
} from './view-state.js';

const $ = (id) => document.getElementById(id);

const state = {
  today: todayAR(),
  thisYear: 0,
  view: 'inicio',
  year: 0,
  data: { status: 'pending', updatedAt: null },
};
state.thisYear = yearOf(state.today);

// Last markup written to each root: identical output is skipped so focus and animations are not reset.
const lastHtml = new Map();
function paint(root, html) {
  if (lastHtml.get(root.id) === html) return;
  lastHtml.set(root.id, html);
  root.innerHTML = html;
}

// ---------------------------------------------------------------- rendering

function renderYearbar() {
  $('yearbar').hidden = state.view === 'inicio';
  $('year-label').textContent = String(state.year);
  const atMin = state.year <= MIN_YEAR;
  const atMax = state.year >= state.thisYear + YEARS_AHEAD;
  $('year-prev').setAttribute('aria-disabled', String(atMin));
  $('year-next').setAttribute('aria-disabled', String(atMax));
  const notice = $('year-notice');
  const text = state.view === 'inicio' ? '' : proyeccionAviso(state.year, state.thisYear, feriadosDelAnio(state.year));
  notice.textContent = text;
  notice.hidden = !text;
}

function renderActive() {
  renderYearbar();
  if (state.view === 'inicio') {
    paint($('inicio-root'), renderInicio(inicioModel(state.today)));
  } else if (state.view === 'calendario') {
    paint($('calendario-root'), renderCalendario(state.year, feriadosDelAnio(state.year), { today: state.today }));
  } else {
    paint($('largos-root'), renderLargos(finesDeSemanaLargos(state.year), { today: state.today, nextDesde: proximoInicioLargo(state.today) }));
  }
}

function renderStatus() {
  $('data-status').textContent = statusMessage(state.data);
}

// ---------------------------------------------------------------- view and URL

const tabs = () => [...document.querySelectorAll('[role="tab"]')];

function syncUrl() {
  try {
    history.replaceState(null, '', location.pathname + serializeUrlState(state, state.thisYear) + location.hash);
  } catch {
    /* some embedded contexts forbid it: the URL is a convenience */
  }
}

function setView(view) {
  state.view = view;
  for (const tab of tabs()) {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`panel-${tab.dataset.view}`).hidden = !selected;
  }
  syncUrl();
  renderActive();
}

function setYear(y) {
  if (y === state.year) return;
  state.year = y;
  syncUrl();
  renderActive();
}

// ---------------------------------------------------------------- actions

let toastTimer;
function say(message) {
  const toast = $('toast');
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.textContent = '';
  }, 4500);
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addToCalendar(fecha) {
  const holiday = feriadosEn(fecha).find((f) => f.tipo === 'inamovible' || f.tipo === 'trasladable') ?? feriadosEn(fecha)[0];
  if (!holiday) return;
  download(toIcs([holiday], holiday.nombre), `feriado-${fecha}.ics`);
  say('Descargamos el evento. Abrilo para agregarlo a tu calendario.');
}

async function share() {
  const text = shareText(heroModel(state.today));
  const url = location.origin + location.pathname;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Próximo feriado en Argentina', text, url });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    say('Enlace copiado al portapapeles.');
  } catch {
    say('No pudimos copiar el enlace. Copialo desde la barra de direcciones.');
  }
}

// ---------------------------------------------------------------- events

function bindEvents() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tab = target.closest('[role="tab"]');
    if (tab) return setView(tab.dataset.view);

    const step = target.closest('[data-year-step]');
    if (step) {
      if (step.getAttribute('aria-disabled') === 'true') return;
      return setYear(yearStep(state.year, Number(step.dataset.yearStep), state.thisYear));
    }

    const action = target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'add-ics') addToCalendar(action.dataset.fecha);
    else if (action.dataset.action === 'share') share();
    else if (action.dataset.action === 'download-year') {
      download(toIcs(feriadosDelAnio(state.year), `Feriados Argentina ${state.year}`), `feriados-argentina-${state.year}.ics`);
      say(`Descargamos el calendario ${state.year}.`);
    }
  });

  $('tab-inicio').parentElement.addEventListener('keydown', (event) => {
    const list = tabs();
    const current = list.indexOf(document.activeElement);
    if (current < 0) return;
    const next = nextTabIndex(event.key, current, list.length);
    if (next === null) return;
    event.preventDefault();
    list[next].focus();
    setView(list[next].dataset.view);
  });

  window.addEventListener('focus', checkDay);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkDay();
      refreshData();
    }
  });
}

// ---------------------------------------------------------------- data and clock

async function refreshData() {
  const forYear = state.thisYear;
  try {
    const result = await refresh(forYear);
    if (forYear !== state.thisYear) return; // the day rolled into a new year while waiting
    state.data = { status: result.status, updatedAt: result.updatedAt };
    renderStatus();
    if (result.changed) renderActive();
  } catch {
    state.data = { status: 'offline', updatedAt: state.data.updatedAt };
    renderStatus();
  }
}

let midnightTimer;
function scheduleMidnight() {
  clearTimeout(midnightTimer);
  // One extra second so the callback never fires just before the Argentine date flips.
  midnightTimer = setTimeout(checkDay, msUntilNextArgentineMidnight(Date.now()) + 1000);
}

/** Re-renders when the Argentine date changed (installed PWAs can stay open for days). */
function checkDay() {
  const today = todayAR();
  if (today !== state.today) {
    const previousYear = state.thisYear;
    state.today = today;
    state.thisYear = yearOf(today);
    if (state.thisYear !== previousYear) {
      state.year = clampYear(state.year === previousYear ? state.thisYear : state.year, state.thisYear);
      applyCached(state.thisYear);
      refreshData();
    }
    renderActive();
  }
  scheduleMidnight();
}

// ---------------------------------------------------------------- boot

function boot() {
  const initial = parseUrlState(location.search, state.thisYear);
  state.year = initial.year;

  // 1) Last-good data from localStorage, synchronously, so the first paint is already correct.
  applyCached(state.thisYear);

  // 2) Paint immediately; the network never blocks rendering.
  const inicio = $('inicio-root');
  inicio.dataset.enter = '';
  bindEvents();
  setView(VIEWS.includes(initial.view) ? initial.view : 'inicio');
  renderStatus();
  setTimeout(() => inicio.removeAttribute('data-enter'), 1200);

  // 3) Then verify against the API and repaint only if something changed.
  refreshData();
  scheduleMidnight();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
