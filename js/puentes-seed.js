// Offline fallback ONLY (first visit with no network). The source of truth for bridges ("puentes
// turísticos") is the ArgentinaDatos API, see data-source.js: when it responds, its list replaces the
// entries below for that year. 2025 and 2026 were taken from the live API; 2023 and 2024 from the
// official decrees. Years without a decree yet (2027+) are intentionally absent: nothing is invented.
export const PUENTES_SEED = {
  2023: ['2023-05-26', '2023-06-19', '2023-10-13'],
  2024: ['2024-04-01', '2024-06-21', '2024-10-11'],
  2025: ['2025-05-02', '2025-08-15', '2025-10-10', '2025-11-21'],
  2026: ['2026-03-23', '2026-07-10', '2026-12-07'],
};
