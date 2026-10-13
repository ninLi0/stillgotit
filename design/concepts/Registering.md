# Registering

## Purpose

Let people choose a username that others can find them by.

*Prevents:* two people end up with the same username; a retry creates a second account or cannot return the account already created.

The server supplies the key and reuses it for the same registration. It must preserve that association before calling register. Registering does not verify a Commons identity or authorize a browser request. The sign-in flow must do both before using a recovered account. Older accounts cannot be claimed by matching their username.

## Principle

Maya registers the username `maya` with recovery key `R1`. The response is lost. She retries with the same username and key and receives the same user. When Sam types `maya`, Registering returns Maya's user, and her username appears beside the files she shares with him. Ben tries to register `maya` with a different key and is refused with "That username is taken.", so he registers `ben` with that key. Reusing `R1` with another username is refused and leaves Maya's account unchanged.

## Types

```types
```

## State

```state
a set of Users with
  a unique username String
  an optional recoveryKey String

Rule: every saved recovery key is nonblank and belongs to at most one user. register always saves a key. Only accounts stored before recovery keys were introduced may lack one.
Rule: usernames and recovery keys are compared exactly, including case. Validation does not trim or change either value.
Rule: a refusal changes no state. A successful retry returns the saved user without changing the record. The username and recovery key are saved together when creating a user.
```

## Actions

```actions
register(username: String, recoveryKey: String) : returns (user: User)
  where username is not 3 to 32 ASCII letters, digits, underscores, or hyphens
  then
    refuses INVALID_USERNAME "A username must have 3 to 32 letters, digits, underscores, or hyphens."
  where username is accepted and recoveryKey is blank (empty or only whitespace)
  then
    refuses INVALID_RECOVERY_KEY "Provide a nonblank recovery key."
  where both inputs are accepted and a user has recoveryKey with a different username
  then
    refuses RECOVERY_KEY_CONFLICT "This recovery key already belongs to a different username."
  where both inputs are accepted and a user has recoveryKey with username
  then
    returns user
  where both inputs are accepted, no user has recoveryKey, and some user has username
  then
    refuses USERNAME_TAKEN "That username is taken."
  where both inputs are accepted and recoveryKey and username are both unused
  then
    add a new user with username and recoveryKey
    returns user
```

## Queries

```queries
_byUsername(username: String) : optional (user: User)
  Returns the user with exactly this username, or no row when nobody has it.

_username(user: User) : optional (username: String)
  Returns the user's username, or no row for an unknown user.

_byRecoveryKey(recoveryKey: String) : optional (user: User)
  Returns the user with exactly this recovery key, or no row for an unknown or blank key.
```
