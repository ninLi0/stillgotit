# StillGotIt

A web app to help students learn course skills and keep using them. Students practice with voice, text, or photos, track mastery, and plan reviews around exams.

## P2: Alpha in progress

[Core journey, implementation plan, and verified progress](P2.md).

Registering, CommonsFederating, Sessioning, and SkillMapping are registered with sync-engine and save records in MongoDB. Registering creates local user identities. CommonsFederating confirms Commons identities and links them to local users. Sessioning starts, checks, and ends sessions for those users. SkillMapping supports courses, units, draft review, requirements versions, source links, prerequisite rules, archiving, and restoration. Use Bun 1.4.2 to run the setup checks:

```sh
bun install --frozen-lockfile
bun run generate
bun run check
```

Checks and generation do not connect to MongoDB. To run the app, start Docker and run:

```sh
bun run db:up
bun run build
bun run start
```

Open **http://localhost:5173**. Sign in with Commons, then create one course. The Vue page reads saved courses from MongoDB. Reloading or restarting the server keeps the course. The server listens on loopback and uses `COMMONS_ORIGIN`, `APP_ORIGIN`, and `PORT` from [.env.example](.env.example), with those same defaults. Use `localhost`, not a different host name, so the origin and cookie checks agree.

The [implemented stage](design/stages/onboarding.md) describes eight endpoints, a course ownership view, and a course-list former. Their ConceptBox-style endpoint chains generate `when / where / then` reactions in [the read-back](generated/stillgotit.md). The host owns cookies, recovery-key storage, expiry checks, and the per-user lock. It does not write concept collections.

Commons confirmation and continuation use separate requests. Confirmation redeems the one-time code. Continuation uses the saved identity and recovery key to find or create the local account, link it, and start a session. A failed link can resume without another registration or code redemption. The browser never chooses a local user ID or recovery key.

Live Commons sign-in and course creation have been checked in the browser. The full onboarding test run passed 270 tests. Automated HTTP tests cover returning sign-in, username choice, saved state across a new runtime, interrupted linking, expiry during waits, isolation between learners, simultaneous course creation, and logout. The diagnostic check still gives seven conservative endpoint-fallback warnings and one source-order advisory. The endpoints are tested, but the checker does not prove every chain will answer. Database outages still return an error and require a retry.

GroundedTutoring now implements `addMaterial`, `_materials`, and `_material`. It validates and stores prepared text and retained-file metadata. Thirteen focused MongoDB tests pass, including retrieval from a fresh process. The [material data contract](design/material-data.md) defines readable renditions and extraction limits. Upload processing, ownership checks at the import boundary, safe import retries, and application registration remain pending for this concept.

The [full plan](P2.md) still includes material import, tutoring, voice, assessment, mastery, and review planning. Those features are not implemented. The entries below record the earlier backend steps; their descriptions of pending HTTP work describe that earlier stage.

### Step 1: save a course

Start Docker, then run these commands from the project folder:

```sh
bun run db:up
bun run demo:course
bun test
```

The demo creates **MIT 18.06SC Linear Algebra** for a fixed test identity, `demo-learner`. Run it again to read the saved course. Real sign-in comes later.

The first step in [SkillMapping.ts](src/concepts/SkillMapping.ts) added three operations:

| Operation | Behavior |
| --- | --- |
| `createCourse` | Refuse a blank title. Save an ID, owner, and title. Return the ID. |
| `_courses` | Read one owner's courses in ID order. |
| `_course` | Read a course's owner and title by ID. Return an empty list if it does not exist. |

The underscore marks a query. A query reads records without changing them. `_course` is an internal lookup; public access checks will use the signed-in learner's identity. This reusable concept allows several courses per owner. The P2 application will enforce its one-course limit.

### Step 2: add a unit

After creating the demo course, run:

```sh
bun run demo:unit
```

This adds **Matrix multiplication** under **MIT 18.06SC Linear Algebra**. Run it again to read the saved unit.

| Operation | Behavior |
| --- | --- |
| `addUnit` | Check course ownership, then check the title. Save the unit and return its ID. |
| `_units` | Read a course's units in ID order. |
| `_unit` | Read a unit's course and title. Return an empty list if it does not exist. |

A unit stores its course ID and title. Its owner comes from that course. An unknown course and another learner's course produce the same refusal. These checks run inside the action. Course ownership cannot change under the current specification, so this action checks an existing course and inserts one unit document. Unit queries are internal; public access checks remain pending.

### Step 3: propose a skill

After creating the demo unit, run:

```sh
bun run demo:skill
```

This creates **Multiply matrices** as a draft. Repeat the command to read it. The caller supplies the proposal text; AI generation comes later.

`propose` first checks unit ownership and rejects a blank title, outcome, or gate. It then saves two linked records:

| Record | Contents |
| --- | --- |
| Skill | Unit, title, source references, empty prerequisites, `DRAFT` status, and the current version ID. |
| Requirements version | Skill ID, outcome (the ability), and gate (the required demonstration). |

Both writes use one [MongoDB transaction](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/). They commit together. The skill ID is returned after commit. Source references are stored without duplicates. The proposal demo has no sources yet; confirmation requires one.

The new queries read skill lists, skill details, sources, prerequisites, and requirements versions. A test forces the version write to fail and checks that the skill write is rolled back too.

### Step 4: revise a draft

After creating the demo skill, run:

```sh
bun run demo:revise-draft
```

This adds a requirement to explain why an incompatible pair of matrices cannot be multiplied. It prints the old and new requirements. Run it again to check that the same edit creates no extra version.

`reviseDraft` checks ownership and draft status, then the target unit, then the text. The unit must belong to the same course. The title, outcome, and gate must not be blank.

| Edit | Version behavior |
| --- | --- |
| Change the title, sources, or unit | Keep the current requirements version. |
| Change the outcome or gate | Create a new current version. Preserve the old version. |

The skill keeps its ID, draft status, and prerequisites. All reads and writes use one transaction. If a write fails, no edit is saved. Tests cover both write failures and two identical edits sent from separate database clients. The action returns `{}`; use the queries to read the updated draft.

### Step 5: discard a draft

After creating the demo course and unit, run:

```sh
bun run demo:discard-draft
```

This creates a temporary draft, revises its gate, and discards it. The output shows that both requirements versions and the draft are gone. The existing **Multiply matrices** draft remains available.

`discardDraft` checks that the skill is a draft owned by the learner. It deletes that skill and all versions linked to its ID in one transaction. It returns `{}` after commit. A missing, foreign, confirmed, or archived skill causes `DRAFT_DISCARD_UNAVAILABLE`. A repeated discard also gets this refusal because the draft no longer exists.

Tests cover version cleanup, unchanged unrelated records, concurrent edits and discards, and rollback when MongoDB rejects the version deletion. Queries return no rows for the discarded skill or its versions.

### Step 6: confirm a skill

After creating the demo course and unit, run:

```sh
bun run demo:confirm-skill
```

This creates and confirms **Identify compatible matrix dimensions**. A second run reads the saved result. The script uses a clearly labeled placeholder material ID; it does not import a file.

`confirm` checks ownership and draft status, then requires at least one source reference. It sets the status to `CONFIRMED` and returns `{}`. The requirements and their version IDs stay the same. Confirmation records acceptance of a learning target. Mastery is estimated later from practice.

The checks and update run in one transaction. Tests cover missing sources, invalid owners and statuses, failed writes, and confirmation during source removal or draft discard. After confirmation, `reviseDraft`, `discardDraft`, and another `confirm` call are refused. Use `editDetails` for title and unit changes.

SkillMapping stores external material IDs. File import and source access checks remain part of the planned integration.

### Step 7: edit a confirmed skill's details

After creating the demo course and unit, run:

```sh
bun run demo:edit-details
```

This creates a separate confirmed demo skill. It changes **Matrix size checks** to **Check matrix product dimensions** and moves it into **Matrix dimensions**. The source ID is a labeled placeholder. A second run accepts the same title and unit without further changes.

`editDetails` checks ownership and confirmed status, then the target unit, then the title. The unit must belong to the same course. The title must not be blank. The action updates only the unit and title, keeps the current requirements version, and returns `{}`.

The checks and update use one transaction. Tests verify refusal rules, failed writes, concurrent edits, and preservation of version history, sources, and prerequisite links.

### Step 8: revise a confirmed skill's requirements

After creating the demo course and unit, run:

```sh
bun run demo:revise-definition
```

This creates a separate confirmed **Explain matrix multiplication** skill, then adds a requirement to explain why reversing matrix order can change the result. It prints both versions. A second run reports `SKILL_DEFINITION_UNCHANGED` and creates no extra version. The source ID is a labeled placeholder.

`reviseDefinition` checks ownership and confirmed status, then rejects blank or unchanged requirements. It creates a version, makes it current, and returns `{ previous, version }`. Both values are version IDs. Earlier requirements remain readable, and the skill keeps its identity and other details.

One transaction saves both writes. Tests verify rollback at either write and correct returned IDs during simultaneous revisions. Mastery and planning reactions remain pending.

### Step 9: attach a source reference

After creating the demo course and unit, run:

```sh
bun run demo:attach-material
```

This creates a separate confirmed **Interpret a matrix product** skill and adds a second source reference. The output shows both sources and the unchanged requirements version. A second run succeeds without a duplicate. Both material IDs are labeled placeholders; no files are imported.

`attachMaterial` checks ownership and confirmed status inside a transaction. It uses MongoDB's `$addToSet` to add one material ID, then returns `{}`. Other skill details and all requirements versions stay unchanged. Missing, foreign, draft, or archived skills cause `SKILL_MATERIAL_UNAVAILABLE`.

Tests cover repeated links, refusal rules, failed writes, simultaneous attachments, and attachment during a requirements revision. The application must check each material's owner, course, and readable content before calling this action. That integration remains pending.

### Step 10: set prerequisites

After creating the demo course and unit, run:

```sh
bun run demo:set-prerequisites
```

This creates two confirmed demo skills. **Compute a matrix product** requires **Read matrix rows and columns**. The script also attempts the reverse link and prints the cycle refusal. A second run keeps the same links and requirements versions. The source ID is a labeled placeholder.

`setPrerequisites` replaces the full prerequisite set and returns `{}`. An empty set clears it; duplicate IDs appear once. The target must be the learner's confirmed skill. Each prerequisite must be confirmed and in the same course. Self-dependencies and cycles are refused. Shared foundations are allowed.

The checks and replacement use one transaction. A shared course write prevents simultaneous edits from creating a cycle together. Tests cover direct and indirect cycles, replacement, clearing, failed writes, concurrent edits, and reads from another process. Skill details, sources, and requirements versions stay unchanged. See [runtime responsibilities](design/runtime.md) for the internal course lock.

### Step 11: archive a skill

After creating the demo course and unit, run:

```sh
bun run demo:archive-skill
```

The demo links **Square a matrix** to **Identify square matrices**. It first tries to archive the required foundation and gets `SKILL_STILL_REQUIRED`. It then archives **Square a matrix**. A second run gets `SKILL_ARCHIVE_UNAVAILABLE` because that skill is already archived. The source ID is a labeled placeholder.

`archive` checks ownership and confirmed status, then checks whether a confirmed skill still requires the target. If none does, it sets the status to `ARCHIVED` and returns `{}`. It keeps all requirements versions, sources, and prerequisite links. Queries still return the archived record. Links from archived skills do not block archival.

The checks and status change use one transaction and the same course lock as `setPrerequisites`. This prevents a concurrent request from creating an active link to an archived skill. Tests cover refusal rules, preserved records, failure of either write, concurrent requests, and reads from another process.

### Step 12: restore a skill

After running the archive demo above, run:

```sh
bun run demo:restore-skill
```

This reuses **Square a matrix** and its foundation. To show the refusal case, the script archives the foundation and tries to restore the skill. It gets `SKILL_RESTORE_PREREQUISITES`. It then restores the foundation and the skill, in that order. The same skill ID and requirements version remain. A second run gets `SKILL_RESTORE_UNAVAILABLE` because the skill is already confirmed.

`restore` checks ownership and archived status, then follows the saved prerequisite chains. The required skills must be confirmed and in the same course. Self-dependencies and chains back to the target are refused. A valid restore changes the status to `CONFIRMED` and returns `{}`. Sources, prerequisite links, and all requirements versions remain unchanged.

The checks and status change share one transaction and the same course lock as prerequisite changes and archiving. Tests cover restoration order, preserved history, failed writes, and overlapping requests. Restoring one skill does not restore its prerequisites or dependents automatically.

### Step 13: register SkillMapping

[SkillMapping.registry.ts](src/concepts/SkillMapping.registry.ts) joins the class, its Markdown specification, and its 24 refusal codes. [concepts.ts](src/concepts.ts) includes it in the application. [assembly.ts](src/assembly.ts) installs a supplied implementation so calls can run through the engine.

The [first stage document](design/stages/skill-mapping.md) declared SkillMapping alone. The current [Commons identity stage](design/stages/commons-federating.md) also selects Registering, CommonsFederating, and Sessioning. It binds CommonsFederating's user, SkillMapping's owner, and Sessioning's subject to `Registering.User`. Sources remain caller-supplied references until GroundedTutoring is implemented. The full planned bindings are in [types.md](design/types.md).

Run:

```sh
bun run generate
bun run check
bun run test
```

For SkillMapping, the source check validates all 12 action and nine query signatures, including inputs, outputs, and refusal mappings. The current check covers four concepts and reports no advisories. It does not prove action rules or MongoDB behavior. SkillMapping's three engine tests cover the lifecycle, preserved data, declared refusals, and database failures.

Calling the class directly still throws its declared error classes. Calling `application.concepts.SkillMapping` through the engine instead returns a declared refusal as `{ error, detail }`. Unexpected database errors still reject the call. Registration does not add public endpoints or application reactions.

### Step 14: import Registering

[Registering.ts](src/concepts/Registering/Registering.ts) and its [registry](src/concepts/Registering/registry.ts) were imported from the pinned ConceptBox reference. Step 24 adds recovery keys. The [attribution](THIRD_PARTY_NOTICES.md) records the changes and preserves its MIT license.

The original `register` checked the username, created a random user ID, and saved both. It now also requires a recovery key, as described in Step 24. MongoDB's unique index prevents duplicate usernames, including concurrent requests from separate clients. Usernames are case-sensitive and must contain 3–32 ASCII letters, digits, underscores, or hyphens. `_byUsername` and `_username` read the saved record.

Run the focused checks with `bun test tests/Registering.test.ts`. The seven tests cover name rules, duplicate requests, unknown users, persistence after reconnecting, separate instances, framework refusals, and course ownership. Registering creates an account; proving who owns it requires the remaining sign-in components.

### Step 15: import Sessioning and test start

[Sessioning.ts](src/concepts/Sessioning/Sessioning.ts) and its [registry](src/concepts/Sessioning/registry.ts) are imported unchanged from the same reference. This step tests `start` directly; the following step tests `use`.

`start` reads the server time, generates a secret session ID from 32 random bytes, and sets expiry to 90 days later. It prepares MongoDB's expiry-cleanup index and saves the subject, session ID, `lastUsed`, and `expiresAt`. It returns the session ID and expiry after the insert succeeds. The sign-in flow must verify the user before calling this action. The HTTP host will set the cookie later.

Run `bun test tests/Sessioning.start.test.ts --timeout 15000`. All four tests pass: saved fields and expiry, separate IDs for simultaneous starts, persistence after reconnecting, and a rejected write followed by a valid start. The following sections check inactivity and sign-out.

### Step 16: test Sessioning.use

`use` receives the secret session ID and reads the server time. MongoDB finds a matching session only if its last use was less than seven days ago and its fixed expiry is still in the future. The same database operation sets `lastUsed` to now. A match returns the saved subject; no match throws `NotSignedIn`. The session ID, subject, and expiry stay unchanged.

Run `bun test tests/Sessioning.use.test.ts --timeout 15000`. All eight tests pass. They cover exact seven-day and 90-day boundaries, repeated activity, unknown sessions, preserved state, activity saved by another database client, and a rejected update followed by a successful retry. The tests advance the concept's clock while keeping the records, so expiry checks cannot depend on background deletion.

### Step 17: test Sessioning.end

`end` receives the secret session ID and uses the same time checks as `use`. MongoDB finds and deletes a live session in one operation. Success returns the session ID. No match throws `NotSignedIn`. Removing one session preserves all other sessions, including another session for the same user. The future HTTP host will clear the browser cookie.

Run `bun test tests/Sessioning.end.test.ts --timeout 15000`. All ten tests pass. They cover sign-out, repeated and unknown requests, exact inactivity and lifetime boundaries, other sessions, persistence after reconnecting, simultaneous sign-outs, and a rejected deletion followed by a successful retry. After removal, later `use` calls are refused.

### Step 18: connect Sessioning to the engine

[concepts.ts](src/concepts.ts) selects the existing Sessioning registry. [assembly.ts](src/assembly.ts) requires a Sessioning implementation for `Registering.User`. Startup supplies `new SessioningConcept<User>(db)`. The [account sessions stage](design/stages/account-sessions.md) declares the same identity binding for the framework check.

Calls to `application.concepts.Sessioning.start`, `use`, and `end` now run through the engine. The registry maps `NotSignedIn` to `{ error: "NOT_SIGNED_IN", detail: "Your session has ended. Sign in again." }`. Unexpected database errors still reject the call. The imported class and registry remain unchanged.

Run `bun test tests/Sessioning.registration.test.ts --timeout 15000`. All six tests pass. They check a registered course owner, session use and logout across database clients, unknown and expired sessions, preserved state, database faults, and simultaneous sign-outs. These are local engine tests. Live Commons sign-in and browser cookies remain pending.

### Step 19: import CommonsFederating and test start

[Federating.ts](src/concepts/Federating/Federating.ts), its [provider](src/concepts/Federating/provider.ts), and its [registry](src/concepts/Federating/registry.ts) come from the pinned ConceptBox reference. The provider and registry are unchanged. The `finish` and `link` actions add the expiry checks described below. CommonsFederating is Federating configured for Commons and Registering's user identities. Step 23 adds it to the assembly and makes the empty input object explicit in `start`.

`start({})` takes no input fields. It creates three random values: an attempt ID, a nonce that Commons will return as `state`, and a verifier kept on the server. It sets expiry to ten minutes from now and saves the attempt in MongoDB. The provider builds the Commons `/connect` URL with the app origin, nonce, and SHA-256 hash of the verifier. The result contains the attempt ID, expiry, and URL. Starting an attempt does not contact Commons or create an account or session.

Run `bun test tests/CommonsFederating.start.test.ts --timeout 15000`. All five tests pass. They check saved fields, exact expiry, the URL and a known verifier-hash example, separate random values, persistence after reconnecting, and a rejected insert followed by a valid start. Code redemption is blocked in these tests. The `localhost:5173` origin is a test fixture, not a configured frontend.

### Step 20: update and test CommonsFederating.finish

`finish` takes the attempt ID, the nonce returned by Commons, and its sign-in code. It first checks that the attempt exists, is unexpired and unconfirmed, and has the same nonce. Invalid attempts throw `SignInExpired` before contacting the provider. A valid attempt sends the code and saved verifier to the provider. If the provider returns no identity, the action throws `SignInRefused`.

After the reply, `finish` reads the clock again. Its MongoDB update requires the attempt to remain known, unexpired, and unconfirmed. The same update saves the Commons subject and reported username together; Step 25 adds username storage for recovery. No match throws `SignInExpired`; success returns the username. The reference code lacked this second expiry check. A regression test accepted a late reply before the fix and refuses it after the fix.

Run `bun test tests/CommonsFederating.start.test.ts tests/CommonsFederating.finish.test.ts --timeout 15000`. All 20 tests pass: five for `start` and 15 for `finish`. Finish tests cover exact time boundaries before and after the provider wait, wrong nonces and codes, repeated requests, persistence, deleted attempts, competing clients, and a rejected database write. They use real MongoDB and the reference MemoryProvider. A held reply and an injected clock make the timing tests deterministic.

### Step 21: update and test CommonsFederating.link

`link` takes a confirmed attempt and a local user ID. The future sign-in composition must supply the verified user. The action prepares the indexes, then opens a MongoDB transaction. An unknown or unconfirmed attempt throws `NotConfirmed`. An expired confirmation throws `SignInExpired`. An unexpired confirmation supplies the Commons subject for the new link.

The insert stays inside the transaction. After MongoDB completes the insert, the action checks the clock again. If the deadline has arrived, it throws `SignInExpired` and the transaction discards the link. Otherwise, the transaction commits and the action returns the local user ID. The unique subject index prevents two users from receiving the same Commons account. A duplicate throws `AlreadyLinked`; other database errors remain database errors. Attempt records stay unchanged.

Run `bun test tests/CommonsFederating.start.test.ts tests/CommonsFederating.finish.test.ts tests/CommonsFederating.link.test.ts --timeout 15000`. All 35 tests pass: five for `start`, 15 for `finish`, and 15 for `link`. Link tests cover exact expiry boundaries, delayed inserts, rollback, hidden uncommitted writes, preserved state, changed Commons usernames, persistence, competing database clients, and recovery after a rejected write. Before the fix, the delayed-insert tests wrongly succeeded at and after expiry.

### Step 22: test CommonsProvider.redeem

The reference [provider](src/concepts/Federating/provider.ts) remains unchanged. `redeem` sends one JSON POST to Commons `/api/connect/redeem`. The body contains `code`, the app's origin, and `code_verifier`. It refuses redirects and uses a ten-second timeout. A successful JSON reply must contain string fields `user` and `username`. The provider returns them as `subject` and `username` and ignores other profile fields.

HTTP 400 means Commons refused the code. The provider returns `undefined` without a warning. Other failed statuses, malformed replies, network errors, and timeouts also return `undefined`, with a warning. The provider never retries a request. The existing `finish` action turns an absent identity into `SignInRefused`.

Run `bun test tests/CommonsProvider.redeem.test.ts --timeout 15000`. All 21 tests pass. A local [Bun HTTP server](https://bun.sh/docs/runtime/http/server) supplies controlled responses while the provider uses real `fetch`. Tests cover the exact request, invalid and already-used codes, failed statuses, malformed identities and JSON, redirects, connection failure, and a fresh request after a timeout. Timing tests check a short configured deadline, a stalled JSON body, and the real ten-second default. Server inactivity timeouts are disabled so they cannot hide a broken provider timeout. Each test closes its local servers.

### Step 23: connect CommonsFederating to the engine

[concepts.ts](src/concepts.ts) selects the imported CommonsFederating registry. [assembly.ts](src/assembly.ts) requires a Federating implementation for `Registering.User`. The new [Commons identity stage](design/stages/commons-federating.md) declares the same binding. Startup supplies CommonsProvider and stores attempts and links under `commonsfederating`. Checks and engine tests use MemoryProvider without contacting Commons.

Call `application.concepts.CommonsFederating.start({})`, then `finish` and `link` with their named inputs. `_user` and `_linkable` also run through the engine. The engine requires an input object even when there are no fields. The first integration run caught this mismatch in the reference `start()` signature. Its TypeScript signature now requires the empty object; its behavior and specification are unchanged.

The existing registry turns `SignInExpired`, `SignInRefused`, `NotConfirmed`, and `AlreadyLinked` into `{ error, detail }` results with their specification codes. Unexpected database errors still reject the call. The provider and registry remain unchanged from the reference.

Run `bun test tests/CommonsFederating.registration.test.ts --timeout 15000`. All nine engine tests pass, including the `_identity` checks added in Step 25. They cover all three actions and three queries, the four refusal codes, expiry during provider replies and database reads or writes, rollback, failed writes, and competing engines. A new engine reads the saved identity and finds the same local user after the Commons username changes. Explicit test calls use that user for a session and a course. The sign-in reactions have not been implemented yet.

The framework check covers four concepts with no advisories. At this step, generated-file checks and TypeScript passed, and the full suite passed all 216 tests. Step 24 adds registration recovery tests. Live Commons sign-in and browser cookies remain unverified.

### Step 24: make registration retryable

The [Registering specification](design/concepts/Registering.md) and implementation now require `recoveryKey` alongside `username`. The server supplies this key and must retain its association with the verified identity before calling `register`. Matching retries return the same local user. Reusing a saved key with a different username returns `RECOVERY_KEY_CONFLICT`. A username owned by another key returns `USERNAME_TAKEN`. A blank key returns `INVALID_RECOVERY_KEY`.

The account and key are saved in one MongoDB document. Unique indexes protect both names and keys. A duplicate insert triggers a new key lookup so simultaneous matching requests can both return the same user. Other database failures remain errors. Older accounts without keys stay readable, but matching a username cannot assign them a key. `_byRecoveryKey` lets the future sign-in flow find an account after an interrupted registration.

Run `bun test tests/Registering.test.ts tests/Registering.recovery.test.ts --timeout 15000`. All 20 tests pass against real MongoDB. They cover matching retries, both conflict rules, concurrent clients, failed writes, recovery after a committed insert loses its reply, and older records. The engine exposes all four refusals and the new query. At this step, the full suite passed all 229 tests.

Step 26 adds the store for the Commons identity-to-key mapping. The full sign-in recovery flow remains pending, and no public registration endpoint exists.

### Step 25: read a confirmed Commons identity

The [Federating specification](design/concepts/Federating.md) and implementation now save the reported username with the subject in `finish`. `_identity({ attempt })` returns only that saved subject, username, and expiry. It reads MongoDB first and then checks the server clock. A result arriving at or after expiry returns `[]`. Unknown, unconfirmed, and older attempts without a saved username also return `[]`. Database errors still reject the query.

The query makes no provider request and changes no records. It works before and after linking. The saved username is a suggestion from that confirmation; it does not rename a local account or fetch a newer Commons profile. The host must supply the attempt from the initiating browser's cookie and check expiry again before starting a session.

Run `bun test tests/CommonsFederating.finish.test.ts tests/CommonsFederating.identity.test.ts tests/CommonsFederating.registration.test.ts --timeout 15000`. All 39 tests pass: 15 for `finish`, 15 for `_identity`, and nine through the engine. Held database results test expiry just before, at, and after the deadline. A simulated lost reply after a real confirmation write verifies recovery from a new database client without redeeming another code. Tests also cover unchanged state, older confirmations, changed usernames, and database errors. At this step, the full suite passed all 245 tests.

### Step 26: persist registration recovery keys

[RegistrationRecoveryStore.ts](src/storage/RegistrationRecoveryStore.ts) stores one recovery key per provider origin and stable subject. Construct it with the server's configured provider origin, then call `getOrCreate({ subject })` with a verified subject. It returns `{ recoveryKey }`. The store uses its own `registrationrecovery.keys` collection and does not create accounts, links, or sessions.

An existing record returns its saved key. A missing record gets a random UUID through an upsert with `$setOnInsert`, which cannot replace another request's saved key. Unique indexes protect both the provider/subject pair and the key. Every returned key comes from a majority read, and writes use majority acknowledgment and journaling. A candidate-key collision permits up to three allocation attempts. Other database errors stop the call. A failed or uncertain write never returns an unsaved candidate.

Run `bun test tests/RegistrationRecoveryStore.test.ts --timeout 15000`. All 14 tests pass against real MongoDB. Two clients that race for one identity receive one key and register one local account. Different identities with a forced candidate collision receive different keys. A fresh Bun process recovers the saved key after the first client closes and after a real write loses its reply. Tests also check provider separation, exact subjects, invalid inputs, rejected writes, damaged records, and index failures. The full suite passes all 259 tests.

The store does not expire or rotate keys. The sign-in host must still verify the browser's attempt, obtain the subject from `_identity`, wait for the store before registration, and recheck expiry before continuing. That connection and the browser endpoints remain pending.

MongoDB 8.0.32 runs at `127.0.0.1:27017`. The default database is `stillgotit`. [compose.yaml](compose.yaml) pins the image and keeps data in the `stillgotit_mongo_data` volume. It uses a single-node replica set so later actions can use [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/). Local connection options are in [.env.example](.env.example).

Tests use a fresh database and delete only that database. They do not use the demo database. To stop MongoDB and keep its data, run `bun run db:stop`. Start it again with `bun run db:up`.

Next, review how sign-in uses the confirmed identity and saved recovery key to register or recover the local account. Then implement that flow, linking, and session creation before adding public course endpoints and a minimal Vue page.

## P1 design submission

Read the [complete design document](design.md), or go directly to a required section:

1. [Problem framing and stakeholders](design.md#problem-framing-and-stakeholders)
2. [Application pitch](design.md#application-pitch)
3. [Concept specifications, essential reactions, and their roles](concepts.md)
4. [UI sketches](design.md#ui-sketches)
5. [User journey](design.md#user-journey)

Sketches are in [images](images/). The design notebook is in the private individual repository.

## Course references

[Background documents, rubrics, and project directions](reference_docs/README.md).
