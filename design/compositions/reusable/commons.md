# Signing in with Commons

The implemented [onboarding stage](../../stages/onboarding.md) connects Commons, registration, and local sessions. It uses the endpoint-chain format from ConceptBox. The host handles cookies, recovery-key storage, and checks after slow work. Concept methods do not call each other.

## Start and confirm

[StartCommons](reaction:reusable.commons.starting.StartCommons) calls `CommonsFederating.start`. The server puts the returned attempt in an HttpOnly cookie. The attempt lasts ten minutes. The browser goes to Commons with a nonce and verifier hash. The verifier stays on the server.

Commons returns to `/auth/commons/callback` with a one-time code and state. The page removes these from its address before posting to [FinishCommons](reaction:reusable.commons.finishing.FinishCommons). That endpoint calls `finish`, which checks the cookie's attempt and nonce, redeems the code, and saves the verified subject and username together. It checks expiry again when saving confirmation. The response supplies the suggested username. It does not create a session yet.

```endpoints
reusable.commons.starting.StartCommons at /auth/commons/start
reusable.commons.finishing.FinishCommons at /auth/commons/finish
```

## Resume the confirmed sign-in

The page calls [ResumeCommons](reaction:reusable.commons.finishing.ResumeCommons). The host reads `_identity` using the cookie's attempt. No usable confirmation means a fresh sign-in is required. A database error remains an error. `_user` alone is not proof because it does not check expiry.

If no link exists, the host gets the saved recovery key for the configured provider and verified subject. It waits for `getOrCreate` to complete, then checks expiry. This is a host write, never a query or a `where` condition. The browser's submitted key and suggested username are ignored.

The continuation endpoint rechecks `_identity` and selects one branch:

| State | Actions |
| --- | --- |
| Commons already has a local link | Start a session for that linked user. |
| No link, but the recovery key has an account | Link that saved user, then start a session. |
| Neither link nor account exists | Register with the saved key, link the returned user, then start a session. |
| Confirmation is absent or expired | Return `SIGN_IN_EXPIRED`. |

A name conflict leaves the attempt cookie in place. The student sends [ChooseUsername](reaction:reusable.commons.finishing.ChooseUsername) with another name. It uses the same flow and key. If the key already has an account, that account and its username win. Matching a username alone never establishes ownership.

The host checks the deadline after the continuation returns and before delivering cookies. If a session was created too late, it withholds the cookie and tries to end that session. On success, the HTTP adapter sets the session cookie and clears the attempt cookie.

```endpoints
reusable.commons.finishing.ResumeCommons at /auth/commons/resume
reusable.commons.finishing.ChooseUsername at /auth/commons/choose
```

## Recovery and limits

The engine does not undo registration if linking fails. A retry reads the same recovery key and saved user. It does not create another account. A competing registration or link permits one reread and retry of the continuation. The saved link is authoritative and is never replaced by a requested username.

If confirmation was saved but its reply was lost, resume reads that saved identity. If the provider consumed the code but confirmation was not saved, the student must start a fresh sign-in. The code is never automatically redeemed twice.

An expired attempt cannot authorize a session. A saved recovery key is not a login credential. Sessions themselves are not exactly-once: a lost reply can leave an undisclosed token until cleanup or expiry. Withdrawing access on Commons does not revoke an existing local session.

## HTTP boundary

- Prefix endpoint paths with `/api`. Keep the browser callback at `/auth/commons/callback`.
- Read attempts and sessions from HttpOnly cookies. Do not accept a local user ID from the browser.
- Require the configured origin for state-changing requests. Validate inputs and results and limit request bodies.
- Serve pages with `Referrer-Policy: no-referrer`. Keep codes, verifiers, recovery keys, and sessions out of logs.
- Treat username conflicts as a name-choice step. Treat failed or expired confirmation as a fresh-sign-in step.
- A successful confirmation keeps the attempt cookie. Only successful continuation exchanges it for a session cookie.

The connected HTTP tests use real MongoDB and a provider fixture. Real Commons sign-in, course creation, restart persistence, sign-out, and returning sign-in have also been checked through the Vue page.
