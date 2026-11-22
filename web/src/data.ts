// Data model + transforms. Everything is keyed by "day numbers" (UTC days since epoch)
// so date math is integer math.

export interface RawRow {
  d: string; c: number; a: number; r: number; loc: number; size: number;
  langs?: Record<string, number>;
}
export interface RawRepo {
  name: string; private: boolean; language: string | null; description: string | null;
  created_at: string | null; pushed_at: string | null; archived: boolean; default_branch: string;
  first_day: string; total_commits: number; series: RawRow[]; tags: { name: string; d: string }[];
}
export interface Dataset { generated_at: string; tz: string; owner: string; repos: RawRepo[] }

export type Metric = "commits" | "loc" | "size";
export type Mode = "cumulative" | "period";

export const DAY_MS = 86_400_000;
export const toDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
export const fromDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const todayIn = (tz: string) =>
  toDay(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));

/** A repo expanded to dense daily arrays over [day0, day1]. */
export interface Prepared {
  name: string;
  raw: RawRepo;
  born: number;            // first day with data
  commits: Float64Array;   // commits that day
  cumCommits: Float64Array;
  loc: Float64Array;       // NaN before born
  size: Float64Array;      // NaN before born
  added: Float64Array;
  removed: Float64Array;
  langsAt: (day: number) => Record<string, number>;
  color: string | null;    // categorical slot, null = neutral
  slot: number;            // 0..7, -1 = neutral
}

export interface Universe {
  day0: number; day1: number; tz: string; generatedAt: string; owner: string;
  repos: Prepared[];
}

export function prepare(ds: Dataset, palette: string[]): Universe {
  const tz = ds.tz || "Africa/Johannesburg";
  const day1 = Math.max(todayIn(tz), ...ds.repos.map((r) => toDay(r.series.at(-1)?.d ?? r.first_day)));
  const day0 = Math.min(day1, ...ds.repos.map((r) => toDay(r.first_day)));
  const n = day1 - day0 + 1;

  const repos: Prepared[] = ds.repos.filter((r) => r.series.length).map((r) => {
    const commits = new Float64Array(n), cum = new Float64Array(n);
    const loc = new Float64Array(n).fill(NaN), size = new Float64Array(n).fill(NaN);
    const added = new Float64Array(n), removed = new Float64Array(n);
    const langSnaps: { day: number; langs: Record<string, number> }[] = [];
    for (const row of r.series) {
      const i = toDay(row.d) - day0;
      if (i < 0 || i >= n) continue;
      commits[i] += row.c; added[i] += row.a; removed[i] += row.r;
      loc[i] = row.loc; size[i] = row.size;
      if (row.langs) langSnaps.push({ day: i + day0, langs: row.langs });
    }
    const born = toDay(r.series[0].d);
    let c = 0, l = NaN, s = NaN;
    for (let i = 0; i < n; i++) {
      c += commits[i]; cum[i] = c;
      if (!Number.isNaN(loc[i])) { l = loc[i]; s = size[i]; }
      else if (i + day0 >= born) { loc[i] = Number.isNaN(l) ? 0 : l; size[i] = Number.isNaN(s) ? 0 : s; }
    }
    const langsAt = (day: number) => {
      let best: Record<string, number> = {};
      for (const snap of langSnaps) { if (snap.day <= day) best = snap.langs; else break; }
      return best;
    };
    return { name: r.name, raw: r, born, commits, cumCommits: cum, loc, size, added, removed, langsAt, color: null, slot: -1 };
  });

  // Stable colour assignment (follows the entity, never the current filter):
  // the 8 repos with the most commits in the dataset's final 365 days get the 8 slots.
  const recent = (p: Prepared) => {
    let s = 0; for (let i = Math.max(0, n - 365); i < n; i++) s += p.commits[i]; return s;
  };
  [...repos]
    .sort((a, b) => recent(b) - recent(a) || (b.loc[n - 1] || 0) - (a.loc[n - 1] || 0))
    .slice(0, palette.length)
    .forEach((p, i) => { p.slot = i; });
  repos.forEach((p) => { p.color = p.slot >= 0 ? palette[p.slot] : null; });

  return { day0, day1, tz, generatedAt: ds.generated_at, owner: ds.owner, repos };
}

export interface ViewSeries {
  repo: Prepared;
  values: Float64Array;   // aligned with xs; NaN = not born yet
  runMax: Float64Array;   // running max of values (for animated y-scale)
}
export interface View {
  metric: Metric; mode: Mode;
  from: number; to: number;
  xs: Float64Array;       // day numbers (daily, or week starts in period mode)
  step: number;           // days per x step
  series: ViewSeries[];
  total: ViewSeries | null;
}

function runningMax(v: Float64Array) {
  const out = new Float64Array(v.length);
  let m = 0;
  for (let i = 0; i < v.length; i++) { if (!Number.isNaN(v[i])) m = Math.max(m, v[i]); out[i] = m; }
  return out;
}

export function buildView(u: Universe, visible: Prepared[], metric: Metric, mode: Mode,
                          from: number, to: number, withTotal: boolean): View {
  from = Math.max(from, u.day0); to = Math.min(to, u.day1);
  if (to < from) to = from;
  const idx = (day: number) => day - u.day0;
  let xs: number[] = [];
  const series: ViewSeries[] = [];

  if (mode === "cumulative") {
    for (let d = from; d <= to; d++) xs.push(d);
    for (const p of visible) {
      const src = metric === "commits" ? p.cumCommits : metric === "loc" ? p.loc : p.size;
      const v = new Float64Array(xs.length);
      xs.forEach((d, i) => { v[i] = d < p.born ? NaN : src[idx(d)]; });
      series.push({ repo: p, values: v, runMax: runningMax(v) });
    }
  } else {
    // ISO weeks (Mon start). Value = commits in week, or net change of loc/size in week.
    const dow = (d: number) => (new Date(d * DAY_MS).getUTCDay() + 6) % 7;
    const start = from - dow(from);
    for (let d = start; d <= to; d += 7) xs.push(d);
    for (const p of visible) {
      const v = new Float64Array(xs.length);
      xs.forEach((w, i) => {
        const a = Math.max(w, from), b = Math.min(w + 6, to);
        if (b < p.born) { v[i] = NaN; return; }
        if (metric === "commits") {
          let s = 0; for (let d = a; d <= b; d++) s += p.commits[idx(d)]; v[i] = s;
        } else {
          const src = metric === "loc" ? p.loc : p.size;
          const end = src[idx(b)];
          const before = a - 1 >= u.day0 ? src[idx(a - 1)] : NaN;
          v[i] = (Number.isNaN(end) ? 0 : end) - (Number.isNaN(before) ? 0 : before);
        }
      });
      series.push({ repo: p, values: v, runMax: runningMax(v) });
    }
  }

  let total: ViewSeries | null = null;
  if (withTotal && series.length > 1) {
    const v = new Float64Array(xs.length).fill(NaN);
    for (const s of series) s.values.forEach((x, i) => {
      if (!Number.isNaN(x)) v[i] = (Number.isNaN(v[i]) ? 0 : v[i]) + x;
    });
    total = { repo: null as unknown as Prepared, values: v, runMax: runningMax(v) };
  }
  return { metric, mode, from, to, xs: Float64Array.from(xs), step: mode === "period" ? 7 : 1, series, total };
}

/** Value of a series at fractional x position (index space), linearly interpolated. */
export function valueAt(s: ViewSeries, fi: number): number {
  const i = Math.floor(fi), t = fi - i;
  const a = s.values[Math.max(0, Math.min(s.values.length - 1, i))];
  const b = s.values[Math.max(0, Math.min(s.values.length - 1, i + 1))];
  if (Number.isNaN(a)) return NaN;
  if (Number.isNaN(b) || t === 0) return a;
  return a + (b - a) * t;
}

// ---------------------------------------------------------------- range stats (KPI tiles)
export interface Kpis {
  commits: number; netLines: number; added: number; removed: number;
  sizeDelta: number; activeDays: number; longestStreak: number; currentStreak: number;
  busiestDay: { day: number; commits: number } | null;
  topRepo: { name: string; commits: number } | null;
  newRepos: number;
}

export function kpis(u: Universe, visible: Prepared[], from: number, to: number): Kpis {
  from = Math.max(from, u.day0); to = Math.min(to, u.day1);
  const n = to - from + 1;
  const perDay = new Float64Array(Math.max(n, 0));
  let added = 0, removed = 0, sizeDelta = 0, top: Kpis["topRepo"] = null, newRepos = 0;
  for (const p of visible) {
    let rc = 0;
    for (let d = from; d <= to; d++) {
      const i = d - u.day0;
      perDay[d - from] += p.commits[i]; rc += p.commits[i];
      added += p.added[i]; removed += p.removed[i];
    }
    const sEnd = p.size[to - u.day0], sStart = from - 1 >= u.day0 ? p.size[from - 1 - u.day0] : NaN;
    sizeDelta += (Number.isNaN(sEnd) ? 0 : sEnd) - (Number.isNaN(sStart) ? 0 : sStart);
    if (p.born >= from && p.born <= to) newRepos++;
    if (rc > 0 && (!top || rc > top.commits)) top = { name: p.name, commits: rc };
  }
  let active = 0, run = 0, longest = 0, busiest: Kpis["busiestDay"] = null, commits = 0;
  perDay.forEach((c, i) => {
    commits += c;
    if (c > 0) { active++; run++; longest = Math.max(longest, run); } else run = 0;
    if (c > 0 && (!busiest || c > busiest.commits)) busiest = { day: from + i, commits: c };
  });
  let current = 0;
  for (let i = perDay.length - 1; i >= 0 && perDay[i] > 0; i--) current++;
  return { commits, netLines: added - removed, added, removed, sizeDelta, activeDays: active,
           longestStreak: longest, currentStreak: current, busiestDay: busiest, topRepo: top, newRepos };
}

export function commitsPerDay(u: Universe, visible: Prepared[], from: number, to: number) {
  const out: { day: number; c: number; byRepo: [string, number][] }[] = [];
  for (let d = Math.max(from, u.day0); d <= Math.min(to, u.day1); d++) {
    const byRepo: [string, number][] = [];
    let c = 0;
    for (const p of visible) { const x = p.commits[d - u.day0]; if (x) { c += x; byRepo.push([p.name, x]); } }
    byRepo.sort((a, b) => b[1] - a[1]);
    out.push({ day: d, c, byRepo });
  }
  return out;
}

export function languageMix(u: Universe, visible: Prepared[], day: number) {
  const tot: Record<string, number> = {};
  for (const p of visible) {
    if (day < p.born) continue;
    for (const [k, v] of Object.entries(p.langsAt(day))) tot[k] = (tot[k] ?? 0) + v;
  }
  return Object.entries(tot).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- formatting
const nf = new Intl.NumberFormat("en-GB");
export const fmtInt = (v: number) => nf.format(Math.round(v)).replace(/ /g, " ");
export function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.0+$/, "")}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return fmtInt(v);
}
const isRound = (v: number) => { const a = Math.abs(v); const u = a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : 1e3; return a > 0 && Math.abs(a / u - Math.round(a / u)) < 1e-9; };
export function fmtBytes(v: number, digits = 1): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(digits === 0 ? 0 : 2)} GB`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e8 ? 0 : digits)} MB`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} KB`;
  return `${Math.round(v)} B`;
}
export function fmtMetric(metric: Metric, v: number, compact = false): string {
  if (Number.isNaN(v)) return "–";
  if (metric === "size") return compact && isRound(v) ? fmtBytes(v, 0).replace(/\.0+ /, " ") : fmtBytes(v);
  return compact ? fmtCompact(v) : fmtInt(v);
}
export const fmtSigned = (s: string, v: number) => (v > 0 ? `+${s}` : v < 0 ? `−${s.replace("-", "")}` : s);

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthYearFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export const fmtDate = (day: number) => dateFmt.format(new Date(day * DAY_MS));
export const fmtMonth = (day: number) => monthFmt.format(new Date(day * DAY_MS));
export const fmtMonthYear = (day: number) => monthYearFmt.format(new Date(day * DAY_MS));

export const METRIC_LABEL: Record<Metric, string> = { commits: "Commits", loc: "Lines of code", size: "Repo size" };
export const METRIC_UNIT: Record<Metric, string> = { commits: "commits", loc: "lines", size: "" };
