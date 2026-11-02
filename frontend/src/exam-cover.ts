// The "Select all" and "Clear" buttons of the exam form's "Skills it covers" list. Each button acts on one group of
// skill identities: every listed skill for the button above the list, or one topic's skills for that topic's button.
// The functions only compute the form's new selection, so saving an exam sends the same request as ticking each box.

/** True when the group has skills and every one of them is covered. An empty group is never complete, so its button offers to select. */
export function allCovered(covered: readonly string[], skills: readonly string[]): boolean {
  const chosen = new Set(covered);
  return skills.length > 0 && skills.every((skill) => chosen.has(skill));
}

/**
 * The covered skills after the group's button is pressed. When every skill of the group is covered, the group's skills
 * are removed. Otherwise the group's missing skills are added after the skills already chosen, in the group's order.
 * Skills outside the group keep their state either way, and the result names each skill once.
 */
export function toggleAll(covered: readonly string[], skills: readonly string[]): string[] {
  const kept = [...new Set(covered)];
  if (allCovered(kept, skills)) {
    const group = new Set(skills);
    return kept.filter((skill) => !group.has(skill));
  }
  return [...new Set([...kept, ...skills])];
}
