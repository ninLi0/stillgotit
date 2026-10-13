# Account sessions implementation stage

This earlier stage registers Registering, Sessioning, and SkillMapping. The current configuration uses [Commons identity](commons-federating.md). This file preserves the earlier bindings for reference. It has no public endpoints or application reactions. Registering creates local user identities. Sessioning stores sessions for those identities.

```types
concrete MaterialReference
  An external source identity supplied by a local caller. Demo references are placeholders, not imported files.
```

```instances
instantiate Registering

instantiate Sessioning with
  Subject is Registering.User

instantiate SkillMapping with
  User is Registering.User
  Material is MaterialReference
```

The full application bindings remain in [types.md](../types.md). `Sessioning.start` trusts the supplied subject. Binding Subject to Registering.User does not verify who is making a request. CommonsFederating and the sign-in composition must establish that identity before starting a session. The HTTP host will read, set, and clear cookies.

Engine tests call the registered actions with a real local user ID. They check session use, expiry, logout, persistence across database clients, refusal results, and database errors. These tests do not prove live Commons sign-in.

When GroundedTutoring is registered, bind SkillMapping's Material to GroundedTutoring.Material. Add application documents to the checked stage as their code is implemented.
