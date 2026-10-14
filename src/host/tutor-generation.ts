import { CourseTutor, objectSchema } from "./tutor.ts";
import type { TutorRequest, TutorAnswer } from "../learning-data.ts";
import type { PassageSet } from "../concepts/GroundedTutoring/dialogue.ts";
const text = { type: "string" };
const cited = (field: string) => objectSchema({ [field]: text, citations: { type: "array", minItems: 1, items: objectSchema({ material: text, location: text }) } });
const prompts = {
  LESSON: "Explain the selected skill in response to the learner's request. Give one worked example when useful. Cite exact supplied material/location pairs.",
  TASK: "Create one fresh assessment containing the COMPLETE gate, normally two new problems plus a why/how question. Use different numbers and situations from worked examples and previous questions. Include all data needed to answer. Do not include solutions, hints, or criteria that reveal the method. Cite the source that supports the skill.",
  REPLY: "Answer the latest learner question in this lesson. Cite exact supplied material/location pairs.",
  HINT: "Give one small hint for the practice task. Do not give the full answer. The learner explicitly requested help; the saved attempt records it.",
  GRADE: "Assess the saved work against ALL saved criteria. Do not solve missing parts for the learner. Check every result and the reasoning. Return INDEPENDENT only if help is NONE and the answer is correct. With help, a correct answer is SUPPORTED. SLIP is a small execution error with a sound method. GAP means missing or wrong understanding. Use UNCERTAIN when work cannot be read or judged. gateMet is true only if fresh is true, result is INDEPENDENT, and the complete saved demonstration gate is met. A manual clarification can explain original work but cannot count as a new solution. Explain the judgment in plain language. Address the learner directly. Say requirements, new problems, and without hints. Do not expose internal field names or uppercase status codes.",
};
/** Provider transport and output validation only. It cannot read or write concept state. */
export function tutorGenerator(tutor: Pick<CourseTutor, "generate" | "suggest">) {
  return async (owner: string, request: TutorRequest): Promise<TutorAnswer> => {
    const answer: TutorAnswer = { text: "", citations: [], materials: request.sources.map((source) => source.material),
      result: "UNCERTAIN", gateMet: false, rationale: "", suggestions: { unitTitle: "", skills: [] } };
    if (!request.sources.length || request.sources.some((source) => source.data.owner !== owner)) throw new Error("Invalid sources");
    if (request.kind === "SUGGEST") { answer.suggestions = await tutor.suggest(owner, request.sources[0]!); return answer; }
    const field = request.kind === "LESSON" ? "explanation" : request.kind === "TASK" ? "question" : "text";
    const schema = request.kind === "GRADE" ? objectSchema({ result: { type: "string", enum: ["INDEPENDENT", "SUPPORTED", "SLIP", "GAP", "UNCERTAIN"] }, gateMet: { type: "boolean" }, rationale: text })
      : request.kind === "HINT" ? objectSchema({ text }) : cited(field);
    const result = await tutor.generate(owner, request.sources, prompts[request.kind], request.context, schema, request.work) as Record<string, unknown>;
    if (request.kind === "GRADE") {
      const context = request.context as { help: string; fresh: boolean };
      if (typeof result.rationale !== "string" || !result.rationale.trim() || typeof result.gateMet !== "boolean" ||
        !["INDEPENDENT", "SUPPORTED", "SLIP", "GAP", "UNCERTAIN"].includes(String(result.result)) ||
        (result.result === "INDEPENDENT" && context.help !== "NONE") || (result.gateMet && (result.result !== "INDEPENDENT" || !context.fresh))) throw new Error("Invalid assessment");
      return { ...answer, result: result.result as TutorAnswer["result"], gateMet: result.gateMet, rationale: result.rationale };
    }
    if (typeof result[field] !== "string" || !(result[field] as string).trim() || (result[field] as string).length > 30000) throw new Error("Incomplete content");
    answer.text = result[field] as string;
    if (request.kind === "TASK" && (request.context as { previousQuestions: string[] }).previousQuestions.includes(answer.text)) throw new Error("Repeated task");
    if (request.kind !== "HINT") {
      if (!Array.isArray(result.citations) || !result.citations.length) throw new Error("Missing citations");
      answer.citations = result.citations.map((part: PassageSet[number]) => {
        const source = request.sources.find((source) => source.material === part.material);
        if (!source || typeof part.location !== "string" || !(part.location === "content" && source.data.content.trim()) &&
          !source.data.originals.some((file) => file.renditions.some((rendition) => rendition.location === part.location))) throw new Error("Invalid citation");
        return { material: part.material, location: part.location };
      });
    }
    return answer;
  };
}
