// Fills one existing StillGotIt course with realistic activity, from a page of the app where the learner is signed in.
//
// Evaluate this whole file in that page, in the browser console or with a browser tool. It defines one function,
// window.stillgotitSeed(manifest), and nothing else. The function works only through the app's own HTTP API: it sends
// the requests the interface sends, with the same inputs, so every rule of the app applies and the real tutor writes
// every suggestion, lesson, practice question and judgment. It must run inside the page because the sign-in cookie is
// HttpOnly, and only a request from the page itself carries it.
//
// The steps run in this order, and a step whose count the course already meets is skipped, so the same manifest can be
// run again after an interruption: skills, starting confidence, lessons, practice, adjustments, the plan, a topic's tree
// kind, and archiving. A refusal never stops the run. It is recorded with the endpoint and the server's sentence, and the
// run moves on. Requests go one at a time, because the server serializes each learner's tutor requests anyway.
//
// docs/P5-session-kit.md, "Seeding a course from the page", explains how to use it. The manifest looks like this:
//
//   stillgotitSeed({ course: "<course id>", materials: ["<material id>", ...], skills: 12,
//     topics: ["Vectors", "Matrices", "Eigenvalues"], confidence: 0.5, lessons: 4, practice: 2, adjustments: 1,
//     budgetMinutes: 20, examInDays: 4, examTitle: "Quiz 3", treeKind: "cherry", archive: 1, log: (line) => console.log(line) })
//
// A count, `budgetMinutes` or `treeKind` that is left out skips its step. `stillgotitSeed.courses()` lists the signed-in learner's
// courses with their ids, topics and materials, and `stillgotitSeed.progress` shows how far the latest run has got.
(() => {
  "use strict";
  // Loading the script again while a run is going would start a second run beside it, so it is refused.
  if (window.stillgotitSeed && window.stillgotitSeed.progress && window.stillgotitSeed.progress.running) {
    throw new Error("A seeding run is still going in this page. Wait for it to finish before loading the script again; stillgotitSeed.progress shows how far it got.");
  }

  // The tree kinds the server offers (src/computations/tree-kinds.ts). The manifest is checked against them before the
  // run starts, so a misspelled kind is caught at once instead of after the tutor's work; the server checks again.
  const TREE_KINDS = ["oak", "pine", "birch", "willow", "maple", "cherry", "palm", "cypress", "baobab", "spruce", "jacaranda", "bonsai"];
  // What a learner might type to start a lesson, and the follow-up question asked once the opening has arrived.
  const LESSON_REQUESTS = [
    "Explain this with a worked example.",
    "Why does this matter for the exam?",
    "Walk me through the definition slowly.",
    "What mistakes do students usually make with this?",
  ];
  const FOLLOW_UPS = [
    "Can you show one more example with different numbers?",
    "How would I check my answer on a problem like this?",
    "What changes if one of the conditions is dropped?",
    "Which step is the easiest one to get wrong?",
  ];
  // Manual adjustments alternate between raising and lowering the estimate, each with a reason in full sentences.
  const ADJUSTMENTS = [
    { change: 15, reason: "I worked through the problem set questions on this on paper without any help, and I got them right. I think I know it better than the estimate shows." },
    { change: -15, reason: "I tried to explain this to a classmate yesterday and got stuck halfway through. The estimate should be lower until I practice it again." },
  ];
  const FIELDS = ["course", "materials", "skills", "topics", "confidence", "lessons", "practice", "adjustments", "budgetMinutes", "examInDays",
    "examTitle", "treeKind", "archive", "log"];

  /** Thrown when the sign-in has ended: every later request would be refused the same way, so the run stops. */
  class SignedOut extends Error {}

  /**
   * Sends one request to the app, as the interface does: a same-origin POST of JSON to /api, with the sign-in cookie.
   * Answers { ok: true, data } on success, and otherwise { ok: false, answered, error, detail }, where `answered` is false
   * when no answer from the app arrived (the network failed, or a proxy ended a slow request with its own page).
   */
  async function call(path, body) {
    let response;
    try {
      response = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, answered: false, error: "NETWORK_ERROR", detail: "The request did not reach the server, or its answer was lost." };
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, answered: false, error: `HTTP_${response.status}`,
        detail: `The server answered with status ${response.status} but not with the app's own answer, which usually means a proxy ended a slow request.` };
    }
    if (!response.ok || typeof data.error === "string") {
      return { ok: false, answered: true, error: typeof data.error === "string" ? data.error : `HTTP_${response.status}`, detail: typeof data.detail === "string" ? data.detail : "" };
    }
    return { ok: true, data };
  }

  /** A fresh key for a request that must be safe to send twice, like the browser's proposal and adjustment keys. */
  function newKey() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const sameTitle = (a, b) => String(a).replace(/\s+/g, " ").trim().toLowerCase() === String(b).replace(/\s+/g, " ").trim().toLowerCase();
  const seconds = (since) => `${Math.round((Date.now() - since) / 1000)} s`;

  /** Checks the manifest before anything is sent, and fills in what it leaves out. Throws one sentence per problem. */
  function checkManifest(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Call stillgotitSeed with a manifest object, such as { course: \"<course id>\", materials: [\"<material id>\"], skills: 12 }.");
    }
    const problems = [];
    for (const key of Object.keys(input)) if (!FIELDS.includes(key)) problems.push(`"${key}" is not a manifest field; the fields are ${FIELDS.join(", ")}.`);
    const count = (name) => {
      const value = input[name];
      if (value === undefined) return 0;
      if (!Number.isInteger(value) || value < 0) { problems.push(`${name} must be a whole number of 0 or more.`); return 0; }
      return value;
    };
    const texts = (name) => {
      const value = input[name];
      if (value === undefined) return [];
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) { problems.push(`${name} must be a list of nonblank strings.`); return []; }
      return value.map((item) => item.trim());
    };
    if (typeof input.course !== "string" || !input.course.trim()) problems.push("course must be the id of one of your courses.");
    const manifest = {
      course: typeof input.course === "string" ? input.course.trim() : "",
      materials: texts("materials"), topics: texts("topics"),
      skills: count("skills"), lessons: count("lessons"), practice: count("practice"), adjustments: count("adjustments"), archive: count("archive"),
      confidence: 0, budgetMinutes: null, examInDays: null, examTitle: "", treeKind: "", log: null,
    };
    if (new Set(manifest.topics.map((topic) => topic.toLowerCase())).size !== manifest.topics.length) problems.push("topics must not repeat a title.");
    if (input.confidence !== undefined) {
      if (typeof input.confidence !== "number" || !(input.confidence >= 0 && input.confidence <= 1)) problems.push("confidence must be a share from 0 to 1, such as 0.5.");
      else manifest.confidence = input.confidence;
    }
    if (input.budgetMinutes !== undefined) {
      if (!Number.isInteger(input.budgetMinutes) || input.budgetMinutes < 0 || input.budgetMinutes > 1440) problems.push("budgetMinutes must be a whole number of minutes from 0 to 1440.");
      else manifest.budgetMinutes = input.budgetMinutes;
    }
    if (input.examInDays !== undefined) {
      if (!Number.isInteger(input.examInDays) || input.examInDays < 0 || input.examInDays > 365) problems.push("examInDays must be a whole number of days from 0 to 365.");
      else manifest.examInDays = input.examInDays;
    }
    if (input.examInDays !== undefined && input.budgetMinutes === undefined) problems.push("examInDays needs budgetMinutes, because an exam can only be set once a course has a daily budget.");
    if (input.examTitle !== undefined) {
      if (typeof input.examTitle !== "string") problems.push("examTitle must be text.");
      else manifest.examTitle = input.examTitle.trim();
    }
    if (input.treeKind !== undefined) {
      if (!TREE_KINDS.includes(input.treeKind)) problems.push(`treeKind must be one of ${TREE_KINDS.join(", ")}.`);
      else manifest.treeKind = input.treeKind;
    }
    if (input.log !== undefined) {
      if (typeof input.log !== "function") problems.push("log must be a function that takes one line of text.");
      else manifest.log = input.log;
    }
    if (problems.length) throw new Error(`The manifest needs fixing before anything is sent. ${problems.join(" ")}`);
    return manifest;
  }

  /** The skills listed so that neighbours come from different topics: each topic's first skill, then each one's second, and so on. */
  function acrossTopics(skills, units) {
    const groups = units.map((unit) => skills.filter((skill) => skill.unit === unit.unit));
    const placed = new Set(groups.flat().map((skill) => skill.skill));
    groups.push(skills.filter((skill) => !placed.has(skill.skill)));
    const out = [];
    for (let index = 0; out.length < skills.length; index++) for (const group of groups) if (group[index]) out.push(group[index]);
    return out;
  }

  /** `count` items chosen evenly from `items`, keeping their order. */
  function evenly(items, count) {
    return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[Math.floor(index * items.length / Math.min(count, items.length))]);
  }

  /** `count` starting confidences from 20 to 95, ordered low, high, next lowest, next highest, so neighbours differ. */
  function confidences(count) {
    const values = Array.from({ length: count }, (_, index) => count === 1 ? 60 : Math.round(20 + 75 * index / (count - 1)));
    const out = [];
    while (values.length) { out.push(values.shift()); if (values.length) out.push(values.pop()); }
    return out;
  }

  /**
   * A phrase from a practice question to quote in the attempt: its first sentence, with formulas and list numbers left
   * out (a formula becomes "…"), cut after ten words when the sentence is longer than fourteen.
   */
  function phraseFrom(question) {
    const plain = String(question).replace(/\$\$[\s\S]*?\$\$/g, " … ").replace(/\$[^$\n]*\$/g, " … ").replace(/[*_`#>]/g, " ")
      .replace(/\s+/g, " ").replace(/…(\s*…)+/g, "…").trim().replace(/^\d+[.)]\s*/, "");
    const sentence = plain.split(/(?<=[.?!])\s/)[0] || plain;
    const words = sentence.split(" ").filter(Boolean), kept = words.length > 14 ? words.slice(0, 10) : words.slice();
    const open = (text) => (text.match(/[([{]/g) || []).length > (text.match(/[)\]}]/g) || []).length;
    // A cut phrase ends on a word, with every bracket it opens closed.
    while (kept.length < words.length && kept.length && (!/[\p{L}\p{N}]/u.test(kept[kept.length - 1]) || open(kept.join(" ")))) kept.pop();
    const phrase = kept.join(" ").replace(/[.,;:?!]+$/, "");
    return phrase ? (kept.length < words.length ? `${phrase} …` : phrase) : "this question";
  }

  /** A short attempt at a practice question: a quoted phrase, then two sentences. A weak one admits it got stuck. */
  function attempt(question, weak) {
    const quote = `“${phraseFrom(question)}”`;
    return weak
      ? `${quote}: I think this uses the main definition from the notes, but I am not sure which step comes first. I tried to set it up and could not finish the working.`
      : `${quote}: I would start from the definition in the notes and apply it step by step to the case given, checking each step against the worked example. That gives the result the question asks for, and the same reasoning shows why it holds.`;
  }

  /** The New York calendar date `days` after `today`, both written YYYY-MM-DD, as the planner writes dates. */
  function addDays(today, days) {
    const [year, month, day] = today.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  }

  /** The work of one run: the manifest, the log, and what the summary reports. */
  function createRun(manifest, progress) {
    const run = {
      manifest, failures: [], skipped: [], notes: [], step: "start", tradeoff: "not run",
      log(line) {
        progress.lines.push(`${new Date().toLocaleTimeString()} ${line}`);
        try { (manifest.log || ((text) => console.log(`[seed] ${text}`)))(line); } catch { /* A failing log must not stop the run. */ }
      },
      /** Records a refusal or a lost answer with the endpoint and the server's sentence. A finished sign-in stops the run. */
      fail(path, result) {
        run.failures.push({ step: run.step, endpoint: `/api${path}`, error: result.error, detail: result.detail });
        run.log(`  Not done: ${path} answered ${result.error}${result.detail ? `. ${result.detail}` : "."}`);
        if (result.error === "UNAUTHORIZED") throw new SignedOut();
      },
      /** Sends one request and answers its data, or null after recording why it did not succeed. */
      async send(path, body) {
        const result = await call(path, body);
        if (result.ok) return result.data;
        run.fail(path, result);
        return null;
      },
      /**
       * Sends a request whose key or content makes a second copy harmless, such as a draft with its proposal key or an
       * adjustment with its adjustment key. When no answer arrives, it sends the same input once more, as the page does.
       */
      async sendKeyed(path, body) {
        let result = await call(path, body);
        if (!result.ok && !result.answered) { run.log(`  No answer from ${path}; sending the same request again.`); result = await call(path, body); }
        if (result.ok) return result.data;
        run.fail(path, result);
        return null;
      },
      /** The skill as the lesson page reads it, or null. */
      async readSkill(skill) {
        const read = await run.send("/learning/read", { skill });
        return read ? read.data : null;
      },
      /** The course, its confirmed skills listed across topics, and each confirmed skill's own read. */
      async snapshot() {
        const course = await run.send("/courses/read", { course: manifest.course });
        if (!course) return null;
        const confirmed = acrossTopics(course.skills.filter((skill) => skill.status === "CONFIRMED"), course.units);
        const skills = [];
        for (const row of confirmed) {
          const data = await run.readSkill(row.skill);
          if (data) skills.push({ ...row, data });
        }
        return { course, skills };
      },
    };
    return run;
  }

  const lessonsOf = (skill) => skill.data.sessions.filter((session) => session.lesson);
  const practiceOf = (skill) => skill.data.cases.filter((item) => item.task && item.judgment);
  const adjustmentsOf = (skill) => skill.data.explanation ? skill.data.explanation.changes.filter((change) => change.kind === "ADJUSTMENT").length : 0;
  const sessionIn = (data, id) => data ? data.sessions.find((session) => session.session === id) || null : null;

  // ---- Skills ----
  /**
   * Asks the tutor for suggestions from each listed material in turn, saves each suggestion as a draft with its own
   * proposal key, and confirms it, until the course has the number of confirmed skills asked for. The tutor's title,
   * outcome and requirements are kept as written. A suggestion whose title matches a skill already in the course is left
   * out, so the tree never shows the same leaf twice. New skills go to the manifest's topic with the fewest skills,
   * created if it is missing; without topics, each goes to the topic the tutor named.
   */
  async function seedSkills(run) {
    const { manifest } = run;
    if (!manifest.skills) { run.skipped.push("Skills: none asked for."); return; }
    const course = await run.send("/courses/read", { course: manifest.course });
    if (!course) return;
    let confirmed = course.skills.filter((skill) => skill.status === "CONFIRMED").length;
    if (confirmed >= manifest.skills) {
      run.skipped.push(`Skills: the course already has ${plural(confirmed, "confirmed skill", "confirmed skills")} (${manifest.skills} asked for).`);
      run.log(`Skills: ${confirmed} already confirmed, nothing to add.`);
      return;
    }
    run.log(`Skills: ${confirmed} confirmed, adding up to ${manifest.skills - confirmed}.`);
    const titles = course.skills.map((skill) => skill.title), units = course.units.slice();
    const sources = new Set(course.materials.map((material) => material.material));
    /** The unit with this title, added to the course when it is missing. */
    async function unitFor(title) {
      const found = units.find((unit) => sameTitle(unit.title, title));
      if (found) return found.unit;
      const added = await run.send("/courses/units/add", { course: manifest.course, title });
      if (!added) return null;
      units.push({ unit: added.unit, title });
      run.log(`  Added the topic “${title}”.`);
      return added.unit;
    }
    const topicUnits = [];
    for (const title of manifest.topics) {
      const unit = await unitFor(title);
      if (unit) topicUnits.push(unit);
    }
    const sizes = new Map(topicUnits.map((unit) => [unit, course.skills.filter((skill) => skill.unit === unit && skill.status === "CONFIRMED").length]));
    if (!manifest.materials.length) run.notes.push("Skills: the manifest lists no materials, so the tutor was not asked for suggestions.");
    for (const material of manifest.materials) {
      if (confirmed >= manifest.skills) break;
      if (!sources.has(material)) {
        run.notes.push(`Skills: ${material} is not one of this course's materials, so it was left out. Check the id with stillgotitSeed.courses().`);
        run.log(`  ${material} is not one of this course's materials; skipping it.`);
        continue;
      }
      const title = course.materials.find((item) => item.material === material).title;
      run.log(`  Asking the tutor for skills in “${title}”…`);
      const started = Date.now();
      // Suggest saves nothing, so a failed or lost answer is safe to ask again once. The page sees only a general code,
      // such as INVALID_REQUEST for a tutor failure, so any failure but a finished sign-in is asked again.
      let result = await call("/courses/skills/suggest", { material });
      if (!result.ok && result.error !== "UNAUTHORIZED") {
        run.log(`  The tutor did not answer (${result.detail || result.error}). Asking once more.`);
        result = await call("/courses/skills/suggest", { material });
      }
      if (!result.ok) { run.fail("/courses/skills/suggest", result); continue; }
      const { unitTitle, skills } = result.data.suggestions;
      run.log(`  The tutor suggested ${plural(skills.length, "skill", "skills")} (${seconds(started)}).`);
      for (const suggestion of skills) {
        if (confirmed >= manifest.skills) break;
        if (titles.some((title) => sameTitle(title, suggestion.title))) { run.log(`  “${suggestion.title}” is already in the course; leaving it out.`); continue; }
        let unit;
        if (topicUnits.length) {
          unit = topicUnits.reduce((best, next) => sizes.get(next) < sizes.get(best) ? next : best);
        } else {
          unit = await unitFor(unitTitle);
          if (!unit) continue;
        }
        const saved = await run.sendKeyed("/courses/skills/propose", { proposalKey: newKey(), unit, material,
          title: suggestion.title, outcome: suggestion.outcome, gate: suggestion.gate });
        if (!saved) continue;
        if (!await run.send("/courses/skills/confirm", { skill: saved.skill })) { titles.push(suggestion.title); continue; }
        titles.push(suggestion.title);
        if (sizes.has(unit)) sizes.set(unit, sizes.get(unit) + 1);
        confirmed++;
        run.log(`  Confirmed “${suggestion.title}” in “${units.find((row) => row.unit === unit).title}”.`);
      }
    }
    if (confirmed < manifest.skills) {
      run.notes.push(`Skills: the course has ${confirmed} of the ${manifest.skills} confirmed skills asked for, because the tutor's suggestions ran out. ` +
        "Add another material to the manifest, or list a material twice to ask the tutor about it again, and run it once more.");
    }
  }

  // ---- Starting confidence ----
  /** Sets a starting confidence from 20 to 95 on the share of confirmed skills asked for, as "Set starting point" does. */
  async function seedConfidence(run) {
    const { manifest } = run;
    if (!manifest.confidence) { run.skipped.push("Starting confidence: none asked for."); return; }
    const course = await run.send("/courses/read", { course: manifest.course });
    const progress = await run.send("/learning/progress", { course: manifest.course });
    if (!course || !progress) return;
    const confirmed = acrossTopics(course.skills.filter((skill) => skill.status === "CONFIRMED"), course.units);
    const tracked = new Set(progress.data.estimates.filter((row) => row.estimate).map((row) => row.skill));
    const target = Math.round(manifest.confidence * confirmed.length), have = confirmed.filter((skill) => tracked.has(skill.skill)).length;
    if (have >= target) {
      run.skipped.push(`Starting confidence: ${have} of ${confirmed.length} skills already have one (${target} asked for).`);
      run.log(`Starting confidence: ${have} skills already have one, nothing to add.`);
      return;
    }
    const chosen = evenly(confirmed.filter((skill) => !tracked.has(skill.skill)), target - have), values = confidences(chosen.length);
    run.log(`Starting confidence: setting it on ${plural(chosen.length, "skill", "skills")}.`);
    for (const [index, skill] of chosen.entries()) {
      if (await run.sendKeyed("/learning/confidence", { skill: skill.skill, confidence: values[index] })) run.log(`  “${skill.title}” starts at ${values[index]}%.`);
    }
  }

  // ---- Lessons ----
  /**
   * Runs lessons the way the lesson page does: /learning/lesson saves the lesson with the learner's request, then
   * /learning/reply waits for the tutor's opening, then one follow-up question waits for its answer. About half of the
   * lessons are finished afterwards, so the course has both open and finished conversations.
   */
  async function seedLessons(run) {
    const { manifest } = run;
    if (!manifest.lessons) { run.skipped.push("Lessons: none asked for."); return; }
    const state = await run.snapshot();
    if (!state) return;
    const have = state.skills.reduce((sum, skill) => sum + lessonsOf(skill).length, 0);
    if (have >= manifest.lessons) {
      run.skipped.push(`Lessons: the course already has ${plural(have, "lesson", "lessons")} (${manifest.lessons} asked for).`);
      run.log(`Lessons: ${have} already, nothing to add.`);
      return;
    }
    if (!state.skills.length) { run.notes.push("Lessons: the course has no confirmed skills to learn, so no lesson was started."); return; }
    // Skills with the fewest lessons go first, keeping the order across topics.
    const order = state.skills.slice().sort((a, b) => lessonsOf(a).length - lessonsOf(b).length);
    const count = manifest.lessons - have;
    run.log(`Lessons: running ${plural(count, "lesson", "lessons")}.`);
    for (let index = 0; index < count; index++) {
      const skill = order[index % order.length], number = have + index;
      await oneLesson(run, skill, LESSON_REQUESTS[number % LESSON_REQUESTS.length], FOLLOW_UPS[number % FOLLOW_UPS.length], index % 2 === 0);
    }
  }

  async function oneLesson(run, skill, request, followUp, finish) {
    run.log(`  “${skill.title}”: “${request}”`);
    const saved = await run.send("/learning/lesson", { skill: skill.skill, request });
    if (!saved) return;
    const lesson = saved.lesson;
    let started = Date.now();
    let opening = await call("/learning/reply", { studySession: lesson });
    if (!opening.ok && opening.error !== "UNAUTHORIZED") {
      // The lesson is saved either way. Like "Retry tutor reply", ask again only while it still waits for its opening.
      const now = sessionIn(await run.readSkill(skill.skill), lesson);
      if (now && now.lesson.explanation.trim()) opening = { ok: true };
      else if (now) { run.log(`  The opening did not arrive (${opening.detail || opening.error}). Asking once more.`); started = Date.now(); opening = await call("/learning/reply", { studySession: lesson }); }
    }
    if (!opening.ok) { run.fail("/learning/reply", opening); return; }
    run.log(`  The opening arrived (${seconds(started)}).`);
    const before = sessionIn(await run.readSkill(skill.skill), lesson);
    if (!before) return;
    started = Date.now();
    let answer = await call("/learning/question", { studySession: lesson, text: followUp, channel: "TEXT", attachments: [], dialogueLength: before.dialogue.length });
    if (!answer.ok && answer.error !== "UNAUTHORIZED") {
      // The question is saved before the tutor answers. When it is saved and still unanswered, ask for the answer again.
      const now = sessionIn(await run.readSkill(skill.skill), lesson), last = now && now.dialogue[now.dialogue.length - 1];
      if (last && last.turn.speaker === "TUTOR" && now.dialogue.length > before.dialogue.length + 1) answer = { ok: true };
      else if (last && last.turn.speaker === "LEARNER" && last.turn.text === followUp) {
        run.log(`  The answer did not arrive (${answer.detail || answer.error}). Asking once more.`);
        started = Date.now(); answer = await call("/learning/reply", { studySession: lesson });
        if (!answer.ok) { run.fail("/learning/reply", answer); return; }
      }
    }
    if (!answer.ok) { run.fail("/learning/question", answer); return; }
    run.log(`  “${followUp}” was answered (${seconds(started)}).`);
    if (finish && await run.send("/learning/finish", { studySession: lesson })) run.log("  Finished the lesson.");
  }

  // ---- Practice ----
  /**
   * Starts practice tasks and answers each with a short attempt written from its own question, declares no outside
   * help, submits it, and waits for the tutor's assessment. Every second attempt is a weak one, so the evidence has both
   * kinds of result. Practice needs a starting confidence, so only skills that have one are used.
   */
  async function seedPractice(run) {
    const { manifest } = run;
    if (!manifest.practice) { run.skipped.push("Practice: none asked for."); return; }
    const state = await run.snapshot();
    if (!state) return;
    const have = state.skills.reduce((sum, skill) => sum + practiceOf(skill).length, 0);
    if (have >= manifest.practice) {
      run.skipped.push(`Practice: the course already has ${plural(have, "assessed attempt", "assessed attempts")} (${manifest.practice} asked for).`);
      run.log(`Practice: ${have} assessed already, nothing to add.`);
      return;
    }
    const ready = state.skills.filter((skill) => skill.data.track).sort((a, b) => practiceOf(a).length - practiceOf(b).length);
    if (!ready.length) { run.notes.push("Practice: no confirmed skill has a starting confidence yet, and practice needs one, so no task was started. Raise confidence in the manifest."); return; }
    const count = manifest.practice - have;
    run.log(`Practice: running ${plural(count, "task", "tasks")}.`);
    for (let index = 0; index < count; index++) await onePractice(run, ready[index % ready.length], (have + index) % 2 === 1);
  }

  async function onePractice(run, skill, weak) {
    run.log(`  “${skill.title}”: asking the tutor for a practice task…`);
    const known = new Set(((await run.readSkill(skill.skill)) || skill.data).sessions.map((session) => session.session));
    let started = Date.now();
    let result = await call("/learning/task", { skill: skill.skill });
    if (!result.ok && result.error !== "UNAUTHORIZED") {
      // A task is saved only with the tutor's question. If the answer was lost, the task may exist already.
      const data = await run.readSkill(skill.skill);
      const found = data && data.sessions.find((session) => session.task && session.status === "OPEN" && !known.has(session.session));
      if (found) result = { ok: true, data: { task: found.session } };
      else {
        run.log(`  No task arrived (${result.detail || result.error}). Asking once more.`);
        started = Date.now(); result = await call("/learning/task", { skill: skill.skill });
      }
    }
    if (!result.ok) { run.fail("/learning/task", result); return; }
    const task = result.data.task;
    const opened = sessionIn(await run.readSkill(skill.skill), task);
    if (!opened) return;
    run.log(`  The task arrived (${seconds(started)}). Answering it with a ${weak ? "weak" : "plausible"} attempt.`);
    const text = attempt(opened.task.question, weak);
    const answered = await call("/learning/respond", { studySession: task, text, channel: "TEXT", attachments: [], dialogueLength: opened.dialogue.length });
    let current = sessionIn(await run.readSkill(skill.skill), task);
    if (!answered.ok && !(current && current.dialogue.some(({ turn }) => turn.speaker === "LEARNER" && turn.text === text))) { run.fail("/learning/respond", answered); return; }
    if (!current) return;
    started = Date.now();
    let graded = await call("/learning/assess", { studySession: task, dialogueLength: current.dialogue.length, reviewed: true, unseen: true, outsideHelp: false });
    if (!graded.ok && graded.error !== "UNAUTHORIZED") {
      // A submitted attempt is saved before it is graded. If it is saved without a judgment, grade it again, as the page does.
      const data = await run.readSkill(skill.skill), saved = data && data.cases.find((item) => item.task === task);
      if (saved && saved.judgment) graded = { ok: true };
      else if (saved) {
        run.log(`  The assessment did not arrive (${graded.detail || graded.error}). Asking once more.`);
        started = Date.now(); graded = await call("/learning/retry", { studySession: task });
        if (!graded.ok) { run.fail("/learning/retry", graded); return; }
      }
    }
    if (!graded.ok) { run.fail("/learning/assess", graded); return; }
    const judged = (await run.readSkill(skill.skill) || { cases: [] }).cases.find((item) => item.task === task);
    run.log(`  Assessed${judged && judged.judgment ? ` as ${judged.judgment.result}` : ""} (${seconds(started)}).`);
  }

  // ---- Adjustments ----
  /** Adjusts the estimate of skills that have one by hand, each with a reason in full sentences and its own key. */
  async function seedAdjustments(run) {
    const { manifest } = run;
    if (!manifest.adjustments) { run.skipped.push("Adjustments: none asked for."); return; }
    const state = await run.snapshot();
    if (!state) return;
    const have = state.skills.reduce((sum, skill) => sum + adjustmentsOf(skill), 0);
    if (have >= manifest.adjustments) {
      run.skipped.push(`Adjustments: the course already has ${plural(have, "adjustment", "adjustments")} (${manifest.adjustments} asked for).`);
      run.log(`Adjustments: ${have} already, nothing to add.`);
      return;
    }
    const ready = state.skills.filter((skill) => skill.data.estimate).sort((a, b) => adjustmentsOf(a) - adjustmentsOf(b));
    if (!ready.length) { run.notes.push("Adjustments: no confirmed skill has an estimate yet, and an adjustment needs one, so none was made. Raise confidence in the manifest."); return; }
    const count = manifest.adjustments - have;
    run.log(`Adjustments: making ${plural(count, "adjustment", "adjustments")}.`);
    for (let index = 0; index < count; index++) {
      const skill = ready[index % ready.length], data = await run.readSkill(skill.skill) || skill.data;
      const current = data.estimate ? data.estimate.value : 50;
      // Raise and lower in turn, but lower an estimate that is already high and raise one that is already low, so the
      // adjustment always shows as a change.
      let { change, reason } = ADJUSTMENTS[(have + index) % ADJUSTMENTS.length];
      if (current + change > 95 || current + change < 10) ({ change, reason } = ADJUSTMENTS.find((item) => Math.sign(item.change) !== Math.sign(change)));
      const value = Math.round(current + change);
      if (await run.sendKeyed("/learning/adjust", { skill: skill.skill, adjustmentKey: newKey(), value, reason })) run.log(`  “${skill.title}” moved from ${Math.round(current)}% to ${value}%: ${reason}`);
    }
  }

  // ---- Plan ----
  /**
   * Saves the daily budget, sets an exam `examInDays` from today that covers every confirmed skill, and asks for a plan.
   * When the plan waits for a trade-off decision, the run declines it once, asks again, and confirms the next proposal,
   * so a decision is recorded and the plan is active. A trade-off appears only when the exam's preparation does not fit
   * the budget before it.
   */
  async function seedPlan(run) {
    const { manifest } = run;
    if (manifest.budgetMinutes === null) { run.skipped.push("Plan: no budgetMinutes in the manifest."); run.tradeoff = "not asked for"; return; }
    const course = await run.send("/courses/read", { course: manifest.course });
    let plan = await run.send("/planning/read", { course: manifest.course });
    if (!course || !plan) return;
    if (plan.data.preferences && plan.exams.length && plan.data.plan && !plan.proposal.length) {
      run.skipped.push(`Plan: the course already has a budget of ${plan.data.preferences.dailyMinutes} minutes, an exam on ${plan.exams[0].date}, and an active plan.`);
      run.log("Plan: already active, nothing to change.");
      run.tradeoff = "not run, because a plan was already active";
      return;
    }
    const covered = course.skills.filter((skill) => skill.status === "CONFIRMED").map((skill) => skill.skill);
    run.log(`Plan: saving a budget of ${manifest.budgetMinutes} minutes a day.`);
    const focusNote = manifest.examTitle ? `Getting ready for ${manifest.examTitle}.` : "";
    if (!await run.send("/planning/configure", { course: manifest.course, dailyMinutes: manifest.budgetMinutes, focusNote })) return;
    const exam = manifest.examInDays !== null && covered.length > 0;
    if (exam) {
      const date = addDays(plan.data.today, manifest.examInDays);
      run.log(`  Setting an exam${manifest.examTitle ? ` (${manifest.examTitle})` : ""} on ${date} that covers ${plural(covered.length, "skill", "skills")}.`);
      if (!await run.send("/planning/exams/set", { course: manifest.course, date, covered })) return;
    } else if (manifest.examInDays !== null) {
      run.notes.push("Plan: the course has no confirmed skills for an exam to cover, so no exam was set.");
    }
    if (!await run.send("/planning/propose", { course: manifest.course })) return;
    plan = await run.send("/planning/read", { course: manifest.course });
    if (!plan) return;
    if (!plan.proposal.length) {
      run.tradeoff = exam ? "none offered: the preparation fits before the exam" : "none offered: no exam was set";
      run.log(plan.data.plan ? "  The plan is active and needed no trade-off." : "  No plan is active yet.");
      if (exam) {
        // Each skill to review before the exam gets one ten-minute activity on one of the days before it.
        const needed = covered.length * 10, available = Math.floor(manifest.budgetMinutes / 10) * 10 * manifest.examInDays;
        run.notes.push(`Plan: no trade-off was offered, because preparing the ${plural(covered.length, "skill", "skills")} takes at most ${needed} minutes ` +
          `and the budget gives ${available} minutes before the exam. A trade-off appears when the preparation does not fit: ` +
          "lower budgetMinutes or examInDays so that the number of skills times 10 is more than budgetMinutes (rounded down to tens) times examInDays.");
      }
      return;
    }
    run.log(`  The plan leaves out ${plural(plan.cuts.length, "activity", "activities")} before the exam and waits for a decision. Declining it once.`);
    if (!await run.send("/planning/tradeoffs/decline", { course: manifest.course, plan: plan.proposal[0].plan })) return;
    if (!await run.send("/planning/propose", { course: manifest.course })) { run.tradeoff = "declined; asking again was refused"; return; }
    plan = await run.send("/planning/read", { course: manifest.course });
    if (!plan) return;
    if (!plan.proposal.length) { run.tradeoff = "declined; the next plan needed no decision"; run.log("  The next plan needed no decision."); return; }
    run.log("  Asked again; confirming the trade-off this time.");
    if (!await run.send("/planning/tradeoffs/confirm", { course: manifest.course, plan: plan.proposal[0].plan })) { run.tradeoff = "declined; confirming the next was refused"; return; }
    run.tradeoff = "declined once, then confirmed";
    run.log("  The trade-off is confirmed and the plan is active.");
  }

  // ---- Tree kind ----
  /** Gives the first topic the tree kind asked for, through the endpoint the tree picker uses. */
  async function seedTreeKind(run) {
    const { manifest } = run;
    if (!manifest.treeKind) { run.skipped.push("Tree kind: none asked for."); return; }
    const course = await run.send("/courses/read", { course: manifest.course });
    if (!course) return;
    const unit = manifest.topics.length ? course.units.find((row) => sameTitle(row.title, manifest.topics[0])) : course.units[0];
    if (!unit) { run.notes.push(`Tree kind: the course has no topic${manifest.topics.length ? ` named “${manifest.topics[0]}”` : ""}, so no tree kind was chosen.`); return; }
    if (course.looks.some((look) => look.unit === unit.unit && look.kind === manifest.treeKind)) {
      run.skipped.push(`Tree kind: “${unit.title}” already grows a ${manifest.treeKind} tree.`);
      run.log(`Tree kind: “${unit.title}” is already a ${manifest.treeKind}.`);
      return;
    }
    if (await run.sendKeyed("/courses/units/look", { unit: unit.unit, kind: manifest.treeKind })) run.log(`Tree kind: “${unit.title}” now grows a ${manifest.treeKind} tree.`);
  }

  // ---- Archive ----
  /** Archives finished conversations, oldest first, until the course has the number of archived conversations asked for. */
  async function seedArchive(run) {
    const { manifest } = run;
    if (!manifest.archive) { run.skipped.push("Archive: none asked for."); return; }
    const listed = await run.send("/learning/archived", { course: manifest.course });
    if (!listed) return;
    const have = listed.sessions.length;
    if (have >= manifest.archive) {
      run.skipped.push(`Archive: the course already has ${plural(have, "archived conversation", "archived conversations")} (${manifest.archive} asked for).`);
      run.log(`Archive: ${have} already, nothing to add.`);
      return;
    }
    const state = await run.snapshot();
    if (!state) return;
    // Session identities are time-ordered, so sorting them puts the oldest first.
    const finished = state.skills.flatMap((skill) => skill.data.sessions.filter((session) => session.status === "CLOSED" && !skill.data.archived.includes(session.session)))
      .sort((a, b) => a.session < b.session ? -1 : a.session > b.session ? 1 : 0).slice(0, manifest.archive - have);
    if (!finished.length) { run.notes.push("Archive: the course has no finished conversation to archive."); return; }
    for (const session of finished) {
      if (await run.sendKeyed("/learning/archive", { studySession: session.session })) {
        run.log(`Archive: archived ${session.lesson ? `the lesson “${session.lesson.request}”` : "a practice task"}`);
      }
    }
  }

  /** What the course holds at the end, read again from the server, with what this run recorded. */
  async function summarize(run) {
    const { manifest } = run;
    const summary = { course: manifest.course, skills: 0, confidence: 0, lessons: 0, practice: 0, adjustments: 0,
      plan: { budgetMinutes: null, exams: [], active: false, waitingForDecision: false, tradeoff: run.tradeoff }, treeKind: null, archived: 0,
      skipped: run.skipped, failures: run.failures, notes: run.notes };
    run.step = "summary";
    const state = await run.snapshot();
    if (state) {
      summary.skills = state.skills.length;
      summary.confidence = state.skills.filter((skill) => skill.data.track).length;
      summary.lessons = state.skills.reduce((sum, skill) => sum + lessonsOf(skill).length, 0);
      summary.practice = state.skills.reduce((sum, skill) => sum + practiceOf(skill).length, 0);
      summary.adjustments = state.skills.reduce((sum, skill) => sum + adjustmentsOf(skill), 0);
      const unit = manifest.topics.length ? state.course.units.find((row) => sameTitle(row.title, manifest.topics[0])) : state.course.units[0];
      const look = unit && state.course.looks.find((row) => row.unit === unit.unit);
      summary.treeKind = look ? look.kind : null;
    }
    const plan = await run.send("/planning/read", { course: manifest.course });
    if (plan) {
      summary.plan.budgetMinutes = plan.data.preferences ? plan.data.preferences.dailyMinutes : null;
      summary.plan.exams = plan.exams.map((exam) => exam.date);
      summary.plan.active = !!plan.data.plan;
      summary.plan.waitingForDecision = plan.proposal.length > 0;
    }
    const archived = await run.send("/learning/archived", { course: manifest.course });
    if (archived) summary.archived = archived.sessions.length;
    return summary;
  }

  const STEPS = [["skills", seedSkills], ["confidence", seedConfidence], ["lessons", seedLessons], ["practice", seedPractice],
    ["adjustments", seedAdjustments], ["plan", seedPlan], ["tree kind", seedTreeKind], ["archive", seedArchive]];

  /**
   * Fills the manifest's course with activity and resolves to a summary of what the course holds afterwards:
   * { course, skills, confidence, lessons, practice, adjustments, plan, treeKind, archived, skipped, failures, notes }.
   * A manifest with a mistake is refused before anything is sent.
   */
  async function stillgotitSeed(manifest) {
    if (stillgotitSeed.progress.running) throw new Error("A seeding run is already going in this page. stillgotitSeed.progress shows how far it got; wait for it to finish.");
    const checked = checkManifest(manifest);
    const progress = { running: true, step: "start", lines: [], summary: null };
    stillgotitSeed.progress = progress;
    const run = createRun(checked, progress), began = Date.now();
    let signedOut = false;
    try {
      run.log(`Seeding course ${checked.course}.`);
      if (!await run.send("/courses/read", { course: checked.course })) {
        run.notes.push("The course could not be read, so nothing was changed. Check the course id with stillgotitSeed.courses().");
      } else {
        for (const [name, step] of STEPS) {
          run.step = name; progress.step = name;
          try { await step(run); } catch (problem) {
            if (problem instanceof SignedOut) throw problem;
            // A mistake in the script must not cost the rest of the run.
            run.failures.push({ step: name, endpoint: "", error: "SCRIPT_ERROR", detail: problem instanceof Error ? problem.message : String(problem) });
            run.log(`  The script failed in this step: ${problem instanceof Error ? problem.message : String(problem)}`);
          }
        }
      }
    } catch (problem) {
      if (problem instanceof SignedOut) {
        signedOut = true;
        run.notes.push("The sign-in ended, so the run stopped. Sign in again and run the same manifest: the steps already done are skipped.");
      } else {
        run.failures.push({ step: run.step, endpoint: "", error: "SCRIPT_ERROR", detail: problem instanceof Error ? problem.message : String(problem) });
      }
    }
    let summary = null;
    try {
      if (!signedOut) summary = await summarize(run);
    } catch (problem) {
      if (!(problem instanceof SignedOut)) {
        run.failures.push({ step: "summary", endpoint: "", error: "SCRIPT_ERROR", detail: problem instanceof Error ? problem.message : String(problem) });
      }
    } finally {
      progress.running = false; progress.step = "done";
    }
    // Without a final read, the summary holds only what the run recorded.
    summary = summary || { course: checked.course, skipped: run.skipped, failures: run.failures, notes: run.notes };
    progress.summary = summary;
    run.log(`Done in ${seconds(began)}: ${plural(run.failures.length, "failure", "failures")}.`);
    return summary;
  }
  /** How far the latest run got: whether it is running, its current step, every log line, and its summary once done. */
  stillgotitSeed.progress = { running: false, step: "idle", lines: [], summary: null };
  /** The signed-in learner's courses, each with its id, status, topics and source materials, to fill in a manifest. */
  stillgotitSeed.courses = async function courses() {
    const list = await call("/courses", {});
    if (!list.ok) throw new Error(list.detail || `The course list could not be read (${list.error}).`);
    const out = [];
    for (const row of list.data.courses) {
      const read = await call("/courses/read", { course: row.course });
      out.push({ course: row.course, title: row.title, status: row.status,
        topics: read.ok ? read.data.units.map((unit) => unit.title) : [],
        materials: read.ok ? read.data.materials.map((material) => ({ material: material.material, title: material.title })) : [] });
    }
    return out;
  };
  window.stillgotitSeed = stillgotitSeed;
})();
