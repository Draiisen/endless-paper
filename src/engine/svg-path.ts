// Tokenize and transform SVG path data preserving command semantics.
// Supported commands: M m L l H h V v C c S s Q q T t Z z A a

export type CmdLetter = 'M' | 'L' | 'H' | 'V' | 'C' | 'S' | 'Q' | 'T' | 'A' | 'Z';

export interface PathCommand {
  cmd: CmdLetter;
  abs: boolean;
  args: number[];
}

const ARG_COUNTS: Record<CmdLetter, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

export function parsePath(d: string): PathCommand[] {
  const result: PathCommand[] = [];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  if (!tokens) return result;

  let i = 0;
  let lastCmd: CmdLetter | null = null;
  let lastAbs = true;

  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      const upper = t.toUpperCase() as CmdLetter;
      if (!(upper in ARG_COUNTS)) {
        i++;
        continue;
      }
      lastCmd = upper;
      lastAbs = t === t.toUpperCase();
      i++;
      const argCount = ARG_COUNTS[upper];
      if (argCount === 0) {
        result.push({ cmd: upper, abs: lastAbs, args: [] });
        continue;
      }
      // Read arg sets repeatedly
      while (i < tokens.length && !/[a-zA-Z]/.test(tokens[i])) {
        const args: number[] = [];
        for (let k = 0; k < argCount && i < tokens.length; k++) {
          args.push(parseFloat(tokens[i]));
          i++;
        }
        if (args.length === argCount) {
          let effective: CmdLetter = upper;
          if (upper === 'M' && result.length && result[result.length - 1].cmd === 'M') {
            // multiple M args become L semantically — handled by serializer
          }
          result.push({ cmd: effective, abs: lastAbs, args });
        }
      }
    } else {
      // Stray number with no command — skip
      i++;
    }
    void lastCmd;
  }
  return result;
}

// Transform path coordinates: each (x,y) pair gets mapped via fn.
// Handles absolute and relative commands and converts everything to absolute output.
export function transformPathCoords(
  d: string,
  fn: (x: number, y: number) => { x: number; y: number }
): string {
  const cmds = parsePath(d);
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  const out: string[] = [];

  for (const c of cmds) {
    switch (c.cmd) {
      case 'M': {
        let [x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        const m = fn(x, y);
        out.push(`M ${m.x.toFixed(2)} ${m.y.toFixed(2)}`);
        curX = x; curY = y;
        startX = x; startY = y;
        break;
      }
      case 'L': {
        let [x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        const m = fn(x, y);
        out.push(`L ${m.x.toFixed(2)} ${m.y.toFixed(2)}`);
        curX = x; curY = y;
        break;
      }
      case 'H': {
        let [x] = c.args;
        if (!c.abs) x += curX;
        const m = fn(x, curY);
        out.push(`L ${m.x.toFixed(2)} ${m.y.toFixed(2)}`);
        curX = x;
        break;
      }
      case 'V': {
        let [y] = c.args;
        if (!c.abs) y += curY;
        const m = fn(curX, y);
        out.push(`L ${m.x.toFixed(2)} ${m.y.toFixed(2)}`);
        curY = y;
        break;
      }
      case 'C': {
        let [x1, y1, x2, y2, x, y] = c.args;
        if (!c.abs) { x1 += curX; y1 += curY; x2 += curX; y2 += curY; x += curX; y += curY; }
        const a = fn(x1, y1);
        const b = fn(x2, y2);
        const e = fn(x, y);
        out.push(`C ${a.x.toFixed(2)} ${a.y.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}, ${e.x.toFixed(2)} ${e.y.toFixed(2)}`);
        curX = x; curY = y;
        break;
      }
      case 'S': {
        let [x2, y2, x, y] = c.args;
        if (!c.abs) { x2 += curX; y2 += curY; x += curX; y += curY; }
        const b = fn(x2, y2);
        const e = fn(x, y);
        out.push(`S ${b.x.toFixed(2)} ${b.y.toFixed(2)}, ${e.x.toFixed(2)} ${e.y.toFixed(2)}`);
        curX = x; curY = y;
        break;
      }
      case 'Q': {
        let [x1, y1, x, y] = c.args;
        if (!c.abs) { x1 += curX; y1 += curY; x += curX; y += curY; }
        const a = fn(x1, y1);
        const e = fn(x, y);
        out.push(`Q ${a.x.toFixed(2)} ${a.y.toFixed(2)}, ${e.x.toFixed(2)} ${e.y.toFixed(2)}`);
        curX = x; curY = y;
        break;
      }
      case 'T': {
        let [x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        const e = fn(x, y);
        out.push(`T ${e.x.toFixed(2)} ${e.y.toFixed(2)}`);
        curX = x; curY = y;
        break;
      }
      case 'A': {
        let [rx, ry, rot, large, sweep, x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        const e = fn(x, y);
        out.push(`A ${rx} ${ry} ${rot} ${large} ${sweep} ${e.x.toFixed(2)} ${e.y.toFixed(2)}`);
        curX = x; curY = y;
        break;
      }
      case 'Z': {
        out.push('Z');
        curX = startX;
        curY = startY;
        break;
      }
    }
  }

  return out.join(' ');
}

// ---- Anchor-based editing helpers ----

export interface PathAnchor {
  // The anchor point itself (absolute coords)
  x: number;
  y: number;
  // Optional control handles (absolute coords)
  inX?: number;
  inY?: number;
  outX?: number;
  outY?: number;
  // Marks the anchor as the start of a subpath (M)
  moveTo?: boolean;
  // True if this subpath ended with a Z (closed)
  closed?: boolean;
}

// Parse an SVG path into an array of anchors. Conversions:
// - M -> anchor with moveTo
// - L -> anchor (no out from prev, no in to this)
// - C/S -> anchor with inX/Y on this, outX/Y on previous
// - Q/T -> converted to cubic equivalents for editing
// - H/V -> converted to L
// - A -> kept as anchor (handles not edited)
// - Z -> marks last anchor as closed
export function parsePathToAnchors(d: string): PathAnchor[] {
  const cmds = parsePath(d);
  const out: PathAnchor[] = [];
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  const last = () => out[out.length - 1];

  for (const c of cmds) {
    switch (c.cmd) {
      case 'M': {
        let [x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        out.push({ x, y, moveTo: true });
        curX = x; curY = y;
        startX = x; startY = y;
        break;
      }
      case 'L': {
        let [x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        out.push({ x, y });
        curX = x; curY = y;
        break;
      }
      case 'H': {
        let [x] = c.args;
        if (!c.abs) x += curX;
        out.push({ x, y: curY });
        curX = x;
        break;
      }
      case 'V': {
        let [y] = c.args;
        if (!c.abs) y += curY;
        out.push({ x: curX, y });
        curY = y;
        break;
      }
      case 'C': {
        let [x1, y1, x2, y2, x, y] = c.args;
        if (!c.abs) { x1 += curX; y1 += curY; x2 += curX; y2 += curY; x += curX; y += curY; }
        const prev = last();
        if (prev) { prev.outX = x1; prev.outY = y1; }
        out.push({ x, y, inX: x2, inY: y2 });
        curX = x; curY = y;
        break;
      }
      case 'S': {
        let [x2, y2, x, y] = c.args;
        if (!c.abs) { x2 += curX; y2 += curY; x += curX; y += curY; }
        const prev = last();
        if (prev) {
          // Implied first ctrl is reflection of prev.inX/inY across prev
          if (prev.inX !== undefined && prev.inY !== undefined) {
            prev.outX = 2 * prev.x - prev.inX;
            prev.outY = 2 * prev.y - prev.inY;
          } else {
            prev.outX = prev.x; prev.outY = prev.y;
          }
        }
        out.push({ x, y, inX: x2, inY: y2 });
        curX = x; curY = y;
        break;
      }
      case 'Q': {
        let [x1, y1, x, y] = c.args;
        if (!c.abs) { x1 += curX; y1 += curY; x += curX; y += curY; }
        // Convert Q to C for editing convenience
        const prev = last();
        if (prev) {
          const c1x = prev.x + (2 / 3) * (x1 - prev.x);
          const c1y = prev.y + (2 / 3) * (y1 - prev.y);
          const c2x = x + (2 / 3) * (x1 - x);
          const c2y = y + (2 / 3) * (y1 - y);
          prev.outX = c1x; prev.outY = c1y;
          out.push({ x, y, inX: c2x, inY: c2y });
        } else {
          out.push({ x, y });
        }
        curX = x; curY = y;
        break;
      }
      case 'T': {
        let [x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        out.push({ x, y });
        curX = x; curY = y;
        break;
      }
      case 'A': {
        let [, , , , , x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        out.push({ x, y });
        curX = x; curY = y;
        break;
      }
      case 'Z': {
        const prev = last();
        if (prev) prev.closed = true;
        curX = startX; curY = startY;
        break;
      }
    }
  }
  return out;
}

export function anchorsToPath(anchors: PathAnchor[]): string {
  if (anchors.length === 0) return '';
  const out: string[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const prev = i > 0 ? anchors[i - 1] : null;
    if (a.moveTo || !prev) {
      out.push(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`);
      if (a.closed) out.push('Z');
      continue;
    }
    const hasOut = prev.outX !== undefined && prev.outY !== undefined;
    const hasIn = a.inX !== undefined && a.inY !== undefined;
    if (hasOut || hasIn) {
      const ox = hasOut ? prev.outX! : prev.x;
      const oy = hasOut ? prev.outY! : prev.y;
      const ix = hasIn ? a.inX! : a.x;
      const iy = hasIn ? a.inY! : a.y;
      out.push(`C ${ox.toFixed(2)} ${oy.toFixed(2)}, ${ix.toFixed(2)} ${iy.toFixed(2)}, ${a.x.toFixed(2)} ${a.y.toFixed(2)}`);
    } else {
      out.push(`L ${a.x.toFixed(2)} ${a.y.toFixed(2)}`);
    }
    if (a.closed) out.push('Z');
  }
  return out.join(' ');
}

// Approximate arc length per segment, returns cumulative length array and per-anchor segments.
export interface PathSegmentSample {
  x: number;
  y: number;
  cumLen: number;
  // Tangent angle (radians) for orientation
  angle: number;
}

// Sample the path uniformly using small line segments by repeatedly sampling beziers.
export function samplePath(d: string, samplesPerSegment = 24): PathSegmentSample[] {
  const anchors = parsePathToAnchors(d);
  const samples: PathSegmentSample[] = [];
  let cumLen = 0;

  function pushSample(x: number, y: number, prev: PathSegmentSample | null): PathSegmentSample {
    let angle = prev ? Math.atan2(y - prev.y, x - prev.x) : 0;
    if (prev) cumLen += Math.hypot(x - prev.x, y - prev.y);
    const s: PathSegmentSample = { x, y, cumLen, angle };
    samples.push(s);
    return s;
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (i === 0 || a.moveTo) {
      pushSample(a.x, a.y, samples.length ? samples[samples.length - 1] : null);
      continue;
    }
    const prev = anchors[i - 1];
    const hasOut = prev.outX !== undefined && prev.outY !== undefined;
    const hasIn = a.inX !== undefined && a.inY !== undefined;
    if (hasOut || hasIn) {
      const p0x = prev.x, p0y = prev.y;
      const p1x = hasOut ? prev.outX! : prev.x;
      const p1y = hasOut ? prev.outY! : prev.y;
      const p2x = hasIn ? a.inX! : a.x;
      const p2y = hasIn ? a.inY! : a.y;
      const p3x = a.x, p3y = a.y;
      for (let s = 1; s <= samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const mt = 1 - t;
        const x = mt * mt * mt * p0x + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * p3x;
        const y = mt * mt * mt * p0y + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * p3y;
        pushSample(x, y, samples[samples.length - 1] ?? null);
      }
    } else {
      pushSample(a.x, a.y, samples[samples.length - 1] ?? null);
    }
  }

  // Compute angles using neighbours for smoother orientation
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    samples[i].angle = Math.atan2(b.y - a.y, b.x - a.x);
  }

  return samples;
}

// Find a point on the path at a given arc-length distance from the start.
// Returns x, y, and the tangent angle. Linear interpolation between samples.
export function pointAtLength(
  samples: PathSegmentSample[],
  length: number,
): { x: number; y: number; angle: number } | null {
  if (samples.length === 0) return null;
  if (length <= 0) return { x: samples[0].x, y: samples[0].y, angle: samples[0].angle };
  const total = samples[samples.length - 1].cumLen;
  if (length >= total) return { x: samples[samples.length - 1].x, y: samples[samples.length - 1].y, angle: samples[samples.length - 1].angle };

  // Binary search
  let lo = 0, hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].cumLen < length) lo = mid; else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.cumLen - a.cumLen;
  const t = span > 0 ? (length - a.cumLen) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + (b.angle - a.angle) * t,
  };
}

export function totalPathLength(samples: PathSegmentSample[]): number {
  return samples.length === 0 ? 0 : samples[samples.length - 1].cumLen;
}
