import { expect, test } from "bun:test";
import { allCovered, toggleAll } from "../frontend/src/exam-cover.ts";

// Two topics of a course: forces has three skills and waves has two.
const forces = ["newton", "friction", "momentum"], waves = ["frequency", "interference"], everything = [...forces, ...waves];

test("a group is complete only when it has skills and every one of them is covered", () => {
  expect(allCovered([], forces)).toBe(false);
  expect(allCovered(["newton", "friction"], forces)).toBe(false);
  expect(allCovered(["momentum", "frequency", "newton", "friction"], forces)).toBe(true);
  expect(allCovered(forces, everything)).toBe(false);
  expect(allCovered(everything, everything)).toBe(true);
  // A group with no skills has nothing to clear, so its button offers Select all.
  expect(allCovered([], [])).toBe(false);
  expect(allCovered(["newton"], [])).toBe(false);
});

test("Select all adds the group's missing skills after the ones already chosen, in the group's order", () => {
  expect(toggleAll([], everything)).toEqual(everything);
  expect(toggleAll(["interference", "friction"], everything)).toEqual(["interference", "friction", "newton", "momentum", "frequency"]);
  expect(allCovered(toggleAll(["friction"], everything), everything)).toBe(true);
});

test("Clear removes the group's skills once every one of them is covered", () => {
  expect(toggleAll(everything, everything)).toEqual([]);
  expect(toggleAll(["frequency", ...forces], forces)).toEqual(["frequency"]);
});

test("a topic's button leaves the skills of other topics as they were", () => {
  // Selecting waves keeps the one force already chosen.
  expect(toggleAll(["friction"], waves)).toEqual(["friction", "frequency", "interference"]);
  // Clearing forces keeps both waves.
  expect(toggleAll(["frequency", "newton", "interference", "friction", "momentum"], forces)).toEqual(["frequency", "interference"]);
  // Pressing a topic's button twice returns the selection it started from when that topic began empty.
  expect(toggleAll(toggleAll(["frequency"], forces), forces)).toEqual(["frequency"]);
});

test("the result names each skill once and leaves the list it was given unchanged", () => {
  const covered = ["newton", "newton", "frequency"];
  expect(toggleAll(covered, forces)).toEqual(["newton", "frequency", "friction", "momentum"]);
  expect(toggleAll(["newton", "newton", "friction", "momentum"], forces)).toEqual([]);
  expect(covered).toEqual(["newton", "newton", "frequency"]);
  // A group with no skills changes nothing.
  expect(toggleAll(["newton"], [])).toEqual(["newton"]);
});
