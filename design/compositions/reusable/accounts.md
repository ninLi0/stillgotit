# Accounts

Every new user is created by `Registering.register`, which stores a unique username and a server-supplied recovery key. A matching retry returns the same user. `Sessioning.use` returns a session's user on each request. Neither concept refers to the other. The [Commons sign-in composition](commons.md) registers or looks up a user, then calls `Sessioning.start`. A recovery key alone does not authorize a session. Password sign-in is outside the P2 scope. These endpoints are implemented in the [onboarding stage](../../stages/onboarding.md).

The [me endpoint](reaction:reusable.accounts.identifying.Me) passes the session to `Sessioning.use`, which returns the user, then responds with the user's username from `Registering._username`. A missing local account returns `NOT_SIGNED_IN`. Every endpoint that requires a session starts the same way: `Sessioning.use` returns the session's user, or the request is refused with `NOT_SIGNED_IN`. Each endpoint reads the user from the session, never from the request's inputs. Each way of signing in responds with the user, and the page then calls the me endpoint for the username.

```endpoints
reusable.accounts.identifying.Me at /auth/me
```

The [sign-out endpoint](reaction:reusable.accounts.leaving.SignOut) ends the session with Sessioning, and the HTTP server clears the cookie. If the person is also signed in on another computer, they stay signed in there.

```endpoints
reusable.accounts.leaving.SignOut at /auth/logout
```
