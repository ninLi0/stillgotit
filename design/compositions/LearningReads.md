# Shared learning reads

[OwnedSkill](view:Reads.OwnedSkill) joins a skill through its unit to the learner's course. [ActiveSkill](view:Reads.ActiveSkill) also requires confirmation. [OwnedSession](view:Reads.OwnedSession) checks both session ownership and access to its skill. [OpenSession](view:Reads.OpenSession) excludes closed sessions and any task with submitted assessment work. [OwnedCase](view:Reads.OwnedCase) joins an assessment to its author and course.

[SkillContext](view:Reads.SkillContext) supplies the current definition, course map, owned materials, and learner progress. Each concept query reads only its own records. Application computations combine the returned values without database calls.

[SkillData](former:Reads.SkillData) presents current requirements, the matching mastery track, saved sessions, original work, and judgment history. [SessionData](former:Reads.SessionData) presents a saved tutoring session. [Progress](former:Reads.Progress) builds the tree's estimate list. [PlanData](former:Reads.PlanData) presents preferences, today's budget, the next activity, and the active plan.

[PlanContext](view:Reads.PlanContext) computes candidate reviews, exam preparation, and a context fingerprint from the course map, learner progress, and planning schedule, which includes the course's active exams. [CanReplan](view:Reads.CanReplan) requires course ownership, saved preferences, and no activity in progress. [NeedsEvidence](view:Reads.NeedsEvidence) requires an effective judgment, a matching mastery track, and an absent or older contribution. Reading it has no side effects.
