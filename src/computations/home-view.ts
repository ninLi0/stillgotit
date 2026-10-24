/** The two home views a learner can choose: the skill tree or the task list. */
export type HomeView = "tree" | "tasks";

/** The offered home views. The set is fixed in code, so it cannot change while the server runs. */
export const HOME_VIEWS: readonly HomeView[] = Object.freeze(["tree", "tasks"]);

/** The view a learner sees when they have chosen none. */
export const DEFAULT_HOME_VIEW: HomeView = "tree";

/** Holds when view is exactly one of the offered home views, including case. */
export function homeViewOffered({ view }: { view: string }): boolean {
  return (HOME_VIEWS as readonly string[]).includes(view);
}

/** Names an offered home view. Flows use it only after homeViewOffered holds. */
export function offeredHomeView({ view }: { view: string }): HomeView {
  if (!homeViewOffered({ view })) throw new Error("offeredHomeView requires an offered home view.");
  return view as HomeView;
}

/** The home view that applies when nothing is saved: the skill tree. */
export function defaultHomeView(_input: Record<string, never>): HomeView {
  return DEFAULT_HOME_VIEW;
}
