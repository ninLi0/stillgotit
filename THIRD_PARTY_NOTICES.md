# Third-party material

The account specifications and the Registering, Sessioning, and Federating code come from [MIT SDG's ConceptBox](https://github.com/mit-sdg/conceptbox/tree/9374617263d0dce783f6ffc472b28092dc4ad96a), commit `9374617263d0dce783f6ffc472b28092dc4ad96a`.

Copyright (c) 2026 Eagon Meng. Used under the MIT License. The full notice is preserved in [licenses/ConceptBox.txt](licenses/ConceptBox.txt).

| Local file | Changes from that version |
| --- | --- |
| `design/concepts/Registering.md` | Require a recovery key, define matching retries and key conflicts, add recovery lookup, and preserve older accounts without keys. |
| `design/concepts/Sessioning.md` | None. |
| `design/concepts/Federating.md` | Require an unexpired attempt when saving confirmation and links. Save the reported username with the subject. Add `_identity` with an expiry check after its read and no identity result for older confirmations without usernames. |
| `design/compositions/reusable/accounts.md` | Use Commons only and describe the planned StillGotIt integration. |
| `design/compositions/reusable/commons.md` | Add the agreed expiry checks, host responsibilities, and planned recovery sequence. Distinguish implemented registration keys from pending sign-in recovery. |
| `src/concepts/Registering/Registering.ts` | Add required recovery keys, exact retry lookup, concurrent-write recovery, input validation, and key conflicts. Store each key with its user. Add a partial unique index that preserves older rows without keys. |
| `src/concepts/Registering/registry.ts` | Add `INVALID_RECOVERY_KEY` and `RECOVERY_KEY_CONFLICT`. |
| `tests/Registering.test.ts` | Adapt the five tests from `tests/concepts/Registering.test.ts` to the local MongoDB setup and required recovery keys. Add checks for persistence, separate instances, all four refusals, matching retries, and framework integration. |
| `tests/Registering.recovery.test.ts` | Add recovery tests for unchanged retries, key and username conflicts, forced concurrent reads across clients, lost replies after real inserts, failed writes, older records, and engine error propagation. |
| `src/concepts/Sessioning/Sessioning.ts` | None. |
| `src/concepts/Sessioning/registry.ts` | None. |
| `tests/Sessioning.start.test.ts` | Adapt the token-format check and clock setup from `tests/concepts/Sessioning.test.ts`. Add focused checks for start's saved state, persistence, and failed writes. |
| `tests/Sessioning.use.test.ts` | Adapt the clock setup and use scenarios from `tests/concepts/Sessioning.test.ts`. Add exact expiry boundaries, preserved-state checks, a second database client, and a rejected activity update. |
| `tests/Sessioning.end.test.ts` | Adapt the clock, refusal, and concurrent-end scenarios from `tests/concepts/Sessioning.test.ts`. Add exact time boundaries, other-session preservation, reconnection, and a rejected deletion. |
| `tests/Sessioning.registration.test.ts` | Add engine checks for the session lifecycle and refusal scenarios, registered course ownership, and database failure recovery. |
| `src/concepts/Federating/Federating.ts` | Require an empty input object for `start`. Add an expiry condition to the confirmation write in `finish` and save the subject and username together. Add `_identity` with a clock check after reading MongoDB. Check expiry before and after the insert, and remove a link that was inserted after its sign-in expired. |
| `src/concepts/Federating/provider.ts` | None. Includes CommonsProvider and the reference MemoryProvider for local tests. |
| `src/concepts/Federating/registry.ts` | None. Declares CommonsFederating, now selected in the application. |
| `tests/CommonsFederating.start.test.ts` | Adapt the start scenario from `tests/concepts/Federating.test.ts` and the address test from `tests/concepts/CommonsProvider.test.ts`. Add stored-state, secret-exposure, concurrent-start, persistence, and failed-write checks. |
| `tests/CommonsFederating.finish.test.ts` | Adapt the finish, nonce, verifier, and competing-confirmation scenarios from `tests/concepts/Federating.test.ts`. Add exact expiry boundaries, controlled provider delays, preserved-state checks, separate clients, and a rejected confirmation write. Verify that the subject and username are saved together and recovered by `_identity`. |
| `tests/CommonsFederating.identity.test.ts` | Add checks for exact output, unchanged state, missing and older attempts, linked identities, saved usernames, expiry during real database reads, lost confirmation replies, recovery after reconnecting, and database errors. Uses the existing test clock and MemoryProvider pattern. |
| `tests/CommonsFederating.link.test.ts` | Adapt the link, refusal, query, and competing-link scenarios from `tests/concepts/Federating.test.ts`. Replace acceptance after expiry with refusal. Add exact time boundaries, delayed real inserts, rollback and visibility checks, persistence, preserved state, separate clients, and rejected-write recovery. |
| `tests/CommonsProvider.redeem.test.ts` | Adapt the request, refusal, timeout, and connection-failure scenarios from `tests/concepts/CommonsProvider.test.ts`. Add already-used codes, malformed replies, blocked redirects, the default ten-second deadline, stalled-body timeout, fresh-request recovery, and checks that warnings omit the supplied code and verifier. Use local servers and real HTTP without changing the provider. |
| `tests/CommonsFederating.registration.test.ts` | Add engine checks for all actions and queries, refusal results, shared local user identities, persistence, delayed expiry, rollback, database failures, and competing links. Uses the reference MemoryProvider and the same account scenarios as the direct concept tests. |

The onboarding implementation also adapts the same pinned ConceptBox version:

| Local file | Changes from that version |
| --- | --- |
| `src/compositions/reusable/accounts.ts` | Reuse the current-user and logout chains. Add result validation and a refusal when the local account is missing. |
| `src/compositions/reusable/commons.ts` | Reuse start, confirmation, and named sign-in branches. Separate confirmation from continuation. Add recovery lookup and result validation. |
| `src/compositions/reusable/inputs.ts` | Adapt the text input validator. Bound text fields and validate course input and endpoint results. |
| `src/host/http-policy.ts`, `src/host/site.ts`, `src/main.ts` | Follow the HTTP policy, cookie bindings, Bun listener, and no-referrer page serving. Add course routes, strict origin checks, safe asset paths, and shutdown handling. |

## Fonts

The interface bundles four fonts in `frontend/public/fonts`, and the design handoff keeps the same files in `design/revamp/fonts`. Each is used unchanged under the SIL Open Font License 1.1. The license text and these copyright notices are in [licenses/OFL-1.1.txt](licenses/OFL-1.1.txt).

| Font | File | Copyright notice in the font file | Used for |
| --- | --- | --- | --- |
| Pixelify Sans | `PixelifySans.ttf` | Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans). Designed by Stefie Justprince. | Headings. |
| Instrument Sans | `InstrumentSans.ttf` | Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans). Designed by Rodrigo Fuenzalida. | Body text, buttons, and numbers. |
| Spline Sans Mono | `SplineSansMono.ttf` | Copyright 2022 The Spline Sans Mono Project Authors (https://github.com/SorkinType/SplineSansMono). Designed by Eben Sorkin and Mirko Velimirovic. | Code and maths. |
| Newsreader | `Newsreader.ttf` | Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader). Designed by Hugues Gentile for Production Type. | The readable text of a PDF page that the Materials viewer cannot draw. |

The font files also state two trademarks: Pixelify Sans is a trademark of Stefie Justprince, and Newsreader is a registered trademark of Production Systems SAS.

## KaTeX

The lesson and the Materials viewer draw formulas with [KaTeX](https://katex.org) 0.19.0. The build bundles its code and stylesheet into a chunk that loads only when a text holds a formula, unchanged except that the stylesheet's woff and ttf fallbacks for each font are dropped (`frontend/vite.config.ts`). They are used under the MIT License, copyright (c) 2013-2020 Khan Academy and other contributors. The full notice is preserved in [licenses/KaTeX.txt](licenses/KaTeX.txt).

KaTeX's 20 fonts are copied unchanged into the build as woff2 files and load only when a formula uses them. They are used under the SIL Open Font License 1.1, whose text is in [licenses/OFL-1.1.txt](licenses/OFL-1.1.txt) with their copyright notice.

| Fonts | Files | Copyright notice in the font files | Used for |
| --- | --- | --- | --- |
| KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main, KaTeX_Math, KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1 to KaTeX_Size4, and KaTeX_Typewriter | `node_modules/katex/dist/fonts/*.woff2`, copied to `frontend/dist/assets` | Copyright (c) 2009-2010 Design Science, Inc. Copyright (c) 2014-2018 Khan Academy. Each family's name is a Reserved Font Name. | Formulas. |
