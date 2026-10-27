/** A test client's call that expects success and returns the response body, which each test client leaves untyped. */
type Ok = (path: string, body: Record<string, unknown>) => Promise<any>;

/**
 * Starts a lesson the way the study page does. `/learning/lesson` saves the lesson with the learner's request and asks no
 * tutor; `/learning/reply` then asks the tutor for its opening explanation. Returns the lesson and the tutor that wrote it.
 */
export async function openLesson(ok: Ok, input: { skill: string; request: string }): Promise<{ lesson: string; tutor: { model: string; level: string } }> {
  const { lesson } = await ok("/learning/lesson", input);
  const { tutor } = await ok("/learning/reply", { studySession: lesson });
  return { lesson, tutor };
}
