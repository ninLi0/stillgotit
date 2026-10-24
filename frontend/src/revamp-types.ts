// Shared shapes between the revamp's screens (design/revamp/README.md), so the shell, the Forest view and the
// Materials viewer agree on their props and events without depending on each other's internals.

/** One skill as the grove, the Tasks view and the Forest view show it. */
export type ViewSkill = {
  skill: string;
  title: string;
  outcome: string;
  /** The current estimate, or null when the skill has none yet. */
  mastery: number | null;
  /** True when the plan has an item for this skill today. */
  dueToday: boolean;
  /** The plan day label when a review is scheduled later this week, such as "Thu". */
  reviewDay?: string;
  /** True when the skill has no evidence yet. */
  isNew?: boolean;
};

/** One topic (unit) with its confirmed skills. */
export type ViewUnit = { unit: string; title: string; emphasized?: boolean; skills: ViewSkill[] };

/** What the Forest view needs from the course page. */
export type ForestProps = { courseTitle: string; units: ViewUnit[]; design: number; selected?: string | null };
/** The Forest view's events: `close`; `open` and `practice` with a skill id; `select` with a skill id or null; `plant`; `regrow`. */

/** A skill shown beside a page in the Materials viewer. */
export type ViewerSkill = { skill: string; title: string; status: "DRAFT" | "CONFIRMED"; /** Source locations within this material, when known. */ locations?: string[] };
/** The viewer's request to open a lesson with a draft question about one page. */
export type AskAboutPage = { material: string; location: string; question: string };
/** The viewer's events: `ask` with AskAboutPage; `open-skill` and `review-draft` with a skill id. */

/** A citation or "Taught from" source the Learn screen asks the shell to open in Materials. */
export type OpenSource = { material: string; location: string };

export const HOME_VIEW_KEY = "stillgotit.homeView";
export type HomeView = "tree" | "tasks";
