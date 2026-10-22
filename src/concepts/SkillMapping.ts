import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import {
  type Collection,
  type Db,
  type Filter,
  MongoServerError,
  type OptionalUnlessRequiredId,
  type UpdateFilter,
} from "mongodb";

export type User = string;
export type Course = string;
export type Unit = string;
export type Skill = string;
export type Version = string;
export type Material = string;
export type MaterialSet = readonly Material[];
export type SkillSet = readonly Skill[];
export type SkillStatus = "DRAFT" | "CONFIRMED" | "ARCHIVED";

interface CourseDocument {
  _id: Course;
  owner: User;
  title: string;
  // Internal claim held while one prerequisite or status change runs in this
  // course. Queries do not expose it.
  prerequisiteLock?: { holder: string; expires: Date };
}

interface UnitDocument {
  _id: Unit;
  course: Course;
  title: string;
}

interface SkillDocument {
  _id: Skill;
  unit: Unit;
  title: string;
  materials: Material[];
  prerequisites: Skill[];
  current: Version;
  status: SkillStatus;
}

interface VersionDocument {
  _id: Version;
  skill: Skill;
  outcome: string;
  gate: string;
}

interface ProposalDocument {
  _id: string;
  original: { unit: Unit; title: string; outcome: string; gate: string; materials: Material[] };
  skill: Skill;
  // A PENDING receipt names the version and skill that its save still has to
  // create. Receipts saved before this field existed were always complete.
  version?: Version;
  status?: "PENDING" | "SAVED";
}

// A prerequisite or status change holds its course claim for a few reads and
// one write. The claim expires, so a stopped process cannot block the course.
// A waiting request outlasts one whole claim before it gives up.
const COURSE_CLAIM_MS = 10_000;
const COURSE_CLAIM_WAIT_MS = 12_000;
const COURSE_CLAIM_POLL_MS = 25;
// A conditional write matches nothing only when another request changed the
// skill after this request read it. The action then reads it again.
const WRITE_ATTEMPTS = 5;

function isDuplicateId(error: unknown, id: string) {
  return error instanceof MongoServerError && error.code === 11000 && error.keyValue?._id === id;
}

// Inserts a record under an identity chosen earlier. A duplicate identity means
// an earlier attempt already saved this record, so the insert is complete.
async function insertOnce<T extends { _id: string }>(collection: Collection<T>, record: T) {
  try {
    await collection.insertOne(record as OptionalUnlessRequiredId<T>);
  } catch (error) {
    if (!isDuplicateId(error, record._id)) throw error;
  }
}

// Runs checks and one conditional write. An attempt returns undefined when its
// write matched nothing; the next attempt rereads, then refuses or writes.
async function untilWritten<T>(attempt: () => Promise<T | undefined>): Promise<T> {
  for (let tries = 0; tries < WRITE_ATTEMPTS; tries++) {
    const result = await attempt();
    if (result !== undefined) return result;
  }
  throw new Error("The skill kept changing during this request. Try again.");
}

export class InvalidCourseTitleError extends Error {
  readonly code = "INVALID_COURSE_TITLE";

  constructor() {
    super("Enter a course title.");
    this.name = "InvalidCourseTitleError";
  }
}

export class UnitCourseUnavailableError extends Error {
  readonly code = "UNIT_COURSE_UNAVAILABLE";

  constructor() {
    super("Choose one of your courses.");
    this.name = "UnitCourseUnavailableError";
  }
}

export class InvalidUnitTitleError extends Error {
  readonly code = "INVALID_UNIT_TITLE";

  constructor() {
    super("Enter a unit title.");
    this.name = "InvalidUnitTitleError";
  }
}

export class ProposalUnitUnavailableError extends Error {
  readonly code = "PROPOSAL_UNIT_UNAVAILABLE";

  constructor() {
    super("Choose a unit in one of your courses.");
    this.name = "ProposalUnitUnavailableError";
  }
}

export class InvalidSkillProposalError extends Error {
  readonly code = "INVALID_SKILL_PROPOSAL";

  constructor() {
    super("Enter a skill title, outcome, and demonstration requirements.");
    this.name = "InvalidSkillProposalError";
  }
}

export class InvalidSkillProposalKeyError extends Error {
  readonly code = "INVALID_SKILL_PROPOSAL_KEY";
  constructor() {
    super("Provide a nonblank proposal key of at most 100 characters.");
    this.name = "InvalidSkillProposalKeyError";
  }
}

export class SkillProposalConflictError extends Error {
  readonly code = "SKILL_PROPOSAL_CONFLICT";
  constructor() {
    super("Use the original skill details when retrying this save.");
    this.name = "SkillProposalConflictError";
  }
}

export class SkillProposalDiscardedError extends Error {
  readonly code = "SKILL_PROPOSAL_DISCARDED";
  constructor() {
    super("This draft was discarded. Create a new proposal to save it again.");
    this.name = "SkillProposalDiscardedError";
  }
}

export class DraftRevisionUnavailableError extends Error {
  readonly code = "DRAFT_REVISION_UNAVAILABLE";

  constructor() {
    super("Choose one of your draft skills.");
    this.name = "DraftRevisionUnavailableError";
  }
}

export class DraftUnitMismatchError extends Error {
  readonly code = "DRAFT_UNIT_MISMATCH";

  constructor() {
    super("Choose a unit in the skill's course.");
    this.name = "DraftUnitMismatchError";
  }
}

export class InvalidDraftContentError extends Error {
  readonly code = "INVALID_DRAFT_CONTENT";

  constructor() {
    super("Enter a skill title, outcome, and demonstration requirements.");
    this.name = "InvalidDraftContentError";
  }
}

export class DraftDiscardUnavailableError extends Error {
  readonly code = "DRAFT_DISCARD_UNAVAILABLE";

  constructor() {
    super("Only your draft skills can be discarded.");
    this.name = "DraftDiscardUnavailableError";
  }
}

export class SkillConfirmUnavailableError extends Error {
  readonly code = "SKILL_CONFIRM_UNAVAILABLE";

  constructor() {
    super("Choose one of your draft skills.");
    this.name = "SkillConfirmUnavailableError";
  }
}

export class SkillSourceRequiredError extends Error {
  readonly code = "SKILL_SOURCE_REQUIRED";

  constructor() {
    super("Add a source before confirming this skill.");
    this.name = "SkillSourceRequiredError";
  }
}

export class SkillDetailsUnavailableError extends Error {
  readonly code = "SKILL_DETAILS_UNAVAILABLE";

  constructor() {
    super("Choose one of your confirmed skills.");
    this.name = "SkillDetailsUnavailableError";
  }
}

export class SkillUnitMismatchError extends Error {
  readonly code = "SKILL_UNIT_MISMATCH";

  constructor() {
    super("Choose a unit in the skill's course.");
    this.name = "SkillUnitMismatchError";
  }
}

export class InvalidSkillTitleError extends Error {
  readonly code = "INVALID_SKILL_TITLE";

  constructor() {
    super("Enter a skill title.");
    this.name = "InvalidSkillTitleError";
  }
}

export class SkillDefinitionUnavailableError extends Error {
  readonly code = "SKILL_DEFINITION_UNAVAILABLE";

  constructor() {
    super("Choose one of your confirmed skills.");
    this.name = "SkillDefinitionUnavailableError";
  }
}

export class InvalidSkillDefinitionError extends Error {
  readonly code = "INVALID_SKILL_DEFINITION";

  constructor() {
    super("Enter an outcome and demonstration requirements.");
    this.name = "InvalidSkillDefinitionError";
  }
}

export class SkillDefinitionUnchangedError extends Error {
  readonly code = "SKILL_DEFINITION_UNCHANGED";

  constructor() {
    super("Change the outcome or requirements to create a new version.");
    this.name = "SkillDefinitionUnchangedError";
  }
}

export class SkillMaterialUnavailableError extends Error {
  readonly code = "SKILL_MATERIAL_UNAVAILABLE";

  constructor() {
    super("Choose one of your confirmed skills.");
    this.name = "SkillMaterialUnavailableError";
  }
}

export class SkillPrerequisitesUnavailableError extends Error {
  readonly code = "SKILL_PREREQUISITES_UNAVAILABLE";

  constructor() {
    super("Choose one of your confirmed skills.");
    this.name = "SkillPrerequisitesUnavailableError";
  }
}

export class InvalidSkillPrerequisitesError extends Error {
  readonly code = "INVALID_SKILL_PREREQUISITES";

  constructor() {
    super("Use confirmed skills from this course, without self-dependencies or cycles.");
    this.name = "InvalidSkillPrerequisitesError";
  }
}

export class SkillArchiveUnavailableError extends Error {
  readonly code = "SKILL_ARCHIVE_UNAVAILABLE";

  constructor() {
    super("Choose one of your confirmed skills.");
    this.name = "SkillArchiveUnavailableError";
  }
}

export class SkillStillRequiredError extends Error {
  readonly code = "SKILL_STILL_REQUIRED";

  constructor() {
    super("Remove this skill from other active skills' prerequisites first.");
    this.name = "SkillStillRequiredError";
  }
}

export class SkillRestoreUnavailableError extends Error {
  readonly code = "SKILL_RESTORE_UNAVAILABLE";

  constructor() {
    super("Choose one of your archived skills.");
    this.name = "SkillRestoreUnavailableError";
  }
}

export class SkillRestorePrerequisitesError extends Error {
  readonly code = "SKILL_RESTORE_PREREQUISITES";

  constructor() {
    super("Restore this skill's prerequisites before restoring the skill.");
    this.name = "SkillRestorePrerequisitesError";
  }
}

// The registry connects these domain methods to their specification and refusals.
export class SkillMapping {
  static readonly queries = {
    _courses: "many",
    _course: "optional",
    _units: "many",
    _unit: "optional",
    _skills: "many",
    _skill: "optional",
    _materials: "many",
    _prerequisites: "many",
    _version: "optional",
    _map: "one",
  } as const;

  private readonly courses: Collection<CourseDocument>;
  private readonly units: Collection<UnitDocument>;
  private readonly skills: Collection<SkillDocument>;
  private readonly versions: Collection<VersionDocument>;
  private readonly proposals: Collection<ProposalDocument>;

  constructor(db: Db, instanceName = "SkillMapping") {
    // MongoDB may run as a standalone server, so no action uses transactions.
    // Each action orders its single-record writes so that a stopped request
    // never exposes a partial result.
    this.courses = db.collection(`${instanceName}.courses`);
    this.units = db.collection(`${instanceName}.units`);
    this.skills = db.collection(`${instanceName}.skills`);
    this.versions = db.collection(`${instanceName}.versions`);
    this.proposals = db.collection(`${instanceName}.proposals`);
  }

  // A skill's unit may change only within its course, and a course never
  // changes owner, so this chain gives a skill's owner.
  async #ownedCourse(unit: Unit, owner: User) {
    const record = await this.units.findOne({ _id: unit });
    return record ? this.courses.findOne({ _id: record.course, owner }) : null;
  }

  async #confirmedCourseSkills(course: Course) {
    const courseUnits = await this.units.find({ course }).toArray();
    return this.skills.find({
      unit: { $in: courseUnits.map(({ _id }) => _id) },
      status: "CONFIRMED",
    }).toArray();
  }

  // Applies a conditional skill update that may make a newly saved version
  // current. If the update does not apply, no skill uses that version and no
  // action returned it, so it is removed. Returns whether the update applied.
  async #updateWithVersion(
    skill: Skill,
    created: Version | undefined,
    filter: Filter<SkillDocument>,
    update: UpdateFilter<SkillDocument>,
  ) {
    let applied: boolean;
    try {
      applied = (await this.skills.updateOne(filter, update)).matchedCount === 1;
    } catch (error) {
      // Keep the database error. A version left behind is never returned.
      if (created) await this.#removeUnusedVersion(skill, created).catch(() => undefined);
      throw error;
    }
    if (!applied && created) {
      await this.#removeUnusedVersion(skill, created);
    }
    return applied;
  }

  async #removeUnusedVersion(skill: Skill, version: Version) {
    // A lost reply can hide an update that did apply. Keep a version in use.
    if (!await this.skills.findOne({ _id: skill, current: version })) {
      await this.versions.deleteOne({ _id: version, skill });
    }
  }

  // Prerequisite and status checks read the whole course, then write one
  // skill. Holding this claim on the course record makes those checks and
  // writes run one at a time per course. The claim uses the database clock and
  // expires, so a stopped process delays later changes by at most
  // COURSE_CLAIM_MS.
  async #withCourseClaim<T>(
    course: Course,
    owner: User,
    unavailable: () => Error,
    work: () => Promise<T>,
  ): Promise<T> {
    const holder = randomUUID();
    const giveUpAt = Date.now() + COURSE_CLAIM_WAIT_MS;
    for (;;) {
      const claimed = await this.courses.updateOne(
        {
          _id: course,
          owner,
          $or: [
            { prerequisiteLock: { $exists: false } },
            { $expr: { $lte: ["$prerequisiteLock.expires", "$$NOW"] } },
          ],
        },
        [{
          $set: {
            prerequisiteLock: {
              holder: { $literal: holder },
              expires: { $add: ["$$NOW", COURSE_CLAIM_MS] },
            },
          },
        }],
      );
      if (claimed.matchedCount === 1) break;
      if (!await this.courses.findOne({ _id: course, owner })) {
        throw unavailable();
      }
      if (Date.now() >= giveUpAt) {
        throw new Error("Another prerequisite change in this course is still running. Try again.");
      }
      await delay(COURSE_CLAIM_POLL_MS);
    }
    try {
      return await work();
    } finally {
      // An unreleased claim expires, so a failed release only delays the next change.
      await this.courses.updateOne(
        { _id: course, "prerequisiteLock.holder": holder },
        { $unset: { prerequisiteLock: "" } },
      ).catch(() => undefined);
    }
  }

  async createCourse({ owner, title }: { owner: User; title: string }): Promise<{
    course: Course;
  }> {
    if (title.trim().length === 0) {
      throw new InvalidCourseTitleError();
    }

    const course = randomUUID();
    await this.courses.insertOne({ _id: course, owner, title });
    return { course };
  }

  async addUnit({ owner, course, title }: {
    owner: User;
    course: Course;
    title: string;
  }): Promise<{ unit: Unit }> {
    // Courses cannot be deleted or reassigned through this concept.
    const ownedCourse = await this.courses.findOne({ _id: course, owner });
    if (!ownedCourse) {
      throw new UnitCourseUnavailableError();
    }
    if (title.trim().length === 0) {
      throw new InvalidUnitTitleError();
    }

    const unit = randomUUID();
    await this.units.insertOne({ _id: unit, course, title });
    return { unit };
  }

  async propose({ owner, unit, proposalKey, title, outcome, gate, materials }: {
    owner: User;
    unit: Unit;
    proposalKey: string;
    title: string;
    outcome: string;
    gate: string;
    materials: MaterialSet;
  }): Promise<{ skill: Skill }> {
    // Freeze the set before any database wait. Its order is not part of the request.
    const sourceReferences = [...new Set(materials)];
    const original = { unit, title, outcome, gate, materials: [...sourceReferences].sort() };
    // A unit's course and a course's owner cannot change under this spec.
    if (!await this.#ownedCourse(unit, owner)) {
      throw new ProposalUnitUnavailableError();
    }
    if ([title, outcome, gate].some((text) => text.trim().length === 0)) {
      throw new InvalidSkillProposalError();
    }
    if (typeof proposalKey !== "string" || !proposalKey.trim() || proposalKey.length > 100) {
      throw new InvalidSkillProposalKeyError();
    }

    // Encoding a pair avoids ambiguous concatenation and gives MongoDB one unique key.
    const receiptId = JSON.stringify([owner, proposalKey]);
    // Claim the key before any other write. The receipt names the version and
    // skill it will create, so a retry can finish a save that stopped partway.
    try {
      await this.proposals.insertOne({
        _id: receiptId, original, skill: randomUUID(), version: randomUUID(), status: "PENDING",
      });
    } catch (error) {
      // An earlier or concurrent request holds this key. Its receipt decides the result.
      if (!isDuplicateId(error, receiptId)) throw error;
    }
    const receipt = await this.proposals.findOne({ _id: receiptId });
    if (!receipt) {
      throw new Error("The proposal receipt is missing.");
    }
    if (!isDeepStrictEqual(receipt.original, original)) {
      throw new SkillProposalConflictError();
    }

    if (receipt.status === "PENDING" && receipt.version) {
      // Create the version before the skill, so a visible skill always has its
      // current version. This input matches the receipt, and both inserts use
      // the receipt's identities, so a repeated insert finds the record an
      // earlier attempt saved and keeps any later edits to it.
      await insertOnce(this.versions, { _id: receipt.version, skill: receipt.skill, outcome, gate });
      await insertOnce(this.skills, {
        _id: receipt.skill,
        unit,
        title,
        materials: sourceReferences,
        prerequisites: [],
        current: receipt.version,
        status: "DRAFT",
      });
      await this.proposals.updateOne({ _id: receiptId, status: "PENDING" }, { $set: { status: "SAVED" } });
      return { skill: receipt.skill };
    }

    // A saved receipt's skill was fully created. If it is gone, it was discarded.
    if (!await this.skills.findOne({ _id: receipt.skill })) {
      throw new SkillProposalDiscardedError();
    }
    return { skill: receipt.skill };
  }

  async reviseDraft({ owner, skill, unit, title, outcome, gate, materials }: {
    owner: User;
    skill: Skill;
    unit: Unit;
    title: string;
    outcome: string;
    gate: string;
    materials: MaterialSet;
  }): Promise<Record<string, never>> {
    const sourceReferences = [...new Set(materials)];

    return untilWritten(async () => {
      const draft = await this.skills.findOne({ _id: skill, status: "DRAFT" });
      if (!draft) {
        throw new DraftRevisionUnavailableError();
      }
      const course = await this.#ownedCourse(draft.unit, owner);
      if (!course) {
        throw new DraftRevisionUnavailableError();
      }

      const targetUnit = await this.units.findOne({ _id: unit, course: course._id });
      if (!targetUnit) {
        throw new DraftUnitMismatchError();
      }
      if ([title, outcome, gate].some((text) => text.trim().length === 0)) {
        throw new InvalidDraftContentError();
      }

      const previous = await this.versions.findOne({ _id: draft.current, skill });
      if (!previous) {
        throw new Error("The draft's current requirements version is missing.");
      }

      // Save changed requirements as a new version before the skill points to it.
      const changed = outcome !== previous.outcome || gate !== previous.gate;
      const current = changed ? randomUUID() : draft.current;
      if (changed) {
        await this.versions.insertOne({ _id: current, skill, outcome, gate });
      }
      // The filter matches only the draft as read above. If another request
      // changed it first, the new version is removed and the checks run again.
      const updated = await this.#updateWithVersion(
        skill,
        changed ? current : undefined,
        { _id: skill, unit: draft.unit, status: "DRAFT", current: draft.current },
        { $set: { unit, title, materials: sourceReferences, current } },
      );
      return updated ? {} : undefined;
    });
  }

  async discardDraft({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    return untilWritten(async () => {
      const draft = await this.skills.findOne({ _id: skill, status: "DRAFT" });
      if (!draft) {
        throw new DraftDiscardUnavailableError();
      }
      if (!await this.#ownedCourse(draft.unit, owner)) {
        throw new DraftDiscardUnavailableError();
      }

      // A save that stopped partway leaves its receipt PENDING. Mark it SAVED
      // before removing the draft, so a retry of that save is refused instead
      // of creating the draft again. The draft exists, so the save was complete.
      await this.proposals.updateMany({ skill, status: "PENDING" }, { $set: { status: "SAVED" } });
      const removed = await this.skills.deleteOne({ _id: skill, unit: draft.unit, status: "DRAFT" });
      if (removed.deletedCount !== 1) {
        return undefined;
      }
      // Remove versions after the skill. If this step stops early, queries
      // already treat versions of a removed skill as absent.
      await this.versions.deleteMany({ skill });
      return {};
    });
  }

  async confirm({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    return untilWritten(async () => {
      const draft = await this.skills.findOne({ _id: skill, status: "DRAFT" });
      if (!draft) {
        throw new SkillConfirmUnavailableError();
      }
      if (!await this.#ownedCourse(draft.unit, owner)) {
        throw new SkillConfirmUnavailableError();
      }
      if (draft.materials.length === 0) {
        throw new SkillSourceRequiredError();
      }

      // The filter also requires a source, so a concurrent source removal is
      // checked again instead of producing a confirmed skill with no source.
      const updated = await this.skills.updateOne(
        { _id: skill, unit: draft.unit, status: "DRAFT", materials: { $ne: [] } },
        { $set: { status: "CONFIRMED" } },
      );
      return updated.matchedCount === 1 ? {} : undefined;
    });
  }

  async editDetails({ owner, skill, unit, title }: {
    owner: User;
    skill: Skill;
    unit: Unit;
    title: string;
  }): Promise<Record<string, never>> {
    return untilWritten(async () => {
      const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" });
      if (!record) {
        throw new SkillDetailsUnavailableError();
      }
      const course = await this.#ownedCourse(record.unit, owner);
      if (!course) {
        throw new SkillDetailsUnavailableError();
      }

      const targetUnit = await this.units.findOne({ _id: unit, course: course._id });
      if (!targetUnit) {
        throw new SkillUnitMismatchError();
      }
      if (title.trim().length === 0) {
        throw new InvalidSkillTitleError();
      }

      const updated = await this.skills.updateOne(
        { _id: skill, unit: record.unit, status: "CONFIRMED" },
        { $set: { unit, title } },
      );
      return updated.matchedCount === 1 ? {} : undefined;
    });
  }

  async reviseDefinition({ owner, skill, outcome, gate }: {
    owner: User;
    skill: Skill;
    outcome: string;
    gate: string;
  }): Promise<{ previous: Version; version: Version }> {
    return untilWritten(async () => {
      const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" });
      if (!record) {
        throw new SkillDefinitionUnavailableError();
      }
      if (!await this.#ownedCourse(record.unit, owner)) {
        throw new SkillDefinitionUnavailableError();
      }
      if ([outcome, gate].some((text) => text.trim().length === 0)) {
        throw new InvalidSkillDefinitionError();
      }

      const previous = record.current;
      const requirements = await this.versions.findOne({ _id: previous, skill });
      if (!requirements) {
        throw new Error("The skill's current requirements version is missing.");
      }
      if (outcome === requirements.outcome && gate === requirements.gate) {
        throw new SkillDefinitionUnchangedError();
      }

      // Save the version first. The switch applies only from the version read
      // above, so the result always names the version it replaced.
      const version = randomUUID();
      await this.versions.insertOne({ _id: version, skill, outcome, gate });
      const updated = await this.#updateWithVersion(
        skill,
        version,
        { _id: skill, unit: record.unit, status: "CONFIRMED", current: previous },
        { $set: { current: version } },
      );
      return updated ? { previous, version } : undefined;
    });
  }

  async attachMaterial({ owner, skill, material }: {
    owner: User;
    skill: Skill;
    material: Material;
  }): Promise<Record<string, never>> {
    return untilWritten(async () => {
      const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" });
      if (!record) {
        throw new SkillMaterialUnavailableError();
      }
      if (!await this.#ownedCourse(record.unit, owner)) {
        throw new SkillMaterialUnavailableError();
      }

      const updated = await this.skills.updateOne(
        { _id: skill, unit: record.unit, status: "CONFIRMED" },
        { $addToSet: { materials: material } },
      );
      // An existing link is valid even when MongoDB changes no fields.
      return updated.matchedCount === 1 ? {} : undefined;
    });
  }

  async setPrerequisites({ owner, skill, prerequisites }: {
    owner: User;
    skill: Skill;
    prerequisites: SkillSet;
  }): Promise<Record<string, never>> {
    const requiredSkills = [...new Set(prerequisites)].sort();

    const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" });
    if (!record) {
      throw new SkillPrerequisitesUnavailableError();
    }
    const unit = await this.units.findOne({ _id: record.unit });
    if (!unit) {
      throw new SkillPrerequisitesUnavailableError();
    }
    // The claim keeps concurrent edits to different skills from each passing
    // the cycle check against the same old course graph. Archive and restore
    // share this claim.
    return this.#withCourseClaim(unit.course, owner, () => new SkillPrerequisitesUnavailableError(), async () => {
      const courseSkills = await this.#confirmedCourseSkills(unit.course);
      const byId = new Map(courseSkills.map((row) => [row._id, row]));
      if (!byId.has(skill)) {
        throw new SkillPrerequisitesUnavailableError();
      }
      if (requiredSkills.some((id) => id === skill || !byId.has(id))) {
        throw new InvalidSkillPrerequisitesError();
      }

      // Adding skill -> prerequisite creates a cycle exactly when a chain
      // from that prerequisite reaches skill. Shared prerequisites are valid.
      const pending = [...requiredSkills];
      const visited = new Set<Skill>();
      while (pending.length > 0) {
        const next = pending.pop()!;
        if (next === skill) {
          throw new InvalidSkillPrerequisitesError();
        }
        if (visited.has(next)) continue;
        visited.add(next);
        const prerequisite = byId.get(next);
        if (!prerequisite) {
          throw new InvalidSkillPrerequisitesError();
        }
        pending.push(...prerequisite.prerequisites);
      }

      const updated = await this.skills.updateOne(
        { _id: skill, status: "CONFIRMED" },
        { $set: { prerequisites: requiredSkills } },
      );
      if (updated.matchedCount !== 1) {
        throw new SkillPrerequisitesUnavailableError();
      }
      return {};
    });
  }

  async archive({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" });
    if (!record) {
      throw new SkillArchiveUnavailableError();
    }
    const unit = await this.units.findOne({ _id: record.unit });
    if (!unit) {
      throw new SkillArchiveUnavailableError();
    }
    // Share the prerequisite claim so a concurrent link cannot be saved
    // to this skill after the dependent check but before archival.
    return this.#withCourseClaim(unit.course, owner, () => new SkillArchiveUnavailableError(), async () => {
      const dependent = await this.skills.findOne({ status: "CONFIRMED", prerequisites: skill });
      if (dependent) {
        throw new SkillStillRequiredError();
      }

      const updated = await this.skills.updateOne(
        { _id: skill, status: "CONFIRMED" },
        { $set: { status: "ARCHIVED" } },
      );
      if (updated.matchedCount !== 1) {
        throw new SkillArchiveUnavailableError();
      }
      return {};
    });
  }

  async restore({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    const record = await this.skills.findOne({ _id: skill, status: "ARCHIVED" });
    if (!record) {
      throw new SkillRestoreUnavailableError();
    }
    const unit = await this.units.findOne({ _id: record.unit });
    if (!unit) {
      throw new SkillRestoreUnavailableError();
    }
    // Share the course claim with archive and setPrerequisites. The checks
    // read current statuses and links only while holding it.
    return this.#withCourseClaim(unit.course, owner, () => new SkillRestoreUnavailableError(), async () => {
      const archived = await this.skills.findOne({ _id: skill, status: "ARCHIVED" });
      if (!archived) {
        throw new SkillRestoreUnavailableError();
      }
      const courseSkills = await this.#confirmedCourseSkills(unit.course);
      const byId = new Map(courseSkills.map((row) => [row._id, row]));
      const pending = [...archived.prerequisites];
      const visited = new Set<Skill>();
      while (pending.length > 0) {
        const next = pending.pop()!;
        if (next === skill) {
          throw new SkillRestorePrerequisitesError();
        }
        if (visited.has(next)) continue;
        visited.add(next);
        const prerequisite = byId.get(next);
        if (!prerequisite) {
          throw new SkillRestorePrerequisitesError();
        }
        pending.push(...prerequisite.prerequisites);
      }

      const updated = await this.skills.updateOne(
        { _id: skill, status: "ARCHIVED" },
        { $set: { status: "CONFIRMED" } },
      );
      if (updated.matchedCount !== 1) {
        throw new SkillRestoreUnavailableError();
      }
      return {};
    });
  }

  async _courses({ owner }: { owner: User }): Promise<
    { course: Course; title: string }[]
  > {
    const rows = await this.courses.find({ owner }).sort({ _id: 1 }).toArray();
    return rows.map(({ _id, title }) => ({ course: _id, title }));
  }

  // Internal lookup. The application must check ownership before exposing data.
  async _course({ course }: { course: Course }): Promise<
    { owner: User; title: string }[]
  > {
    const row = await this.courses.findOne({ _id: course });
    return row ? [{ owner: row.owner, title: row.title }] : [];
  }

  async _units({ course }: { course: Course }): Promise<
    { unit: Unit; title: string }[]
  > {
    const rows = await this.units.find({ course }).sort({ _id: 1 }).toArray();
    return rows.map(({ _id, title }) => ({ unit: _id, title }));
  }

  async _unit({ unit }: { unit: Unit }): Promise<
    { course: Course; title: string }[]
  > {
    const row = await this.units.findOne({ _id: unit });
    return row ? [{ course: row.course, title: row.title }] : [];
  }

  async _skills({ unit }: { unit: Unit }): Promise<
    { skill: Skill; title: string; current: Version; status: SkillStatus }[]
  > {
    const rows = await this.skills.find({ unit }).sort({ _id: 1 }).toArray();
    return rows.map(({ _id, title, current, status }) => ({
      skill: _id, title, current, status,
    }));
  }

  async _skill({ skill }: { skill: Skill }): Promise<
    { unit: Unit; title: string; current: Version; status: SkillStatus }[]
  > {
    const row = await this.skills.findOne({ _id: skill });
    return row
      ? [{ unit: row.unit, title: row.title, current: row.current, status: row.status }]
      : [];
  }

  async _materials({ skill }: { skill: Skill }): Promise<{ material: Material }[]> {
    const row = await this.skills.findOne({ _id: skill });
    return row ? row.materials.sort().map((material) => ({ material })) : [];
  }

  async _prerequisites({ skill }: { skill: Skill }): Promise<{ prerequisite: Skill }[]> {
    const row = await this.skills.findOne({ _id: skill });
    return row ? row.prerequisites.sort().map((prerequisite) => ({ prerequisite })) : [];
  }

  async _version({ version }: { version: Version }): Promise<
    { skill: Skill; outcome: string; gate: string }[]
  > {
    const row = await this.versions.findOne({ _id: version });
    // Discarding removes the skill before its versions. A version whose skill
    // is gone counts as discarded, even if that removal stopped partway.
    if (!row || !await this.skills.findOne({ _id: row.skill }, { projection: { _id: 1 } })) {
      return [];
    }
    return [{ skill: row.skill, outcome: row.outcome, gate: row.gate }];
  }

  async _map({ course }: { course: Course }) {
    const units = await this._units({ course });
    const skills = (await Promise.all(units.map(async ({ unit }) => Promise.all((await this._skills({ unit })).map(async (skill) => {
      const [definition] = await this._version({ version: skill.current });
      return { ...skill, unit, course, outcome: definition?.outcome ?? "", gate: definition?.gate ?? "",
        materials: (await this._materials({ skill: skill.skill })).map((row) => row.material),
        prerequisites: (await this._prerequisites({ skill: skill.skill })).map((row) => row.prerequisite) };
    }))))).flat();
    return { skills };
  }
}

export async function createSkillMapping(
  db: Db,
  instanceName = "SkillMapping",
): Promise<SkillMapping> {
  const courses = db.collection<CourseDocument>(`${instanceName}.courses`);
  const units = db.collection<UnitDocument>(`${instanceName}.units`);
  const skills = db.collection<SkillDocument>(`${instanceName}.skills`);
  const versions = db.collection<VersionDocument>(`${instanceName}.versions`);
  const proposals = db.collection<ProposalDocument>(`${instanceName}.proposals`);
  await courses.createIndex({ owner: 1, _id: 1 });
  await units.createIndex({ course: 1, _id: 1 });
  await skills.createIndex({ unit: 1, _id: 1 });
  await skills.createIndex({ prerequisites: 1, status: 1 });
  await versions.createIndex({ skill: 1, _id: 1 });
  // discardDraft finds a draft's receipt by skill.
  await proposals.createIndex({ skill: 1 });
  return new SkillMapping(db, instanceName);
}
