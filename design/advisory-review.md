# P2 diagnostic review

The pinned sync-engine 1.1.0 checker reports 40 advisories: 36 warnings about answer coverage and four notices about list order. These are two categories, not 40 separate confirmed failures.

## Answer coverage: 36 warnings

`MISSING_ENDPOINT_FALLBACK` means the checker cannot prove that every admitted request receives an answer. It does not prove that the endpoint fails. Its proof does not cover all action results, complementary state reads, or admission checks outside the endpoint declaration.

| Area | Count | Endpoint names |
| --- | ---: | --- |
| Accounts | 5 | Me, StartCommons, FinishCommons, ResumeCommons, ChooseUsername |
| Courses | 9 | ListCourses, CreateCourse, ReadCourse, AddUnit, AddMaterial, ReadMaterial, ProposeSkill, EditDraft, ConfirmSkill |
| Learning | 15 | Read, Progress, Confidence, Lesson, Task, Respond, Question, Reply, Hint, Transcript, Assess, RetryAssessment, Correct, Regrade, Suggest |
| Planning | 7 | Read, Configure, Propose, Begin, Finish, Stop, Miss |

Authentication actions return registered refusals. Course endpoints and the read endpoints have explicit missing-state answers or concept refusals. The guarded learning and planning commands also require admission through the registered Access formers.

A regression test reproduced one real gap: a native gateway call to start practice without a mastery track waited until `TIMED_OUT`. The browser already refused that request. The exported runtime gateway now uses the same admission function and learner lock as HTTP. The request returns `INVALID_INPUT` with an explanation before generation starts. All 18 guarded commands have missing-state checks through both interfaces. Tests also cover a forged owner, expiry, cancellation, mixed HTTP/native calls, and concurrent course creation.

## List order: four notices

`ORDER_SENSITIVE_FORMER` concerns CourseList, Materials, Units, and Skills. All four now declare ascending order by their unique record identity with `.arranged(...)`. A test reverses the database result rows and checks that all four answers remain unchanged.

The notice remains because this checker version tests for an `order` property on the arrangement. A field-based arrangement also has that property. Therefore, adding explicit ordering does not remove the notice in 1.1.0. The dependency and its diagnostic rules have not been changed or suppressed.

## P2 decisions

Application requests use HTTP or the exported runtime gateway. Both check admission before dispatch. The raw assembled invoker stays internal and assumes these checks have passed. Some invalid calls that bypass the gateway can still time out. Adding refusal paths for those raw calls is outside this P2 change.

Keep `@mit-sdg/sync-engine` and `@mit-sdg/sync-engine-http` pinned at 1.1.0. Do not patch, upgrade, or suppress the checker for these notices. All 40 advisories remain visible. Tests verify the guarded entry paths and stable list order.

## Evidence

- `tests/Learning.http.test.ts` covers the reproduced failure, admission, concurrency, and stable ordering.
- `src/host/http.ts` shares admission and locking between HTTP and native gateway callers.
- `src/compositions/courses.ts` declares the four list orders.
- The pinned framework explains the conservative coverage proof in `docs/user/reference/semantics.md`, under “Sibling paths and endpoint settlement.” Its ordering check is in `dist/engine/tooling/diagnostics.js`, in `formerOrderDiagnostic`.

No unconditional fallback was added. Such a fallback would compete with valid answer paths, because sibling rules do not run as an ordered if/else chain.
