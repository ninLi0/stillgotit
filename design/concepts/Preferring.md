# Preferring

## Purpose

Remember which offered option each person chose for one setting, on the server, so the choice follows them to every device and no request has to carry it.

## Principle

An application offers three options for how its tutor answers: Quick, Balanced, and Thorough. Maya has chosen nothing, so Preferring returns no choice for her, and the application uses its own default, Balanced. On her laptop she chooses Thorough. That evening she signs in on her phone, and Preferring returns Thorough for her there too. Sam still has no choice; Maya's choice is hers alone. The reply to Maya's choice was lost, so her laptop sends Thorough again, and nothing changes. Later Maya chooses Quick, and from then on Preferring returns Quick on both devices. Finally she clears her choice. Preferring again returns no choice for her, and the application's default applies. Clearing a second time changes nothing.

## Types

```types
external User
  The person whose choice is remembered.
external Option
  A choice the application offered and validated. Preferring stores and returns it unchanged and never interprets it.
```

## State

```state
a set of Users with
  an Option

Rule: a user is in Users exactly when they have a remembered choice, and each user has one option at a time.
Rule: Preferring does not know which options are offered. The application validates an option before calling set, and validates a remembered option again before using it, because the offer can change after a choice is saved.
Rule: Preferring trusts the user it is given. The application supplies the signed-in user, never a user named in a request.
Rule: set and clear each make one write keyed by the user, so concurrent calls for the same user leave the result of whichever write came last. A remembered choice never expires; it lasts until its user changes or clears it.
```

## Actions

```actions
set(user: User, option: Option) : returns ()
  where true
  then
    make option the user's choice, adding the user to Users or replacing their earlier option
    returns

clear(user: User) : returns ()
  where user is not in Users
  then
    returns
  where user is in Users
  then
    remove user from Users
    returns
```

## Queries

```queries
_choice(user: User) : optional (option: Option)
  answers the user's remembered option
  answers no row when the user has no remembered choice
```
