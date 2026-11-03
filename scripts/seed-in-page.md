# Seeding a course from the page

How the realistic data for the P5 sessions was made. The script is [`scripts/seed-in-page.js`](seed-in-page.js); the sessions themselves are described on the [P5 page](../docs/P5.md).

Making realistic data by hand takes hours for each course. The script `scripts/seed-in-page.js` does the clicking for one course at a time. It asks the tutor for skills from the course's materials and confirms them, sets starting confidences, holds lessons with a follow-up question, answers and submits practice tasks, adjusts an estimate with a written reason, sets a budget and an exam and decides the plan's trade-off, gives a topic another kind of tree, and archives a finished conversation. It sends the same requests the interface sends, so the real tutor writes every suggestion, explanation, task and judgment, and the app's own rules apply. It must run inside a page of the app where the owner is signed in, because only the page itself can use the sign-in cookie.

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
