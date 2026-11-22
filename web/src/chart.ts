// The line chart renderer. Pure drawing: given a View, a cursor and a size, paint one frame
// onto any CanvasRenderingContext2D-compatible context (screen canvas, offscreen canvas for
// PNG/video, or svgcanvas for SVG).
import {
  fmtDate, fmtMetric, fmtMonth, fmtMonthYear, METRIC_LABEL, valueAt,
  type View, type ViewSeries,
} from "./data";

export interface Theme {
  dark: boolean;
  surface: string; plane: string; ink: string; ink2: string; muted: string;
  grid: string; axis: string; neutralSeries: string; ring: string;
}

export interface FrameOpts {
  width: number; height: number;
  cursor: number;          // fractional index into view.xs (0 .. xs.length-1)
  yMax: number;            // current (animated) top of y-scale, in data units
  log: boolean;
  logMin?: number;         // bottom of the log scale (power of 10)
  animated: boolean;       // draws the moving head/labels style
  daysPerSecond: number;   // for time-based effects (birth pulse)
  hoverIndex?: number | null;
  title?: string;          // footer credit for exports
  showBrand?: boolean;
  scale?: number;          // typography scale for video exports
}

export interface Layout { left: number; right: number; top: number; bottom: number; w: number; h: number }

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

export function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function yTarget(view: View, cursor: number, log: boolean): number {
  const i = Math.max(0, Math.min(view.xs.length - 1, Math.ceil(cursor)));
  let m = 0;
  for (const s of view.series) m = Math.max(m, s.runMax[i] || 0);
  if (view.total) m = Math.max(m, view.total.runMax[i] || 0);
  if (m <= 0) m = 1;
  return log ? m * 1.6 : m * 1.1;
}

export function logFloor(view: View): number {
  let m = Infinity;
  for (const s of view.series) for (const v of s.values) if (v > 0 && v < m) m = v;
  return Number.isFinite(m) ? 10 ** Math.floor(Math.log10(m)) : 1;
}

function yScale(yMax: number, log: boolean, L: Layout, logMin = 1) {
  const bottom = L.top + L.h;
  if (log) {
    const lo = Math.log10(logMin), hi = Math.log10(Math.max(logMin * 10, yMax));
    return (v: number) => bottom - ((Math.log10(Math.max(logMin, v)) - lo) / (hi - lo)) * L.h;
  }
  return (v: number) => bottom - (v / yMax) * L.h;
}

export function layout(view: View, o: FrameOpts, ctx: CanvasRenderingContext2D): Layout {
  const s = o.scale ?? 1;
  ctx.font = `600 ${12 * s}px ${FONT}`;
  let lw = 0;
  for (const sr of view.series) lw = Math.max(lw, ctx.measureText(sr.repo.name).width);
  if (view.total) lw = Math.max(lw, ctx.measureText("All repos").width);
  ctx.font = `500 ${12 * s}px ${FONT}`;
  const valW = ctx.measureText(view.metric === "size" ? "888.8 MB" : "888,888").width;
  const right = Math.min(o.width * 0.4, 14 * s + 11 * s + lw + 8 * s + valW + 10 * s);
  const top = (o.showBrand ? 96 : 84) * s;
  const bottom = (o.showBrand ? 64 : 34) * s;
  const left = (o.width < 560 ? 44 : 58) * s;
  return { left, right, top, bottom, w: Math.max(10, o.width - left - right), h: Math.max(10, o.height - top - bottom) };
}

export function drawFrame(ctx: CanvasRenderingContext2D, view: View, o: FrameOpts, T: Theme) {
  const s = o.scale ?? 1;
  const L = layout(view, o, ctx);
  const n = view.xs.length;
  const xAt = (fi: number) => L.left + (n <= 1 ? L.w : (fi / (n - 1)) * L.w);
  const y = yScale(o.yMax, o.log, L, o.logMin);
  const cursor = Math.max(0, Math.min(n - 1, o.cursor));
  const cursorDay = view.xs[Math.floor(cursor)] + (cursor % 1) * view.step;

  // background
  ctx.fillStyle = T.surface;
  ctx.fillRect(0, 0, o.width, o.height);

  // ---------------------------------------------------------------- header (in-canvas, so exports carry it)
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = T.muted;
  ctx.font = `600 ${11 * s}px ${FONT}`;
  const modeLabel = view.mode === "period"
    ? (view.metric === "commits" ? "COMMITS PER WEEK" : `${METRIC_LABEL[view.metric].toUpperCase()} · NET CHANGE PER WEEK`)
    : METRIC_LABEL[view.metric].toUpperCase();
  ctx.fillText(modeLabel + (o.log ? " · LOG SCALE" : ""), L.left, 28 * s);
  const headerDate = o.animated ? fmtDate(Math.floor(cursorDay)) : `${fmtDate(view.from)} – ${fmtDate(view.to)}`;
  const fi = cursor;
  let sum = 0, any = false;
  for (const sr of view.series) { const v = valueAt(sr, fi); if (!Number.isNaN(v)) { sum += v; any = true; } }
  const totalText = any ? fmtMetric(view.metric, sum) : "–";
  // shrink the two headline figures together until they fit side by side
  let hs = 26 * s;
  for (; hs > 14 * s; hs -= 1) {
    ctx.font = `650 ${hs}px ${FONT}`;
    if (L.left + ctx.measureText(headerDate).width + ctx.measureText(totalText).width + 40 * s < o.width - 20 * s) break;
  }
  ctx.fillStyle = T.ink;
  ctx.font = `650 ${hs}px ${FONT}`;
  ctx.fillText(headerDate, L.left, 60 * s);
  ctx.textAlign = "right";
  ctx.fillStyle = T.muted;
  ctx.font = `600 ${11 * s}px ${FONT}`;
  ctx.fillText(view.mode === "period" ? "ALL VISIBLE · THIS WEEK" : "ALL VISIBLE REPOS", o.width - 20 * s, 28 * s);
  ctx.fillStyle = T.ink;
  ctx.font = `650 ${hs}px ${FONT}`;
  ctx.fillText(totalText, o.width - 20 * s, 60 * s);

  // ---------------------------------------------------------------- watermark month during playback
  if (o.animated) {
    ctx.save();
    ctx.globalAlpha = T.dark ? 0.06 : 0.07;
    ctx.fillStyle = T.ink;
    ctx.font = `800 ${Math.min(L.h * 0.42, L.w * 0.16)}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(fmtMonthYear(Math.floor(cursorDay)), L.left + L.w - 8 * s, L.top + L.h - 6 * s);
    ctx.restore();
  }

  // ---------------------------------------------------------------- grid + y axis
  ctx.lineWidth = 1;
  ctx.font = `500 ${11 * s}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks: number[] = [];
  const tickLabel = (v: number) => {
    if (view.metric !== "size" && o.yMax >= 1e4 && v !== 0) {
      return v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : `${+(v / 1e3).toFixed(1)}k`;
    }
    return fmtMetric(view.metric, v, true);
  };
  if (o.log) {
    for (let v = o.logMin ?? 1; v <= o.yMax; v *= 10) ticks.push(v);
  } else {
    const step = niceStep(o.yMax, Math.max(3, Math.round(L.h / (56 * s))));
    for (let v = 0; v <= o.yMax + 1e-9; v += step) ticks.push(v);
  }
  for (const t of ticks) {
    const yy = Math.round(y(t)) + 0.5;
    if (yy < L.top - 1) continue;
    // fade a tick in as it enters from the top so rescaling feels continuous
    const alpha = Math.max(0, Math.min(1, (yy - L.top + 4) / (24 * s)));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = t === 0 ? T.axis : T.grid;
    ctx.beginPath(); ctx.moveTo(L.left, yy); ctx.lineTo(L.left + L.w, yy); ctx.stroke();
    ctx.fillStyle = T.muted;
    ctx.fillText(tickLabel(t), L.left - 10 * s, yy);
  }
  ctx.globalAlpha = 1;

  // ---------------------------------------------------------------- x axis (month ticks)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = T.muted;
  const spanDays = view.to - view.from;
  const monthEvery = spanDays > 900 ? 6 : spanDays > 420 ? 3 : spanDays > 200 ? 1 : 1;
  const firstDate = new Date(view.from * 86_400_000);
  let mY = firstDate.getUTCFullYear(), mM = firstDate.getUTCMonth() + 1;
  const dayToFi = (day: number) => (day - view.xs[0]) / view.step;
  let lastLabelX = -1e9;
  for (let k = 0; k < 400; k++) {
    const day = Math.round(Date.UTC(mY, mM - 1 + k, 1) / 86_400_000);
    if (day > view.to) break;
    if (day < view.from) continue;
    const m = new Date(day * 86_400_000).getUTCMonth();
    if (m % monthEvery) continue;
    const xx = Math.round(xAt(dayToFi(day))) + 0.5;
    ctx.strokeStyle = T.grid;
    ctx.beginPath(); ctx.moveTo(xx, L.top + L.h); ctx.lineTo(xx, L.top + L.h + 5 * s); ctx.stroke();
    const label = m === 0 || spanDays > 420 ? fmtMonthYear(day) : fmtMonth(day);
    if (xx - lastLabelX > 52 * s) {
      ctx.fillText(label, xx, L.top + L.h + 9 * s);
      lastLabelX = xx;
    }
  }
  if (spanDays < 45) { // short ranges: label the ends
    ctx.textAlign = "left"; ctx.fillText(fmtDate(view.from), L.left, L.top + L.h + 9 * s);
    ctx.textAlign = "right"; ctx.fillText(fmtDate(view.to), L.left + L.w, L.top + L.h + 9 * s);
  }

  // ---------------------------------------------------------------- lines
  ctx.save();
  ctx.beginPath(); ctx.rect(L.left - 2, L.top - 12 * s, L.w + 4, L.h + 14 * s); ctx.clip();

  type Head = { sr: ViewSeries | null; x: number; y: number; v: number; color: string; name: string; born: number };
  const heads: Head[] = [];
  const drawSeries = (sr: ViewSeries, color: string, isTotal: boolean) => {
    const end = Math.floor(cursor);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= end; i++) {
      const v = sr.values[i];
      if (Number.isNaN(v)) { started = false; continue; }
      const px = xAt(i), py = y(v);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    const hv = valueAt(sr, cursor);
    if (!Number.isNaN(hv) && cursor > end) {
      const px = xAt(cursor), py = y(hv);
      if (!started) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      started = true;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = (isTotal ? 1.75 : 2) * s;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.setLineDash(isTotal ? [5 * s, 4 * s] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!Number.isNaN(hv)) {
      heads.push({
        sr: isTotal ? null : sr, x: xAt(cursor), y: y(hv), v: hv, color,
        name: isTotal ? "All repos" : sr.repo.name, born: isTotal ? -Infinity : sr.repo.born,
      });
    }
  };

  // neutral series first so coloured ones sit on top
  const ordered = [...view.series].sort((a, b) => (a.repo.slot < 0 ? -1 : 0) - (b.repo.slot < 0 ? -1 : 0));
  for (const sr of ordered) drawSeries(sr, sr.repo.color ?? T.neutralSeries, false);
  if (view.total) drawSeries(view.total, T.ink2, true);

  // tags (release markers)
  for (const sr of view.series) {
    for (const tag of sr.repo.raw.tags) {
      const fiTag = dayToFi(Math.floor(new Date(tag.d).getTime() / 86_400_000));
      if (fiTag < 0 || fiTag > cursor) continue;
      const v = valueAt(sr, fiTag);
      if (Number.isNaN(v)) continue;
      const px = xAt(fiTag), py = y(v), r = 3.5 * s;
      ctx.beginPath();
      ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath();
      ctx.fillStyle = T.surface; ctx.fill();
      ctx.strokeStyle = sr.repo.color ?? T.neutralSeries; ctx.lineWidth = 1.5 * s; ctx.stroke();
    }
  }

  // head dots (+ glow and birth pulse while animating)
  if (o.animated || cursor < n - 1) {
    for (const h of heads) {
      if (o.animated) {
        const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 16 * s);
        g.addColorStop(0, hexA(h.color, T.dark ? 0.45 : 0.3));
        g.addColorStop(1, hexA(h.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(h.x, h.y, 16 * s, 0, Math.PI * 2); ctx.fill();
        const ageSec = (cursorDay - h.born) / Math.max(0.001, o.daysPerSecond);
        if (ageSec >= 0 && ageSec < 0.9) {
          const p = ageSec / 0.9;
          ctx.strokeStyle = hexA(h.color, 0.8 * (1 - p));
          ctx.lineWidth = 2 * s;
          ctx.beginPath(); ctx.arc(h.x, h.y, (5 + 22 * easeOut(p)) * s, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(h.x, h.y, 4.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = h.color; ctx.fill();
      ctx.lineWidth = 2 * s; ctx.strokeStyle = T.surface; ctx.stroke();
    }
  }
  ctx.restore();

  // ---------------------------------------------------------------- hover crosshair (static/paused)
  if (o.hoverIndex != null && o.hoverIndex >= 0 && o.hoverIndex <= cursor) {
    const hx = Math.round(xAt(o.hoverIndex)) + 0.5;
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, L.top); ctx.lineTo(hx, L.top + L.h); ctx.stroke();
    const all = view.total ? [...view.series, view.total] : view.series;
    for (const sr of all) {
      const v = sr.values[o.hoverIndex];
      if (Number.isNaN(v)) continue;
      ctx.beginPath(); ctx.arc(hx, y(v), 4 * s, 0, Math.PI * 2);
      ctx.fillStyle = sr === view.total ? T.ink2 : sr.repo.color ?? T.neutralSeries; ctx.fill();
      ctx.lineWidth = 2 * s; ctx.strokeStyle = T.surface; ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- direct labels (collision-resolved)
  const gap = 17 * s;
  const items = heads.map((h) => ({ ...h, ly: h.y }));
  items.sort((a, b) => a.y - b.y);
  const minY = L.top - 6 * s, maxY = L.top + L.h + 4 * s;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < items.length; i++) items[i].ly = Math.max(items[i].ly, items[i - 1].ly + gap);
    const over = items.length ? items[items.length - 1].ly - maxY : 0;
    if (over > 0) for (const it of items) it.ly -= over;
    for (let i = items.length - 2; i >= 0; i--) items[i].ly = Math.min(items[i].ly, items[i + 1].ly - gap);
    if (items.length && items[0].ly < minY) { const d = minY - items[0].ly; for (const it of items) it.ly += d; }
  }
  const labelX = Math.min(xAt(cursor), L.left + L.w) + 14 * s;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const it of items) {
    if (Math.abs(it.ly - it.y) > 2) {
      ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(it.x + 6 * s, it.y); ctx.lineTo(labelX - 4 * s, it.ly); ctx.stroke();
    }
    // identity dot carries the colour; text stays in ink tokens
    ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.arc(labelX + 3 * s, it.ly, 3 * s, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${12 * s}px ${FONT}`;
    ctx.fillStyle = T.ink2;
    ctx.fillText(it.name, labelX + 11 * s, it.ly - 0.5 * s);
    const nw = ctx.measureText(it.name).width;
    ctx.font = `500 ${12 * s}px ${FONT}`;
    ctx.fillStyle = T.ink;
    const val = fmtMetric(view.metric, it.v, true);
    // value sits after the name if there's room, otherwise it is omitted (tooltip/legend has it)
    if (labelX + 11 * s + nw + 8 * s + ctx.measureText(val).width < o.width - 4 * s) {
      ctx.fillText(val, labelX + 11 * s + nw + 8 * s, it.ly - 0.5 * s);
    }
  }

  // ---------------------------------------------------------------- brand footer (exports)
  if (o.showBrand) {
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = T.muted;
    ctx.font = `500 ${12 * s}px ${FONT}`;
    ctx.fillText(o.title ?? "", L.left, o.height - 22 * s);
    if (o.animated) { // progress bar
      const p = n > 1 ? cursor / (n - 1) : 1;
      ctx.fillStyle = T.grid;
      ctx.fillRect(L.left, o.height - 12 * s, L.w, 2 * s);
      ctx.fillStyle = T.ink2;
      ctx.fillRect(L.left, o.height - 12 * s, L.w * p, 2 * s);
    }
  }
  return L;
}

export function indexFromX(view: View, L: Layout, x: number): number {
  const n = view.xs.length;
  if (n <= 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(((x - L.left) / L.w) * (n - 1))));
}

function easeOut(t: number) { return 1 - (1 - t) ** 3; }

export function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
