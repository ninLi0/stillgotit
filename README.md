# StillGotIt

StillGotIt helps college students learn the skills in a course and keep them after the course moves on. A learner brings their own course materials, and the app turns them into a tree of skills. An AI tutor teaches and checks each skill from those materials, the app estimates how well the learner knows each skill, and it plans short reviews before the learner is likely to forget.

## Start here

- **Use the app:** https://stillgotit.mit-sdg.dev, with a 6.1040 Commons account. A short [video](https://youtu.be/MH_9Ws4fWmI) walks through the main journey.
- **See how it is designed:** the [design index](design/README.md) links every concept specification to its code, the [compositions](design/compositions/) that connect the concepts, and the pages on the host, the runtime and the visual design.
- **See how the design changed:** the [design document](docs/design-document.md), with links to the commits.
- **Run, check and test it:** the next three sections.
- **Milestone pages:** the last section, kept for the record.

## Run locally

You need [Bun](https://bun.sh) 1.4.2, [Docker](https://www.docker.com/) for MongoDB 8.0, a 6.1040 Commons account to sign in, and a Gemini API key from [Google AI Studio](https://aistudio.google.com/api-keys) for the tutor. Without a key the app runs with its AI features off and says so.

1. Copy `.env.example` to `.env` and put your key after `GEMINI_API_KEY=`. The other values already suit a local run, and Git ignores the file.
2. Install the locked packages and start MongoDB:

   ```sh
   bun install --frozen-lockfile
   bun run db:up
   ```

   MongoDB runs in Docker at `127.0.0.1:27017`, as a single server without transactions, like the class platform. `bun run db:stop` stops it and keeps the data.
3. Build the interface and start the server:

   ```sh
   bun run preview
   ```

   Open **http://127.0.0.1:3000** and sign in with Commons.

For development with reloading, run `bun run dev:server` and `bun run dev:frontend` in two terminals and open **http://localhost:5173**. Uploaded files are kept in `.data/files` unless the S3 variables are set.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | The app's database; the database name is part of the address. |
| `MONGODB_TEST_URI` | The server the tests use. Default: the local Docker server. |
| `PUBLIC_ORIGIN` | The address people open; the server accepts changes only from it. The run scripts set it. |
| `COMMONS_ORIGIN` | The Commons sign-in server. Default: `https://class.mit-sdg.dev`. |
| `GEMINI_API_KEY` | The key for the AI tutor. |
| `GEMINI_MODEL` | The tutor model for learners who have not chosen one. Default: `gemini-4-argon`. |
| `GEMINI_TRANSCRIBE_MODEL` | The model that transcribes recordings. Default: `GEMINI_MODEL`. |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible storage for uploaded files; all three or none. `S3_ENDPOINT`, `S3_REGION` and `S3_SESSION_TOKEN` are optional extras. |

The class platform sets `HOST`, `PORT` and `NODE_ENV` itself.

## Check and test

MongoDB must be running. The tests replace Gemini with fixed answers, so they need no key.

```sh
bun run generate
bun run check
bun test --timeout 15000
bun run build
bunx --no-install sync-engine check-design design/concepts/*.md design/compositions/*.md design/stages/materials.md
```

- `bun run generate` rewrites `generated/stillgotit.md` and `generated/wire.ts` from the code. Run it after changing a concept, an endpoint or a reaction; `bun run check` fails while they are stale.
- `bun run check` compares each concept's code with its specification, confirms the generated files are current, and type-checks the server and the interface. It reports 15 concepts, because Preferring is used three times, and 95 advisories, explained in the [diagnostic review](design/advisory-review.md).
- `bun test --timeout 15000` runs 1,331 tests in 113 files in four to five minutes. Each file uses its own database and drops it; `bun run db:clean` drops the leftovers of interrupted runs.
- `bun run build` builds the interface into `frontend/dist`.
- The last command checks the form of the specifications, the compositions and the application stage. Check the other files in `design/stages/` one at a time, since together they report duplicate bindings.

To try the interface without a Commons account or a key:

```sh
bun run build
ALLOW_UI_FIXTURES=1 bun tests/fixtures/browser-app.ts
```

Open **http://127.0.0.1:5174**. The fixture serves the built app with canned tutor answers and a stand-in Commons that signs you in as `ui_tester`, says so in a banner, and drops its database when stopped. `STILLGOTIT_LIVE_AI=1` makes it use the real key from `.env`.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/concepts/` | One folder per concept: its TypeScript class and its registry. |
| `src/compositions/`, `src/computations/` | The endpoints, reactions, views and formers that connect the concepts, and the pure computations they use. |
| `src/main.ts`, `src/host/`, `src/storage/` | The Bun server: HTTP and admission, the learner locks, Gemini, file storage, imports and transcription. See [design/host.md](design/host.md). |
| `frontend/` | The Vue 3 interface. |
| `design/` | The specifications and design notes; start at [design/README.md](design/README.md). |
| `generated/`, `generated.config.ts` | The read-back and HTTP contract that `bun run generate` writes, and the application they are generated from. |
| `tests/` | Concept, HTTP and scenario tests; `tests/fixtures/` holds the browser fixture. |
| `scripts/` | The MongoDB start-up check, the P2 demonstrations (`demo:*` in `package.json`), and `seed-in-page.js` with [its instructions](scripts/seed-in-page.md). |
| `docs/` | The design document, the milestone pages, and earlier records in `docs/history/`. |
| `reference_docs/` | Copies of the course's [background readings, rubrics and project directions](reference_docs/README.md). |
| `THIRD_PARTY_NOTICES.md`, `licenses/` | Attribution and licenses for reused code. |

## Course milestones

The pages written for each 6.1040 milestone, kept for the record rather than as the way in:

- [P5, user testing](docs/P5.md): the task list, the study reports and the flaws found, with the [session kit](docs/P5-session-kit.md) and the [changes made between P4 and the sessions](docs/changes-since-P4.md).
- [P4, code complete](docs/P4.md): what changed since P3, the tests of the deployed app and the known limits.
- [P3, the beta](docs/P3.md) and [P2, the alpha](docs/P2.md).
- [P1, the design submission](docs/history/p1-design.md) and its [concept design](design/p1-concepts.md).
- The [design notebook](https://github.com/ninLi0/6.1040/blob/main/design-notebook.md), the running record of decisions from E1 on, in the course repository.
