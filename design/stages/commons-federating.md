# Commons identity implementation stage

This stage registers Registering, CommonsFederating, Sessioning, and SkillMapping. It has no public endpoints or application reactions. CommonsFederating verifies external identities and links them to Registering's local users. Sessioning and SkillMapping use those same local users.

```types
concrete MaterialReference
  An external source identity supplied by a local caller. Demo references are placeholders, not imported files.
```

```instances
instantiate Registering

instantiate Federating as CommonsFederating with
  User is Registering.User

instantiate Sessioning with
  Subject is Registering.User

instantiate SkillMapping with
  User is Registering.User
  Material is MaterialReference
```

The full application bindings remain in [types.md](../types.md). Startup supplies CommonsProvider. Checks and engine tests use MemoryProvider so they do not contact Commons. Engine tests call `start`, `finish`, `link`, `_identity`, `_user`, and `_linkable` through the registered concept. `_identity` returns the saved Commons subject and username only while the attempt remains unexpired after the database read. Tests also pass the linked local user to Sessioning and SkillMapping.

These calls are explicit test steps. Registering accepts a required recovery key and returns the same user for a matching retry. The Commons engine tests still supply fixture keys. Separate RegistrationRecoveryStore tests check the key saved for each provider and subject pair and use its result in explicit Registering calls. The store is host storage infrastructure and adds no concept to this stage. The sign-in composition must still connect confirmation, key retrieval, registration, linking, and session creation, including recovery from a failed link. The HTTP host must keep the attempt in the initiating browser's cookie and supply the verified local user. A type binding or a recovery key alone does not authenticate a request. Browser cookies and live Commons sign-in remain untested.

When GroundedTutoring is registered, bind SkillMapping's Material to GroundedTutoring.Material. Add application documents to the checked stage as their code is implemented.
