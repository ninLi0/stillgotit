# Rubric for Testing and validating software

Source: [Rubric for Testing and validating software](https://61040.github.io/fa26/rubrics/testing-validating/)

Downloaded: October 11, 2026

Good validation should have these qualities:

- **Behavioral coverage.** Tests exercise operational principles and meaningful variants, including error cases and the actions required by the milestone.
- **Effective checks.** Tests determine success programmatically and would detect relevant incorrect behavior. Test setup uses concept actions rather than bypassing the concept’s interface.
- **Integration evidence.** Validation follows user journeys through the front end, back end, and stored data, including relevant error cases and access-control checks. The submitted journey and narrated screen recording clearly illustrate a useful task being fulfilled by the submitted version.
- **Legible results.** Saved outputs, demonstrations, and explanations make clear what was checked, what happened, and any remaining limitations.

Common pitfalls:

- **Useless tests.** Many repetitive examples exercise the same easy path while important failure modes remain unchecked.
- **Testing around the problem.** Setup edits state directly, assertions do not check the intended behavior, or a demonstration avoids a known failure.
- **Unjustified confidence.** When deployment is required by the milestone, a successful local run is treated as evidence that the deployed app works; or failures are shown without diagnosis or follow-up.

Competency levels:

- **Deficient.** There is little credible evidence that the required behavior was tested, or the tests cannot establish whether it works.
- **Emergent.** Tests and demonstrations cover some expected behavior, but important actions, variants, integration paths, or checks are missing. Results do not support confidence in the milestone’s scope.
- **Competent.** Required principle and variant tests meaningfully check the implemented behavior, and integration checks exercise the relevant user journeys, error cases, and access controls. Saved results and the narrated demonstration are understandable and consistent with the submitted version; limitations are identified honestly.
- **Expert.** Validation meets the competent criteria and targets a subtle or consequential risk that routine happy-path testing would miss. The evidence shows thoughtful diagnosis, a justified correction or conclusion, and an effective way to detect recurrence.
