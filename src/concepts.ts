import { studyPlanning } from "./concepts/StudyPlanning/registry.ts";
import { masteryEstimating } from "./concepts/MasteryEstimating/registry.ts";
import { assessmentReviewing } from "./concepts/AssessmentReviewing/registry.ts";
import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { commonsFederating } from "./concepts/Federating/registry.ts";
import { registering } from "./concepts/Registering/registry.ts";
import { sessioning } from "./concepts/Sessioning/registry.ts";
import { skillMapping } from "./concepts/SkillMapping.registry.ts";
import { groundedTutoring } from "./concepts/GroundedTutoring/registry.ts";
import { singleMaterial, evidenceAttribution } from "./computations.ts";
import { sessionSubject, attemptIsReady, correctionNote, dialogueIsCurrent, estimateTimeline, evidenceUpdate, generationDefinition, generationFields, gradeRequest, hasLessonQuestion, itemSubject, lessonRequest, planDetail, planRequest, prerequisitesReady, progressRows, responseInput, reviewApproved, selectSkill, selectSkillMaterials, selectSources, sessionMaterials, sessionRequest, studyDetail, submissionInput, suggestRequest, taskRequest } from "./computations/learning.ts";
import { generating } from "./concepts/Generating/registry.ts";

export const applicationConceptSet = conceptSet({
  Registering: registering,
  CommonsFederating: commonsFederating,
  Sessioning: sessioning,
  SkillMapping: skillMapping,
  AssessmentReviewing: assessmentReviewing,
  MasteryEstimating: masteryEstimating,
  StudyPlanning: studyPlanning,
  GroundedTutoring: groundedTutoring,
  TutorGenerating: generating,
}, { singleMaterial, evidenceAttribution, sessionSubject, attemptIsReady, correctionNote, dialogueIsCurrent, estimateTimeline, evidenceUpdate, generationDefinition, generationFields, gradeRequest, hasLessonQuestion, itemSubject, lessonRequest, planDetail, planRequest, prerequisitesReady, progressRows, responseInput, reviewApproved, selectSkill, selectSkillMaterials, selectSources, sessionMaterials, sessionRequest, studyDetail, submissionInput, suggestRequest, taskRequest });
export const { concepts, computations } = applicationConceptSet;
