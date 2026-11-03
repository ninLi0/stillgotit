# Changes since P4

What changed in StillGotIt between the P4 submission (`9255c1e`, October 26, 2026) and the P5 user tests on November 2, in order, with the commits. The first entries were finished on the night of P4 but kept out of that submission. The [P5 page](P5.md) describes the sessions and the [design document](design-document.md) the design.

| Change | Why | Commit |
| --- | --- | --- |
| Shorter words on the lesson page | The evidence sentences moved behind (i) buttons, and a sent message lost its "Sending…" line. | `965c64e`, merged in `49ffff3` |
| The sidebar is the one place to pick or start a conversation | The lesson page's tab strip duplicated the sidebar and grew with every lesson. | `2f0a4b0`, merged in `21eb8f5` |
| Gemini 4 Argon at Medium is the default tutor model | In the last manual test before P4, Flash's answers often failed the server's checks and Argon's did not. | `82f2c82`, merged in `d0d0bc1` |
| A plan refusal names the review that blocks it | The Plan page only knew about the course on screen, so the refusal pointed nowhere. | `115610c`, merged in `8c2a982` |
| A new lesson exists before the tutor answers | A learner who left the page, or whose tutor failed, lost the request. | `2635f37` and `89902f4`, merged in `cee72d4` |
| A starting confidence seeds at most a Good recall | A confidence of 90% seeded an Easy rating and a first review more than a week out. | `c45b994`, merged in `00c8191` |
| Reviewing suggested skills is a deck | The stacked form gave no sense of place among the suggestions. | `b2ab024`, merged in `0d54147` |
| A selected tree stays open, and its sign offers "Change tree" | The tree picker was hard to find in the owner's own test. | `661cc59`, merged in `8c63cd9` |
| The message box keeps an unsent message; a reopened conversation shows its messages at once | Unsent text was lost on reload or a course switch, and reopening waited on the tutor. | `a4f28e8` and `e2792e0`, merged in `93eb216` |
| Plain reads no longer wait for the tutor | Every read waited on the learner's lock, which a tutor request holds for as long as the tutor takes. | `bcfd07f`, merged in `f6522c7`; archived list in `3b058ca` |
| After a success, the Plan and the Memory view name the same review day | After an adjustment they counted from different events. | `f444071`, merged in `3a6c777` |
| Conversations can be archived, and older ones are reachable | The sidebar kept every conversation and dropped those past the 40 most recent. | `39f1bb3`, merged in `0b25d7a` |
| A learner can delete a material | There was no way to remove a file and its text from the library. | `1b0edaa`, merged in `568e94e` |
| A finished lesson can be continued | Finishing closed a lesson for good, so one more question meant a new conversation without its sources. | `4295075`, merged in `69b3307` |
| Importing the same graded paper twice no longer counts its marks twice | Each upload was a separate source. | `5db85ed`, merged in `0962c85` |
| A learner's own attached work is no longer a course material | Attachments to answers were listed and counted among the course's files. | `0b23bce`, merged in `6b9f978` |
| Lesson answers can include an interactive example, off by default | An experiment, switched on in Settings. | `fb92e6f`, merged in `3a8aba3` |
| A practice task that cites its notes by file name is no longer refused | In the pilot with the real model, every practice task on an uploaded file was refused. | `2e31a65`, merged in `c43d656` |
| A course can be filled with realistic activity from the signed-in page | The data a user test needs took hours by hand; see [the script's page](../scripts/seed-in-page.md). | `ccf8a17`, merged in `21fe7af` |
| The interface says each fact once | The evidence under a skill said the same thing up to three times within a few lines. | `02f93f6`, merged in `f905c77` |
| The sign-in page's sample grove fits its panel at every width | On phones and narrow columns the grove was cut off at both sides. | `797d650`, merged in `1e96bb2` |
| An exam can cover a whole course or a whole topic in one click | An exam on a whole course took one checkbox per skill. | `49f3412`, merged in `625a866` |
