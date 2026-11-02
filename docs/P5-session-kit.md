# P5 session kit

This page is the facilitator's working copy for the two user tests described on the [P5 page](P5.md): what the deployed app must hold before the first session, the script read to each participant, the note sheet, and the templates the study reports and the flaws list are written from. The task list itself is on the P5 page and is not repeated here.

## Before the first session

### The deployed app

- [ ] Main is pushed and deployed. The P5 page pins the deployed commit once the deploy is confirmed.
- [ ] https://stillgotit.mit-sdg.dev loads, and three things that only the P5 build has are visible: every sidebar conversation row has a "⋯" button with "Archive conversation", the Materials page offers "Delete material…", and reopening a conversation shows its messages at once.
- [ ] The laptop used for the sessions is signed in to the owner's account. Sign in again on the morning of each session, so a session that expired overnight does not interrupt task 1.
- [ ] The message box's model pill reads Gemini 4 Argon at Medium. In the P4 test the other models often failed the server's checks.
- [ ] In Settings, "Interactive examples" is off on the owner's account, so the participants see plain answers unless they turn it on themselves. Before the first session, turn it on once, ask one lesson question on the deployed app, and note whether the real model produced a valid example; then turn it off again. In the local pilot on November 2 the real model produced a valid example in three answers out of three.
- [ ] A tutor call works end to end on the deployed app: ask one question in an existing conversation and see the answer arrive with its citations.
- [ ] The task course does not exist yet. It is created empty right before each session (see "The task course" below), so both participants start from the same state.

### Realistic data

The participants use the owner's account, so the account must look like it has been used for a term. The P5 page sets the target; this list is the concrete version of it. Everything uploaded is sent to Google's Gemini service, so the files are the owner's own work and published readings, nothing private to anyone else.

| Course | Materials to bring in | Then |
| --- | --- | --- |
| 6.3930 (already on the account) | The final project proposal PDF and the lecture PDFs from the course site; one returned, graded problem set as "Graded work: …" if there is one. | At least eight confirmed skills in three topics. |
| 6.5940 | Two or three lecture-slide PDFs from the course site. | At least eight confirmed skills in three topics. |
| Music class (named as the catalog names it) | The Bob Marley reading from the New York Review of Books, the Rolling Stone piece on "Catch a Fire", and Denning's "Noise Uprising" chapter, all in Downloads. | At least eight confirmed skills in three topics. |

In each of the three courses, after the skills are confirmed:

- [ ] A starting confidence is set on about half of the skills, spread from "barely" to "sure".
- [ ] Three or more lessons exist, each with at least one follow-up question, so the sidebar's Conversations group has several days of history.
- [ ] Two practice attempts are assessed, one that went well and one that did not, so the evidence panel has both kinds to show.
- [ ] One manual adjustment has a reason written in full sentences.
- [ ] A daily budget and a dated exam are set, the plan is active, and one trade-off proposal has been decided, so the Plan page shows a schedule rather than an invitation.
- [ ] At least one topic grows a tree of another kind, so the grove is not uniform.
- [ ] One finished conversation is archived, so "Archived conversations" is not empty.

Across the account:

- [ ] One extra course is archived (an old course with one material is enough), so the course switcher shows what an archived course looks like.
- [ ] If a recorded lecture with its transcript is available, it is in one of the three courses; if not, the P5 page's "Realistic surroundings" paragraph is edited to say what the account actually holds.

### The task course

- [ ] A text-based PDF of lecture notes for the participant's subject is saved on the Desktop under a plain name such as "Linear Algebra week 7 notes.pdf". A public set, such as an MIT OpenCourseWare 18.06 lecture-notes PDF, avoids anything private. It must be a chapter-sized excerpt with selectable text, not a scanned book, and under 15 MB.
- [ ] The course is created empty, named for the subject, two minutes before the participant sits down.
- [ ] After the session the course is archived, so the second participant starts from the same empty state.

### The room

- [ ] Screen recording with the microphone on (on a Mac, Shift-Command-5, then "Record Entire Screen" with the microphone chosen under Options). A test recording of ten seconds plays back with sound.
- [ ] A timer the facilitator can see and the participant cannot.
- [ ] The note sheet below open in a second window or on paper, with the task list beside it.
- [ ] The charger is plugged in and notifications are off.

## The session script

Times are targets for an hour. Text in quotation marks is read aloud as written.

### Welcome and consent (3 minutes)

"Thank you for doing this. I am testing a study app I built for a class, and I want to see how it works for someone who has never seen it. I would like to record the screen and your voice while you use it, so I can go back over what happened. The recording stays with me and is not shared. You can stop at any time and you do not need a reason. Is that all right?"

Note the answer and the time. Then:

"You will be using my account, so nothing about you is stored in the app. The app sends the course material and the messages you type to Google's Gemini service to produce its answers, so please do not type anything private."

### The brief (2 minutes)

"I am going to give you seven short tasks, one at a time. I am testing the app, not you: if something is confusing, that is a problem with the app, and it is exactly what I need to find. Please think out loud the whole time: say what you are trying to do, what you expect to happen, and read out what you are looking at. I will mostly stay quiet. If I do not answer a question, it is because I want to see what you would do on your own."

A one-minute warm-up helps: "Before the first task, just look at this page and tell me what you think it is for."

### The tasks (about 40 minutes)

Read each instruction from the P5 page's task list, as written. Target times: task 1, 5 minutes; task 2, 7; task 3, 4; task 4, 8; task 5, 7; task 6, 6; task 7, 4.

Rules decided in advance:

- Help only after the participant has made no progress for two minutes, or asks for help a second time. Then give the smallest hint that lets them continue, such as "it is somewhere on this page", never an explanation of the interface. Write down every hint with the task and the time.
- Silence longer than about fifteen seconds gets "What are you thinking now?"
- A task is over when the participant says they are done, or when they have given up and the hint rule has been used twice. Do not correct a task they believe is done; note it.
- If task 6 has not started by minute 32, skip task 7, and if needed shorten task 4 to one question. Task 6 stays, because Budgeting is the concept most changed since P1.

What to watch for in each task, so the notes catch it:

1. Bring in a material: where they look first, whether the import's progress reads as progress, and how they tell the file is ready.
2. Grow skills from it: whether "suggest" is found, whether the deck's place marker is noticed, what they think "Confirm · add a leaf" will do, and whether they understand the result on the tree.
3. Say how well you know one: whether the confidence control is found from the skill, what they think the number that appears means, and whether the (i) bubbles are opened.
4. Learn with the tutor: whether the message box is obvious, whether citations are noticed and followed, and whether the source pane is trusted.
5. Prove it: whether the help declaration is understood, whether the verdict and its reason are read, and whether the change in the estimate is noticed without prompting.
6. Plan for a quiz: the order in which budget, exam and schedule are found, whether the proposal is read as a choice, and what they say the sea shows. The proposal appears only when the preparation does not fit before the exam: with the task course's two skills and a quiz tomorrow, a 15-minute budget is 5 minutes short and the Plan page asks for a decision, while 30 minutes, or a quiz next week, fits everything. If the participant chooses a longer time, let them, and note that the decision moment did not occur.
7. Come back later: whether the Memory view is found, what they say the curve means, and how long the tree picker takes to find.

### Debrief (20 minutes)

Open questions first, then every hesitation in the notes, newest first while it is fresh.

- "Overall, what is this app for, in your own words?"
- "What worked well? What would you change first?"
- For each noted hesitation: "At this point you paused. What were you trying to do? What did you expect to happen? What did the app do instead? How did you work it out?"
- "When the tutor cited your notes, did you trust it? Did you check?"
- "What did the percentage on a skill mean to you? What did the curve mean?"
- "When the plan said something would not fit, what did you think your options were?"
- "Was there anything you did not understand the words for?" (This finds linguistic-level flaws.)
- "Would you use this for a class you are taking now? Why or why not?"

### After the session

- [ ] Stop the recording and save it with the participant's code (P1 or P2), never their name.
- [ ] Archive the task course.
- [ ] Within a day, turn the notes into the study report while the reasons are still clear.

## The note sheet

One line per moment. A moment is anything the participant did, said, or showed, including hesitations, backtracking, sighs and smiles. Mark hints given with an H.

| Time | Task | What the participant did or said | What the app showed | Mark |
| --- | --- | --- | --- | --- |
| 0:00 | 1 | | | |

## Template for a study report (200 to 300 words)

Written once per participant, in the P5 page's "Study reports" section. The directions ask for key moments and why they happened, balanced between what worked and what did not.

1. One sentence on who the participant is in general terms (year, field, whether they use study apps) and the setup (owner's account, the task course, the time taken).
2. Three or four key moments. For each: what happened, what the participant said they expected, what the app did instead, and which gulf it broke on (execution, when they could not see how to act; evaluation, when they could not tell what had happened). Name the task.
3. What went well, with the same precision: a task done without hesitation is a result too.
4. One sentence on what the debrief added that the observation alone did not show.

## Template for the flaws and opportunities

Three to five rows in the P5 page's "Flaws and opportunities" section.

| # | Flaw or opportunity | Why it happens | How a later design could address it | Level | Severity |
| --- | --- | --- | --- | --- | --- |

Levels: physical (the control is hard to see, reach or operate), linguistic (the words or symbols are not understood), conceptual (the participant's model of what the app does differs from the design's).

Severity: minor (friction the participant recovers from on their own), moderate (a wrong turn that costs time but is recovered without help), major (recovered only with a hint), critical (no progress without the facilitator's intervention).

## Seeding a course from the page

Making the realistic data above by hand takes hours for each course. The script `scripts/seed-in-page.js` does the clicking for one course at a time. It asks the tutor for skills from the course's materials and confirms them, sets starting confidences, holds lessons with a follow-up question, answers and submits practice tasks, adjusts an estimate with a written reason, sets a budget and an exam and decides the plan's trade-off, gives a topic another kind of tree, and archives a finished conversation. It sends the same requests the interface sends, so the real tutor writes every suggestion, explanation, task and judgment, and the app's own rules apply. It must run inside a page of the app where the owner is signed in, because only the page itself can use the sign-in cookie.

1. **Bring in the files first.** Create the course and upload its materials on the Materials page as usual, and wait until each one is ready. The script uploads nothing and creates no course.
2. **Load the script.** On https://stillgotit.mit-sdg.dev, signed in, open the browser's console (in Chrome on a Mac, Option-Command-J), paste the whole of `scripts/seed-in-page.js`, and press Return. This only defines `stillgotitSeed`; nothing is sent yet. A browser tool that runs JavaScript in the page works the same way.
3. **Find the ids.** Run `await stillgotitSeed.courses()`. It lists each course with its id, its topics, and its materials with their ids. The same ids also appear in the answers to `/api/courses/scores` and `/api/courses/read` in the browser's Network tab.
4. **Start the run** with a manifest for the course:

   ```js
   stillgotitSeed({
     course: "<course id>", materials: ["<material id>", "<material id>", "<material id>"],
     skills: 12, topics: ["Vectors", "Matrices", "Eigenvalues"], confidence: 0.5,
     lessons: 4, practice: 2, adjustments: 1,
     budgetMinutes: 20, examInDays: 4, examTitle: "Quiz 3",
     treeKind: "cherry", archive: 1,
   }).then((summary) => console.log(summary));
   ```

   - `skills` is the number of confirmed skills the course should have, counting those it already has. The tutor is asked about each listed material in turn, and its suggestions are kept as written. A suggestion with the same title as a skill already in the course is left out. To ask about a material a second time, list it twice.
   - `topics` are the units the new skills are spread over, each new skill going to the topic with the fewest. Missing topics are created. Without `topics`, each skill goes to the topic the tutor named.
   - `confidence` is the share of confirmed skills that get a starting confidence, spread from 20% to 95%. Practice and adjustments need a starting confidence, so keep it above zero when you ask for them.
   - `lessons` are opened with a request such as "Explain this with a worked example.", and each gets one follow-up question once the opening has arrived. About half of them are finished afterwards.
   - `practice` tasks are answered with a short attempt that quotes the task's question, declared as done without outside help, and submitted for assessment. Every second attempt is a weak one, so the evidence shows both kinds of result.
   - `adjustments` set an estimate by hand, alternately up and down, each with a reason in full sentences.
   - `budgetMinutes` and `examInDays` set the daily budget and an exam that many days from today, covering every confirmed skill, and then ask for a plan. When the plan waits for a trade-off decision, the script declines it once, asks for a new plan, and confirms that one, so the Plan page shows an active plan and a decision has been made. A trade-off is offered only when the exam's preparation does not fit: each covered skill needs one ten-minute activity before the exam, so it appears when the number of skills times 10 is more than the budget, rounded down to tens, times the days to the exam. Twelve skills with 20 minutes a day and an exam in 4 days (120 against 80 minutes) produce one, while 25 minutes a day and an exam in 7 days (120 against 140) do not. The app has no exam titles, so `examTitle` becomes the course's focus note, "Getting ready for Quiz 3.", which the Plan's study-time settings show.
   - `treeKind` is the tree the first topic grows: oak, pine, birch, willow, maple, cherry, palm, cypress, baobab, spruce, jacaranda, or bonsai.
   - `archive` is the number of finished conversations to archive, oldest first.

   A count that is left out or 0 skips its step, and so does a manifest without `budgetMinutes` or `treeKind`. A manifest with a mistake, such as a misspelled field or tree kind, is refused before anything is sent.
5. **Watch the log.** Each step writes lines to the console as it goes. With the real tutor each answer takes 10 to 60 seconds, so the example above, which makes about fifteen tutor requests, takes roughly ten to fifteen minutes. Keep the tab open, and do not reload it or sign out until the run is done. A page runs one seeding at a time: a second run, or pasting the script again, is refused while one is going. `stillgotitSeed.progress` holds the current step, every line so far, and the summary once the run ends. This helps when a browser tool cannot wait that long for one call: start the run without waiting for it, and read `stillgotitSeed.progress` from time to time.
6. **Read the summary.** The run resolves to an object with the course's counts after the run (`skills`, `confidence`, `lessons`, `practice`, `adjustments`, `archived`, and the first topic's `treeKind`), the `plan` (budget, exam dates, whether it is active, and what happened to the trade-off), `skipped` for the steps the course already met, `failures` for each request the app refused or did not answer, with the endpoint, the code and the server's own sentence, and `notes` for anything that fell short, such as suggestions running out. A refusal never stops the run; only a finished sign-in does. Reload the page afterwards to see the new activity.

The same manifest can be run again. A step whose count the course already meets is skipped, so a run that stopped partway, for example because the sign-in expired, continues where it left off. When the tutor fails once, the script asks again once, as the page's own retry buttons do, and requests that are safe to repeat, such as saving a draft with its proposal key, are sent again when their answer is lost. Every tutor request uses the Gemini quota, and the tutor's work is real: read a few of the lessons and judgments before a session, as a participant might open them.
