# Account registration implementation stage

This earlier stage registers Registering and SkillMapping. The current configuration uses [Commons identity](commons-federating.md). This file preserves the earlier bindings for reference. It has no public endpoints or application reactions. Registering creates local user identities; it does not establish who is signed in.

```types
concrete MaterialReference
  An external source identity supplied by a local caller. Demo references are placeholders, not imported files.
```

```instances
instantiate Registering

instantiate SkillMapping with
  User is Registering.User
  Material is MaterialReference
```

The full application bindings remain in [types.md](../types.md). Sessioning and CommonsFederating are not selected in this earlier stage. The future sign-in endpoints will supply the authenticated user. Local demos can still call SkillMapping with their fixed test identities; these calls do not prove authentication.

When GroundedTutoring is registered, bind SkillMapping's Material to GroundedTutoring.Material. Add application documents to the checked stage as their code is implemented.
