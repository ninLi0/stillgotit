# SkillMapping implementation stage

This earlier stage registers SkillMapping alone. The current configuration uses [Commons identity](commons-federating.md). This file preserves the earlier bindings for reference. It has no public endpoints or application reactions.

```types
concrete LearnerId
  A learner identity supplied by a local caller. Commons authentication is not connected yet.
concrete MaterialReference
  An external source identity supplied by a local caller. Demo references are placeholders, not imported files.
```

```instances
instantiate SkillMapping with
  User is LearnerId
  Material is MaterialReference
```

The full application bindings remain in [types.md](../types.md). When GroundedTutoring is registered, bind SkillMapping's Material to GroundedTutoring.Material. Add the matching application documents as their code is implemented.

SkillMapping checks ownership inside its actions. Its queries remain internal. This stage does not establish a signed-in identity or check source access.
