// PNG / SVG / video exports. Every export re-renders the chart at the target size,
// so files are crisp and independent of the on-screen canvas.
import { Context as SvgContext } from "svgcanvas";

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportPNG(draw: DrawFn, w: number, h: number, scale: number, filename: string) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  draw(ctx, w, h);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  download(blob, filename);
}

export function exportSVG(draw: DrawFn, w: number, h: number, filename: string) {
  const ctx = new SvgContext({ width: w, height: h }) as unknown as CanvasRenderingContext2D & { getSerializedSvg(fix?: boolean): string };
  draw(ctx, w, h);
  download(new Blob([ctx.getSerializedSvg(true)], { type: "image/svg+xml" }), filename);
}

export function bestVideoType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: [string, string][] = [
    ["video/mp4;codecs=avc1.640028", "mp4"],
    ["video/mp4;codecs=avc1", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm;codecs=vp8", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

export interface RecordOpts {
  width: number; height: number; fps: number;
  durationSec: number; holdSec: number;
  /** draw the frame for animation progress p (0..1); dt = seconds since the previous frame */
  frame: (ctx: CanvasRenderingContext2D, p: number, dt: number) => void;
  onProgress: (p: number) => void;
  signal: AbortSignal;
}

/** Real-time capture of an offscreen canvas. Timing follows the clock, so dropped frames never stretch the video. */
export function recordVideo(o: RecordOpts): Promise<{ blob: Blob; ext: string }> {
  const type = bestVideoType();
  if (!type) return Promise.reject(new Error("This browser can't record video. Try Chrome, Edge or Safari."));
  const c = document.createElement("canvas");
  c.width = o.width; c.height = o.height;
  const ctx = c.getContext("2d", { alpha: false })!;
  o.frame(ctx, 0, 0);
  const stream = c.captureStream(o.fps);
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: Math.round(o.width * o.height * 6) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let raf = 0, start = 0, last = 0, done = false;
    const total = o.durationSec + o.holdSec;
    const finish = (err?: Error) => {
      if (done) return; done = true;
      cancelAnimationFrame(raf);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (err) reject(err); else resolve({ blob: new Blob(chunks, { type: type.mime.split(";")[0] }), ext: type.ext });
      };
      if (rec.state !== "inactive") rec.stop(); else rec.onstop?.(new Event("stop"));
    };
    o.signal.addEventListener("abort", () => finish(new DOMException("Cancelled", "AbortError")));
    const tick = (now: number) => {
      if (done) return;
      if (!start) { start = now; last = now; }
      const t = (now - start) / 1000;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      o.frame(ctx, Math.min(1, t / o.durationSec), dt);
      o.onProgress(Math.min(1, t / total));
      if (t >= total) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    rec.start(250);
    raf = requestAnimationFrame(tick);
  });
}
