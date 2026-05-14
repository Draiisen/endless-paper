// Tokenize and transform SVG path data preserving command semantics.
// Supported commands: M m L l H h V v C c S s Q q T t Z z A a

type CmdLetter = 'M' | 'L' | 'H' | 'V' | 'C' | 'S' | 'Q' | 'T' | 'A' | 'Z';

interface PathCommand {
  cmd: CmdLetter;
  abs: boolean;
  args: number[];
}

const ARG_COUNTS: Record<CmdLetter, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

function parsePath(d: string): PathCommand[] {
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
          // After M/m, subsequent implicit commands are L/l
          let effective: CmdLetter = upper;
          if (upper === 'M' && result.length && result[result.length - 1].cmd === 'M') {
            // already pushed an M, treat further as L
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
        // Arcs: first 5 args are radii/flags/etc — only the final endpoint is a coordinate.
        let [rx, ry, rot, large, sweep, x, y] = c.args;
        if (!c.abs) { x += curX; y += curY; }
        const e = fn(x, y);
        // Note: scaling rx/ry uniformly is okay if our transform is uniform; here we keep raw radii.
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
