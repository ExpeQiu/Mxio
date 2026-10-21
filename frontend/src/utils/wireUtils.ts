/**
 * Wire utilities: path generation, auto-coloring, keyboard color shortcuts.
 * Implements Wokwi-style orthogonal wire routing.
 */

/** Keyboard shortcut → hex color (matches Wokwi's color palette) */
export const WIRE_KEY_COLORS: Record<string, string> = {
  '0': '#000000', // Black
  '1': '#8B4513', // Brown
  '2': '#cc0000', // Red
  '3': '#FF8C00', // Orange
  '4': '#FFD700', // Gold
  '5': '#22c55e', // Green
  '6': '#0000cc', // Blue
  '7': '#8B00FF', // Violet
  '8': '#808080', // Gray
  '9': '#FFFFFF', // White
  c: '#00FFFF', // Cyan
  l: '#32CD32', // Limegreen
  m: '#FF00FF', // Magenta
  p: '#800080', // Purple
  y: '#FFFF00', // Yellow
};

/** Default wire color when no specific signal is detected */
export const DEFAULT_WIRE_COLOR = '#22c55e';

/**
 * Jumper palette for breadboard wires — like a real jumper kit, neighbouring
 * wires get visibly different colors instead of a wall of green. Red and
 * black are deliberately absent: they're reserved for power-rail wires.
 */
export const WIRE_JUMPER_PALETTE = [
  '#22c55e', // green
  '#0000cc', // blue
  '#FF8C00', // orange
  '#8B00FF', // violet
  '#FFD700', // gold
  '#00FFFF', // cyan
  '#FF00FF', // magenta
  '#8B4513', // brown
  '#808080', // gray
  '#32CD32', // limegreen
] as const;

/**
 * Power-rail hole → mandated wire color: positive rails (tp./bp.) are red,
 * negative rails (tn./bn.) are black, like the stripes on a real breadboard.
 * Returns null for anything that isn't a rail hole.
 */
export function railWireColor(pinName: string): string | null {
  if (/^[tb]p\.\d+$/.test(pinName)) return '#cc0000';
  if (/^[tb]n\.\d+$/.test(pinName)) return '#000000';
  return null;
}

/**
 * Deterministic palette pick for a wire id — stable across reloads so a
 * saved project keeps its colors, and different ids spread across the
 * palette so adjacent jumpers rarely collide.
 */
export function jumperColorForId(wireId: string): string {
  let h = 0;
  for (let i = 0; i < wireId.length; i++) {
    h = (h * 31 + wireId.charCodeAt(i)) >>> 0;
  }
  return WIRE_JUMPER_PALETTE[h % WIRE_JUMPER_PALETTE.length];
}

/** Ground wire color — slate, not pure black (black vanishes on dark canvas
 * and reads as "through the pin header" when routed along a column). */
export const GND_WIRE_COLOR = '#78716c';

/**
 * Automatically determine wire color from the starting pin name.
 * GND → slate, VCC/5V/3.3V/VBUS/VIN → red, everything else → green.
 */
export function autoWireColor(pinName: string): string {
  const lower = pinName.toLowerCase();
  if (lower.includes('gnd') || lower === 'ground' || lower === '-' || lower.startsWith('gnd')) {
    return GND_WIRE_COLOR;
  }
  if (
    lower.includes('vcc') ||
    lower.includes('5v') ||
    lower.includes('3.3v') ||
    lower.includes('3v3') ||
    lower.includes('vbus') ||
    lower.includes('vin') ||
    lower === 'power' ||
    lower === '+' ||
    lower.startsWith('vcc') ||
    lower.startsWith('v+')
  ) {
    return '#cc0000';
  }
  return DEFAULT_WIRE_COLOR;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Corner radius (world px) for rounded wire bends, Wokwi-style. Each bend
 * clamps to half the length of its shorter adjacent segment so short
 * segments never overshoot.
 */
export const WIRE_BEND_RADIUS = 7;

/** Radius of the semicircle drawn where two wires cross without joining. */
export const WIRE_JUMP_RADIUS = 8;

/**
 * Expand a stored point chain into the rendered orthogonal polyline.
 * Between consecutive points that are not axis-aligned an L-shape corner
 * is inserted: horizontal to the next point's X, then vertical to its Y.
 */
export function expandOrthogonalPoints(points: Point[]): Point[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.x !== curr.x && prev.y !== curr.y) {
      out.push({ x: curr.x, y: prev.y });
    }
    out.push({ ...curr });
  }
  return out;
}

/**
 * Simplify an orthogonal polyline by removing duplicate points and
 * collapsing collinear/U-turn triples.
 *
 * Three consecutive points sharing the same x (or same y) make the middle
 * one redundant — whether the path goes straight through (collinear) or
 * doubles back over itself (U-turn). Dropping the middle point handles
 * both, which is what eliminates wires rendered on top of themselves.
 */
export function simplifyOrthogonalPath(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));

  // Drop consecutive duplicates first
  const dedup: Point[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) dedup.push({ ...p });
  }

  // Iteratively collapse three-in-a-row on the same axis until stable
  let result = dedup;
  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];
      if ((prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y)) {
        result = [...result.slice(0, i), ...result.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Sub-pixel jogs a hand-drag can leave behind: two parallel runs offset by
 * less than this many world px, joined by a tiny perpendicular step, are
 * fused onto the same line. Kept below the drag snap threshold so it only
 * ever swallows accidental offsets, never deliberate routing.
 */
export const MICRO_JOG_EPS = 2;

/**
 * Fuse micro jogs: when two parallel runs are joined by a perpendicular
 * step shorter than `eps`, align one run onto the other so the wire reads
 * as a single straight line. The run NOT anchored to a wire endpoint moves
 * (the shorter one when both are free); a jog anchored to endpoints on
 * both sides is structural and stays. Runs until stable.
 */
export function fuseMicroJogs(pts: Point[], eps: number = MICRO_JOG_EPS): Point[] {
  const out = pts.map((p) => ({ ...p }));
  if (out.length < 4) return out;

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i + 2 < out.length; i++) {
      const a = out[i - 1];
      const p = out[i];
      const q = out[i + 1];
      const b = out[i + 2];
      const beforeAnchored = i - 1 === 0;
      const afterAnchored = i + 2 === out.length - 1;

      // Horizontal micro jog joining two vertical runs
      if (
        p.y === q.y && p.x !== q.x && Math.abs(p.x - q.x) <= eps &&
        a.x === p.x && a.y !== p.y && b.x === q.x && b.y !== q.y
      ) {
        if (beforeAnchored && afterAnchored) continue;
        const moveAfter = beforeAnchored
          ? true
          : afterAnchored
            ? false
            : Math.abs(b.y - q.y) <= Math.abs(p.y - a.y);
        if (moveAfter) {
          q.x = p.x;
          b.x = p.x;
        } else {
          a.x = q.x;
          p.x = q.x;
        }
        changed = true;
      } else if (
        // Vertical micro jog joining two horizontal runs
        p.x === q.x && p.y !== q.y && Math.abs(p.y - q.y) <= eps &&
        a.y === p.y && a.x !== p.x && b.y === q.y && b.x !== q.x
      ) {
        if (beforeAnchored && afterAnchored) continue;
        const moveAfter = beforeAnchored
          ? true
          : afterAnchored
            ? false
            : Math.abs(b.x - q.x) <= Math.abs(p.x - a.x);
        if (moveAfter) {
          q.y = p.y;
          b.y = p.y;
        } else {
          a.y = q.y;
          p.y = q.y;
        }
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Build an SVG path through an orthogonal polyline with rounded bends.
 * Every interior corner is shortened by the bend radius on both sides and
 * bridged with a quadratic curve whose control point is the corner itself.
 * Corners whose adjacent segments are too short to fit a visible arc fall
 * back to a hard corner.
 */
export function roundedPathFromPoints(
  pts: Point[],
  radius: number = WIRE_BEND_RADIUS,
  jumps?: Map<number, number[]>,
): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

  let pen = pts[0];
  let d = `M ${pen.x} ${pen.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const corner = pts[i];
    const next = pts[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.75 || inLen === 0 || outLen === 0) {
      d += runWithJumps(pen, corner, jumps?.get(i - 1));
      pen = corner;
      continue;
    }
    const inX = corner.x - ((corner.x - prev.x) / inLen) * r;
    const inY = corner.y - ((corner.y - prev.y) / inLen) * r;
    const outX = corner.x + ((next.x - corner.x) / outLen) * r;
    const outY = corner.y + ((next.y - corner.y) / outLen) * r;
    d += runWithJumps(pen, { x: inX, y: inY }, jumps?.get(i - 1));
    d += ` Q ${corner.x} ${corner.y} ${outX} ${outY}`;
    pen = { x: outX, y: outY };
  }
  const last = pts[pts.length - 1];
  d += runWithJumps(pen, last, jumps?.get(pts.length - 2));
  return d;
}

interface AxisSeg {
  a: Point;
  b: Point;
}

/**
 * Horizontal runs hop over vertical runs with a semicircle. A T-junction
 * (the crossing sits on either segment's end) is a real connection and
 * stays flat.
 */
function jumpCenters(horizontal: AxisSeg, foreign: Point[][]): number[] {
  // Endpoint margin: skip T-junctions and leave room for the arc itself.
  // Bend clearance is handled when the rounded path shortens corner legs.
  const margin = WIRE_JUMP_RADIUS + 2;
  const y = horizontal.a.y;
  const h0 = Math.min(horizontal.a.x, horizontal.b.x);
  const h1 = Math.max(horizontal.a.x, horizontal.b.x);
  if (h1 - h0 < margin * 2) return [];
  const centers: number[] = [];
  for (const poly of foreign) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      if (a.x !== b.x) continue;
      const x = a.x;
      const v0 = Math.min(a.y, b.y);
      const v1 = Math.max(a.y, b.y);
      if (x < h0 + margin || x > h1 - margin) continue;
      if (y < v0 + margin || y > v1 - margin) continue;
      centers.push(x);
    }
  }
  return centers;
}

/** Straight run, with semicircular hops where this horizontal segment crosses another wire. */
function runWithJumps(from: Point, to: Point, centers: number[] | undefined): string {
  if (from.y !== to.y || !centers?.length) return ` L ${to.x} ${to.y}`;
  const dir = to.x >= from.x ? 1 : -1;
  const r = WIRE_JUMP_RADIUS;
  const ordered = [...centers].sort((p, q) => dir * (p - q));
  let cursor = from.x;
  let d = '';
  for (const c of ordered) {
    const approach = c - dir * r;
    const leave = c + dir * r;
    if (dir * (approach - cursor) < 1) continue;
    if (dir * (to.x - leave) < 1) continue;
    // sweep=0 arcs "up" (smaller y) for both L→R and R→L in SVG y-down space.
    d += ` L ${approach} ${from.y} A ${r} ${r} 0 0 0 ${leave} ${from.y}`;
    cursor = leave;
  }
  d += ` L ${to.x} ${to.y}`;
  return d;
}

/** Orthogonal polyline actually drawn for a wire. */
export function orthogonalPolyline(
  start: Point,
  waypoints: Point[] | undefined,
  end: Point,
): Point[] {
  return simplifyOrthogonalPath(
    fuseMicroJogs(expandOrthogonalPoints([start, ...(waypoints ?? []), end])),
  );
}

/**
 * Same path as `generateOrthogonalPath`, plus a semicircle on each
 * horizontal run where it crosses another wire in the middle.
 */
export function pathWithCrossJumps(pts: Point[], foreign: Point[][]): string {
  if (pts.length < 2) return roundedPathFromPoints(pts);
  const jumps = new Map<number, number[]>();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.y !== b.y) continue;
    const centers = jumpCenters({ a, b }, foreign);
    if (centers.length) jumps.set(i, centers);
  }
  return roundedPathFromPoints(pts, WIRE_BEND_RADIUS, jumps);
}

/**
 * Generate the SVG path for a wire: expand the stored points into the
 * orthogonal polyline, drop degenerate geometry (duplicates, collinear
 * runs, U-turns that render the wire on top of itself), then emit rounded
 * bends. The cleanup runs at render time so wires saved with degenerate
 * waypoints display correctly without touching the stored data.
 */
export function generateOrthogonalPath(
  start: Point,
  waypoints: Point[] | undefined,
  end: Point,
): string {
  const points: Point[] = [start, ...(waypoints ?? []), end];
  if (points.length < 2) return '';
  return roundedPathFromPoints(
    simplifyOrthogonalPath(fuseMicroJogs(expandOrthogonalPoints(points))),
  );
}

/**
 * Elbow point for a leg between `from` and a free point (mouse cursor or
 * the just-clicked destination pin): the longer axis goes first. Returns
 * null when the leg is already axis-aligned (no elbow needed).
 */
export function previewElbow(from: Point, x: number, y: number): Point | null {
  const dx = Math.abs(x - from.x);
  const dy = Math.abs(y - from.y);
  if (dx === 0 || dy === 0) return null;
  return dx >= dy ? { x, y: from.y } : { x: from.x, y };
}

/**
 * Live preview while drawing: fixed waypoints render like a committed wire;
 * the last leg (to the mouse cursor) adapts its elbow orientation based on
 * whether the horizontal or vertical distance is larger.
 */
export function generatePreviewPath(
  start: Point,
  waypoints: Point[],
  mouseX: number,
  mouseY: number,
): string {
  const fixed = expandOrthogonalPoints([start, ...waypoints]);
  const last = fixed[fixed.length - 1];
  const elbow = previewElbow(last, mouseX, mouseY);
  const pts = simplifyOrthogonalPath([
    ...fixed,
    ...(elbow ? [elbow] : []),
    { x: mouseX, y: mouseY },
  ]);
  return roundedPathFromPoints(pts);
}

/**
 * Canonical stored waypoints for a wire: every interior corner of the
 * simplified orthogonal polyline, so the stored data matches exactly what
 * is rendered. Call with the final endpoint positions (creation and drag
 * commits) — not with stale/unresolved pins.
 */
export function normalizeWireWaypoints(start: Point, waypoints: Point[], end: Point): Point[] {
  const simplified = simplifyOrthogonalPath(
    fuseMicroJogs(expandOrthogonalPoints([start, ...waypoints, end])),
  );
  return simplified.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
}
