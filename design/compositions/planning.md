# Daily planning flows

[Read](reaction:Planning.Read) returns the owned course's schedule through the plan former. [Configure](reaction:Planning.Configure) saves the daily budget and focus note. Its successful action triggers a review proposal and routine activation.

[Propose](reaction:Planning.Propose) requests a fresh routine plan from declared current-state reads. The calculation retains the prototype's ten-minute activities, seven-day horizon, and one-, three-, and seven-day review intervals. Work that does not fit remains visible.

[Begin](reaction:Planning.Begin) checks that the item belongs to this learner and course, that its requirements are still current, and that prerequisites are ready. StudyPlanning enforces remaining time and the one-active-activity rule.

[Finish](reaction:Planning.Finish), [Stop](reaction:Planning.Stop), and [Miss](reaction:Planning.Miss) check item ownership before recording progress. Each waits for the resulting plan refresh before responding. Actual time stays in the planning concept. Completing a timer does not prove mastery.

Full exam management and tradeoff confirmation screens remain P3 work. The underlying concept continues to enforce those rules.

```endpoints
Planning.Read at /planning/read
Planning.Configure at /planning/configure
Planning.Propose at /planning/propose
Planning.Begin at /planning/begin
Planning.Finish at /planning/finish
Planning.Stop at /planning/stop
Planning.Miss at /planning/miss
```
