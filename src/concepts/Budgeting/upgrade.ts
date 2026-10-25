import type { Db, Document } from "mongodb";

/**
 * Rewrites documents that an instance saved before this concept was named Budgeting. Those documents call deadlines
 * `exams`, give each one an `exam` identity, and list a candidate's deadlines in `examRefs`; plan inputs and candidates
 * kept inside items and deferred lists use the same names. They may also hold totals, cuts, and approved cuts that the
 * queries now compute. Each such document is rewritten once in the current shape with the same values, so its
 * deadlines, plans, and recorded time stay as they were. The host runs this at startup, before any request arrives.
 * Documents already in the current shape are not touched, and a document that another writer changed in the meantime
 * keeps the old shape until the next start.
 */
export async function upgradeEarlierDocuments(database: Db, name: string): Promise<number> {
  const owners = database.collection(`${name.toLowerCase()}.learners`);
  let upgraded = 0;
  for await (const saved of owners.find({ "preferences.exams": { $exists: true } })) {
    const record = { ...saved, revision: saved.revision + 1, preferences: saved.preferences.map(preferences) };
    if ((await owners.replaceOne({ _id: saved._id, revision: saved.revision }, record)).matchedCount) upgraded++;
  }
  return upgraded;
}

const deadline = ({ exam, ...rest }: Document) => ({ deadline: exam, ...rest });
const candidate = ({ examRefs, ...rest }: Document) => ({ ...rest, deadlineRefs: examRefs });
const item = (value: Document) => ({ ...value, candidate: candidate(value.candidate) });

function preferences(value: Document) {
  if (!("exams" in value)) return value;
  const { exams, approvedExamCuts: _, ...rest } = value;
  return { ...rest, deadlines: exams.map(deadline), plans: rest.plans.map(plan) };
}

function plan(value: Document) {
  const { focusExam: _focus, examUrgent: _urgent, estimatedExamMinutes: _required, availableExamMinutes: _available, examCuts: _cuts,
    needsConfirmation: _confirmation, ...rest } = value;
  const { exams, ...inputs } = rest.inputs;
  return { ...rest, inputs: { ...inputs, deadlines: exams.map(deadline), work: inputs.work.map(item) },
    deferred: rest.deferred.map(candidate), items: rest.items.map(item) };
}
