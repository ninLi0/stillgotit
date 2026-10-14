# Runtime responsibilities

Eight domain concepts own their records. A ninth, Generating, exposes external inference as an engine action. The Bun host handles cookies, provider credentials, binary files, import checkpoints, and request locks. It does not sequence learning actions or write concept collections. The [P2 stage](stages/materials.md) selects the endpoint, reaction, view, former, and computation specifications.

## Accounts and requests

Commons identifies the learner. The server reads its sign-in attempt and session from HttpOnly cookies. It does not trust an owner, local user ID, recovery key, or session field from the browser. State-changing requests require the configured Origin. The app runs at `http://localhost:5173` by default and listens only on loopback.

Commons confirmation redeems one code and saves a verified identity. Continuation uses that identity and RegistrationRecoveryStore to find or create the local account, save the Commons link, and start a session. A failed link can resume without another registration or code redemption. Expiry is rechecked after slow work and before cookies are delivered. A lost reply can leave an undisclosed session until expiry; the flow does not promise exactly one session.

Use one Bun process for P2. A per-attempt lock serializes sign-in. A per-learner lock covers course creation and learning mutations. P2 holds this lock through provider calls to prevent concurrent changes to the saved context. Engine flows recheck the session after provider work. HTTP and the exported runtime gateway share an admission function that evaluates registered formers under the learner lock. A declined command returns an explanation before provider work starts. The engine and gateway share a four-minute request limit; the provider has its own three-minute timeout. Queries are uncached. Running several servers requires a database-level application coordination design.

Native integrations use the exported runtime gateway. It preserves the admission checks and locks used by HTTP. The raw assembled invoker remains an internal interface that assumes those preconditions. The [advisory review](advisory-review.md) records the P2 decision to keep gateway protection and leave raw-endpoint refusal paths outside this change. Locks wait only for dispatched engine work, so a queued native call cannot prevent an HTTP call from releasing the same lock.

The concept actions enforce their own state rules. SkillMapping saves a new skill, its first version, and its proposal receipt in one transaction. Each learner's proposal key identifies the original input and result. Retrying that input returns the same skill without undoing later edits. Draft deletion retains the receipt and prevents replay from recreating the skill. The browser stores pending draft requests before sending them and removes each only after acknowledgment. See the [course flows](compositions/courses.md).

AssessmentReviewing stores a case and its append-only judgments in one document. StudyPlanning stores a learner's plans together so replacement and the single-current-activity rule are atomic. MasteryEstimating keeps one effective input per evidence identity and accepts only a higher revision.

## ChatGPT connection

Commons identity and ChatGPT plan access are separate. The host follows OpenAI's [local/open-source OAuth flow](https://developers.openai.com/siwc/token-sharing-open-source). A connection uses state, PKCE, nonce, and a stable local host identity. It verifies the ID token's signature, issuer, audience, expiry, nonce, and subject. It also requires scopes for inference and direct ChatGPT plan usage.

The callback is `http://127.0.0.1:<port>/auth/chatgpt/return`. It prepares credentials, then returns to the configured app origin. Finalization requires the same Commons owner and the initiating browser cookie. Pending attempts expire after ten minutes. They do not survive a server restart; start a new connection in that case.

Credentials stay in owner-scoped files under `.data/chatgpt`, with protected file permissions and atomic replacement during refresh. Account selection and model selection are scoped to that learner. Tokens never reach the frontend or Git. Disconnection clears local tokens and attempts provider revocation. The UI reports when remote revocation could not be confirmed.

The model picker reads the active account's catalog. The effort picker intersects each model's supported levels with the published [Responses API reasoning efforts](https://developers.openai.com/api/docs/guides/reasoning). Catalog execution modes outside those values are excluded. Model and effort are saved together for that ChatGPT connection and survive restart, refresh, and reconnection. Changing models retains a compatible effort or selects the catalog default. A model with no effort metadata uses the API default. The server rejects unsupported choices and checks that the account did not change during validation. Each new tutor request sends the selected effort; a request already in progress keeps its original settings.

The Generating action delegates transport to the host provider adapter, which calls the public Responses API with the account's model, `store: false`, `stream: true`, and structured output. It collects text by output item and content part, then requires a completed terminal event. The terminal event may have an empty output array even when earlier events contain the answer. Repeated final-part events replace their text instead of duplicating it. A completed answer returns immediately and closes its reader; it does not wait for the provider to close the connection. A partial stream is not treated as a completed answer. The [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) do not provide the audio transcription API through this connection. Local Whisper handles voice instead.

## File import

`MaterialImportStore` preserves one request, server-generated key, and exact prepared input. Its [contract](material-import-store.md) defines CREATED, SOURCES_SAVED, READY, and COMPLETE checkpoints. Unique owner/request and owner/key indexes protect retries. Store writes occur outside reaction conditions.

The multipart host checks the session and declared course-access former, hashes actual uploaded bytes, and retains originals under owner-specific paths. It prepares text and image renditions, records extraction limits, and saves READY before calling GroundedTutoring.addMaterial. An exact retry reuses the saved key and input. The material action stores its record and retry mapping together. A restart after that save but before COMPLETE can recover the same material.

The Python processor reads PDFs, documents, slides, sheets, text, notebooks, images, and bounded archives. LibreOffice adds document rendering. Page images preserve diagrams and equations for the tutor. Source locations accompany extracted content. A download uses the declared material-read endpoint to check owner and course access, then requires an exact saved file reference. Merely knowing a file ID gives no access.

Uploads permit 12 files and 25 MB combined. Individual sources permit 50 pages. Tutor requests permit 40 image renditions. Archives permit 60 files and 50 MB expanded and reject traversal, links, nested archives, and encrypted entries. Original files and extraction limitations remain inspectable. The importer does not guarantee accurate reading of every layout or format.

Microphone audio is written temporarily for local Whisper and removed in a finally block after success, failure, or timeout. The transcript is saved only when the learner sends it. Uploaded lecture audio is retained and transcribed as course material. A process crash may leave a temporary file for later cleanup; this prototype has no startup scavenger.

## Lessons, practice, and evidence

Declared views join owned skills, current requirements, and source material before a Generating action asks the tutor. The provider adapter validates returned text and cited material/location pairs. The endpoint rechecks the original definition after generation. A changed definition produces a conflict instead of saving content under new requirements. Existing sessions retain their original requirements and sources. Submitted photos are read as the learner's work, separately from reference solutions.

Practice checks prerequisite readiness. Lesson explanations remain available when prerequisites need work. A requested hint is recorded before it is delivered. Recorded hints and declared outside help prevent independent-success judgments.

Submission requires an explicit whole-attempt review and the displayed dialogue length. GroundedTutoring saves freshness and outside-help declarations with that review. SubmitReviewed constructs work from saved responses, corrected transcripts, attachments, hints, citations, and fixed criteria. It uses the server flow time. The browser cannot replace criteria, owner, result, or recorded help. The learner confirms whether the exact problems are unfamiliar; uncertain freshness cannot meet the full gate.

A submission reaction saves the case. Its successful action triggers task closure. These are separate durable actions. All later mutation paths check whether a case already exists. A provider failure leaves that case available for retry. A regrade appends a judgment and preserves earlier judgments and original work. A manual correction follows the same help, freshness, and gate rules.

Successful assessment, revision, and graded-import actions trigger evidence reactions. Each reads the effective judgment and applies it once to its original mastery track. A higher revision replaces the earlier contribution; it is not another practice success. The authentication occurrence of Learning.Read triggers repair reactions for that learner. They recover missing task closures and outdated mastery contributions from durable records. The read waits for those reactions. No old occurrence log is replayed. Unjudged cases remain visibly pending. If a later step fails, earlier concept writes remain saved; a fresh read and plan request recover that work.

## Review planning

Study dates use `America/New_York`; mastery decay uses elapsed time. A declared pure computation supplies candidate activities and a context digest from query snapshots. StudyPlanning also compares its own saved budget, date, and work records before activation.

P2 proposes ten-minute activities across seven days. The first independent success suggests a next-day review. Independent work on later study dates extends the interval to three, then seven days. A slip or understanding gap resets it. Candidate keys persist while the same work and window remain applicable. The plan shows work that cannot fit.

Reactions to budget, confidence, effective evidence, and finished/stopped/missed activities request a new routine plan. A separate reaction activates a proposal only after the concept and context checks pass. Refresh waits while an activity is in progress. Beginning an activity checks its current requirements and prerequisites. Completing a timed activity records actual time; it does not create assessment evidence. A missed activity has no direct mastery effect.

The full StudyPlanning concept implements exam cuts and explicit approval, but the P2 interface exposes daily planning only. Exam management, richer prerequisite editing, source search, and graded-coursework import remain P3 application work.

## Frontend boundary

Vue uses the generated HTTP client and output types for courses, suggestions, tutoring, assessment, mastery, and planning. The small host transport handles OAuth controls, multipart imports, binary downloads, and temporary microphone audio. Browser types exclude private `/internal/*` routes. The upload response type comes from the private generated material endpoint.

The frontend displays state and sends learner choices. It does not calculate mastery, copy judgment effects, allocate review work, or decide who owns records. One generated question command saves learner input and requests the lesson reply. The UI offers a separate retry if the provider fails after the question was saved.

## Verification boundary

The tests use real MongoDB for domain persistence and controlled provider responses for integration. File tests exercise actual parsers; a generated speech sample exercises actual local transcription. An isolated browser test uses canned AI responses. Separate live checks used the approved ChatGPT connection with an MIT lecture PDF and scripted answers in their own databases. They verified skill proposals, cited lessons and follow-up, fresh practice, image and text assessment, mastery, review planning, and reload persistence. The check after the refactor used the account's maximum reasoning effort and the generated frontend client. The main account's learning records were unchanged. These samples do not establish broad grading accuracy, microphone capture, or handwriting recognition. The narrated recording remains a separate deliverable. See [P2 status](../P2.md).
