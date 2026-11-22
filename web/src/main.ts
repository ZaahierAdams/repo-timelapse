import "./style.css";
import { createClient, type User } from "@supabase/supabase-js";
import {
  buildView, commitsPerDay, fmtBytes, fmtCompact, fmtDate, fmtInt, fmtMetric, fmtMonth, fmtSigned, fromDay,
  kpis, languageMix, METRIC_LABEL, prepare, toDay, valueAt,
  type Dataset, type Metric, type Mode, type Prepared, type Universe, type View,
} from "./data";
import { drawFrame, indexFromX, logFloor, yTarget, type FrameOpts, type Layout, type Theme } from "./chart";
import { bestVideoType, download, exportPNG, exportSVG, recordVideo } from "./export";

// ---------------------------------------------------------------- config
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://kseznvlerqpdbabnxrja.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_K7TTcCndu0D0zieZrCTIeQ_n187w5rn";
const ALLOWED_EMAIL = "zaahier.ada@gmail.com";
const DEFAULT_FROM = "2026-05-01";
const CREDIT = "Repo Timelapse · github.com/ZaahierAdams";

// Categorical palette (validated set; slot order is the CVD-safety mechanism — don't reorder).
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
};

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "repo-timelapse-auth" },
});

const app = document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ICON = {
  mark: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--surface-2)" stroke="var(--ring-strong)"/><path d="M6 23 L12 16 L17 19 L26 8" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="8" r="2.8" fill="var(--ink)"/></svg>`,
  google: `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`,
  play: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>`,
  restart: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5V5h2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  loop: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 7V6a2 2 0 0 1 2-2h8l-2-2M13.5 9v1a2 2 0 0 1-2 2h-8l2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  download: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  calendar: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  sun: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  moon: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  out: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13h2M10 5l3 3-3 3M13 8H6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

// ---------------------------------------------------------------- gate screens
function gate(inner: string) {
  app.innerHTML = `<main class="gate"><div class="gate-card">${inner}</div></main>`;
}
function renderLoading(msg = "Loading your repos…") {
  gate(`<div class="spinner"></div><p style="margin:16px 0 0">${esc(msg)}</p>`);
}
function renderSignIn(note = "") {
  gate(`
    <div class="gate-mark">${ICON.mark}</div>
    <h1>Repo Timelapse</h1>
    <p>Commits, lines of code and repo size across every repo, animated over time.</p>
    <button class="btn-google" id="g">${ICON.google}<span>Continue with Google</span></button>
    <div class="gate-foot">${note ? esc(note) : "Private dashboard. Only the owner's Google account can see the data."}</div>`);
  document.getElementById("g")!.onclick = async () => {
    const redirectTo = location.origin + import.meta.env.BASE_URL;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account", login_hint: ALLOWED_EMAIL } },
    });
    if (error) renderSignIn(error.message);
  };
}
function renderDenied(email: string | undefined) {
  gate(`
    <div class="gate-mark">${ICON.mark}</div>
    <h1>This dashboard is private</h1>
    <p>${email ? `You're signed in as <b>${esc(email)}</b>, which doesn't have access.` : "This account doesn't have access."}</p>
    <button class="btn-google" id="so">Sign in with a different account</button>`);
  document.getElementById("so")!.onclick = async () => { await sb.auth.signOut(); renderSignIn(); };
}
function renderError(msg: string) {
  gate(`<h1>Something went wrong</h1><p>${esc(msg)}</p><button class="btn-google" id="rt">Try again</button>`);
  document.getElementById("rt")!.onclick = () => location.reload();
}

// ---------------------------------------------------------------- boot
async function boot() {
  renderLoading("Checking sign-in…");
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("local")) {
    const ds = (await (await fetch(`${import.meta.env.BASE_URL}__local/stats.json`)).json()) as Dataset;
    return start(ds, null);
  }
  const { data: { session }, error } = await sb.auth.getSession();
  if (error) return renderSignIn(error.message);
  if (!session) return renderSignIn();
  const email = session.user.email?.toLowerCase();
  if (email !== ALLOWED_EMAIL) return renderDenied(email);
  renderLoading();
  const res = await sb.rpc("repo_timelapse_get");
  if (res.error) {
    if (res.error.code === "42501") return renderDenied(email);
    return renderError(res.error.message);
  }
  const payload = res.data as { data: Dataset } | null;
  if (!payload?.data) return renderError("No stats yet. The nightly collector hasn't run.");
  // tidy the URL after the OAuth redirect
  if (location.search.includes("code=")) history.replaceState(null, "", location.pathname);
  start(payload.data, session.user);
}
sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT") renderSignIn(); });
boot().catch((e) => renderError(String(e?.message ?? e)));

// ---------------------------------------------------------------- app state
type ViewKind = "animated" | "static";
type Preset = "default" | "30d" | "90d" | "ytd" | "12m" | "all" | "custom";
interface State {
  metric: Metric; mode: Mode; preset: Preset; from: number; to: number;
  log: boolean; total: boolean; idle: boolean; view: ViewKind; hidden: Set<string>; speed: number; loop: boolean;
}
const PRESETS: { id: Preset; label: string }[] = [
  { id: "default", label: "Since May 2026" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "12m", label: "Last 12 months" },
  { id: "all", label: "All time" },
];
function resolvePreset(p: Preset, u: Universe, st: State): [number, number] {
  const t = u.day1;
  const y = new Date(t * 86_400_000).getUTCFullYear();
  switch (p) {
    case "default": return [toDay(DEFAULT_FROM), t];
    case "30d": return [t - 29, t];
    case "90d": return [t - 89, t];
    case "ytd": return [toDay(`${y}-01-01`), t];
    case "12m": return [t - 364, t];
    case "all": return [u.day0, t];
    default: return [st.from, st.to];
  }
}

function readState(u: Universe): State {
  const q = new URLSearchParams(location.search);
  const st: State = {
    metric: (["commits", "loc", "size"].includes(q.get("m") ?? "") ? q.get("m") : "loc") as Metric,
    mode: q.get("mode") === "w" ? "period" : "cumulative",
    preset: (q.get("p") as Preset) || "default",
    from: 0, to: 0,
    log: q.get("log") === "1", total: q.get("tot") === "1", idle: q.get("idle") === "1",
    view: q.get("v") === "s" ? "static" : "animated",
    hidden: new Set((q.get("h") ?? "").split(",").filter(Boolean)),
    speed: Number(q.get("spd")) || 1, loop: q.get("loop") === "1",
  };
  if (!PRESETS.some((p) => p.id === st.preset) && st.preset !== "custom") st.preset = "default";
  if (st.preset === "custom" && q.get("from") && q.get("to")) { st.from = toDay(q.get("from")!); st.to = toDay(q.get("to")!); }
  else { if (st.preset === "custom") st.preset = "default"; [st.from, st.to] = resolvePreset(st.preset, u, st); }
  return st;
}
function writeState(st: State) {
  const q = new URLSearchParams();
  if (st.metric !== "loc") q.set("m", st.metric);
  if (st.mode === "period") q.set("mode", "w");
  if (st.preset !== "default") q.set("p", st.preset);
  if (st.preset === "custom") { q.set("from", fromDay(st.from)); q.set("to", fromDay(st.to)); }
  if (st.log) q.set("log", "1");
  if (st.total) q.set("tot", "1");
  if (st.idle) q.set("idle", "1");
  if (st.view === "static") q.set("v", "s");
  if (st.hidden.size) q.set("h", [...st.hidden].join(","));
  if (st.speed !== 1) q.set("spd", String(st.speed));
  if (st.loop) q.set("loop", "1");
  if (new URLSearchParams(location.search).has("local")) q.set("local", "1");
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? `?${s}` : ""));
}

// ---------------------------------------------------------------- theme
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    dark: isDark(), surface: v("--surface"), plane: v("--plane"), ink: v("--ink"), ink2: v("--ink-2"),
    muted: v("--muted"), grid: v("--grid"), axis: v("--axis"), neutralSeries: v("--muted"), ring: v("--ring"),
  };
}

// ---------------------------------------------------------------- the app
function start(ds: Dataset, user: User | null) {
  const u = prepare(ds, isDark() ? PALETTE.dark : PALETTE.light);
  const st = readState(u);
  let theme = readTheme();

  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">${ICON.mark}<span>Repo Timelapse</span></div>
      <div class="spacer"></div>
      <span class="updated" id="updated"></span>
      <button class="icon-btn" id="themeBtn" title="Toggle light / dark" aria-label="Toggle theme"></button>
      ${user ? `<div class="user">${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ""}
        <button class="icon-btn" id="signOut" title="Sign out" aria-label="Sign out">${ICON.out}</button></div>` : ""}
    </header>

    <div class="filters" role="toolbar" aria-label="Chart controls">
      <div class="seg" id="metricSeg" role="group" aria-label="Metric">
        <button data-v="commits">Commits</button><button data-v="loc">Lines of code</button><button data-v="size">Repo size</button>
      </div>
      <div class="seg" id="modeSeg" role="group" aria-label="Aggregation">
        <button data-v="cumulative">Cumulative</button><button data-v="period">Per week</button>
      </div>
      <div class="range">
        <button class="range-btn" id="rangeBtn" aria-haspopup="dialog">${ICON.calendar}<span id="rangeLabel"></span></button>
        <div class="popover" id="rangePop" hidden role="dialog" aria-label="Date range">
          <div id="presetList"></div>
          <div class="custom">
            <label>From <input type="date" id="fromIn"></label>
            <label>To <input type="date" id="toIn"></label>
            <button class="btn" id="applyRange">Apply custom range</button>
          </div>
        </div>
      </div>
      <button class="chip-toggle" id="logT"><span class="box"></span>Log scale</button>
      <button class="chip-toggle" id="totT"><span class="box"></span>All-repos total</button>
      <div class="grow"></div>
      <div class="seg" id="viewSeg" role="group" aria-label="View">
        <button data-v="animated">Animated</button><button data-v="static">Static</button>
      </div>
    </div>

    <section class="kpis" id="kpis" aria-label="Summary for the selected range"></section>

    <section class="card chart-card">
      <div class="chart-wrap" id="wrap">
        <canvas id="cv" role="img" aria-label="Line chart"></canvas>
        <div class="tooltip" id="tip" hidden></div>
      </div>
      <div class="player" id="player">
        <button class="play-btn" id="playBtn" aria-label="Play"></button>
        <button class="icon-btn restart" id="restartBtn" title="Restart (Home)" aria-label="Restart">${ICON.restart}</button>
        <div class="scrub"><input type="range" id="scrub" min="0" max="1000" value="0" step="1" aria-label="Timeline position"></div>
        <span class="static-note" id="staticNote">Hover the chart for exact values on any day.</span>
        <span class="date" id="pDate"></span>
        <select class="speed" id="speed" aria-label="Playback speed">
          <option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
        </select>
        <button class="icon-btn loop" id="loopBtn" title="Loop" aria-label="Loop" aria-pressed="false">${ICON.loop}</button>
        <div class="menu">
          <button class="icon-btn" id="exportBtn" title="Export" aria-label="Export" aria-haspopup="menu">${ICON.download}</button>
          <div class="popover" id="exportPop" hidden role="menu">
            <div class="menu-label">Image</div>
            <button class="menu-item" data-x="png">PNG <small>3200×1800</small></button>
            <button class="menu-item" data-x="svg">SVG <small>vector</small></button>
            <div class="menu-sep"></div>
            <div class="menu-label">Animated video</div>
            <button class="menu-item" data-x="v169">Landscape 16:9 <small>1920×1080</small></button>
            <button class="menu-item" data-x="v11">Square 1:1 <small>1080×1080</small></button>
            <button class="menu-item" data-x="v916">Vertical 9:16 <small>1080×1920</small></button>
            <div class="menu-sep"></div>
            <button class="menu-item" data-x="csv">Data (CSV)</button>
          </div>
        </div>
      </div>
    </section>

    <div class="legend-head">
      <h2>Repositories</h2><span class="muted" id="legendNote" style="font-size:12px"></span>
      <div class="spacer"></div>
      <button class="link-btn" id="idleBtn"></button>
      <button class="link-btn" id="allBtn">Show all</button>
      <button class="link-btn" id="noneBtn">Hide all</button>
    </div>
    <div class="legend" id="legend"></div>

    <section class="panels">
      <div class="card panel">
        <h3>Language mix</h3>
        <div class="panel-sub" id="langSub"></div>
        <div id="langs"></div>
      </div>
      <div class="card panel">
        <h3>Daily commits</h3>
        <div class="panel-sub" id="heatSub"></div>
        <div class="heat-wrap">
          <div class="heat-days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
          <div class="heat-scroll"><div class="heat" id="heat"></div></div>
        </div>
        <div class="heat-legend">Less <span class="cell" style="background:var(--heat-0)"></span><span class="cell" style="background:var(--heat-1)"></span><span class="cell" style="background:var(--heat-2)"></span><span class="cell" style="background:var(--heat-3)"></span><span class="cell" style="background:var(--heat-4)"></span> More</div>
      </div>
    </section>

    <details class="card table-view">
      <summary>Data table &amp; how it's measured</summary>
      <div class="tbl-wrap"><table id="tbl"></table></div>
      <div class="notes">
        <b>Commits</b> are non-merge commits on any branch, dated by author time (${esc(u.tz)}).
        <b>Lines of code</b> count lines in source files on the default branch (TypeScript, JavaScript, Python, Kotlin, Java, Swift, Dart, C#, SQL, HTML, CSS and more). Lockfiles, minified or generated files, build output, <code>node_modules</code>, hidden folders and scratch folders like <code>_to_delete</code> are excluded.
        <b>Repo size</b> is the total size of all tracked files on the default branch, including assets.
        Data is collected nightly by a GitHub Action that replays each repo's full git history.
      </div>
    </details>
  </div>
  <div class="modal-back" id="modal" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h3 id="mTitle">Recording video…</h3>
      <p id="mText">Keep this tab open and visible while it records in real time.</p>
      <div class="progress"><div id="mBar"></div></div>
      <button class="btn ghost" id="mCancel">Cancel</button>
    </div>
  </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $<HTMLCanvasElement>("cv");
  const ctx = canvas.getContext("2d")!;
  const wrap = $("wrap"), tip = $("tip");
  const scrub = $<HTMLInputElement>("scrub");

  // ---------------------------------------------------------------- derived
  let view!: View;
  let candidates: Prepared[] = [];   // repos that exist in range (and are active unless idle shown)
  let idleCount = 0;
  let cursor = 0, yAnim = 1, playing = false, holdT = 0, hoverIndex: number | null = null;
  let W = 800, H = 440, L: Layout | null = null, raf = 0, lastTs = 0, lastUi = 0;

  const activeInRange = (p: Prepared) => {
    if (p.born > st.to) return false;
    for (let d = Math.max(st.from, u.day0); d <= Math.min(st.to, u.day1); d++) {
      const i = d - u.day0;
      if (p.commits[i] > 0 || p.added[i] > 0 || p.removed[i] > 0) return true;
    }
    return false;
  };
  const visible = () => candidates.filter((p) => !st.hidden.has(p.name));
  const daysPerSecond = () => {
    const span = Math.max(1, st.to - st.from);
    return (span / Math.min(40, Math.max(8, span * 0.075))) * st.speed;
  };
  const cursorDay = () => view.xs[Math.floor(cursor)] + (cursor % 1) * view.step;
  const lastIndex = () => Math.max(0, view.xs.length - 1);

  function recompute(resetAnim: boolean) {
    const exists = u.repos.filter((p) => p.born <= st.to);
    const active = exists.filter(activeInRange);
    idleCount = exists.length - active.length;
    candidates = (st.idle ? exists : active).sort((a, b) => a.born - b.born || a.name.localeCompare(b.name));
    view = buildView(u, visible(), st.metric, st.mode, st.from, st.to, st.total);
    if (st.view === "static") cursor = lastIndex();
    else if (resetAnim) { cursor = 0; holdT = 0; }
    else cursor = Math.min(cursor, lastIndex());
    yAnim = yTarget(view, cursor, st.log);
    writeState(st);
    syncControls(); renderKpis(); renderLegend(); renderHeatmap(); renderTable();
    draw(); updateLive(true);
  }

  // ---------------------------------------------------------------- drawing
  function frameOpts(extra: Partial<FrameOpts> = {}): FrameOpts {
    return {
      width: W, height: H, cursor, yMax: yAnim, log: st.log, logMin: logFloor(view), animated: st.view === "animated",
      daysPerSecond: daysPerSecond(), hoverIndex: playing ? null : hoverIndex, scale: W < 640 ? 0.85 : 1, ...extra,
    };
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L = drawFrame(ctx, view, frameOpts(), theme);
  }
  function resize() {
    W = wrap.clientWidth;
    H = Math.round(W < 640 ? Math.max(380, W * 1.0) : Math.min(620, Math.max(380, W * 0.5)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    if (view) draw();
  }

  function easeY(dt: number) {
    const target = yTarget(view, cursor, st.log);
    const k = 1 - Math.exp(-dt * 5);
    if (st.log) yAnim = 10 ** (Math.log10(yAnim) + (Math.log10(target) - Math.log10(yAnim)) * k);
    else yAnim += (target - yAnim) * k;
    return Math.abs(target - yAnim) / target > 0.002;
  }

  function loop(ts: number) {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (playing) {
      if (cursor >= lastIndex()) {
        holdT += dt;
        if (st.loop && holdT > 1.6) { cursor = 0; holdT = 0; yAnim = yTarget(view, 0, st.log); }
        else if (!st.loop) { playing = false; syncPlay(); }
      } else {
        cursor = Math.min(lastIndex(), cursor + (dt * daysPerSecond()) / view.step);
      }
    }
    const settling = easeY(dt);
    draw();
    if (ts - lastUi > 90 || !playing) { updateLive(false); lastUi = ts; }
    if (playing || settling) raf = requestAnimationFrame(loop);
    else { raf = 0; lastTs = 0; }
  }
  function kick() { if (!raf) { lastTs = 0; raf = requestAnimationFrame(loop); } }

  function play() {
    if (st.view !== "animated") return;
    if (cursor >= lastIndex()) { cursor = 0; holdT = 0; yAnim = yTarget(view, 0, st.log); }
    playing = true; hoverIndex = null; tip.hidden = true; syncPlay(); kick();
  }
  function pause() { playing = false; syncPlay(); }
  function syncPlay() {
    const b = $("playBtn");
    b.innerHTML = playing ? ICON.pause : ICON.play;
    b.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  // ---------------------------------------------------------------- live UI (follows the cursor)
  let lastHeatDay = -1, lastLangT = 0;
  function updateLive(force: boolean) {
    const n = lastIndex();
    const p = n ? cursor / n : 1;
    scrub.value = String(Math.round(p * 1000));
    scrub.style.setProperty("--p", `${p * 100}%`);
    const cd = Math.floor(cursorDay());
    $("pDate").textContent = st.view === "animated" ? fmtDate(Math.min(cd, st.to)) : `${fmtDate(view.from)} – ${fmtDate(view.to)}`;
    // legend values
    for (const el of document.querySelectorAll<HTMLElement>(".repo-chip")) {
      const sr = view.series.find((s) => s.repo.name === el.dataset.name);
      const v = sr ? valueAt(sr, cursor) : NaN;
      el.querySelector(".val")!.textContent = sr ? fmtMetric(st.metric, v, true) : "";
    }
    const now = performance.now();
    if (force || now - lastLangT > 180) { renderLangs(Math.min(cd, st.to)); lastLangT = now; }
    if (force || cd !== lastHeatDay) { markHeat(cd); lastHeatDay = cd; }
  }

  // ---------------------------------------------------------------- controls
  function syncControls() {
    for (const [id, val] of [["metricSeg", st.metric], ["modeSeg", st.mode], ["viewSeg", st.view]] as const) {
      for (const b of $(id).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === val));
    }
    $("logT").setAttribute("aria-pressed", String(st.log));
    $("totT").setAttribute("aria-pressed", String(st.total));
    $("loopBtn").setAttribute("aria-pressed", String(st.loop));
    $("loopBtn").style.color = st.loop ? "var(--ink)" : "";
    $<HTMLSelectElement>("speed").value = String(st.speed);
    $("player").classList.toggle("static", st.view === "static");
    const preset = PRESETS.find((p) => p.id === st.preset);
    $("rangeLabel").textContent = preset && st.preset !== "custom"
      ? `${preset.label} · ${fmtDate(st.from)} – ${fmtDate(st.to)}` : `${fmtDate(st.from)} – ${fmtDate(st.to)}`;
    $("presetList").innerHTML = PRESETS.map((p) =>
      `<button class="preset" role="menuitemradio" aria-checked="${p.id === st.preset}" data-p="${p.id}"><span>${p.label}</span><span class="check">✓</span></button>`).join("");
    $<HTMLInputElement>("fromIn").value = fromDay(st.from);
    $<HTMLInputElement>("toIn").value = fromDay(st.to);
    $<HTMLInputElement>("fromIn").min = fromDay(u.day0); $<HTMLInputElement>("toIn").max = fromDay(u.day1);
    $("themeBtn").innerHTML = isDark() ? ICON.sun : ICON.moon;
    $("idleBtn").textContent = st.idle ? "Hide idle repos" : idleCount ? `Show ${idleCount} idle repo${idleCount > 1 ? "s" : ""}` : "";
    $("idleBtn").hidden = !st.idle && !idleCount;
    syncPlay();
    const upd = new Date(u.generatedAt);
    const hrs = Math.round((Date.now() - upd.getTime()) / 3_600_000);
    $("updated").textContent = `Data updated ${hrs < 1 ? "just now" : hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`}`;
    $("updated").title = upd.toLocaleString();
  }

  const segHandler = (id: string, fn: (v: string) => void) =>
    $(id).addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b?.dataset.v) fn(b.dataset.v);
    });
  segHandler("metricSeg", (v) => { st.metric = v as Metric; recompute(false); if (st.view === "animated" && !playing) kick(); });
  segHandler("modeSeg", (v) => { st.mode = v as Mode; recompute(true); if (st.view === "animated") play(); });
  segHandler("viewSeg", (v) => {
    st.view = v as ViewKind; pause();
    recompute(true);
    if (st.view === "animated") play();
  });
  $("logT").onclick = () => { st.log = !st.log; recompute(false); };
  $("totT").onclick = () => { st.total = !st.total; recompute(false); };
  $("loopBtn").onclick = () => { st.loop = !st.loop; syncControls(); writeState(st); };
  $<HTMLSelectElement>("speed").onchange = (e) => { st.speed = Number((e.target as HTMLSelectElement).value); writeState(st); };
  $("playBtn").onclick = () => (playing ? pause() : play());
  $("restartBtn").onclick = () => { cursor = 0; holdT = 0; yAnim = yTarget(view, 0, st.log); play(); };
  scrub.addEventListener("input", () => {
    pause();
    cursor = (Number(scrub.value) / 1000) * lastIndex();
    kick(); updateLive(false);
  });

  // date range popover
  const pop = $("rangePop");
  $("rangeBtn").onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; $("exportPop").hidden = true; };
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = (e.target as HTMLElement).closest<HTMLElement>(".preset");
    if (!b) return;
    st.preset = b.dataset.p as Preset;
    [st.from, st.to] = resolvePreset(st.preset, u, st);
    pop.hidden = true; recompute(true); if (st.view === "animated") play();
  });
  $("applyRange").onclick = () => {
    const f = $<HTMLInputElement>("fromIn").value, t = $<HTMLInputElement>("toIn").value;
    if (!f || !t) return;
    let a = toDay(f), b = toDay(t);
    if (b < a) [a, b] = [b, a];
    st.preset = "custom"; st.from = Math.max(a, u.day0); st.to = Math.min(b, u.day1);
    pop.hidden = true; recompute(true); if (st.view === "animated") play();
  };
  document.addEventListener("click", () => { pop.hidden = true; $("exportPop").hidden = true; });

  // legend
  $("legend").addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".repo-chip");
    if (!chip) return;
    const name = chip.dataset.name!;
    if ((e as MouseEvent).altKey || (e as MouseEvent).metaKey) {
      // solo
      st.hidden = new Set(candidates.map((p) => p.name).filter((n) => n !== name));
    } else if (st.hidden.has(name)) st.hidden.delete(name); else st.hidden.add(name);
    recompute(false); kick();
  });
  $("allBtn").onclick = () => { st.hidden.clear(); recompute(false); kick(); };
  $("noneBtn").onclick = () => { candidates.forEach((p) => st.hidden.add(p.name)); recompute(false); };
  $("idleBtn").onclick = () => { st.idle = !st.idle; recompute(false); kick(); };

  // theme
  $("themeBtn").onclick = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("rt-theme", next); } catch { /* private mode */ }
    applyTheme();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  function applyTheme() {
    theme = readTheme();
    const pal = isDark() ? PALETTE.dark : PALETTE.light;
    u.repos.forEach((p) => { p.color = p.slot >= 0 ? pal[p.slot] : null; });
    syncControls(); renderLegend(); renderTable(); draw(); updateLive(true);
  }
  if (user) $("signOut").onclick = () => sb.auth.signOut();

  // hover tooltip
  canvas.addEventListener("pointermove", (e) => {
    if (playing || !L) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < L.left - 8 || x > L.left + L.w + 8 || y < L.top - 20 || y > L.top + L.h + 10) { hideTip(); return; }
    const idx = indexFromX(view, L, x);
    if (idx > Math.ceil(cursor)) { hideTip(); return; }
    hoverIndex = idx; draw(); showTip(idx, x, y);
  });
  canvas.addEventListener("pointerleave", hideTip);
  function hideTip() { if (hoverIndex !== null) { hoverIndex = null; draw(); } tip.hidden = true; }
  function showTip(idx: number, x: number, y: number) {
    const day = view.xs[idx];
    const rows = view.series
      .map((s) => ({ s, v: s.values[idx] }))
      .filter((r) => !Number.isNaN(r.v))
      .sort((a, b) => b.v - a.v);
    if (!rows.length) { tip.hidden = true; return; }
    const head = view.mode === "period" ? `Week of ${fmtDate(Math.max(day, view.from))}` : fmtDate(day);
    const f = (v: number) => (view.mode === "period" && st.metric !== "commits"
      ? fmtSigned(fmtMetric(st.metric, Math.abs(v)), v) : fmtMetric(st.metric, v));
    let html = `<div class="t-head">${head}</div>`;
    for (const r of rows.slice(0, 12)) {
      html += `<div class="t-row"><span class="dot" style="background:${r.s.repo.color ?? theme.neutralSeries}"></span><span class="name">${esc(r.s.repo.name)}</span><span class="val">${f(r.v)}</span></div>`;
    }
    if (rows.length > 12) html += `<div class="muted" style="font-size:11.5px;padding-top:2px">+${rows.length - 12} more</div>`;
    if (view.total) {
      const tv = view.total.values[idx];
      html += `<div class="t-row total"><span></span><span class="name">All repos</span><span class="val">${f(tv)}</span></div>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 16; if (left + tw > W - 4) left = x - tw - 16;
    let top = y - th / 2; top = Math.max(4, Math.min(H - th - 4, top));
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }

  // keyboard
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
    if (e.code === "Space" && st.view === "animated") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === "Home") { cursor = 0; holdT = 0; yAnim = yTarget(view, 0, st.log); kick(); updateLive(true); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && st.view === "animated") {
      pause();
      const stepIdx = e.shiftKey ? 7 / view.step : 1;
      cursor = Math.max(0, Math.min(lastIndex(), Math.round(cursor) + (e.key === "ArrowRight" ? stepIdx : -stepIdx)));
      kick(); updateLive(true);
    }
  });

  // ---------------------------------------------------------------- KPI tiles
  function renderKpis() {
    const k = kpis(u, visible(), st.from, st.to);
    const loc = view.series.reduce((s, sr) => { const v = sr.repo.loc[Math.min(st.to, u.day1) - u.day0]; return s + (Number.isNaN(v) ? 0 : v); }, 0);
    const tile = (label: string, value: string, sub: string, cls = "") =>
      `<div class="kpi"><div class="label">${label}</div><div class="value num ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
    $("kpis").innerHTML = [
      tile("Commits", fmtInt(k.commits), `${fmtInt(k.activeDays)} active days`),
      tile("Net lines", fmtSigned(fmtCompact(Math.abs(k.netLines)), k.netLines),
        `<span class="up">+${fmtCompact(k.added)}</span> / <span class="down">−${fmtCompact(k.removed)}</span>`),
      tile("Lines of code", fmtCompact(loc), `across ${view.series.length} repo${view.series.length === 1 ? "" : "s"}`),
      tile("Size growth", fmtSigned(fmtBytes(Math.abs(k.sizeDelta)), k.sizeDelta), "tracked files incl. assets"),
      tile("Longest streak", `${k.longestStreak} day${k.longestStreak === 1 ? "" : "s"}`, k.currentStreak ? `current: ${k.currentStreak} day${k.currentStreak === 1 ? "" : "s"}` : `${k.newRepos} new repo${k.newRepos === 1 ? "" : "s"} started`),
      tile("Most active", k.topRepo ? esc(k.topRepo.name) : "–", k.topRepo ? `${fmtInt(k.topRepo.commits)} commits · ${Math.round((k.topRepo.commits / Math.max(1, k.commits)) * 100)}% of all` : "no commits in range"),
    ].join("");
  }

  // ---------------------------------------------------------------- legend
  function renderLegend() {
    $("legend").innerHTML = candidates.map((p) => {
      const on = !st.hidden.has(p.name);
      const dormant = st.idle && !activeInRange(p);
      return `<button class="repo-chip${dormant ? " dormant" : ""}" data-name="${esc(p.name)}" aria-pressed="${on}" title="${esc(p.raw.description ?? p.name)}${"\n"}Click to toggle · Alt/⌘-click to show only this repo">
        <span class="dot" style="background:${p.color ?? theme.neutralSeries}"></span><span class="name">${esc(p.name)}</span><span class="val"></span></button>`;
    }).join("") || `<span class="muted">No repos have activity in this range.</span>`;
    $("legendNote").textContent = candidates.length ? `${visible().length} of ${candidates.length} shown` : "";
  }

  // ---------------------------------------------------------------- language mix
  function renderLangs(day: number) {
    const mix = languageMix(u, visible(), day);
    const total = mix.reduce((s, [, v]) => s + v, 0);
    const top = mix.slice(0, 7);
    const rest = mix.slice(7).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) top.push(["Other", rest]);
    const max = top[0]?.[1] ?? 1;
    $("langSub").textContent = total ? `${fmtInt(total)} lines on ${fmtDate(day)}` : `No code yet on ${fmtDate(day)}`;
    const host = $("langs");
    // reuse rows so the width transition animates during playback
    const rows = host.querySelectorAll<HTMLElement>(".lang-row");
    if (rows.length !== top.length) {
      host.innerHTML = top.map(() => `<div class="lang-row"><span class="lname"></span><div class="track"><div class="fill"></div></div><span class="lval num"></span></div>`).join("");
    }
    host.querySelectorAll<HTMLElement>(".lang-row").forEach((row, i) => {
      const [name, v] = top[i];
      row.querySelector(".lname")!.textContent = name;
      (row.querySelector(".fill") as HTMLElement).style.width = `${(v / max) * 100}%`;
      row.querySelector(".lval")!.innerHTML = `${fmtCompact(v)}<span>${Math.round((v / total) * 100)}%</span>`;
    });
  }

  // ---------------------------------------------------------------- heatmap
  let heatCells: { el: HTMLElement; day: number }[] = [];
  function renderHeatmap() {
    const days = commitsPerDay(u, visible(), st.from, st.to);
    const nz = days.map((d) => d.c).filter((c) => c > 0).sort((a, b) => a - b);
    const q = (p: number) => nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 1;
    const t1 = q(0.25), t2 = q(0.5), t3 = q(0.8);
    const level = (c: number) => (c <= 0 ? 0 : c <= t1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4);
    const dow = (d: number) => (new Date(d * 86_400_000).getUTCDay() + 6) % 7;
    const start = st.from - dow(st.from);
    const host = $("heat");
    let html = "";
    heatCells = [];
    const byDay = new Map(days.map((d) => [d.day, d]));
    let lastMonth = -1;
    for (let w = start; w <= st.to; w += 7) {
      const labelDay = Math.max(w, st.from);
      const m = new Date(labelDay * 86_400_000).getUTCMonth();
      const showM = m !== lastMonth;
      html += `<span class="mlabel">${showM ? fmtMonth(labelDay) : ""}</span>`;
      if (showM) lastMonth = m;
      for (let i = 0; i < 7; i++) {
        const d = w + i;
        const rec = byDay.get(d);
        if (d < st.from || d > st.to || !rec) { html += `<span class="cell out"></span>`; continue; }
        const title = `${fmtDate(d)}: ${rec.c} commit${rec.c === 1 ? "" : "s"}${rec.byRepo.length ? "\n" + rec.byRepo.slice(0, 5).map(([n, c]) => `${n} · ${c}`).join("\n") : ""}`;
        html += `<span class="cell l${level(rec.c)}" data-d="${d}" title="${esc(title)}"></span>`;
      }
    }
    host.innerHTML = html;
    host.querySelectorAll<HTMLElement>(".cell[data-d]").forEach((el) => heatCells.push({ el, day: Number(el.dataset.d) }));
    const total = days.reduce((s, d) => s + d.c, 0);
    $("heatSub").textContent = `${fmtInt(total)} commits over ${fmtInt(days.length)} days`;
    const sc = host.parentElement!;
    sc.scrollLeft = sc.scrollWidth;
    lastHeatDay = -1;
  }
  function markHeat(day: number) {
    const anim = st.view === "animated";
    for (const c of heatCells) {
      c.el.classList.toggle("future", anim && c.day > day);
      c.el.classList.toggle("cur", anim && c.day === day && cursor < lastIndex());
    }
  }

  // ---------------------------------------------------------------- table
  function renderTable() {
    const to = Math.min(st.to, u.day1) - u.day0;
    const fromI = Math.max(st.from, u.day0) - u.day0;
    const rows = candidates.map((p) => {
      let c = 0; for (let i = fromI; i <= to; i++) c += p.commits[i];
      const locEnd = p.loc[to], locStart = fromI > 0 ? p.loc[fromI - 1] : NaN;
      const dl = (Number.isNaN(locEnd) ? 0 : locEnd) - (Number.isNaN(locStart) ? 0 : locStart);
      return `<tr><td><span class="dot" style="background:${p.color ?? theme.neutralSeries}"></span>${esc(p.name)}</td>
        <td>${fmtDate(p.born)}</td><td>${fmtInt(c)}</td><td>${fmtInt(p.cumCommits[to])}</td>
        <td>${Number.isNaN(locEnd) ? "–" : fmtInt(locEnd)}</td><td>${fmtSigned(fmtInt(Math.abs(dl)), dl)}</td>
        <td>${Number.isNaN(p.size[to]) ? "–" : fmtBytes(p.size[to])}</td></tr>`;
    }).join("");
    $("tbl").innerHTML = `<thead><tr><th>Repo</th><th>First commit</th><th>Commits in range</th><th>Commits total</th><th>Lines (end)</th><th>Δ lines in range</th><th>Size (end)</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------------------------------------------------------------- exports
  const exportPop = $("exportPop");
  $("exportBtn").onclick = (e) => { e.stopPropagation(); exportPop.hidden = !exportPop.hidden; pop.hidden = true; };
  const stamp = () => `repo-timelapse-${st.metric}-${fromDay(st.from)}_${fromDay(st.to)}`;
  exportPop.addEventListener("click", async (e) => {
    e.stopPropagation();
    const b = (e.target as HTMLElement).closest<HTMLElement>(".menu-item");
    if (!b) return;
    exportPop.hidden = true;
    const kind = b.dataset.x!;
    // A paused mid-timeline frame exports as that moment; otherwise export the complete chart.
    const moment = st.view === "animated" && !playing && cursor < lastIndex();
    const still = (ctx2: CanvasRenderingContext2D, w: number, h: number) => {
      const cur = moment ? cursor : lastIndex();
      drawFrame(ctx2, view, {
        ...frameOpts(), width: w, height: h, cursor: cur, animated: moment, scale: 1,
        yMax: moment ? yAnim : yTarget(view, cur, st.log), hoverIndex: null, showBrand: true, title: CREDIT,
      }, theme);
    };
    try {
      if (kind === "png") await exportPNG(still, 1600, 900, 2, `${stamp()}.png`);
      else if (kind === "svg") exportSVG(still, 1600, 900, `${stamp()}.svg`);
      else if (kind === "csv") exportCSV();
      else await exportVideo(kind);
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast((err as Error).message || "Export failed");
    }
  });

  function exportCSV() {
    const head = ["date", ...view.series.map((s) => s.repo.name), ...(view.total ? ["all_repos"] : [])];
    const lines = [head.join(",")];
    view.xs.forEach((d, i) => {
      const vals = view.series.map((s) => (Number.isNaN(s.values[i]) ? "" : String(s.values[i])));
      if (view.total) vals.push(Number.isNaN(view.total.values[i]) ? "" : String(view.total.values[i]));
      lines.push([fromDay(d), ...vals].join(","));
    });
    download(new Blob([lines.join("\n")], { type: "text/csv" }), `${stamp()}${st.mode === "period" ? "-weekly" : ""}.csv`);
  }

  async function exportVideo(kind: string) {
    const type = bestVideoType();
    if (!type) throw new Error("This browser can't record video. Try Chrome, Edge or Safari.");
    const dims = kind === "v11" ? [1080, 1080, 1.45] : kind === "v916" ? [1080, 1920, 1.7] : [1920, 1080, 1.6];
    const [vw, vh, sc] = dims;
    const W2 = vw / sc, H2 = vh / sc; // draw in logical px, scaled up
    const n = lastIndex();
    const dps = daysPerSecond();
    const duration = Math.max(4, (st.to - st.from) / dps);
    let yv = yTarget(view, 0, st.log);
    pause();
    const ac = new AbortController();
    const modal = $("modal"), bar = $("mBar");
    modal.hidden = false;
    $("mTitle").textContent = "Recording video…";
    $("mText").textContent = `${Math.round(duration + 2)} s ${type.ext.toUpperCase()} at ${vw}×${vh}. Keep this tab open and visible while it records.`;
    $("mCancel").onclick = () => ac.abort();
    try {
      const { blob, ext } = await recordVideo({
        width: vw, height: vh, fps: 60, durationSec: duration, holdSec: 2, signal: ac.signal,
        onProgress: (p) => { bar.style.width = `${p * 100}%`; },
        frame: (c, p, dt) => {
          const cur = p * n;
          const target = yTarget(view, cur, st.log);
          const k = dt === 0 ? 1 : 1 - Math.exp(-dt * 5);
          yv = st.log ? 10 ** (Math.log10(yv) + (Math.log10(target) - Math.log10(yv)) * k) : yv + (target - yv) * k;
          c.setTransform(sc, 0, 0, sc, 0, 0);
          drawFrame(c, view, {
            width: W2, height: H2, cursor: cur, yMax: yv, log: st.log, logMin: logFloor(view), animated: true,
            daysPerSecond: dps, showBrand: true, title: CREDIT,
          }, theme);
        },
      });
      download(blob, `${stamp()}-${vw}x${vh}.${ext}`);
      toast("Video saved");
    } finally {
      modal.hidden = true; bar.style.width = "0";
    }
  }

  function toast(msg: string) {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------------------------------------------------------------- go
  new ResizeObserver(() => resize()).observe(wrap);
  resize();
  recompute(true);
  if (st.view === "animated") {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { cursor = lastIndex(); yAnim = yTarget(view, cursor, st.log); draw(); updateLive(true); }
    else play();
  }
}
