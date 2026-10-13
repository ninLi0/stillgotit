# Sessioning

## Purpose

Let people stay signed in across requests without sending their password each time.

*Prevents:* someone keeps using a session after signing out; someone who finds a session left open on a shared computer, or copies one, keeps using it indefinitely; someone who comes back after a few days has to sign in again.

## Principle

After Maya proves who she is, a session is started for her. Each time she sends a request with the session, Sessioning returns her as the person it belongs to and records when she last used it. When she signs out, the session ends, and any later request that carries it is refused. She forgets to sign out on a library computer; nobody uses that session for a week, and then it is refused. She uses the session on her own laptop every day, but three months after it started, that one is refused too, and she signs in again.

## Types

```types
external Subject
  The person a session belongs to.
```

## State

```state
a set of Sessions with
  a Subject
  a lastUsed DateTime
  an expiresAt DateTime

Rule: a session's identity is unguessable, and it is all a person sends to use the session.
Rule: Sessioning may delete a session at any time once it can no longer be used.
```

## Actions

```actions
start(subject: Subject) : returns (session: Session, expiresAt: DateTime)
  where true
  then
    add a new session for subject, last used now, that expires 90 days from now
    returns session, expiresAt

use(session: Session) : returns (subject: Subject)
  where session is unknown, has not been used for 7 days, or has expired
  then
    refuses NOT_SIGNED_IN "Your session has ended. Sign in again."
  where session was used within the last 7 days and has not expired
  then
    set the session's lastUsed to now
    returns subject

end(session: Session) : returns (session: Session)
  where session is unknown, has not been used for 7 days, or has expired
  then
    refuses NOT_SIGNED_IN "Your session has ended. Sign in again."
  where session was used within the last 7 days and has not expired
  then
    remove session
    returns session
```

## Queries

```queries
```
