# Runtime responsibilities

Eight domain concepts own their records. A ninth, Generating, wraps calls to the AI tutor as an engine action. The Bun host handles everything that is not a concept's job: cookies, the Gemini connection, uploaded files, import checkpoints, and request locks. It does not sequence learning actions, and it never writes to a concept's collections. The [materials stage](stages/materials.md) lists the endpoints, reactions, views, formers, and computations that connect the concepts.

## Where the app runs

The app is deployed on 6.1040 Apps, the class platform. The platform runs one Bun process from a plain Bun image. Its file system is read-only, and each deployment starts on a fresh machine. The platform sets `HOST`, `PORT`, and `NODE_ENV`. The owner sets `PUBLIC_ORIGIN` to the app's `https` address, and the server accepts state-changing requests only from that origin. Cloudflare sits in front of the app and ends any request that takes longer than about 100 seconds.

MongoDB on the platform is a single server, not a replica set, so it has no transactions. The database name comes from `MONGODB_URI`. The server keeps at most four connections open, because the platform allows ten and the old and new versions overlap briefly during a deployment. Local development runs MongoDB the same way, so any code that needs a transaction fails on a laptop before it fails online.

Uploaded files go to the platform's S3 storage when the `S3_*` variables are set. Without them, development saves files under `.data/files`. The `/health` route answers `GET` and `HEAD` so the platform can check that the app started.

## Accounts and requests

Commons identifies the learner. The server reads the sign-in attempt and the session from HttpOnly cookies. It never trusts an owner, user ID, recovery key, or session that the browser sends in a request body.

Confirming a Commons sign-in redeems a one-time code and saves the verified identity. The next step uses that identity to find or create the local account, link it to Commons, and start a session. If the link fails, the learner can resume without registering again or redeeming another code. The server rechecks expiry after slow work and again before it sets cookies. A lost reply can leave an unused session behind until it expires, so the flow does not promise exactly one session.

Linking an account uses no transaction. A unique index on the Commons subject refuses a second link, even when two requests arrive at the same moment. After the insert, the server checks expiry again. If the sign-in expired while the insert was in flight, it removes the new link and reports the expiry.

The app runs as one process, and the host serializes work with in-process locks. One lock per sign-in attempt covers sign-in. One lock per learner covers course creation and every learning change, and it is held through AI calls so the saved context cannot change underneath a lesson. After an AI call, the engine checks the session again. HTTP requests and the exported runtime gateway share one admission function, which evaluates the registered formers under the learner lock, so a refused command is explained before any AI work starts. The engine and gateway give each request at most 90 seconds, and a single Gemini call gets at most 80 seconds, which keeps both under Cloudflare's limit. Queries are not cached.

Native integrations use the exported runtime gateway, which keeps the same admission checks and locks as HTTP. The raw assembled invoker is an internal interface that assumes those checks already happened. The [advisory review](advisory-review.md) explains why the gateway carries this protection. Locks wait only for work the engine has already dispatched, so a queued native call cannot keep an HTTP call from releasing a lock.

## Safe writes without transactions

Each concept enforces its own rules. Without transactions, a concept that changes more than one record writes them one at a time, in an order where a reader never sees a half-finished change. If a process stops partway, repeating the same request either finishes the work or is refused.

SkillMapping follows these rules:

- **Proposing a skill.** The concept first saves a pending receipt under the learner's proposal key. The receipt holds the original input and the IDs chosen for the new skill and its first version. Next it saves the version, then the skill, and finally marks the receipt as saved. A skill therefore never exists without its version. If the process stops before the end, retrying the same key finishes the save. Retrying with different input is refused.
- **Revising a skill.** The concept saves the new version first. Then it makes that version current with a single conditional update, which succeeds only if nothing else changed the skill in the meantime. If that update fails, the old version stays current, and the unused version is removed.
- **Discarding a draft.** The concept removes the skill before its versions and keeps the receipt. Replaying the original proposal after a discard is refused, so a discarded draft cannot come back.
- **Confirming, editing details, and attaching material.** Each is one conditional update on the skill. If another change got there first, the concept reads again and either retries or refuses.
- **Prerequisites, archiving, and restoring.** These rules involve two skills at once. For example, a cycle needs both A→B and B→A, and an active skill must not require an archived one. A condition on one skill cannot see a change to the other. So these actions briefly claim the course record, run their checks, make one update, and release the claim. The claim expires after 10 seconds, so a stopped process cannot lock a course for long.

The browser stores pending draft requests before it sends them and removes each one only after the server acknowledges it. The [course flows](compositions/courses.md) describe these requests.

The other concepts keep related data in one document, so a single write is enough. AssessmentReviewing stores a case and its append-only judgments together. StudyPlanning stores a learner's plans together, which makes replacing a plan and the one-activity-at-a-time rule a single write. MasteryEstimating keeps one effective input per piece of evidence and accepts a replacement only when its revision number is higher.

## The AI tutor (Gemini)

The host calls Google's Gemini API directly. The API key lives only in the server's environment. It is sent in a request header and never appears in a URL, a log, or a response to the browser. The model defaults to `gemini-3.8-flash`, and `GEMINI_MODEL` can override it.

Each request sends the tutor's instructions, the learner's request, and the selected course material. Text renditions go as text. Images go inline, up to 40 images and 30 MB in total. An original PDF of 15 MB or less also goes inline, so the tutor can see its figures; a larger PDF is sent as text only, with a note that its visuals were left out. Gemini returns JSON that matches a schema, and the host still checks the answer and every cited material and location before anything is saved.

When Gemini fails, the learner sees a plain explanation instead of a generic error. The host tells apart a busy service, a used-up quota or billing problem, a missing or wrong key, a request Gemini would not accept, a safety block, an answer that was too long or empty or badly formed, a timeout, and a network failure. The server log records Google's status and message, which help the app owner fix setup problems. If the server has no key, the AI buttons are disabled and the reason appears beside them.

Dictation sends the learner's recording to Gemini, which writes down exactly what was said, with spoken math written as symbols. The recording is not stored. The transcript is saved only if the learner sends it as an answer.

Course materials and answers leave the app when they go to Google. The setup screen says so, and it asks learners not to upload anything private.

## File import

`MaterialImportStore` saves each import request with a server-generated key and the exact prepared input. Its [contract](material-import-store.md) defines the CREATED, SOURCES_SAVED, READY, and COMPLETE checkpoints. Unique owner/request and owner/key indexes protect retries, and the store is written outside reaction conditions.

The upload endpoint checks the session and the course-access former, hashes the bytes it actually received, and saves the originals under paths specific to the owner. It then extracts text and images, records what it could not read, and saves READY before calling `GroundedTutoring.addMaterial`. An exact retry reuses the saved key and input. The material action stores its record and its retry mapping together, so a restart after that save but before COMPLETE recovers the same material.

The importer runs in memory with TypeScript. It reads PDF text page by page, PNG, JPEG, and WebP images, plain text, Markdown, and code, notebooks cell by cell, and the text of Word, PowerPoint, and Excel files. It does not render pages as images, so a PDF made only of scans has no readable text. Office files carry a note that their pictures and charts were not included. [Material data](material-data.md) lists the formats and their source locations.

Uploads allow 12 files and 25 MB in total, and each source allows 50 pages. Office files may unpack to at most 50 MB. ZIP archives, audio, and other unsupported types are refused before anything is saved. Learners can still open their original files and see what the importer could not read. The importer does not promise to read every layout correctly.

A download goes through the declared material-read endpoint, which checks the owner and course access, and then requires an exact saved file reference. Knowing a file ID is not enough to download it.

## Lessons, practice, and evidence

Declared views join the learner's skills, their current requirements, and the source material before a Generating action asks the tutor. The host checks the returned text and its citations. The endpoint then rechecks the skill's definition, and if the definition changed during generation, it reports a conflict instead of saving content under the new requirements. Existing sessions keep their original requirements and sources. A submitted photo is read as the learner's own work, separately from any reference solution.

Practice checks whether prerequisites are ready. Lesson explanations stay available even when prerequisites need work. A hint is recorded before it is shown, and a recorded hint or declared outside help rules out an independent-success judgment.

Submitting work requires the learner to review the whole attempt and confirms the number of dialogue turns shown. GroundedTutoring saves the freshness and outside-help declarations with that review. The reviewed work is built from the saved responses, corrected transcripts, attachments, hints, citations, and fixed criteria, and it uses the server's time. The browser cannot replace the criteria, owner, result, or recorded help. The learner states whether the exact problems were unfamiliar, and work of uncertain freshness cannot meet the full gate.

A submission reaction saves the assessment case, and that save triggers closing the task. These are separate durable actions, and every later change checks whether a case already exists. If the AI fails, the case stays available to retry. A regrade adds a judgment and keeps earlier judgments and the original work. A manual correction follows the same help, freshness, and gate rules.

Successful assessments and revisions trigger evidence reactions. Each one reads the effective judgment and applies it once to the skill's mastery track. A higher revision replaces the earlier contribution instead of counting as another success. When a learner signs in and reads their courses, repair reactions recover any task closures and mastery contributions that a failure left behind, using the durable records. The read waits for those repairs. Unjudged cases stay visibly pending. If a later step fails, earlier concept writes stay saved, and a fresh read and plan request recover the rest.

## Review planning

Study dates use the `America/New_York` time zone, and mastery decay uses elapsed time. A declared pure computation proposes candidate activities and a digest of the context from query snapshots. Before activating a plan, StudyPlanning also compares its own saved budget, date, and work records.

The planner proposes ten-minute activities across seven days. The first independent success suggests a review the next day. Independent work on later days stretches the gap to three days and then seven. A slip or a gap in understanding resets it. Candidate keys stay the same while the same work and window still apply. The plan also shows work that does not fit.

Changes to the budget, confidence, effective evidence, or an activity's outcome (finished, stopped, or missed) request a new plan. A separate reaction activates the proposal only after the concept and context checks pass. Refreshing waits while an activity is in progress. Starting an activity checks its current requirements and prerequisites. Finishing a timed activity records the actual time but does not create assessment evidence, and a missed activity does not change mastery directly.

The StudyPlanning concept supports exam deadlines with explicit approval of tradeoffs, but the interface offers only daily planning for now. Exam management, prerequisite editing, source search, and graded-coursework import are planned for P4.

## Frontend boundary

Vue uses the generated HTTP client and output types for courses, suggestions, tutoring, assessment, mastery, and planning. A small host transport handles the AI status check, multipart uploads, file downloads, and microphone recordings. Browser types leave out the private `/internal/*` routes, and the upload response type comes from the private generated material endpoint.

The frontend shows state and sends the learner's choices. It does not calculate mastery, copy the effects of a judgment, allocate review work, or decide who owns a record. A single generated question command saves the learner's question and asks for the lesson reply. If the AI fails after the question was saved, the interface offers a separate retry.

## Verification boundary

The tests use a real, standalone MongoDB server for concept storage and controlled AI responses for integration. The file tests run the real parsers on small PDF, Word, PowerPoint, and Excel fixtures, and the storage tests use both the disk store and a fake S3 server. The Gemini tests use a fake `fetch` to check the request format, parsing, and every error path. An isolated browser test uses canned AI responses. These tests do not establish how accurately the tutor grades work or reads handwriting. [P3 status](../P3.md) records the checks made on the deployed app.
