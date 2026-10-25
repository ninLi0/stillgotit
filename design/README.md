# Implementation specifications

[P1 concepts](p1-concepts.md) preserves the original design. Current concept specifications use sync-engine 1.2.0 format.

## Registered concepts

| Concept | Responsibility |
| --- | --- |
| [SkillMapping](concepts/SkillMapping.md) | Course skills, draft review, requirements versions, sources, and prerequisites. |
| [MaterialKeeping](concepts/MaterialKeeping.md) | Each learner's source materials, with their readable content, retained files, and import retries, used as Library. |
| [GroundedTutoring](concepts/GroundedTutoring.md) | Grounded lessons, practice, dialogue, hints, and transcript review. |
| [AssessmentReviewing](concepts/AssessmentReviewing.md) | Original work, judgments, clarifications, and revisions. |
| [MasteryEstimating](concepts/MasteryEstimating.md) | Provisional confidence and replay of effective assessment evidence. |
| [Budgeting](concepts/Budgeting.md) | A daily time budget, proposals, time records, and explicit approval of cuts; used as StudyPlanning. |
| [Registering](concepts/Registering.md) | Local accounts with unique names and recovery keys. |
| [Sessioning](concepts/Sessioning.md) | Local sessions and expiry. |
| [Federating](concepts/Federating.md) | Verified Commons identities and local account links. |
| [Generating](concepts/Generating.md) | A stateless external-provider action used as TutorGenerating. |
| [Preferring](concepts/Preferring.md) | A user's remembered choice among offered options, used as TutorPreferring for the tutor model and thinking level and as ViewPreferring for the home view. |

The nine domain concepts, TutorPreferring, and ViewPreferring own their MongoDB collections. Generating has no durable state. None calls another concept. [Source attribution](../THIRD_PARTY_NOTICES.md) identifies the reused account code and license.

## Application boundary

[The application stage](stages/materials.md) is selected by `generated.config.ts`. It binds twelve instances. The selected [course flows](compositions/Courses.md), learning, progress, planning, read, admission, computation, and [settings](compositions/Settings.md) documents describe the current engine flows. [Generated read-back](../generated/stillgotit.md) shows the resulting `when / where / then` rules.

The selected composition documents match the current implementation. Unselected access and identity sketches describe broader work that the selected stage does not bind. The selected stage and its linked flow documents identify the implemented paths. [The onboarding stage](stages/onboarding.md) preserves an earlier increment.

- [Runtime contract](runtime.md): host boundaries, provider access, and recovery.
- [Host actors](host.md): each part of the host, what it owns, what it calls or serves, and the page that describes it.
- [Material data](material-data.md): retained originals and readable renditions.
- [Import store](material-import-store.md): one key and frozen preparation per import.
- [Shared identities](types.md): bindings across concepts.
- [P3 status](../P3.md): the beta's journey, checks, known limits, and plan. [P2](../P2.md) records the earlier alpha.
- [Diagnostic review](advisory-review.md): the P2 review of the checker's advisories, with its tested fixes and decisions.

## Checks

```sh
bun run check
bun test --timeout 15000
bunx --no-install sync-engine check-design design/concepts/*.md design/compositions/*.md design/compositions/reusable/*.md design/types.md
```

The source check covers action/query signatures and refusal mappings for eleven concepts. The selected-stage check resolves its links against code. Type checks cover the backend and Vue. These checks do not prove the rules, extraction quality, AI quality, or live account access; tests and browser use provide separate evidence.
