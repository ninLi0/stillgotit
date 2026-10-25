import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Budgeting.md" with { type: "text" };
import { Budgeting } from "./Budgeting.ts";
import * as refusal from "./refusals.ts";

export const budgeting = registerConcept({
  class: Budgeting, spec, refusals: {
    INVALID_DAILY_BUDGET: refusal.InvalidDailyBudget,
    DEADLINE_PREFERENCES_UNAVAILABLE: refusal.DeadlinePreferencesUnavailable,
    INVALID_DEADLINE_DETAILS: refusal.InvalidDeadlineDetails,
    DEADLINE_REMOVE_UNAVAILABLE: refusal.DeadlineRemoveUnavailable,
    PLAN_PREFERENCES_UNAVAILABLE: refusal.PlanPreferencesUnavailable,
    PLAN_SESSION_IN_PROGRESS: refusal.PlanSessionInProgress,
    INVALID_PLAN_INPUT: refusal.InvalidPlanInput,
    ROUTINE_PLAN_UNAVAILABLE: refusal.RoutinePlanUnavailable,
    ROUTINE_SESSION_IN_PROGRESS: refusal.RoutineSessionInProgress,
    ROUTINE_PLAN_OUTDATED: refusal.RoutinePlanOutdated,
    DEADLINE_TRADEOFF_CONFIRMATION_REQUIRED: refusal.DeadlineTradeoffConfirmationRequired,
    TRADEOFF_PLAN_UNAVAILABLE: refusal.TradeoffPlanUnavailable,
    TRADEOFF_SESSION_IN_PROGRESS: refusal.TradeoffSessionInProgress,
    TRADEOFF_PLAN_OUTDATED: refusal.TradeoffPlanOutdated,
    TRADEOFF_CONFIRMATION_NOT_NEEDED: refusal.TradeoffConfirmationNotNeeded,
    PLAN_DECLINE_UNAVAILABLE: refusal.PlanDeclineUnavailable,
    ACTIVITY_BEGIN_UNAVAILABLE: refusal.ActivityBeginUnavailable,
    ANOTHER_ACTIVITY_IN_PROGRESS: refusal.AnotherActivityInProgress,
    ACTIVITY_NOT_SCHEDULED_TODAY: refusal.ActivityNotScheduledToday,
    ACTIVITY_EXCEEDS_REMAINING_BUDGET: refusal.ActivityExceedsRemainingBudget,
    ACTIVITY_FINISH_UNAVAILABLE: refusal.ActivityFinishUnavailable,
    INVALID_FINISH_TIME: refusal.InvalidFinishTime,
    ACTIVITY_STOP_UNAVAILABLE: refusal.ActivityStopUnavailable,
    INVALID_STOP_TIME: refusal.InvalidStopTime,
    ACTIVITY_MISS_UNAVAILABLE: refusal.ActivityMissUnavailable,
    ACTIVITY_MISS_TOO_EARLY: refusal.ActivityMissTooEarly,
  },
});
