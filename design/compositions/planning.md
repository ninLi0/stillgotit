# Study-plan refresh and activity progress

[SetBudget](reaction:Planning.SetBudget) checks the owned course and calls `StudyPlanning.configure`. [RefreshPlan](reaction:Planning.RefreshPlan) is also triggered after confidence initialization, accepted mastery evidence, a mastery adjustment, changed requirements or prerequisites, and finished, stopped, or missed work. Opening the app on a new study date requests a refresh separately from the read-only course response.

[PlanningContext](view:Planning.PlanningContext) combines current skill versions, prerequisite links, effective judgments, estimates, priorities, source availability, and StudyPlanning's preferences, exams, items, and spent time. Its basis includes these records and the study date. Derive the basis on the server; a browser or model cannot declare a proposal current.

Build candidates for learning, fresh checks, repairs, and reviews. Preserve keys for the same activity across proposals. A new review occasion or requirements version needs a new key. Include all known unfinished exam preparation and its prerequisite work. Mark incomplete workload estimates explicitly. The AI may suggest activities and durations; it cannot hide known work or approve exam cuts.

The initial review intervals are one, three, then seven days. Independent reviews on later study days advance the interval. Same-day recovery does not. Supported success adds a fresh unaided check and a next-day review. SLIP or GAP returns the interval to one day. These are test settings. A schedule still has to fit the budget, allowed dates, and exam constraints.

Use a seven-day horizon when no exam requires a longer one. P2 may propose one short next-review activity within that window; a slot must exist for its full estimated duration. Do not manufacture completion when nothing fits.

[SaveProposal](reaction:Planning.SaveProposal) checks that the request's context is still current, then calls `StudyPlanning.replan` with candidates, horizon, explanation, basis, and workloadComplete. Wait until the learner has no IN_PROGRESS activity. Coalesce refreshes during an activity and rebuild from current state after finish or stop; do not apply an old queued proposal.

[ActivateRoutine](reaction:Planning.ActivateRoutine) follows a proposal without new cuts. Recompute `currentBasis` and call `activateRoutine` while holding the learner's mutation lock. The action also checks its saved local inputs. The full exam flow must use a separate explicit learner request for `confirmTradeoffs`; a refresh or unchanged budget is not approval. P2's interface first exposes daily-budget planning. Exam management and cut confirmation remain in the P3 interface plan.

## Track activity time

[Begin](reaction:Planning.Begin) checks [EligibleActivity](view:Planning.EligibleActivity): the item is owned, active, scheduled for today, fits the remaining budget, and still refers to current requirements. A practice item also needs ready prerequisites or the explicit urgent-exam exception. Then call `StudyPlanning.begin`.

[Finish](reaction:Planning.Finish), [Stop](reaction:Planning.Stop), and [Miss](reaction:Planning.Miss) call their matching concept actions and request a refreshed plan. Record actual time even after wrong answers or a stopped session. A miss has no direct mastery effect. Preserve spent time and completed keys across every replacement.

[PlanState](view:Planning.PlanState) supplies the active plan, pending proposal, next item, current budget, deferred work, and any cuts. [PlanChange](former:Planning.PlanChange) returns those records after an update, or explains why no activity fits. A proposal awaiting confirmation does not replace the active plan.

```endpoints
Planning.SetBudget at /planning/budget
Planning.RefreshPlan at /planning/refresh
Planning.Begin at /planning/begin
Planning.Finish at /planning/finish
Planning.Stop at /planning/stop
Planning.Miss at /planning/miss
```
