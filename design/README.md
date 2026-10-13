# Implementation specifications

[P1 concept specifications](p1-concepts.md) contains the original five concepts, essential reactions, and composition note. This copy preserves the design that guides implementation.

Prepare the current specifications in the sync-engine 1.1.0 format under `design/concepts/` before implementing app features. Describe application types and the connections between concepts under `design/types.md` and `design/compositions/`. Register each specification with its implementation when that implementation is written.

## Current specifications

- [SkillMapping](concepts/SkillMapping.md): preserves the P1 actions and version history. Adds explicit results, refusals, and read queries.
- [GroundedTutoring](concepts/GroundedTutoring.md): preserves lessons, practice, and recorded help. Adds retained file references, optional transcript corrections during lessons, and one transcript review before assessment.
- [AssessmentReviewing](concepts/AssessmentReviewing.md): preserves the five P1 actions, original work, and judgment history. Expands saved responses to include confirmed transcripts and supported attachments. Adds explicit results, refusals, and read queries.
- [MasteryEstimating](concepts/MasteryEstimating.md): preserves the three P1 actions, scoring rules, and prerequisite readiness check. Groups the numerical settings and defines calculation order. Adds explicit results, refusals, and queries for the score's evidence and explanation.
- [StudyPlanning](concepts/StudyPlanning.md): preserves the eleven P1 actions. Adds explicit results, refusals, and read queries. Checks current planning inputs before activation, limits activity changes to active plans, and preserves time records across replacements.
- [Registering](concepts/Registering.md): creates a user with a unique username and recovery key. Matching retries return the saved user. Adds recovery lookup and two refusal codes to ConceptBox's reference.
- [Sessioning](concepts/Sessioning.md): starts, checks, and ends local sessions. Reused from ConceptBox without changes.
- [Federating](concepts/Federating.md): links a confirmed provider identity to a local user. Used as CommonsFederating. Adds expiry checks at writes, saves the confirmed username, and reads the identity with a fresh expiry check after the database read.

See [source attribution and license](../THIRD_PARTY_NOTICES.md) for the pinned reference version.

Action and query signatures use named collection types, such as `MaterialSet`, `SkillSet`, `MediaList`, `PassageSet`, `SubjectSet`, and `CandidateList`. These describe collections, not new identities. State declarations use `set of` or `seq of` with the element type.

## Application specifications

| Document | Purpose |
| --- | --- |
| [Shared identities](types.md) | Binds the five learning concepts and three account concepts to their shared identities. |
| [Accounts](compositions/reusable/accounts.md) | Defines the current-user and sign-out endpoints. |
| [Commons sign-in](compositions/reusable/commons.md) | Defines sign-in attempts, callbacks, account links, cookies, and recovery requirements. |
| [Access and course display](compositions/access.md) | Defines ownership checks and the combined course view. |
| [Course materials and skills](compositions/courses.md) | Defines import, draft review, confirmation, and changed requirements. |
| [Learning and submission](compositions/learning.md) | Defines lessons, voice input, hints, transcript review, and saving an attempt. |
| [Assessment and mastery](compositions/progress.md) | Defines initial confidence, assessment, correction, and one scoring contribution per attempt. |
| [Study planning](compositions/planning.md) | Defines refreshed plans, review intervals, and activity time. |
| [Implemented onboarding](stages/onboarding.md) | Binds the four implemented concepts and documents the eight live endpoints, ownership view, former, host wrapper, and Vue page. |
| [Runtime responsibilities](runtime.md) | Defines Commons access, provider and file operations, request coordination, and restart recovery. |

The composition documents name the planned reactions, views, formers, and endpoint paths. A reaction connects successful actions. A view combines concept queries. A former shapes an endpoint response. Pair each document with the corresponding source module as it is implemented.

The full inventory contains eight planned instances. Registering, CommonsFederating, Sessioning, and SkillMapping are implemented and assembled. Their direct and engine tests cover action rules, persistence, concurrent work, and refusals. CommonsProvider and RegistrationRecoveryStore have separate tests. The onboarding stage now connects these parts through HTTP and a Vue page. Material import and the remaining four learning concepts are still planned.

## Validation and next step

The P1 copy is reference material. Check the authored corpus with:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md design/compositions/*.md design/compositions/reusable/*.md design/types.md
```

The eight concept files, shared bindings, and seven composition documents pass the format check. That check does not resolve planned links against code, prove application type closure, or test behavior.

`bun run check` compares the four implementations with their specifications and checks [the onboarding stage](stages/onboarding.md) against its endpoints, view, and former. It also checks generated files and TypeScript for the backend and Vue frontend. The stage is selected in `generated.config.ts`.

The check has no errors. It reports seven conservative endpoint-fallback warnings and one former-order advisory. Integration tests check actual return and refusal paths; static checks do not prove that every request will receive an answer under every fault. Source checks also do not prove transactions or persistence, so those have direct and engine tests.

Next, implement material import and skill proposals through GroundedTutoring. Add their types and composition documents to the checked stage when the code exists. Keep private design notes in the learner's own words.

Use the [course setup guide](https://61040.github.io/fa26/resources/sync-engine-local-dev/) and the [sync-engine authoring guide](https://github.com/mit-sdg/sync-engine/blob/v1.1.0/docs/user/guide/authoring.md) for the required format.
