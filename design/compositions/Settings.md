# Settings

A learner chooses which Gemini model the tutor uses and how much it thinks before answering, which Gemini calls the thinking level. `TutorPreferring`, an instance of [Preferring](../concepts/Preferring.md), keeps that choice on the server for the signed-in learner, so it follows them to every browser. Every tutor request reads the choice on the server and sends that model and level to Gemini. No request uses a model name or level from the browser until the server has checked it against its own catalog. Dictation is the one exception: it keeps the server's configured model with no thinking level and its own error sentences. The [application stage](../stages/materials.md) binds the instance.

The learner also chooses which view Home shows: the skill tree or the task list. `ViewPreferring`, a second instance of Preferring, keeps that choice on the server in the same way, so it also follows the learner to every browser. [The home view](#the-home-view) describes it. The appearance (System, Light, or Dark) is different: it stays in the browser and never reaches the server, because whether a dark page suits the learner depends on the device and the room it is used in, and System already follows each device's own setting ([Dark mode](../visual-design.md#dark-mode)).

## The model catalog

The server offers a fixed table of models. Each entry has the Gemini model name, the name shown to learners, a one-line description, the thinking levels the model supports, its default level, the levels at which a long request may not finish within the 80-second limit, and a one-sentence trade-off. The table lists only models that return JSON matching a schema and read PDFs and images, because every tutor request needs both. Levels always appear in the order Minimal, Low, Medium, High. The browser and the catalog name them `MINIMAL`, `LOW`, `MEDIUM`, and `HIGH`; Gemini receives them in lowercase.

| Model | Shown as | Description | Levels | Default level | May not finish in time | Trade-off |
| --- | --- | --- | --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | The fastest and lowest-cost model offered. | Minimal, Low, Medium, High | Minimal | None | It answers quickly but can miss detail in long or difficult material. |
| `gemini-3.8-flash` | Gemini 3.8 Flash | A fast general model for lessons, practice, and feedback. | Low, Medium, High | Medium | None | It balances speed, cost, and care; raise the level for harder problems. |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (preview) | The most careful model offered, for difficult material and grading. | Low, Medium, High | High | High | It is slower and costs more, and as a preview Google may change or withdraw it. |

The "May not finish in time" column is meant to come from measured timings: one request at the app's maximum inline size, 30 MB in total with PDFs up to 15 MB, made at each model's highest level and at Pro's Medium. These timings have not been measured yet, so only Pro at High is marked. High is also Pro's default level, so a learner who chooses Pro lands on the marked level and sees the warning. If the app owner makes Pro the default, every learner without a choice runs at High.

`GEMINI_MODEL` names the default entry, after the server trims it and removes a leading `models/`. When `GEMINI_MODEL` is unset, the default is `gemini-3.8-flash`. If `GEMINI_MODEL` names a model that is not in the table, the server stops at startup with a message that names the offered models, because it cannot know which levels an unlisted model accepts. This keeps the default choice valid for as long as the server runs. Before each deploy, the app owner checks that the platform's `GEMINI_MODEL` is unset or is one of the three offered names. A learner who has made no choice gets the default model at that model's default level.

When the server has a Gemini key, it checks the table once at startup, before it accepts requests, against Gemini's model list: `GET v1beta/models?pageSize=200`, with the key in the request header and never in the address. It drops an entry when the list has no `models/<name>` record for it, or when that record's `supportedGenerationMethods` lacks `generateContent`. It drops nothing when the call fails, takes longer than 5 seconds, returns a malformed list, or returns a `nextPageToken`, because an incomplete list cannot show that a model is gone. It never drops the default entry. If the list lacks the default, the server logs a warning, and requests that use the default meet the provider refusal described below. The list's `thinking` field is not used, because its form is not confirmed; the table stays the only source of levels. The server logs one line naming any dropped models. The app therefore works the same whether or not this check succeeds.

The resulting table does not change while the server runs. A model that Google retires later is caught by the provider refusal below until the next restart drops it. These computations read that fixed table, so each returns the same result for the same inputs within one server process:

- **TutorCatalog**: The tutor models this server offers, in table order, with descriptions, trade-offs, supported thinking levels, default levels, and the configured default model.

```computations
tutorCatalog() : TutorCatalog
  Produces the offered models in table order, with each entry's fields and a mark on the default entry.

defaultChoice() : TutorChoice
  Produces the default model at that model's default level.

modelOffered(model: String) : Flag
  Holds when model exactly matches the name of an offered model, including case.

levelSupported(model: String, level: String) : Flag
  Holds when model is offered and level is exactly one of the levels that model lists.

offeredChoice(model: String, level: String) : TutorChoice
  Pairs an offered model with a level it lists. Flows use it only after modelOffered and levelSupported hold.

choiceOffered(choice: TutorChoice) : Flag
  Holds when a saved choice's model is still offered and still lists the saved level.

tutorStatus(saved: Flag, offered: Flag) : String
  Names the TutorStatus case: DEFAULT when nothing is saved, SAVED when the saved choice is still offered, and RETIRED when it is not.
```

## Reading and changing the choice

Each settings endpoint calls `Sessioning.use` and uses the returned user. No input names a learner, so one learner can neither read nor change another learner's choice. A missing or ended session is refused with `NOT_SIGNED_IN`.

[TutorStatus](view:Settings.TutorStatus) relates a learner to the choice that applies to them and its status. Exactly one case holds for each learner:

- SAVED: `TutorPreferring._choice` returns a choice, and [choiceOffered](computation:choiceOffered) holds for it. The choice is the saved one.
- RETIRED: `TutorPreferring._choice` returns a choice whose model is no longer offered, or whose model no longer lists its level. The choice is the saved one, and no tutor request may use it.
- DEFAULT: `TutorPreferring._choice` returns no row. The choice comes from [defaultChoice](computation:defaultChoice).

[tutorStatus](computation:tutorStatus) names the case from whether a choice is saved and whether it is still offered.

[TutorSettings](former:Settings.TutorSettings) answers one record for the learner: the offered models from [tutorCatalog](computation:tutorCatalog) in table order, the choice and status from TutorStatus, and the default choice. Every settings endpoint responds with this record.

[ReadTutor](reaction:Settings.ReadTutor) takes only the session. It responds with TutorSettings and changes nothing.

[ChooseTutor](reaction:Settings.ChooseTutor) takes the session, `model`, and `level`. The boundary first checks that `model` and `level` are strings of at most 100 characters, and refuses any other input as invalid before the flow starts. Then exactly one case applies:

- When [modelOffered](computation:modelOffered) and [levelSupported](computation:levelSupported) hold, [offeredChoice](computation:offeredChoice) builds the choice, `TutorPreferring.set` saves it, and the endpoint responds with TutorSettings.
- When the model is not offered, the endpoint refuses with `UNKNOWN_TUTOR_MODEL`: "That model isn't offered. Choose one of the models in the Tutor panel."
- When the model is offered but does not list the level, the endpoint refuses with `UNSUPPORTED_THINKING_LEVEL`: "That model doesn't offer this thinking level. Choose one of the levels shown for it."

A refusal saves nothing, so the learner's earlier choice, or the lack of one, stays as it was. Choosing the default model at its default level saves it as the learner's own choice, which stays even if the app owner later changes `GEMINI_MODEL`. Choosing replaces a RETIRED choice.

[ClearTutor](reaction:Settings.ClearTutor) takes only the session. It calls `TutorPreferring.clear` and responds with TutorSettings. Clearing when nothing is saved succeeds and changes nothing.

Each change is one write keyed by the learner, and the endpoint responds only after that write is saved, so a learner who sees "Saved" has a saved choice. If the reply is lost, sending the same choice again, or clearing again, gives the same result. Each response reflects the saved state at the moment TutorSettings read it, which is normally the change just made: SAVED after choosing and DEFAULT after clearing. Across devices the later write wins. If another browser changes or clears the choice between this write and that read, the response shows the other browser's result. Choosing and clearing do not take the learner's lock, so a save never waits behind a running lesson. This is safe because the table cannot change while the server runs and only offered choices are saved. A tutor request that passed admission therefore still finds an offered choice when it prepares its request, whether it is the earlier choice or the new one. A request that has already prepared its request keeps that choice, and the new choice applies to the next request.

## Every tutor request uses the choice

The tutor flows are Lesson, Task, Question, Reply, Hint, Assess, RetryAssessment, and Regrade in the [learning flows](Learning.md), and Suggest, which the [course flows](Courses.md) describe. Each reads TutorStatus in the same `where` condition that prepares its request, and requires status SAVED or DEFAULT. [withChoice](computation:withChoice) then adds that model and level to the prepared request before `TutorGenerating.generate` receives it. Question, Hint, Assess, and Regrade save something before they ask the tutor; they read the choice in the later step that asks.

```computations
withChoice(request: TutorRequest, choice: TutorChoice) : TutorRequest
  Adds the validated model and thinking level to a prepared request and changes nothing else in it.

requestChoice(request: TutorRequest) : TutorChoice
  Reads back the model and thinking level that a prepared request carried, so a response can say what produced its answer.
```

Admission refuses a RETIRED choice before any write. Before a tutor command is dispatched, HTTP and the runtime gateway evaluate [TutorReady](former:Settings.TutorReady) under the learner's lock, ahead of the command's own admission former. TutorReady admits the command when TutorStatus is SAVED or DEFAULT. Otherwise the command is declined with "The tutor model or thinking level you chose is no longer offered. Choose another one in the Tutor panel." Because this check runs first, a hint is not recorded, a question is not saved, and an attempt is not closed for a request that could not be sent.

The Gemini transport sends each tutor request to `models/<model>:generateContent` for the request's model. It puts `thinkingConfig: { thinkingLevel: "<level>" }` inside `generationConfig`, beside `responseMimeType` and `responseJsonSchema`, with the level in lowercase. A live call to Gemini on October 23, 2026, confirmed this field: `"low"` was accepted, while the same value placed directly in `generationConfig` was rejected. The transport refuses a tutor request that carries no model or level before contacting Google, so no tutor request can quietly fall back to a fixed model.

The same rule covers AI calls outside these nine flows. Every Gemini call made in answer to a learner's request uses the validated pair: the saved choice when TutorStatus is SAVED, the default when it is DEFAULT, and a refusal before any work when it is RETIRED. This includes graded-work extraction. Dictation is the one exception, as the introduction says. Work done at import time, with no learner waiting, uses the server's configured model.

Each successful tutor response also returns `tutor`, the model and level that produced the answer, which [requestChoice](computation:requestChoice) reads from the sent request. [SentTutor](former:Settings.SentTutor) forms that value from the sent request with requestChoice after the action, so each response can carry it. Lesson returns it beside the lesson, Task beside the task, Assess beside the attempt, Regrade beside the judgment, and Suggest beside the suggestions. Question, Reply, Hint, and RetryAssessment return it alone. It is not stored. `Generating` keeps no durable state, and the GroundedTutoring and AssessmentReviewing records have no fields for a model or level. The page therefore labels answers produced while it is open; after a reload, earlier answers have no label.

## When the provider refuses the model or the level

The server never retries with another model or level. When Gemini refuses a tutor request, `TutorGenerating.generate` refuses with `GENERATION_FAILED`, and the host replaces the reason with a plain sentence. In the sentences below, {model} is the chosen model's shown name and {level} is the chosen level's shown name.

The three sentences that send the learner to the Tutor panel apply only when Google's refusal identifies the chosen model:

- When Google cannot find the chosen model, or a permission limit names it: "{model} isn't available to this app right now. Choose another model in the Tutor panel and try again."
- When a quota limit that names the chosen model is used up, including a quota of zero for this key: "{model} has used up its quota for now. Choose another model in the Tutor panel, or try again later."
- When Google refuses the chosen level for that model: "{model} doesn't accept {level} thinking. Choose another level in the Tutor panel."

A refusal about the key, the project, or billing as a whole keeps its current sentence, because choosing another model would not help. A busy service, a safety block, and an incomplete answer also keep their current sentences. When it is unclear whether a refusal concerns the chosen model, the current sentence is used. The implementation grounds these signals in Google's actual responses, which live calls capture before implementation: one for an unknown model and one for a model that this key has no quota for. A timeout on a tutor request reads: "The tutor took too long to answer. Try again with a shorter request, less material, or a lower thinking level."

Dictation keeps its current sentences, because it does not use the learner's choice. Its timeout sentence gives no thinking-level advice. A model problem on the dictation path is reported as a setup problem for the app owner, not as a choice for the learner.

These refusals arrive after a flow's earlier saves, like other provider failures. Hint keeps the recorded hint, Question keeps the saved question for Reply, and Assess keeps the closed attempt for RetryAssessment. After choosing another model or level, the learner uses those same retries. Regrade saves the learner's clarification before it asks for a judgment. After a refusal, the learner's retry is another Regrade, which appends the same clarification a second time. Model refusals make this repeat more likely, and Regrade does not prevent it.

The 80-second limit for one Gemini call stays, and it cannot grow for higher levels. The engine allows each request 90 seconds, and Cloudflare ends a request after about 100 seconds.

## The Tutor panel

A button in the lesson's message box, among its tools, names the choice that applies, for example "Gemini 3.8 Flash · Medium". On phones it shows only the model, and its tooltip and spoken name keep the level. It opens the Tutor panel in a small dialog of its own, titled "Model and thinking" under the eyebrow "Tutor", which closes once a change is saved; Cancel, the ✕, and Escape close it without saving. Settings shows the same panel as its Tutor section. The page reads TutorSettings after sign-in and again each time the panel opens, so a second browser shows the same saved choice. The button shows the latest TutorSettings record the page received. Another browser's button keeps its last record until its panel opens or the page reloads, while the server always uses the newest saved choice. When the status is RETIRED, the button reads "Tutor: choose again" instead of naming the choice, and the panel opens on the RETIRED status line, which says the choice is no longer offered and asks the learner to choose again.

The panel contains, in order:

- The title "Tutor".
- The introduction "Choose which Gemini model writes your lessons, practice tasks, feedback, and skill suggestions, and how much it thinks before answering. Your choice is saved to your account and applies on every device."
- The current status. SAVED reads "You chose {model} with {level} thinking." DEFAULT reads "You're using the app default, {model} with {level} thinking." RETIRED reads "Your saved choice, {model} with {level} thinking, is no longer offered. Choose another one, or use the app default."
- A "Model" group with one option per offered model, in table order. Each shows its name, description, and trade-off, and the default entry adds "App default".
- A "Thinking level" group with only the levels the selected model lists. The model's default level adds "Model default". A level the model does not list is never shown, and changing the model selects that model's default level. The help text reads "More thinking can give more careful answers, but it takes longer and costs more. Less thinking is faster."
- A warning, shown only when the selected level may not finish in time for the selected model: "{level} thinking on {model} can take longer than the tutor's 80-second limit on long materials. If a request times out, choose a lower level or a Flash model."
- The actions "Save", which calls ChooseTutor; "Use app default", shown only when a choice is saved, which calls ClearTutor; and, in the dialog, "Cancel".
- After a save, the status message "Saved. Your next tutor request will use {model} with {level} thinking.", with the model and level taken from the returned record rather than from the form. After a refusal, the server's sentence.
- The privacy line from the settings dialog: "Your files and answers are sent to Google to create lessons and feedback."

Both groups are radio groups with visible labels. The warning, the status message, and refusals are announced to screen readers. The Settings dialog shows the panel as its Tutor section, which opens on the latest record each time Settings opens. When the server has no Gemini key, the panel still opens and saves a choice, and the reason beside the AI buttons still explains why the tutor is off.

Each answer produced while the page is open shows the label "{model} · {level} thinking" in the secondary text style, below the answer. This covers a lesson explanation, a lesson reply, a practice task, a hint, an assessment judgment, and the heading of the suggested-skills panel.

## The home view

Home shows the learner's course in one of two views: the skill tree or the task list. The browser and the server name them `tree` and `tasks`. The two views are fixed in the server's code, so they do not change while the server runs. A learner who has chosen no view sees the skill tree.

```computations
homeViewOffered(view: String) : Flag
  Holds when view is exactly `tree` or `tasks`, including case.

offeredHomeView(view: String) : HomeView
  Names an offered home view. Flows use it only after homeViewOffered holds.

defaultHomeView() : HomeView
  Produces `tree`, the skill tree.
```

[AppliedHomeView](view:Settings.AppliedHomeView) relates a learner to the view that applies to them. Exactly one case holds for each learner:

- `ViewPreferring._choice` returns a view, and [homeViewOffered](computation:homeViewOffered) holds for it. The saved view applies.
- `ViewPreferring._choice` returns a view that is no longer offered. The view from [defaultHomeView](computation:defaultHomeView) applies. Preferring leaves it to the application to check a remembered option again before using it, so a view that a later version of the code removes never reaches the browser.
- `ViewPreferring._choice` returns no row. The view from defaultHomeView applies.

Both home view endpoints call `Sessioning.use` and use the returned user, like the tutor endpoints. No input names a learner, so one learner can neither read nor change another learner's view. A missing or ended session is refused with `NOT_SIGNED_IN`.

[ReadHomeView](reaction:Settings.ReadHomeView) takes only the session. It responds with `view`, the view from AppliedHomeView, and changes nothing.

[SetHomeView](reaction:Settings.SetHomeView) takes the session and `view`. The boundary first checks that `view` is a string of at most 100 characters and that no other field is sent, and refuses any other input as invalid before the flow starts. Then exactly one case applies:

- When homeViewOffered holds, [offeredHomeView](computation:offeredHomeView) names the view, `ViewPreferring.set` saves it, and the endpoint responds with `view`, the view it saved.
- When homeViewOffered does not hold, the endpoint refuses with `UNKNOWN_HOME_VIEW`: "Choose the skill tree or the task list."

A refusal saves nothing, so the learner's earlier view, or the lack of one, stays as it was. Saving is one write keyed by the learner, and the endpoint responds only after that write is saved. Saving the same view again changes nothing and succeeds, so a browser whose reply was lost can send it again. Across devices the later write wins. Choosing the skill tree saves it as the learner's own choice. No endpoint clears the view, because Home always shows one of the two views and choosing the skill tree has the same effect as having no choice.

Like choosing or clearing the tutor model, saving the home view does not take the learner's lock, so it never waits behind a running lesson; this is safe because no learning flow reads the view.

## Tests

The tests use a fake `fetch` and the controlled tutor responses described in the [runtime contract](../runtime.md). They cover:

- catalog validation: an unknown model, a level that the model does not list, exact matching including case, and the startup stop for an unlisted `GEMINI_MODEL`;
- the startup model-list check: a missing model is dropped, while a failed, slow, malformed, or incomplete list drops nothing, and the default is never dropped;
- a tutor request carries the chosen model in its address and the chosen level in `generationConfig.thinkingConfig.thinkingLevel`;
- the default model at its default level applies when nothing is chosen, and a RETIRED choice is declined at admission before any write;
- one learner's choosing and clearing leave another learner's choice unchanged;
- a refusal that names the chosen model produces the model sentence, a key-wide refusal keeps the setup sentence, and an unclear refusal keeps the current sentence;
- a dictation timeout and a dictation model problem keep their current sentences;
- a tutor request without a pair, and a suggestion request without a pair, are each refused without contacting Google;
- the home view: the skill tree when nothing is saved, a saved view read on a second browser, a refused view with its sentence over HTTP and through the runtime gateway, a repeated save, and another learner's isolation.

## Endpoints

The HTTP adapter adds `/api` to these paths.

```endpoints
Settings.ReadTutor at /settings/tutor
Settings.ChooseTutor at /settings/tutor/choose
Settings.ClearTutor at /settings/tutor/clear
Settings.ReadHomeView at /settings/view
Settings.SetHomeView at /settings/view/set
```
