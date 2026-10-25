import { describe, expect, test } from "bun:test";
import { CHART, layoutChart, spread, stairs, valueY, type ChartPoint } from "../frontend/src/estimate-chart.ts";

/** The path's corners, in order. The path uses only M, H and V, so every segment is horizontal or vertical. */
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

const DAY = 86_400_000, START = Date.parse("2026-10-01T14:00:00Z");
const at = (days: number) => new Date(START + days * DAY).toISOString();

describe("The estimate chart's geometry", () => {
  test("values map to whole pixels from the top of the plot (100%) to its baseline (0%)", () => {
    expect(valueY(100)).toBe(CHART.top);
    expect(valueY(0)).toBe(CHART.top + CHART.plotHeight);
    expect(valueY(35)).toBe(CHART.top + 78);
    expect(valueY(88.4)).toBe(CHART.top + Math.round(11.6 * 1.2));
    expect(valueY(140)).toBe(CHART.top);
    expect(valueY(-5)).toBe(CHART.top + CHART.plotHeight);
  });

  test("time runs left to right, with close points pushed apart and crowded ones spaced evenly", () => {
    const xs = spread([0, 1, 2, 100], 40, 240, 12);
    expect(xs[0]).toBe(40);
    expect(xs.at(-1)).toBe(240);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(12);
    // Two changes at the same moment as the start still get their own place.
    expect(spread([5, 5, 5], 40, 240, 12)).toEqual([40, 140, 240]);
    // More points than fit at the minimum gap are spaced evenly, in order.
    const crowded = spread(Array.from({ length: 30 }, (_, i) => i), 40, 240, 12);
    expect(crowded[0]).toBe(40);
    expect(crowded.at(-1)).toBe(240);
    for (let i = 1; i < crowded.length; i++) expect(crowded[i]!).toBeGreaterThan(crowded[i - 1]!);
    expect(spread([7], 40, 240, 12)).toEqual([40]);
  });

  test("time lowers the line in falling stairs of at most 2 pixels that land on the target", () => {
    const steps = corners(`M 40 30${stairs(40, 30, 140, 41)}`);
    expect(steps.at(-1)).toEqual([140, 41]);
    for (let i = 1; i < steps.length; i++) {
      const [x0, y0] = steps[i - 1]!, [x1, y1] = steps[i]!;
      expect(x1).toBeGreaterThanOrEqual(x0);
      expect(y1 - y0).toBeGreaterThanOrEqual(0);
      expect(y1 - y0).toBeLessThanOrEqual(2);
    }
    // No drop is a flat hold to the next point.
    expect(stairs(40, 30, 140, 30)).toBe(" H 140");
  });

  test("a timeline becomes one stepped line through each value, with a marker at the start, each attempt and each adjustment", () => {
    const points: ChartPoint[] = [
      { at: at(0), kind: "START", before: null, after: 50, label: "Starting point" },
      { at: at(2), kind: "ATTEMPT", before: 48.4, after: 95, label: "Assessed attempt · Practice 1 · Independent success" },
      { at: at(6), kind: "ADJUSTMENT", before: 90.8, after: 70, label: "Your adjustment" },
      { at: at(18), kind: "TIME", before: 70, after: 61, label: "Time without practice" },
    ];
    const chart = layoutChart(points, 252);
    const path = corners(chart.path);
    for (const [x, y] of path) { expect(Number.isInteger(x)).toBe(true); expect(Number.isInteger(y)).toBe(true); }
    // The line starts at the starting value and ends at the value now, at the right of the plot.
    expect(path[0]).toEqual([CHART.left + CHART.inset, valueY(50)]);
    expect(path.at(-1)).toEqual([chart.end.x, valueY(61)]);
    expect(chart.end).toMatchObject({ x: 252 - CHART.right - CHART.inset, value: 61 });
    // Each change's before and after values are corners of the line.
    for (const p of points.slice(1)) expect(path.some(([, y]) => y === valueY(p.after))).toBe(true);
    expect(path.some(([, y]) => y === valueY(48.4))).toBe(true);
    expect(path.some(([, y]) => y === valueY(90.8))).toBe(true);
    // Time is drawn by the line itself, so it has no marker.
    expect(chart.markers.map((m) => m.point.kind)).toEqual(["START", "ATTEMPT", "ADJUSTMENT"]);
    for (const m of chart.markers) {
      expect(m.y).toBe(valueY(m.point.after));
      expect(m.hit % 2).toBe(0);
      expect(m.hit).toBeGreaterThanOrEqual(12);
      expect(m.hit).toBeLessThanOrEqual(CHART.hit);
    }
    expect(chart.ticks.map((t) => t.value)).toEqual([80, 65, 35]);
    expect(chart.height).toBe(valueY(0) + CHART.axis);
  });

  test("a provisional timeline with only its starting point is a flat line across the plot", () => {
    const chart = layoutChart([{ at: at(0), kind: "START", before: null, after: 40, label: "Starting point" }], 252);
    expect(corners(chart.path)).toEqual([[CHART.left + CHART.inset, valueY(40)], [252 - CHART.right - CHART.inset, valueY(40)]]);
    expect(chart.markers).toHaveLength(1);
    expect(chart.end.value).toBe(40);
  });
});
