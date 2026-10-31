# P5 session kit

This page is the facilitator's working copy for the two user tests described on the [P5 page](P5.md): what the deployed app must hold before the first session, the script read to each participant, the note sheet, and the templates the study reports and the flaws list are written from. The task list itself is on the P5 page and is not repeated here.

## Before the first session

### The deployed app

- [ ] Main is pushed and deployed. The P5 page pins the deployed commit once the deploy is confirmed.
- [ ] https://stillgotit.mit-sdg.dev loads, and three things that only the P5 build has are visible: every sidebar conversation row has a "⋯" button with "Archive conversation", the Materials page offers "Delete material…", and reopening a conversation shows its messages at once.
- [ ] The laptop used for the sessions is signed in to the owner's account. Sign in again on the morning of each session, so a session that expired overnight does not interrupt task 1.
- [ ] The message box's model pill reads Gemini 4 Argon at Medium. In the P4 test the other models often failed the server's checks.
- [ ] In Settings, "Interactive examples" is off on the owner's account, so the participants see plain answers unless they turn it on themselves. Before Sunday, turn it on once, ask one lesson question on the deployed app, and note whether the real model produced a valid example; then turn it off again.
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
6. Plan for a quiz: the order in which budget, exam and schedule are found, whether the proposal is read as a choice, and what they say the sea shows.
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
