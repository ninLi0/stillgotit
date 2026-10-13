# Federating

## Purpose

Let people sign in with an account they already have on another site, and come back to the same account each time.

*Prevents:* someone opens a link that finishes a sign-in another person started, and ends up in that person's account; someone reads a code meant for another person, such as from their browser's history, and signs in as them; a person's details change on the other site, and they get a second account; someone links another person's account on the other site to an account they control.

## Principle

Sam starts a sign-in, approves the app on the other site, and his browser finishes the attempt it started. The other site confirms that the code belongs to its user `u7f3`, whose username is `sam`. The app registers `sam`, and his account `u7f3` is linked to that user. After he changes his username on the other site, Sam signs in again, and Federating returns the same user. Leo sends Sam a link that finishes a sign-in Leo started; Sam's browser never started that attempt, so finishing it is refused with "This sign-in has expired. Start again." Leo reads a code from Sam's browser history and finishes a sign-in of his own with it. The code was issued for the verifier of Sam's attempt, so the other site doesn't confirm it for Leo's, and finishing is refused with "The other site didn't confirm this sign-in. Start again."

## Types

```types
external User
  The account in the app that a sign-in on the other site reaches.
```

## State

```state
a set of Attempts with
  a nonce String
  a verifier String
  an expiresAt DateTime

a set of Confirmed Attempts with
  a subject String
  an optional username String

a set of Links with
  a unique subject String
  a User

Rule: an attempt, its nonce, and its verifier are unguessable. start returns the attempt and its nonce only to its caller, and finish refuses an attempt without its nonce. The verifier is sent only to the other site, with the code.
Rule: Federating may delete an attempt once it has expired.
Rule: an attempt must still be unexpired when finish saves its confirmation and when link saves its link. An earlier check alone is insufficient.
Rule: finish saves the confirmed subject and username together. The username is the value reported at confirmation, not a live profile lookup. Only older stored confirmations may lack a username; _identity returns no row for them, so the sign-in flow must request a fresh attempt.
Rule: _identity checks server time after reading the confirmation. It returns a row only when the time is strictly before expiresAt. The query changes no state, extends no deadline, and does not contact the provider. Later actions must still check their own preconditions.
```

## Actions

```actions
start() : returns (attempt: Attempt, expiresAt: DateTime, address: String)
  where true
  then
    add a new attempt with a fresh nonce and a fresh verifier that expires 10 minutes from now
    set address to the other site's sign-in address, carrying the nonce and a hash of the verifier
    returns attempt, expiresAt, address

finish(attempt: Attempt, nonce: String, code: String) : returns (username: String)
  where attempt is unknown, expired, or already confirmed at the initial check or at the confirmation write, or nonce is not the attempt's nonce
  then
    refuses SIGN_IN_EXPIRED "This sign-in has expired. Start again."
  where the initial checks pass and the other site either refuses the code with the attempt's verifier or does not answer
  then
    refuses SIGN_IN_REFUSED "The other site didn't confirm this sign-in. Start again."
  where the initial checks pass, the other site confirms the code for its user subject with username, and attempt is still known, unexpired, and unconfirmed when saving the confirmation
  then
    add attempt to Confirmed Attempts with subject and username in one write
    returns username

link(attempt: Attempt, user: User) : returns (user: User)
  where attempt is not in Confirmed Attempts
  then
    refuses NOT_CONFIRMED "This sign-in hasn't been confirmed."
  where attempt is in Confirmed Attempts and has expired
  then
    refuses SIGN_IN_EXPIRED "This sign-in has expired. Start again."
  where attempt is confirmed and unexpired, and a link has its subject
  then
    refuses ALREADY_LINKED "This account on the other site is already linked."
  where attempt is in Confirmed Attempts, is still unexpired when saving the link, and no link has its subject
  then
    add a new link with the attempt's subject and user
    returns user
```

## Queries

```queries
_identity(attempt: Attempt) : optional (subject: String, username: String, expiresAt: DateTime)
  Returns only the saved subject, username, and expiry for a known, confirmed attempt with a saved username that is still unexpired after the database read. Returns no row for an unknown, unconfirmed, expired, or older attempt without a username. Works whether or not the subject has a local link. Database errors propagate instead of returning no row.

_user(attempt: Attempt) : optional (user: User)
  Returns the user linked to a confirmed attempt's subject, or no row when the attempt is unconfirmed or its subject is unlinked.

_linkable(attempt: Attempt) : one (linkable: Flag)
  Returns true when the attempt is confirmed, unexpired, and its subject unlinked, and false otherwise.
```
