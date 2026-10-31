import { expect, test } from "bun:test";
import { finishedLessonOffer, type FinishedLessonSession } from "../frontend/src/finished-lesson.ts";

const lesson = (status: FinishedLessonSession["status"], materials: string[] = ["notes", "slides"]): FinishedLessonSession =>
  ({ lesson: { request: "Explain products.", explanation: "Match a row to a column." }, status, materials });
const task = (status: FinishedLessonSession["status"]): FinishedLessonSession => ({ lesson: null, status, materials: ["notes"] });
const none = new Set<string>();

test("a finished lesson that is not archived offers Continue", () => {
  expect(finishedLessonOffer(lesson("CLOSED"), false, none)).toBe("continue");
  // A lesson that lost only some of its materials still has a source to answer from.
  expect(finishedLessonOffer(lesson("CLOSED"), false, new Set(["notes"]))).toBe("continue");
  // A lesson finished before its opening explanation arrived can be continued too; the retry then writes the opening.
  expect(finishedLessonOffer({ ...lesson("CLOSED"), lesson: { request: "Explain products.", explanation: "" } }, false, none)).toBe("continue");
});

test("an archived finished lesson offers no Continue, because the page offers Restore conversation for it", () => {
  expect(finishedLessonOffer(lesson("CLOSED"), true, none)).toBeNull();
  expect(finishedLessonOffer(lesson("CLOSED", ["notes"]), true, new Set(["notes"]))).toBeNull();
});

test("a finished lesson whose every material was deleted says so instead of offering Continue", () => {
  expect(finishedLessonOffer(lesson("CLOSED"), false, new Set(["notes", "slides", "other"]))).toBe("sources-gone");
  // A lesson with no saved material is not one whose materials were all deleted.
  expect(finishedLessonOffer(lesson("CLOSED", []), false, new Set(["notes"]))).toBe("continue");
});

test("an open lesson and a practice task, open or submitted, are not finished lessons", () => {
  expect(finishedLessonOffer(lesson("OPEN"), false, none)).toBeNull();
  expect(finishedLessonOffer(lesson("OPEN"), false, new Set(["notes", "slides"]))).toBeNull();
  for (const status of ["OPEN", "CLOSED"] as const) {
    expect(finishedLessonOffer(task(status), false, none)).toBeNull();
    expect(finishedLessonOffer(task(status), true, none)).toBeNull();
  }
});
