import { describe, expect, test } from "bun:test";
import { CHART, valueY, type ChartPoint } from "../frontend/src/estimate-chart.ts";
import {
  DEFAULT_LINE, HORIZON, STAGE_LINES, THRESHOLD_LINE, assignLanes, chartFrame, dayX, labelWidth, layoutDefault, layoutShaped,
  layoutSkills, pastShare, reviewOrder, stageLine, standing, steppedPath, type DayValue, type ReviewRow,
} from "../frontend/src/memory-chart.ts";

/** The path's corners, in order. The paths use only M, H and V, so every segment is horizontal or vertical. */
function corners(path: string): [number, number][] {
  const tokens = path.trim().split(/\s+/), out: [number, number][] = [];
  let x = 0, y = 0;
  for (let i = 0; i < tokens.length; i++) {
    const command = tokens[i];
    if (command === "M") { x = Number(tokens[++i]); y = Number(tokens[++i]); }
    else if (command === "H") x = Number(tokens[++i]);
    else if (command === "V") y = Number(tokens[++i]);
    else throw new Error(`Unexpected path command ${command}`);
    out.push([x, y]);
  }
  return out;
}
const whole = (path: string) => corners(path).every(([x, y]) => Number.isInteger(x) && Number.isInteger(y));
const has = (path: string, x: number, y: number) => corners(path).some(([cx, cy]) => cx === x && cy === y);

// The test's own copy of the policy's curve, standing in for the values the memory read answers.
const SAMPLES = [1, 3, 7, 14, 30, 60, 90];
const fall = (value: number, days: number) => value * 2 ** (-days / 60);
const REFERENCE: DayValue[] = [0, ...SAMPLES].map((days) => ({ days, value: fall(100, days) }));
const projection = (value: number) => SAMPLES.map((days) => ({ days, value: fall(value, days) }));
const DAY = 86_400_000, TODAY = Date.parse("2026-10-26T16:00:00Z");
const at = (days: number) => new Date(TODAY + days * DAY).toISOString();

function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("The Memory view's chart geometry", () => {
  test("a frame keeps the estimate chart's gutters and scale, and days map to whole pixels from today to day 90", () => {
    const frame = chartFrame(520);
    expect(frame.width).toBe(520);
    expect(frame.plot).toEqual({ left: CHART.left, right: 520 - CHART.right, top: CHART.top, bottom: valueY(0) });
    expect(frame.height).toBe(valueY(0) + CHART.axis);
    expect(chartFrame(100).width).toBe(240);
    expect(chartFrame(333.7).width).toBe(333);
    expect(dayX(0, 40, 400)).toBe(40);
    expect(dayX(HORIZON, 40, 400)).toBe(400);
    expect(dayX(45, 40, 400)).toBe(220);
    expect(dayX(-3, 40, 400)).toBe(40);
    expect(dayX(500, 40, 400)).toBe(400);
    expect(Number.isInteger(dayX(7, 40, 401))).toBe(true);
  });

  test("a stepped line falls in 2-pixel stairs, rises at the later point, and knows how far along each point sits", () => {
    const line = steppedPath([{ x: 40, y: 20 }, { x: 140, y: 61 }, { x: 180, y: 30 }, { x: 220, y: 30 }]);
    expect(whole(line.d)).toBe(true);
    const steps = corners(line.d);
    expect(steps[0]).toEqual([40, 20]);
    expect(steps.at(-1)).toEqual([220, 30]);
    // The fall from 20 to 61: no step down is taller than 2 pixels, and the line never rises on the way.
    const falling = steps.slice(0, steps.findIndex(([x, y]) => x === 140 && y === 61) + 1);
    for (let i = 1; i < falling.length; i++) {
      expect(falling[i]![1] - falling[i - 1]![1]).toBeLessThanOrEqual(2);
      expect(falling[i]![1]).toBeGreaterThanOrEqual(falling[i - 1]![1]);
    }
    // The rise holds the level to the later point, then steps straight up.
    expect(line.d).toContain("H 180 V 30");
    expect(line.lengths).toEqual([0, 100 + 41, 141 + 40 + 31, 212 + 40]);
    expect(line.length).toBe(252);
    expect(steppedPath([])).toEqual({ d: "", lengths: [], length: 0 });
  });

  test("the default curve runs from 100% today to its day-90 value, under a review line at the threshold", () => {
    const layout = layoutDefault(REFERENCE, 70, 400);
    expect(whole(layout.path)).toBe(true);
    const steps = corners(layout.path);
    expect(steps[0]).toEqual([layout.frame.inner.left, valueY(100)]);
    expect(steps.at(-1)).toEqual([layout.frame.inner.right, valueY(fall(100, 90))]);
    for (let i = 1; i < steps.length; i++) expect(steps[i]![1]).toBeGreaterThanOrEqual(steps[i - 1]![1]);
    expect(has(layout.path, dayX(60, layout.frame.inner.left, layout.frame.inner.right), valueY(50))).toBe(true);
    expect(layout.threshold).toEqual({ value: 70, y: valueY(70) });
    expect(layout.days.map((d) => d.days)).toEqual([0, 30, 60, 90]);
    expect(layout.end).toEqual({ x: layout.frame.inner.right, y: valueY(fall(100, 90)), value: fall(100, 90) });
    // How far along the line each answered day sits: 0 at the start, 1 at the end, growing in between.
    expect(layout.reach.get(0)).toBe(0);
    expect(layout.reach.get(90)).toBe(1);
    expect(layout.reach.get(60)!).toBeGreaterThan(layout.reach.get(30)!);
    expect(layout.reach.get(60)!).toBeLessThan(1);
  });

  test("each skill's line starts at its estimate in its stage's green, and its review day sits on its own line", () => {
    const skills = [
      { skill: "a", estimate: 95, projection: projection(95), reviewBy: { days: 27, value: fall(95, 27) } },
      { skill: "b", estimate: 50, projection: projection(50), reviewBy: null },
      { skill: "c", estimate: 92, projection: projection(92), reviewBy: { days: 24, value: fall(92, 24) } },
      { skill: "d", estimate: 95, projection: projection(95), reviewBy: { days: 27, value: fall(95, 27) } },
    ];
    const layout = layoutSkills(skills, REFERENCE, 70, 520, (days) => `Day ${days}`);
    const x = (days: number) => dayX(days, layout.frame.inner.left, layout.frame.inner.right);
    expect(layout.lines.map((l) => l.color)).toEqual([STAGE_LINES.bloom, STAGE_LINES.leaf, STAGE_LINES.bloom, STAGE_LINES.bloom]);
    for (const line of layout.lines) expect(whole(line.d)).toBe(true);
    expect(corners(layout.lines[1]!.d)[0]).toEqual([x(0), valueY(50)]);
    expect(has(layout.lines[0]!.d, x(27), valueY(fall(95, 27)))).toBe(true);
    expect(has(layout.lines[2]!.d, x(24), valueY(fall(92, 24)))).toBe(true);
    // Skills reviewing on the same day share a flag; a skill already below has none. Flags come in day order.
    expect(layout.flags.map((f) => [f.days, f.skills])).toEqual([[24, ["c"]], [27, ["a", "d"]]]);
    expect(layout.flags.map((f) => f.label)).toEqual(["Day 24", "Day 27"]);
    // The two labels are 3 days apart, too close to share a lane.
    expect(layout.flags.map((f) => f.lane)).toEqual([0, 1]);
    for (const f of layout.flags) {
      expect(f.x).toBe(x(f.days));
      expect(f.reach).toBeGreaterThan(0);
      expect(f.reach).toBeLessThan(1);
    }
    expect(corners(layout.reference)[0]).toEqual([x(0), valueY(100)]);
  });

  test("labels take the first lane where they clear the label before them, and stay inside the plot", () => {
    expect(assignLanes([{ x: 100, width: 40 }, { x: 110, width: 40 }, { x: 200, width: 40 }, { x: 120, width: 40 }], 30, 400)).toEqual([0, 1, 0, 2]);
    expect(assignLanes([{ x: 100, width: 40 }, { x: 146, width: 40 }], 30, 400)).toEqual([0, 0]);
    expect(assignLanes([{ x: 100, width: 40 }, { x: 145, width: 40 }], 30, 400)).toEqual([0, 1]);
    // A label near an edge is pushed inside, which can crowd it into the next lane beside a label it would have cleared.
    expect(assignLanes([{ x: 340, width: 40 }, { x: 400, width: 40 }], 30, 400)).toEqual([0, 1]);
    expect(assignLanes([{ x: 330, width: 40 }, { x: 400, width: 40 }], 30, 400)).toEqual([0, 0]);
    expect(assignLanes([{ x: 32, width: 40 }, { x: 60, width: 40 }], 30, 400)).toEqual([0, 1]);
    expect(labelWidth("Nov 21")).toBe(Math.ceil(6 * 6.4) + 8);
  });

  test("the past takes its share of the width, between a fifth and three fifths", () => {
    expect(pastShare(0)).toBe(0.2);
    expect(pastShare(-4)).toBe(0.2);
    expect(pastShare(90)).toBe(0.5);
    expect(pastShare(10_000)).toBe(0.6);
  });

  test("a skill's shaped curve runs from its starting point through its evidence to today, then ahead, over the curve left alone", () => {
    const past: ChartPoint[] = [
      { at: at(-30), kind: "START", before: null, after: 50, label: "Starting point" },
      { at: at(-20), kind: "ATTEMPT", before: fall(50, 10), after: 95, label: "Assessed attempt" },
      { at: at(-5), kind: "ADJUSTMENT", before: fall(95, 15), after: 85, label: "Your adjustment" },
    ];
    const estimate = fall(85, 5);
    const leftAlone = [{ at: at(-30), value: 50 }, { at: at(0), value: fall(50, 30) }, ...SAMPLES.map((days) => ({ at: at(days), value: fall(50, 30 + days) }))];
    const layout = layoutShaped({ past, asOf: at(0), estimate, projection: projection(estimate), reviewBy: { days: 16, value: fall(estimate, 16) }, leftAlone, threshold: 70 }, 600);
    const { inner } = layout.frame;
    expect(layout.split).toBe(inner.left + Math.round(pastShare(30) * (inner.right - inner.left)));
    expect(whole(layout.path)).toBe(true);
    expect(whole(layout.leftAlone)).toBe(true);
    const steps = corners(layout.path);
    expect(steps[0]).toEqual([inner.left, valueY(50)]);
    expect(has(layout.path, layout.split, valueY(estimate))).toBe(true);
    expect(steps.at(-1)).toEqual([inner.right, valueY(fall(estimate, 90))]);
    // Markers for the starting point, the attempt and the adjustment, in order along the line.
    expect(layout.markers.map((m) => m.point.kind)).toEqual(["START", "ATTEMPT", "ADJUSTMENT"]);
    expect(layout.markers.map((m) => m.y)).toEqual([valueY(50), valueY(95), valueY(85)]);
    for (const m of layout.markers) { expect(has(layout.path, m.x, m.y)).toBe(true); expect(m.x).toBeLessThanOrEqual(layout.split); }
    const reaches = layout.markers.map((m) => m.reach);
    expect(reaches[0]).toBe(0);
    for (let i = 1; i < reaches.length; i++) expect(reaches[i]!).toBeGreaterThan(reaches[i - 1]!);
    // The attempt's rise: the line falls to the value before it, then steps straight up.
    expect(has(layout.path, layout.markers[1]!.x, valueY(fall(50, 10)))).toBe(true);
    // The curve left alone starts at the same starting point, passes today at its own value, and ends on day 90.
    const alone = corners(layout.leftAlone);
    expect(alone[0]).toEqual([inner.left, valueY(50)]);
    expect(has(layout.leftAlone, layout.split, valueY(fall(50, 30)))).toBe(true);
    expect(alone.at(-1)).toEqual([inner.right, valueY(fall(50, 120))]);
    expect(layout.flag).toEqual({ x: dayX(16, layout.split, inner.right), y: valueY(fall(estimate, 16)), days: 16, reach: expect.any(Number) });
    expect(layout.flag!.reach).toBeGreaterThan(layout.todayReach);
    expect(has(layout.path, layout.flag!.x, layout.flag!.y)).toBe(true);
  });

  test("a curve whose starting point is today begins a fifth of the way in and has no review flag past day 90", () => {
    const past: ChartPoint[] = [{ at: at(0), kind: "START", before: null, after: 100, label: "Starting point" }];
    const layout = layoutShaped({ past, asOf: at(0), estimate: 100, projection: projection(100), reviewBy: { days: 120, value: 25 },
      leftAlone: [{ at: at(0), value: 100 }, { at: at(0), value: 100 }, ...projection(100).map((p) => ({ at: at(p.days), value: p.value }))], threshold: 70 }, 300);
    expect(layout.split).toBe(layout.frame.inner.left + Math.round(0.2 * (layout.frame.inner.right - layout.frame.inner.left)));
    expect(layout.flag).toBeNull();
    expect(layout.markers).toHaveLength(1);
    expect(corners(layout.path)[0]).toEqual([layout.frame.inner.left, valueY(100)]);
  });

  test("the review list puts due skills first, lowest first, then coming reviews soonest first, then the rest", () => {
    const row = (skill: string, title: string, estimate: number | null, days: number | null, belowNow: boolean | null): ReviewRow =>
      ({ skill, title, estimate, reviewBy: days === null ? null : { days }, belowNow });
    const rows = [
      row("u", "Unstarted", null, null, null), row("h", "Holds", 99, 120, false), row("c2", "Later", 90, 21, false), row("d1", "Due higher", 60, null, true),
      row("c1", "Soon", 75, 4, false), row("d2", "Due lower", 30, null, true), row("c3", "Also soon", 75, 4, false),
    ];
    expect(rows.map(standing)).toEqual(["UNSTARTED", "HOLDS", "COMING", "DUE", "COMING", "DUE", "COMING"]);
    expect(reviewOrder(rows).map((r) => r.skill)).toEqual(["d2", "d1", "c3", "c1", "c2", "h", "u"]);
    expect(rows[0]!.skill).toBe("u");
  });

  test("line colours follow the growth stages and keep more than the 3:1 a line needs on white", () => {
    expect([10, 40, 70, 90].map(stageLine)).toEqual([STAGE_LINES.sprout, STAGE_LINES.leaf, STAGE_LINES.full, STAGE_LINES.bloom]);
    const ramp = [STAGE_LINES.sprout, STAGE_LINES.leaf, STAGE_LINES.full, STAGE_LINES.bloom].map((hex) => contrast(hex, "#FFFFFF"));
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]!).toBeGreaterThan(ramp[i - 1]!);
    expect(Math.min(...ramp)).toBeGreaterThanOrEqual(4.2);
    // The default curve on white and on the pale band of the days ahead (--inset), and the review threshold.
    expect(contrast(DEFAULT_LINE, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DEFAULT_LINE, "#F5F5F3")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THRESHOLD_LINE, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});
