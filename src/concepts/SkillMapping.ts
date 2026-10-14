import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type Collection, type Db, MongoServerError } from "mongodb";

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
  // Internal transaction marker. Queries do not expose it.
  prerequisiteLock?: string;
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

  constructor(private readonly db: Db, instanceName = "SkillMapping") {
    // All collections and transaction sessions use this database's client.
    this.courses = db.collection(`${instanceName}.courses`);
    this.units = db.collection(`${instanceName}.units`);
    this.skills = db.collection(`${instanceName}.skills`);
    this.versions = db.collection(`${instanceName}.versions`);
    this.proposals = db.collection(`${instanceName}.proposals`);
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
    const unitRecord = await this.units.findOne({ _id: unit });
    const ownedCourse = unitRecord
      ? await this.courses.findOne({ _id: unitRecord.course, owner })
      : null;
    if (!ownedCourse) {
      throw new ProposalUnitUnavailableError();
    }
    if ([title, outcome, gate].some((text) => text.trim().length === 0)) {
      throw new InvalidSkillProposalError();
    }
    if (typeof proposalKey !== "string" || !proposalKey.trim() || proposalKey.length > 100) {
      throw new InvalidSkillProposalKeyError();
    }

    const skill = randomUUID();
    const version = randomUUID();
    // Encoding a pair avoids ambiguous concatenation and gives MongoDB one unique key.
    const receiptId = JSON.stringify([owner, proposalKey]);

    const save = () => this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        const receipt = await this.proposals.findOne({ _id: receiptId }, { session });
        if (receipt) {
          if (!isDeepStrictEqual(receipt.original, original)) throw new SkillProposalConflictError();
          if (!await this.skills.findOne({ _id: receipt.skill }, { session })) throw new SkillProposalDiscardedError();
          return { skill: receipt.skill };
        }
        // The receipt, skill, and version commit together. Discard keeps the receipt.
        await this.proposals.insertOne({ _id: receiptId, original, skill }, { session });
        await this.skills.insertOne({
          _id: skill,
          unit,
          title,
          materials: sourceReferences,
          prerequisites: [],
          current: version,
          status: "DRAFT",
        }, { session });
        await this.versions.insertOne({
          _id: version,
          skill,
          outcome,
          gate,
        }, { session });
        return { skill };
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
    try {
      return await save();
    } catch (error) {
      // A competing transaction can win the receipt key. Reread its committed result.
      if (error instanceof MongoServerError && error.code === 11000 && error.keyValue?._id === receiptId) {
        return save();
      }
      throw error;
    }
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

    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        // Read inside the transaction so a retry checks the latest draft again.
        const draft = await this.skills.findOne({ _id: skill, status: "DRAFT" }, { session });
        if (!draft) {
          throw new DraftRevisionUnavailableError();
        }
        const sourceUnit = await this.units.findOne({ _id: draft.unit }, { session });
        const course = sourceUnit
          ? await this.courses.findOne({ _id: sourceUnit.course, owner }, { session })
          : null;
        if (!course || !sourceUnit) {
          throw new DraftRevisionUnavailableError();
        }

        const targetUnit = await this.units.findOne({ _id: unit, course: sourceUnit.course }, { session });
        if (!targetUnit) {
          throw new DraftUnitMismatchError();
        }
        if ([title, outcome, gate].some((text) => text.trim().length === 0)) {
          throw new InvalidDraftContentError();
        }

        const previous = await this.versions.findOne({ _id: draft.current, skill }, { session });
        if (!previous) {
          throw new Error("The draft's current requirements version is missing.");
        }

        let current = draft.current;
        if (outcome !== previous.outcome || gate !== previous.gate) {
          current = randomUUID();
          await this.versions.insertOne({ _id: current, skill, outcome, gate }, { session });
        }
        const updated = await this.skills.updateOne(
          { _id: skill, status: "DRAFT" },
          { $set: { unit, title, materials: sourceReferences, current } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new DraftRevisionUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async discardDraft({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        // Check the current draft again if a concurrent edit causes a retry.
        const draft = await this.skills.findOne({ _id: skill, status: "DRAFT" }, { session });
        if (!draft) {
          throw new DraftDiscardUnavailableError();
        }
        const unit = await this.units.findOne({ _id: draft.unit }, { session });
        const course = unit
          ? await this.courses.findOne({ _id: unit.course, owner }, { session })
          : null;
        if (!course) {
          throw new DraftDiscardUnavailableError();
        }

        const removed = await this.skills.deleteOne({ _id: skill, status: "DRAFT" }, { session });
        if (removed.deletedCount !== 1) {
          throw new DraftDiscardUnavailableError();
        }
        await this.versions.deleteMany({ skill }, { session });
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async confirm({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        // A retry must recheck status and sources after any concurrent edit.
        const draft = await this.skills.findOne({ _id: skill, status: "DRAFT" }, { session });
        if (!draft) {
          throw new SkillConfirmUnavailableError();
        }
        const unit = await this.units.findOne({ _id: draft.unit }, { session });
        const course = unit
          ? await this.courses.findOne({ _id: unit.course, owner }, { session })
          : null;
        if (!course) {
          throw new SkillConfirmUnavailableError();
        }
        if (draft.materials.length === 0) {
          throw new SkillSourceRequiredError();
        }

        const updated = await this.skills.updateOne(
          { _id: skill, status: "DRAFT" },
          { $set: { status: "CONFIRMED" } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new SkillConfirmUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async editDetails({ owner, skill, unit, title }: {
    owner: User;
    skill: Skill;
    unit: Unit;
    title: string;
  }): Promise<Record<string, never>> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        // Recheck the current skill and its course on a transaction retry.
        const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" }, { session });
        if (!record) {
          throw new SkillDetailsUnavailableError();
        }
        const sourceUnit = await this.units.findOne({ _id: record.unit }, { session });
        const course = sourceUnit
          ? await this.courses.findOne({ _id: sourceUnit.course, owner }, { session })
          : null;
        if (!course || !sourceUnit) {
          throw new SkillDetailsUnavailableError();
        }

        const targetUnit = await this.units.findOne({ _id: unit, course: sourceUnit.course }, { session });
        if (!targetUnit) {
          throw new SkillUnitMismatchError();
        }
        if (title.trim().length === 0) {
          throw new InvalidSkillTitleError();
        }

        const updated = await this.skills.updateOne(
          { _id: skill, status: "CONFIRMED" },
          { $set: { unit, title } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new SkillDetailsUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async reviseDefinition({ owner, skill, outcome, gate }: {
    owner: User;
    skill: Skill;
    outcome: string;
    gate: string;
  }): Promise<{ previous: Version; version: Version }> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        // Read the current version again if another revision causes a retry.
        const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" }, { session });
        if (!record) {
          throw new SkillDefinitionUnavailableError();
        }
        const unit = await this.units.findOne({ _id: record.unit }, { session });
        const course = unit
          ? await this.courses.findOne({ _id: unit.course, owner }, { session })
          : null;
        if (!course) {
          throw new SkillDefinitionUnavailableError();
        }
        if ([outcome, gate].some((text) => text.trim().length === 0)) {
          throw new InvalidSkillDefinitionError();
        }

        const previous = record.current;
        const requirements = await this.versions.findOne({ _id: previous, skill }, { session });
        if (!requirements) {
          throw new Error("The skill's current requirements version is missing.");
        }
        if (outcome === requirements.outcome && gate === requirements.gate) {
          throw new SkillDefinitionUnchangedError();
        }

        const version = randomUUID();
        await this.versions.insertOne({ _id: version, skill, outcome, gate }, { session });
        const updated = await this.skills.updateOne(
          { _id: skill, status: "CONFIRMED" },
          { $set: { current: version } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new SkillDefinitionUnavailableError();
        }
        return { previous, version };
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async attachMaterial({ owner, skill, material }: {
    owner: User;
    skill: Skill;
    material: Material;
  }): Promise<Record<string, never>> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        // Recheck status and ownership if another edit causes a retry.
        const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" }, { session });
        if (!record) {
          throw new SkillMaterialUnavailableError();
        }
        const unit = await this.units.findOne({ _id: record.unit }, { session });
        const course = unit
          ? await this.courses.findOne({ _id: unit.course, owner }, { session })
          : null;
        if (!course) {
          throw new SkillMaterialUnavailableError();
        }

        const updated = await this.skills.updateOne(
          { _id: skill, status: "CONFIRMED" },
          { $addToSet: { materials: material } },
          { session },
        );
        // An existing link is valid even when MongoDB changes no fields.
        if (updated.matchedCount !== 1) {
          throw new SkillMaterialUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async setPrerequisites({ owner, skill, prerequisites }: {
    owner: User;
    skill: Skill;
    prerequisites: SkillSet;
  }): Promise<Record<string, never>> {
    const requiredSkills = [...new Set(prerequisites)].sort();

    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" }, { session });
        if (!record) {
          throw new SkillPrerequisitesUnavailableError();
        }
        const unit = await this.units.findOne({ _id: record.unit }, { session });
        // A shared write prevents concurrent edits to different skills from
        // each passing the cycle check against the same old course graph.
        // Archive and restore share this course lock.
        const course = unit
          ? await this.courses.findOneAndUpdate(
            { _id: unit.course, owner },
            { $set: { prerequisiteLock: randomUUID() } },
            { session, returnDocument: "after" },
          )
          : null;
        if (!course) {
          throw new SkillPrerequisitesUnavailableError();
        }

        const courseUnits = await this.units.find({ course: course._id }, { session }).toArray();
        const courseSkills = await this.skills.find({
          unit: { $in: courseUnits.map(({ _id }) => _id) },
          status: "CONFIRMED",
        }, { session }).toArray();
        const byId = new Map(courseSkills.map((row) => [row._id, row]));
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
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new SkillPrerequisitesUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async archive({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        const record = await this.skills.findOne({ _id: skill, status: "CONFIRMED" }, { session });
        if (!record) {
          throw new SkillArchiveUnavailableError();
        }
        const unit = await this.units.findOne({ _id: record.unit }, { session });
        // Share the prerequisite lock so a concurrent link cannot be saved
        // to this skill after the dependent check but before archival.
        const course = unit
          ? await this.courses.findOneAndUpdate(
            { _id: unit.course, owner },
            { $set: { prerequisiteLock: randomUUID() } },
            { session, returnDocument: "after" },
          )
          : null;
        if (!course) {
          throw new SkillArchiveUnavailableError();
        }

        const dependent = await this.skills.findOne(
          { status: "CONFIRMED", prerequisites: skill },
          { session },
        );
        if (dependent) {
          throw new SkillStillRequiredError();
        }

        const updated = await this.skills.updateOne(
          { _id: skill, status: "CONFIRMED" },
          { $set: { status: "ARCHIVED" } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new SkillArchiveUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
  }

  async restore({ owner, skill }: {
    owner: User;
    skill: Skill;
  }): Promise<Record<string, never>> {
    return this.db.client.withSession((session) =>
      session.withTransaction(async () => {
        const record = await this.skills.findOne({ _id: skill, status: "ARCHIVED" }, { session });
        if (!record) {
          throw new SkillRestoreUnavailableError();
        }
        const unit = await this.units.findOne({ _id: record.unit }, { session });
        // Share the course lock with archive and setPrerequisites. A retry
        // must read current statuses and links before restoring this skill.
        const course = unit
          ? await this.courses.findOneAndUpdate(
            { _id: unit.course, owner },
            { $set: { prerequisiteLock: randomUUID() } },
            { session, returnDocument: "after" },
          )
          : null;
        if (!course) {
          throw new SkillRestoreUnavailableError();
        }

        const courseUnits = await this.units.find({ course: course._id }, { session }).toArray();
        const courseSkills = await this.skills.find({
          unit: { $in: courseUnits.map(({ _id }) => _id) },
          status: "CONFIRMED",
        }, { session }).toArray();
        const byId = new Map(courseSkills.map((row) => [row._id, row]));
        const pending = [...record.prerequisites];
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
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new SkillRestoreUnavailableError();
        }
        return {};
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
      }),
    );
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
    return row ? [{ skill: row.skill, outcome: row.outcome, gate: row.gate }] : [];
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
  await courses.createIndex({ owner: 1, _id: 1 });
  await units.createIndex({ course: 1, _id: 1 });
  await skills.createIndex({ unit: 1, _id: 1 });
  await skills.createIndex({ prerequisites: 1, status: 1 });
  await versions.createIndex({ skill: 1, _id: 1 });
  return new SkillMapping(db, instanceName);
}
