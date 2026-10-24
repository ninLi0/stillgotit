# Importing graded work

A learner turns returned, graded coursework into assessment evidence. The file arrives through the ordinary material upload. The tutor reads each question's mark and feedback and proposes a skill and a result. The learner reviews and edits the rows, then confirms. Each confirmed row becomes one imported assessment case. The existing [ImportedEvidence](reaction:Progress.ImportedEvidence) reaction then applies its judgment to the skill's mastery as of the performance date.

The [application stage](../stages/materials.md) binds the concept instances. Each endpoint here first calls `Sessioning.use` and uses the returned user as the owner. A session that cannot be used answers `NOT_SIGNED_IN`. No request field selects the owner. The host runs Extract and Confirm under the learner's lock, like other learning commands. The HTTP adapter adds `/api` to the paths in this document.

Before dispatching Extract or Confirm, [request admission](LearningAccess.md) evaluates [GradedReady](former:Access.GradedReady). It declines only when GradedMaterial, below, does not hold. It then declines with the admission layer's usual code and the same sentence as the endpoints, "Choose graded work that you imported into one of your courses."; admission entries carry a sentence, not a code of their own. ReadImports has no admission step and makes the same check itself.

## Graded uploads

A graded upload is an ordinary course material. Graded work may be a PDF, with or without a text layer, or photos of the pages. The import screen sends it through `/api/courses/materials/add` with origin `COURSE`, and [AddMaterial](reaction:Courses.AddMaterial) saves it. Retention, viewing through [ReadMaterial](reaction:Courses.ReadMaterial), and file access are unchanged.

Graded work goes through the same import path as any other upload, so the importer reads every kind of returned paper ([materials](Materials.md), "Graded work"): a scanned or partly scanned PDF, whose pages without text become page locations that the tutor reads from the original, a photographed page, or a HEIC or HEIF photo. The import screen accepts a PDF or photos of the pages (PNG, JPEG, WebP, HEIC, or HEIF). When the importer still finds nothing to read, the learner sees its own sentence, "No readable content was found in these files. Check that they aren't empty, or export documents that contain pictures to PDF and import the PDF.", and the import screen adds "Upload photos of the pages instead." beneath it. Before uploading anything, the import screen also checks each file against the tutor's inline limit (15 MB today), because extraction sends every original PDF and photo inline in full. A larger PDF or photo is refused on the screen with the matching sentence from the [learning flows](Learning.md), so it never becomes a graded material that the tutor cannot read. The screen also keeps a graded upload to 12 files and 25 MB in total, below the 95 MB that other uploads allow; if the provider still refuses a whole request as too large, the learner sees that recorded provider reason.

The import screen requires a name for the work that is not blank after trimming. It sets the title to `Graded work: ` followed by the trimmed name, such as `Graded work: Midterm 1`. [gradedTitle](computation:gradedTitle) recognizes that exact prefix. The title carries the graded mark so that GroundedTutoring's material record needs no new field for it. Material records never change, so a graded upload stays graded. The library lists the title, so the learner can see which materials are graded work. For a graded material, the library offers "Review graded work" instead of skill suggestions. It reopens the import screen for that material, so the learner never needs to upload the same file again.

Each upload is a separate material. If the learner uploads the same paper twice, its questions can be imported once from each upload, and the skill counts that evidence twice. The import screen says so plainly: "Each upload is separate. Uploading the same paper again lets its questions be imported again."

[GradedMaterial](view:Importing.GradedMaterial) reads `GroundedTutoring._material`. It holds when the material exists, belongs to the owner, lies in a course the owner owns ([OwnedCourse](view:Courses.OwnedCourse)), and has a graded title. It answers that course and the material's retained originals. Every endpoint here requires it before any other read. An unknown material, another learner's material, a material outside the owner's courses, and the owner's own ungraded material all answer `GRADED_MATERIAL_UNAVAILABLE` with one sentence: "Choose graded work that you imported into one of your courses." A caller therefore cannot tell whether another learner's material exists.

Graded work is evidence, not teaching material. It never becomes a skill source, so lessons, practice tasks, hints, and assessments never send it to the tutor as a source. The course setup view does not offer it for skill suggestions or as a draft's source. [Suggest](reaction:Learning.Suggest), [ProposeSkill](reaction:Courses.ProposeSkill), and [EditDraft](reaction:Courses.EditDraft) first confirm that the material is the learner's own in the chosen course. Any other material keeps its existing ownership refusal, whatever its title. Only then do they answer `GRADED_MATERIAL_NOT_SOURCE` for a graded title, before any provider call or skill change: graded work is evidence, not a teaching source.

## Extracting marked questions

[Extract](reaction:Importing.Extract) takes `material`. After GradedMaterial answers the course, it reads the course map with `SkillMapping._map`. When [hasConfirmedSkill](computation:hasConfirmedSkill) does not hold, it answers `GRADED_SKILLS_UNAVAILABLE` without contacting the tutor: confirm at least one skill in this course before importing graded work. Otherwise it reads the owner's sources in the course with `GroundedTutoring._sourceSet` and selects the material with [singleMaterial](computation:singleMaterial) and [selectSources](computation:selectSources). [extractRequest](computation:extractRequest) prepares an `EXTRACT` request, and `TutorGenerating.generate` sends it. The [learning flows](Learning.md) define that request kind, its answer, the host's validation, and the 50-question limit.

A provider failure or an invalid answer follows the same path as the other AI endpoints. Generating refuses `GENERATION_FAILED`, and the learner sees the host's recorded reason, such as a busy service, a used-up quota, a safety block, or a timeout. A PDF or photo too large to send in full is refused the same way before the tutor is contacted, with its own sentence telling the learner to upload photos.

After the tutor answers, the endpoint checks the session again. [generationFields](computation:generationFields) exposes the validated rows. When [hasGradedRows](computation:hasGradedRows) does not hold, the endpoint answers `GRADED_MARKS_MISSING`: no question marks were found, and a total score alone cannot update individual skills. Otherwise it answers `rows` in the order the questions appear in the work. Each row has the question `label`, the `mark` and `feedback` as the grader wrote them, a short `excerpt` of the learner's answer, the proposed `skill` identity or an empty string for none, the proposed `result`, and a one-sentence `rationale`.

Extraction saves nothing on the server. A repeated request asks the tutor again, and its labels and proposals may differ. A failed request leaves no state to repair.

## Reviewing the rows

The import screen opens after an upload or from "Review graded work". It keeps its rows in the browser's session storage under the material identity, following the draft queue in [course flows](Courses.md). It saves the rows as soon as Extract answers, then saves the learner's edits, date, and help declaration with them. While an entry exists, opening the material shows the kept rows instead of extracting again. The learner can ask to read the work again; the new answer replaces the kept rows. With no kept rows, the screen calls Extract. Confirming sends only the checked rows that are mapped to a skill, one at a time, as the confirming section describes, and the screen marks each acknowledged row as imported in the kept rows. When no checked row is mapped to a skill, the screen sends nothing and shows "Check at least one question and map it to a skill." When no such row remains after the sequence, it removes the entry. A failed or lost reply keeps the entry, including after a page reload or server restart, and a retry sends the same kept row with its original label, so its source key is the same. Closing the tab loses session storage; the learner then reopens the material and extracts again.

The screen reads the course's skills through [ReadCourse](reaction:Courses.ReadCourse), the file through ReadMaterial, and earlier imports and the server's date through [ReadImports](reaction:Importing.ReadImports). It lists the earlier imports from this material. The skill choices are the course's confirmed skills and none. For each row, the learner can choose another skill, change the result, or uncheck the row. Unchecked rows and rows mapped to no skill are skipped. Marks and feedback appear as the grader gave them and cannot be edited.

The screen compares each row with the earlier imports by trimmed label and skill, as the source key does:

- A row whose trimmed label and skill match an earlier import appears as imported, starts unchecked, and cannot be checked. Confirm would refuse it.
- A row whose skill already has an import from this material under a different label shows a warning and starts unchecked: "This skill already has an import from this work, from <earlier label>. Check this row only if it is a different question." The learner may still check and confirm it.

The learner enters the performance date. It is required and cannot be after today. The screen uses the server's date from ReadImports as today, so it allows the same dates that Confirm accepts. The learner also declares whether the work was done without help. The default is no help, as in an exam. When the learner declares help, the screen changes each Independent row to Supported and stops offering Independent.

The concept starts an estimate's history at the earlier of its starting date and its oldest informative evidence. The screen therefore warns when a checked row's result is not Uncertain and the performance date is earlier than the start of the mapped skill's current estimate: "Your estimate for this skill started on <start date>. Importing work from <performance date> makes its history start from that earlier date." To know the start, the screen reads each mapped skill through [Read](reaction:Learning.Read). The matching track in [SkillData](former:Reads.SkillData) carries its start. A skill without an estimate shows no warning.

## Confirming the import

[Confirm](reaction:Importing.Confirm) imports one question. It takes `material`, `performedOn` (a calendar date written `YYYY-MM-DD`), `outsideHelp` (true when the learner had help), and `row`. The row carries the extracted `label`, `mark`, `feedback`, `excerpt`, and `rationale` unchanged, the tutor's `proposedResult`, and the learner's `skill` and `result`. The server does not keep the extraction, so these values are the learner's claim. They can affect only the learner's own records. As for other endpoints, the boundary refuses a body that lacks one of the four fields, gives `outsideHelp` as anything but true or false, or gives `row` as anything but a record. The endpoint checks the content of the row.

One request imports one question because an endpoint here can start an action once for a value it computed, not once for each element of a computed list. The screen sends only the checked rows that are mapped to a skill, one at a time, in row order, with the same date and help declaration, and waits for each answer before sending the next. When no checked row is mapped to a skill, it sends nothing and shows "Check at least one question and map it to a skill." Once a row of the sequence has been imported, the screen locks the date and the help declaration until the sequence is complete, so every question from one paper carries the same values. A single row also keeps each request well within the host's request size limit.

The endpoint binds one instant for the flow. It reads GradedMaterial and the course map with `SkillMapping._map`. [gradedReview](computation:gradedReview) checks the date and the row. [AlreadyImported](view:Importing.AlreadyImported) checks the owner's earlier imports. It holds when the owner's cases for the row's skill (`AssessmentReviewing._cases`) include one whose saved source key (`AssessmentReviewing._case`) is the key that [gradedKey](computation:gradedKey) produces for the row. Every check finishes before the import. The first failing check, in this order, answers, and nothing is imported:

1. `GRADED_MATERIAL_UNAVAILABLE`: the material is not the owner's graded work, as above.
2. `GRADED_DATE_INVALID`: `performedOn` is blank or is not a real calendar date. Enter the date the work was performed.
3. `GRADED_DATE_FUTURE`: the date is after today's date in America/New_York. The performance date cannot be after today.
4. `GRADED_ROW_INVALID`: the row lacks one of its eight fields, a field is not a string, `proposedResult` is not one of the five results, or the row breaks the extraction's rules for label, mark, feedback, excerpt, result, or rationale. Review the extracted rows again.
5. `GRADED_ROW_UNMAPPED`: `skill` is empty. Map the question to a skill.
6. `GRADED_HELP_CONFLICT`: help is declared and `result` is `INDEPENDENT`. With help, the strongest result is “Success with help”.
7. `GRADED_SKILL_UNAVAILABLE`: the skill is not a confirmed skill in the material's course. Map the question to a confirmed skill in this course.
8. `GRADED_SOURCE_USED`: this question and skill were already imported from this material. This is the concept's own refusal for a used source key, so a repeated confirm is refused rather than duplicated. AlreadyImported answers it before the action; if two confirms of the same row race, the concept's unique author, skill, and source key rule answers it.

When every check passes, [gradedImport](computation:gradedImport) builds the import, and the endpoint calls `AssessmentReviewing.importGraded` once, with these values:

- `author` is the owner, `subject` is the row's skill, and `definition` is that skill's current requirements version.
- `sourceKey` identifies the material, the trimmed label, and the skill, as gradedKey defines. The concept refuses a second case with the same author, skill, and key.
- `question` is the trimmed label. `criteria` is the version's outcome and demonstration gate.
- `response` holds the excerpt as text, the graded material's retained originals as attachments, and the material as its source reference.
- `help` is `NONE` without declared help and `HINT` with it. `fresh` is true, because the problems were new. `gateMet` is false, because an import cannot show the complete demonstration gate.
- `performedAt` is the start of the performance date in America/New_York. It is never later than the flow's instant.
- `mark` and `feedback` are the grader's, unchanged. `result` is the learner's confirmed result.
- `rationale` names the result in words (Independent, Supported, Slip, Gap, or Uncertain). When `result` equals `proposedResult`, it is "You kept the tutor's proposed result, <result>, when importing graded work. Tutor's reason: <rationale>". When they differ, it is "You changed the tutor's proposed result from <proposedResult> to <result> when importing graded work. Tutor's reason for <proposedResult>: <rationale>".

The endpoint answers with the new `case` after the import has completed and its causal progress work has settled. By then, ImportedEvidence has applied the judgment to the skill's matching mastery track, and any plan refresh that evidence triggers has run. A skill without a starting estimate keeps its new case. [InitializedEvidence](reaction:Progress.InitializedEvidence) applies that case when the learner sets confidence. Skills without imported evidence keep their estimates. After each answer, the screen marks the row as imported in its kept rows and sends the next checked row that is mapped to a skill. After the last one, it removes its kept rows and rereads ReadImports.

Each `importGraded` saves its case and judgment together in one write, so a question is imported whole or not at all, and questions already imported stay imported when a later one is refused. A refusal other than `GRADED_SOURCE_USED` stops the sequence: the screen shows the refusal's sentence beside that row and keeps it and the later rows checked, so the learner can fix the row and confirm again. If the process stops after an import, or a reply is lost, that case stays saved and the learner does not see success for it. The next skill read repairs any missing mastery contribution through [RepairReadEvidence](reaction:Progress.RepairReadEvidence). The screen still holds the row. `GRADED_SOURCE_USED` never stops the sequence, whether it answers a retry of a saved row or a row that another tab already imported: the screen rereads ReadImports, marks that row as imported, unchecks it, and continues with the next checked row. The host runs Confirm under the learner's lock, so two confirms from two tabs run one after the other, and the second import of the same question is refused rather than duplicated.

## Reading imported rows

[ReadImports](reaction:Importing.ReadImports) takes `material`. When GradedMaterial holds, it binds one instant and answers `imported` from [ImportedRows](former:Importing.ImportedRows) and `today`, the server's date from [gradedToday](computation:gradedToday). Otherwise it answers `GRADED_MATERIAL_UNAVAILABLE`.

ImportedRows reads each skill in the material's course (`SkillMapping._units` and `SkillMapping._skills`) and the owner's imported cases for that skill (`AssessmentReviewing._cases`). It keeps the cases whose source key (`AssessmentReviewing._case`) came from this material, as [gradedSource](computation:gradedSource) decides. It reads each kept case's label, mark, and feedback with `AssessmentReviewing._work` and its result with `AssessmentReviewing._effectiveJudgment`. Each row has the case, skill, question label, original mark and feedback, performance date, and current effective result. Rows are ordered by case identity. There are no rows when nothing from this material was imported. Only the owner's cases are read, so another learner's imports are never visible.

Imported cases also remain in SkillData, with no task and with their original mark and feedback, so the skill page can tell them apart. This flow does not change that read. [Correct](reaction:Learning.Correct) accepts an imported case and keeps its gateMet false, and [Regrade](reaction:Learning.Regrade) refuses one, as the learning flows describe.

## Endpoints

```endpoints
Importing.Extract at /courses/graded/extract
Importing.Confirm at /courses/graded/confirm
Importing.ReadImports at /courses/graded/read
```

## Computations

These functions are pure calculations over request values and query results. They do not read databases, change state, call providers, or start actions.

- **GradedRow**: The row sent to Confirm, with the extracted label, mark, feedback, excerpt, and rationale, the tutor's proposed result, and the learner's skill and result.
- **GradedReview**: The first failing date or row check, or `READY` with the performance instant.
- **GradedKey**: The skill and source key of the row.
- **GradedImport**: The `importGraded` input built from the row.

```computations
gradedTitle(title: String) : Flag
  True when the title starts with exactly "Graded work: " and continues with at least one character that is not whitespace.

hasConfirmedSkill(skills: SkillMapping.SkillMapRows) : Flag
  True when the course map has at least one confirmed skill.

extractRequest(selected: GroundedTutoring.SourceRecords, skills: SkillMapping.SkillMapRows) : TutorRequest
  Prepares an EXTRACT request. Its only source is the selected graded material, it carries no separate learner work, and its context lists each confirmed skill's identity, title, current outcome, and gate in skill identity order. It does not call a provider.

hasGradedRows(answer: TutorAnswer) : Flag
  True when the validated EXTRACT answer has at least one row.

gradedToday(at: DateTime) : String
  The America/New_York calendar date of the instant, written YYYY-MM-DD.

gradedReview(row: GradedRow, outsideHelp: Flag, performedOn: String, at: DateTime, skills: SkillMapping.SkillMapRows) : GradedReview
  Applies the confirm checks for the date and the row in their stated order and answers the first failure: DATE_INVALID, DATE_FUTURE, ROW_INVALID, UNMAPPED, HELP_CONFLICT, or SKILL_UNAVAILABLE. Otherwise it answers READY with the start of the performance date in America/New_York. Today follows the gradedToday rule for the supplied instant.

gradedKey(material: GroundedTutoring.Material, row: GradedRow) : GradedKey
  Produces the skill and source key of the row. The key is the word graded followed by the JSON array of the material identity, the trimmed label, and the skill identity.

gradedImport(material: GroundedTutoring.Material, originals: GroundedTutoring.MediaList, row: GradedRow, outsideHelp: Flag, performedAt: DateTime, skills: SkillMapping.SkillMapRows) : GradedImport
  Produces the importGraded input for the row, with the values listed under Confirming the import, including the rationale wording. It uses the gradedKey source key and the current version, outcome, and gate from the course map.

gradedSource(sourceKey: String, material: GroundedTutoring.Material) : Flag
  True when gradedKey made the source key for this material.
```
