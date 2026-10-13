# Runtime responsibilities

The learning concepts own domain records. Registering, CommonsFederating, and Sessioning own local accounts, Commons identity links, and local sessions. The Bun host supplies provider calls, cookies, file processing, request coordination, and restart recovery. Host services must not write concept collections directly. Changes go through registered actions; reads use queries and composed views.

## Commons and request handling

Follow the [accounts](compositions/reusable/accounts.md) and [Commons](compositions/reusable/commons.md) specifications. Bind the stable Commons subject to `Registering.User`. On later requests, use `Sessioning.use` to check the local session. Do not identify a learner by display name or accept an actor supplied by the browser. Protect state-changing requests against cross-site use and keep session credentials out of responses and logs.

The callback is `/auth/commons/callback`. The HTTP host prefixes logical endpoint paths with `/api`. It owns the HttpOnly sign-in and session cookies. Federating must check expiry at confirmation and link writes. Specify and test recovery from a saved registration followed by a failed link before exposing finish or choose endpoints. The [eight-instance inventory](types.md) includes planned components; it does not mean that all are implemented.

Use one Bun process for the local P2 app. Every public mutation and delayed provider result uses the same per-learner mutation lock. Acquire it before ownership and context checks and hold it through the short domain write sequence. Release it during network calls; reacquire it and recheck context before accepting the result. A read-then-write reaction alone does not prevent a race.

MongoDB stores concept records in separate collections with indexes for their declared uniqueness constraints. Each owner action must leave either its complete change or no change after a refusal. SkillMapping uses a MongoDB session and transaction to create a draft skill and its requirements version together. Both writes share the session and run in sequence. A test rejects the version write and verifies rollback of the skill write. Courses and units cannot be deleted, moved, or reassigned under the current specification, so their ownership checks remain valid through proposal creation. Revisit this assumption if those actions are added.

Draft revision reads the draft, its course, the target unit, and its current requirements inside one transaction. It creates a version only when the outcome or gate changes. It then updates the draft. A transaction retry reads the state again before applying the edit. Tests verify rollback when either write fails and version history after two identical concurrent edits. Engine action queues are not database transactions.

Draft discard checks status and ownership inside a transaction, then deletes the skill and all its versions. A test makes the versions collection a read-only view to force a database error on the second delete. The skill and versions remain intact after rollback. Other tests cover two simultaneous discards and a discard during revision.

Confirmation checks draft status, ownership, and a nonempty materials set inside one transaction. It changes only the status. Tests cover a rejected status update and confirmation during source removal or draft discard. SkillMapping treats material IDs as external references; the host must check ownership and readable imported content before supplying them.

Detail edits check confirmed status, ownership, the target unit's course, and the title inside one transaction. They update only the unit and title. Tests verify version and prerequisite preservation, rejected writes, and complete title and unit pairs after concurrent edits.

Requirements revision checks ownership, confirmed status, and the current definition inside one transaction. Blank or unchanged requirements are refused. A changed definition creates a version and updates the skill's current version together. The returned previous ID comes from that transaction's read, including after a retry. Tests cover failure of either write, simultaneous revisions, and preserved history. Mastery and planning reactions remain unimplemented.

Source attachment checks ownership and confirmed status inside one transaction, then uses `$addToSet` to add one material ID. Repeating a link succeeds with no duplicate or new requirements version. Tests cover failed writes, concurrent attachments, and attachment during a requirements revision. The host must check material ownership, course, and readable content before calling this action.

Prerequisite replacement checks confirmed status and course ownership, then validates the proposed links inside one transaction. It replaces the full set without changing requirements versions. Empty sets clear the links. Tests cover invalid references, direct and indirect cycles, shared foundations, preserved state, and failure of either write.

To prevent cycles from concurrent edits to different skills, each transaction first changes an internal `prerequisiteLock` marker on the course. A conflicting transaction retries and checks the graph again. This uses MongoDB's [transaction write-lock pattern](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/#in-progress-transactions-and-stale-reads). Queries do not expose the marker. Refusals and failed writes roll it back. Concurrency tests pause the first real database reads so competing transactions start from the same earlier state. Archive and restore share this lock.

Archiving checks confirmed status and ownership, takes the course lock, and looks for confirmed skills that require the target. Any such skill prevents archival. Otherwise, the transaction changes only the target's status to `ARCHIVED`. Requirements versions, sources, and prerequisite links remain readable. Links from archived skills do not block archival. Tests cover rejected writes, repeated requests, and overlapping prerequisite changes or archives. A compound index on prerequisites and status supports the dependent lookup.

Restoration checks archived status and ownership, takes the course lock, and follows the saved prerequisite chains. Every required skill must be confirmed and in the same course. Self-dependencies and chains back to the target are refused. The transaction changes only the target's status to `CONFIRMED`; all saved content and links remain. Other skills are not restored automatically. Tests cover restoration order, preserved history, failed writes, repeated requests, and overlapping restores or prerequisite archival.

## Framework registration and startup

SkillMapping's registry connects the class, specification, and 24 refusal codes. The assembly receives a ready implementation. Calls through `application.concepts.SkillMapping` run through the engine. Registered errors become refusal results with `error` and `detail`; unexpected database errors reject the call. Direct class calls still throw their original errors. Registration does not change the concept's MongoDB transactions.

Registering's registry connects its class, specification, and four refusal codes. `register` requires a valid username and a nonblank recovery key. It reads by key first. An exact retry returns the saved user; a changed username throws `RecoveryKeyConflict`. A new account saves the username and key in one document write. MongoDB enforces both uniqueness rules across clients. After a duplicate insert, the action reads the key again to distinguish a concurrent matching registration from a key or username conflict. Other database errors propagate. See [attribution](../THIRD_PARTY_NOTICES.md) for changes to the reference.

The key index is [partial](https://www.mongodb.com/docs/manual/core/index-partial/), covering string keys. Older rows without keys stay readable and keep their usernames. No action assigns them a key by matching a username. `_byRecoveryKey` returns no row for a blank or missing key, so it cannot accidentally select an older row. All new accounts require a key.

Twenty registration tests use real MongoDB. They cover action rules, exact key comparison, all four engine refusals, preserved state, and course ownership. Controlled reads force three kinds of concurrent registration across two clients. A simulated lost reply after a real insert verifies recovery after reconnecting. Database validators reject writes, and an unrelated unique index verifies that database faults are not mislabeled as username conflicts. The recovery-key store is described below. Connecting it to the sign-in composition remains pending.

Sessioning's reference class and registry are imported unchanged. `start` saves a supplied subject, a secret session ID, `lastUsed`, and a fixed 90-day expiry. It prepares an expiry-cleanup index and returns only after the insert succeeds. Four tests check the saved state, separate sessions, persistence after reconnecting, and a rejected database write. The sign-in composition must verify the subject before calling `start`; cookie handling remains a host responsibility.

`use` checks the session ID, inactivity limit, and fixed expiry in one MongoDB update. A match updates only `lastUsed` and returns the saved subject. No match throws `NotSignedIn`. Eight tests check the exact seven-day and 90-day boundaries, refreshed activity, unknown sessions, preserved state, another database client's saved activity, and a rejected update. Tests inspect the collection because Sessioning has no queries. The expiry tests advance only the concept's clock, leaving records in MongoDB to check refusal before cleanup.

`end` uses the same time checks in a single `findOneAndDelete`. Success removes one session and returns its ID. No match throws `NotSignedIn`. Ten tests check removal, repeated requests, exact time boundaries, preserved sessions, persistent removal after reconnecting, and concurrent sign-outs. A read-only view in a test database forces a deletion error; records remain, and retry succeeds after restoring the collection. Cookie clearing remains a host responsibility.

Sessioning is assembled with `Subject` bound to `Registering.User`. Calls through the engine return `{ error: "NOT_SIGNED_IN", detail }` for the declared `NotSignedIn` error. Database faults still reject the call. Six engine tests cover registered course ownership, use and logout across clients, refusal results, preserved state, failure recovery, and simultaneous sign-outs. This binding connects identity types; it does not authenticate a browser request.

Federating comes from the pinned reference. Its providers and registry remain unchanged; `finish` and `link` add the expiry checks described below. CommonsFederating is assembled for Commons and Registering's user type. `start({})` uses an empty input object because engine actions require one. It generates an attempt ID, nonce, and verifier, sets a ten-minute expiry, and saves the unconfirmed attempt. It then returns the attempt ID, expiry, and Commons sign-in address. The address contains the nonce as `state` and a hash of the verifier. The raw verifier stays on the server until code redemption.

Five focused start tests cover the saved attempt, exact expiry, a known verifier-hash example, concurrent starts, persistence across clients, and a rejected insert followed by recovery. They block code redemption and make no Commons requests. MongoDB's expiry-cleanup index has a one-minute grace period; action checks must enforce expiry themselves.

`finish` checks the attempt and nonce before redeeming a code. After the provider returns an identity, a fresh clock reading enters the confirmation update's filter. The attempt must still exist, be unexpired, and have no subject. This one MongoDB update saves the subject and reported username together. An unmatched update throws `SignInExpired`. An absent provider identity throws `SignInRefused`. Unexpected database errors still reject the call.

Fifteen finish tests use real MongoDB and MemoryProvider. They cover exact time boundaries, held replies, wrong nonces and codes, preserved state, persistence, cleanup during a wait, competing clients, and a failed confirmation write. A validator rejects the username write and verifies that no subject is saved separately. Competing confirmations preserve the winning subject and username together. The timing regression failed against the original code and passes with the new guard. If the provider consumed a code before a failed write, that code cannot be used again; the test starts a fresh attempt.

`_identity` reads the confirmed attempt, then checks the server clock. It returns only the saved subject, username, and expiry while that deadline is still in the future. Unknown, unconfirmed, expired, and older attempts without a saved username return no row. The query changes no state and makes no provider request. Database errors propagate. The username is the value saved during confirmation, even if it changes on Commons later. A local link does not affect the result.

Fifteen identity tests use real MongoDB. Held results cross the deadline to check time after the database await. Tests also cover exact time boundaries, unchanged records, older confirmations, linked and unlinked identities, changed usernames, and a closed database client. A real confirmation write followed by a simulated lost reply verifies that a new client can recover both identity fields without redeeming another code. The sign-in host must still read the attempt from the initiating browser's cookie and check expiry before starting a session.

`link` prepares the indexes before opening a MongoDB transaction. It reads the confirmed attempt and checks expiry. Unknown or unconfirmed attempts throw `NotConfirmed`; expired confirmations throw `SignInExpired`. It inserts the subject-to-user link, then checks expiry again before committing. If the insert took too long, the transaction discards the link before any other request can read it. A retried transaction repeats these checks. The subject's unique index prevents competing links. Duplicate writes throw `AlreadyLinked`; other database errors propagate. The action does not alter the attempt or an existing link.

Fifteen link tests use real MongoDB and MemoryProvider. A held insert tests the deadline and rollback. Another client cannot see the uncommitted link. Other cases check refusal rules, unchanged attempts, identity after a Commons username change, persistence, cleanup during a wait, competing clients, and recovery after a rejected insert. The original code accepted the two delayed inserts that now throw `SignInExpired`. All 35 start, finish, and link tests pass together.

CommonsProvider's `redeem` sends one JSON POST with the code, app origin, and verifier. It refuses redirects. HTTP 400 returns no identity without a warning; other failed statuses, invalid replies, network failures, and timeouts return no identity with a warning. A successful reply must supply string `user` and `username` fields. `AbortSignal.timeout` limits both the initial response wait and JSON body reading. The default is ten seconds. No request is automatically retried.

Twenty-one provider tests pass using real `fetch` and local HTTP servers. They check request fields, invalid and already-used codes, malformed replies, redirects, connection failure, a custom deadline, a stalled response body, the real ten-second default, and a fresh request after timeout. The test servers disable their own inactivity timeout and close after each test. Provider code remains identical to the reference.

CommonsFederating's registered calls return `{ error, detail }` for its four declared refusals. Database faults still reject the call. Nine engine tests use real MongoDB and MemoryProvider. They cover all three actions and three queries, saved identity across engines, a renamed Commons account, session and course ownership, expiry during provider replies and database reads or writes, rollback, database faults, and competing links. The tests call Registering and Sessioning explicitly; no sign-in reactions run. Engine testing found that the reference's no-argument `start()` call fails in the engine wrapper. The required empty input object fixes that integration without adding input fields to the specification.

`src/main.ts` connects to MongoDB, prepares SkillMapping's indexes, and assembles Registering, CommonsFederating, Sessioning, and SkillMapping. It constructs CommonsProvider from `COMMONS_ORIGIN` and `APP_ORIGIN`, with the defaults in `.env.example`. It reports the concept and endpoint inventory, drains the engine, and closes the connection. It does not contact Commons or serve HTTP. `generated.config.ts` constructs the same registered concepts with an unconnected MongoDB client and MemoryProvider. Static checks and generation inspect declarations without running actions or creating indexes. Browser cookies, sign-in reactions, and live sign-in remain pending.

## Current onboarding host

`src/main.ts` now starts the Bun HTTP server and serves the built Vue page. `createRuntime` assembles the concepts and recovery store. `createApplicationHttp` wraps the reference HTTP adapter. The descriptions of pending HTTP work above record earlier component steps.

The wrapper checks request origin before any work. It reads attempts and sessions only from their cookies. It saves recovery keys outside query conditions, then supplies the saved key to the continuation endpoint. It ignores any browser-supplied key or local user ID. Concept actions still own all user, link, session, and course writes.

A per-attempt lock serializes confirmation and continuation. A per-user lock covers the course limit check and creation, including any accepted work still finishing after a response timeout. These locks cover one Bun process. A deployment with several processes needs a database-level application constraint.

The engine uses uncached queries. After a continuation returns, the host checks the current time before delivering cookies. If confirmation expired during a session write, it withholds the token and tries to end that session. An undisclosed session may remain if cleanup fails. This flow does not promise exactly one session after a lost reply.

The [onboarding stage](stages/onboarding.md) is the checked specification. It defines the split callback and continuation, eight endpoint paths, ownership view, course-list former, and UI. Live Commons sign-in and course creation have been checked. Earlier component test counts remain historical; [P2 progress](../P2.md) records current validation.

## Registration recovery keys

`RegistrationRecoveryStore` owns a separate `registrationrecovery.keys` collection. Each record contains the configured provider origin, the provider's stable subject, and one recovery key. Unique indexes protect both `(provider, subject)` and `recoveryKey`. The provider is fixed when the store is constructed and uses the same URL-origin normalization as CommonsProvider. Subjects must be nonblank strings and are compared exactly. A key is not sign-in proof.

`getOrCreate({ subject })` returns `{ recoveryKey }`. It reads an existing record first. If none exists, it generates a random UUID and uses an upsert with `$setOnInsert` to save it only if the record is still absent. It returns the saved key, never an unsaved candidate. If another client wins the same identity, both clients use that saved key. If a candidate collides with another identity's key, the store tries another candidate, up to three attempts. Other database failures propagate. Missing or invalid saved keys cause an error; the helper does not replace them.

The collection reads from the primary with [majority read concern](https://www.mongodb.com/docs/manual/reference/read-concern-majority/) and uses majority, journaled writes. Every returned key comes from a majority read, including a read after the upsert. A lookup must not return another client's key before that mapping is committed. These settings are explicit rather than inherited from a caller's database options.

The records have no automatic expiry and survive sign-out, expired attempts, and server restarts. The sign-in host must obtain the subject from `_identity`, save or retrieve the key before calling Registering, and recheck expiry after waiting. A failed or uncertain store write stops registration. A later request reads any completed write. This helper writes only recovery metadata; account creation and linking still use registered concept actions. The helper must not be called from a concept query or a reaction's read-only condition.

Fourteen tests use real MongoDB. Controlled reads make two clients see an absent record before competing to create it. The same identity receives one key and creates one local account through explicit Registering calls. Different identities that generate the same candidate receive different saved keys. A fresh Bun process reads a saved key after its writer closes and after a committed write loses its reply. Other checks cover provider separation, exact subjects, invalid inputs, rejected writes, damaged records, and index failures. The store is now connected to verified browser attempts by the onboarding host.

## GroundedTutoring material storage

The initial GroundedTutoring implementation contains `addMaterial`, `_materials`, and `_material`. It owns its namespaced materials collection and uses the [material data representation](material-data.md). It remains outside the running assembly while the other tutoring methods are pending.

`addMaterial` validates fields and requires nonblank text or a readable rendition. It snapshots input before the first database wait, prepares an owner/scope/ID index, and inserts one complete record. Invalid material is refused before storage work. Database failures remain errors. Each successful call creates a new identity; this action alone does not deduplicate a retried import.

`_materials` reads one owner and scope in material-ID order and returns summaries. `_material` reads a full record by ID. Both queries preserve state. Their inputs are internal identities; public requests will need session and ownership checks in the composition. The concept does not call other concepts or read file bytes.

Thirteen direct tests use real MongoDB and metadata fixtures. They verify both text and image representations, extraction limitations, input snapshots, query projections and filters, missing rows, malformed inputs, rejected writes, database-read failures, and persistence after the writer closes and a fresh process reads the record. These tests do not establish file readability or public access control.

## Provider and file operations

Use a host operation record for retryable service work. It holds an operation key, actor, kind, target, saved context version, status, and any created domain identities. It does not own skill definitions, grades, or mastery. Reusing a key with different input is refused. A retried successful operation returns the identities already saved for it.

Each create step needs a stable operation step key. Commit its created domain record and the step-to-result mapping in the same storage transaction or equivalent atomic operation. Saving the mapping afterward leaves a crash window that can create duplicate courses, materials, or drafts. The storage adapter supplies this infrastructure through the owner action; the host does not write the domain record itself.

Validate provider output against the expected structure. Recheck ownership, source selection, saved requirements, session state, and the operation's context before passing it to an action. New lesson and practice requests use current requirements. Existing sessions and assessment cases keep their saved requirements, even after the skill changes. A late reply must not replace a newer correction. Provider access remains server-side.

Keep original course files and submitted attachments with fixed owned references. Record extracted content locations and limitations. Finish all required parsing, rendering, and transcription before registering readable material or submitting work. Report unreadable content. Accepting an upload does not prove that its diagrams, tables, or equations were processed.

Microphone audio is temporary. Save the transcript, then delete the recording. Also clean up failed or abandoned recordings. Uploaded lecture audio remains course material. A restarted request reads the saved transcript rather than assuming that temporary audio still exists.

## Time and recovery

Use trusted server time. For the local P2 demonstration, study dates use `America/New_York`, matching the course context. Keep that zone in configuration and include the derived study date in planning context. Use elapsed seconds for mastery decay. Browser timestamps do not decide judgment order or proposal freshness.

The framework does not resume reactions after restart. Before accepting new mutations, reconcile saved state:

| Durable state | Recovery action |
| --- | --- |
| An assessment case exists but its tutoring task remains OPEN | Block further edits and close the task. |
| Submitted work has no judgment | Show pending assessment and retry from the saved case. |
| A judgment is missing from mastery or has a newer revision | Apply that case's effective judgment with its original attempt date. |
| A mastery track is absent | Keep the judgment; apply it after the learner initializes that version. |
| A provider result belongs to an obsolete request context | Discard the result and retain the learner's current records. |
| An activity remains IN_PROGRESS | Let the learner resume, finish, or stop it. Do not mark it complete automatically. |
| A plan is based on old inputs or an earlier study date | Request a fresh proposal without assuming that old exam cuts were newly approved. |

Reconciliation must be safe to retry. A failed derived update is visible as pending until repaired. The interface must not claim that a submission failed when its case was saved successfully.

## Integration checks

Check two learners' access, concurrent course creation, transcript edits during submission, duplicate requests, stale AI replies, late regrades, and restart between dependent actions. Use real local MongoDB for persistence checks. Provider stubs test failure paths; the final core journey also needs real sign-in, file processing, transcription, and AI assessment.
