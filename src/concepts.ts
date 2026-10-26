import { budgeting } from "./concepts/Budgeting/registry.ts";
import { masteryEstimating } from "./concepts/MasteryEstimating/registry.ts";
import { assessmentReviewing } from "./concepts/AssessmentReviewing/registry.ts";
import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { commonsFederating } from "./concepts/Federating/registry.ts";
import { registering } from "./concepts/Registering/registry.ts";
import { sessioning } from "./concepts/Sessioning/registry.ts";
import { skillMapping } from "./concepts/SkillMapping.registry.ts";
import { groundedTutoring } from "./concepts/GroundedTutoring/registry.ts";
import { materialKeeping } from "./concepts/MaterialKeeping/registry.ts";
import { singleMaterial, evidenceAttribution } from "./computations.ts";
import { carriedEstimate, prerequisiteSet, prerequisiteToPractice, sessionSubject, attemptIsReady, beginAllowed, correctionNote, coveredSkillsConfirmed, cutKey, dialogueIsCurrent, evidenceUpdate, generationDefinition, generationFields, gradeRequest, hasLessonQuestion, itemOrder, itemSubject, lessonRequest, planDetail, planRequest, prerequisitesReady, progressRows, responseInput, reviewApproved, selectSkill, selectSkillMaterials, selectSources, sessionActivity, recentSession, studyTopics, sessionMaterials, sessionRequest, studyDetail, submissionInput, suggestRequest, taskRequest, urgentExamItem, estimateTimeline } from "./computations/learning.ts";
import { generating } from "./concepts/Generating/registry.ts";
import preferringSpec from "@design/concepts/Preferring.md" with { type: "text" };
import { Preferring } from "./concepts/Preferring/Preferring.ts";
import type { User } from "./concepts/Registering/Registering.ts";
import type { TutorChoice } from "./tutor-types.ts";
import { choiceOffered, defaultChoice, levelSupported, modelOffered, offeredChoice, requestChoice, tutorCatalog, tutorStatus, withChoice } from "./computations/tutor.ts";
import { defaultHomeView, homeViewOffered, offeredHomeView, type HomeView } from "./computations/home-view.ts";

/** Preferring bound as the stage's TutorPreferring instance: User is Registering.User, Option is TutorChoice. */
export class TutorPreferring extends Preferring<User, TutorChoice> {}
const tutorPreferring = registerConcept({ class: TutorPreferring, spec: preferringSpec, refusals: {} });
/** Preferring bound as the stage's ViewPreferring instance: User is Registering.User, Option is HomeView. */
export class ViewPreferring extends Preferring<User, HomeView> {}
const viewPreferring = registerConcept({ class: ViewPreferring, spec: preferringSpec, refusals: {} });
import { extractRequest, gradedImport, gradedKey, gradedReview, gradedSource, gradedTitle, gradedToday, hasConfirmedSkill, hasGradedRows } from "./computations/importing.ts";

export const applicationConceptSet = conceptSet({
  Registering: registering,
  CommonsFederating: commonsFederating,
  Sessioning: sessioning,
  SkillMapping: skillMapping,
  AssessmentReviewing: assessmentReviewing,
  MasteryEstimating: masteryEstimating,
  StudyPlanning: budgeting,
  Library: materialKeeping,
  GroundedTutoring: groundedTutoring,
  TutorGenerating: generating,
  TutorPreferring: tutorPreferring,
  ViewPreferring: viewPreferring,
}, { singleMaterial, evidenceAttribution, carriedEstimate, prerequisiteSet, prerequisiteToPractice, sessionSubject, attemptIsReady, beginAllowed, correctionNote, coveredSkillsConfirmed, cutKey, dialogueIsCurrent, evidenceUpdate, generationDefinition, generationFields, gradeRequest, hasLessonQuestion, itemOrder, itemSubject, lessonRequest, planDetail, planRequest, prerequisitesReady, progressRows, responseInput, reviewApproved, selectSkill, selectSkillMaterials, selectSources, sessionActivity, recentSession, studyTopics, sessionMaterials, sessionRequest, studyDetail, submissionInput, suggestRequest, taskRequest, urgentExamItem, estimateTimeline,
  tutorCatalog, defaultChoice, modelOffered, levelSupported, offeredChoice, choiceOffered, withChoice, requestChoice, tutorStatus,
  homeViewOffered, offeredHomeView, defaultHomeView,
  gradedTitle, hasConfirmedSkill, extractRequest, hasGradedRows, gradedToday, gradedReview, gradedKey, gradedImport, gradedSource });
export const { concepts, computations } = applicationConceptSet;
