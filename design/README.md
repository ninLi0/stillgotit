# Implementation specifications

[P1 concepts](p1-concepts.md) preserves the original design. Current concept specifications use sync-engine 1.1.0 format.

## Registered concepts

| Concept | Responsibility |
| --- | --- |
| [SkillMapping](concepts/SkillMapping.md) | Course skills, draft review, requirements versions, sources, and prerequisites. |
| [GroundedTutoring](concepts/GroundedTutoring.md) | Materials, grounded lessons, practice, dialogue, hints, and transcript review. |
| [AssessmentReviewing](concepts/AssessmentReviewing.md) | Original work, judgments, clarifications, and revisions. |
| [MasteryEstimating](concepts/MasteryEstimating.md) | Provisional confidence and replay of effective assessment evidence. |
| [StudyPlanning](concepts/StudyPlanning.md) | Budgets, proposals, time records, and explicit exam-cut approval. |
| [Registering](concepts/Registering.md) | Local accounts with unique names and recovery keys. |
| [Sessioning](concepts/Sessioning.md) | Local sessions and expiry. |
| [Federating](concepts/Federating.md) | Verified Commons identities and local account links. |
| [Generating](concepts/Generating.md) | A stateless external-provider action used as TutorGenerating. |
| [Preferring](concepts/Preferring.md) | A user's remembered choice among offered options, used as TutorPreferring for the tutor model and thinking level. |

The eight domain concepts and TutorPreferring own their MongoDB collections. Generating has no durable state. None calls another concept. [Source attribution](../THIRD_PARTY_NOTICES.md) identifies the reused account code and license.

## Application boundary

[The P2 stage](stages/materials.md) is selected by `generated.config.ts`. It binds ten instances. The selected [course flows](compositions/Courses.md), learning, progress, planning, read, admission, computation, and [tutor settings](compositions/Settings.md) documents describe the current engine flows. [Generated read-back](../generated/stillgotit.md) shows the resulting `when / where / then` rules.

The selected composition documents match the current implementation. Unselected access and identity sketches describe broader P3 work. The selected P2 stage and its linked flow documents identify the implemented paths. [The onboarding stage](stages/onboarding.md) preserves an earlier increment.

- [Runtime contract](runtime.md): host boundaries, provider access, and recovery.
- [Material data](material-data.md): retained originals and readable renditions.
- [Import store](material-import-store.md): one key and frozen preparation per import.
- [Shared identities](types.md): bindings across concepts.
- [P2 progress](../P2.md): current checks and work still requiring live validation.
- [Diagnostic review](advisory-review.md): all 40 advisories, tested fixes, and P2 decisions.

## Checks

```sh
bun run check
bun test --timeout 15000
bunx --no-install sync-engine check-design design/concepts/*.md design/compositions/*.md design/compositions/reusable/*.md design/types.md
```

The source check covers action/query signatures and refusal mappings for ten concepts. The selected-stage check resolves its links against code. Type checks cover the backend and Vue. These checks do not prove the rules, extraction quality, AI quality, or live account access; tests and browser use provide separate evidence.
