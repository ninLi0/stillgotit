# StillGotIt

StillGotIt helps college students learn the skills in a course and keep them after the course moves on. A learner brings their own course materials, and the app turns them into a tree of skills. An AI tutor teaches and checks each skill from those materials, the app estimates how well the learner knows each skill, and it plans short reviews before the learner is likely to forget.

## Links

- **The deployed app:** https://stillgotit.mit-sdg.dev. Sign in with a 6.1040 Commons account.
- **Demo video:** [a narrated walk through the main journey](PASTE_VIDEO_URL)
- **P4 status:** [docs/P4.md](docs/P4.md) covers what changed since P3, how the work was checked, the tests of the deployed app, how to prepare a user test, and the known limits.
- **Design document:** [docs/design-document.md](docs/design-document.md) summarizes how the final design differs from the P1 concept design and the P3 visual design, with links to the commits.
- **Earlier status pages:** [P3, the beta](docs/P3.md), and [P2, the alpha](docs/P2.md).
- **Design:** the [design index](design/README.md) lists every design document and links each concept to its code. The main parts are:
  - the [concept specifications](design/concepts/), one file per concept;
  - the [compositions](design/compositions/), which describe the endpoints, reactions, views, and formers that connect the concepts;
  - the [host](design/host.md), which names each part of the server that works outside the concepts;
  - the [runtime responsibilities](design/runtime.md): where the app runs, accounts and requests, writes without transactions, the AI tutor, and file import;
  - the [visual design study](design/visual-design.md), which covers the Pixel Nature look.
- **The P1 design:** the [design submission](docs/history/p1-design.md) and its [concept design](design/p1-concepts.md).

## Run locally

You need:

- [Bun](https://bun.sh) 1.4.2, the version that `package.json` names.
- [Docker](https://www.docker.com/), which runs MongoDB 8.0 for the app and for the tests.
- A 6.1040 Commons account, to sign in.
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/api-keys), for the AI tutor. Without a key, the app still runs, but its AI features are turned off and say why, and recordings cannot be imported.

From a fresh clone:

1. Copy `.env.example` to `.env`, and put your key after `GEMINI_API_KEY=`. Bun reads `.env` by itself, and Git ignores it. The other values in `.env.example` already suit a local run.
2. Install the exact package versions in `bun.lock`, and start MongoDB:

   ```sh
   bun install --frozen-lockfile
   bun run db:up
   ```

   `bun run db:up` starts MongoDB in Docker at `127.0.0.1:27017` and waits until it answers. Like the class platform, it runs as a single server without transactions. Its data stays in a Docker volume, and `bun run db:stop` stops it without deleting the data.
3. Build the interface and start the server:

   ```sh
   bun run preview
   ```

   This starts MongoDB if it is not running, builds the Vue interface into `frontend/dist`, and starts the server in production mode on port 3000. Open **http://127.0.0.1:3000** and sign in with Commons.

For development with automatic reloading, run `bun run dev:server` and `bun run dev:frontend` in two terminals, then open **http://localhost:5173**. The first restarts the server when a file changes, and the second serves the interface through Vite.

Uploaded files are kept in `.data/files`, which Git ignores, unless the S3 variables below are set.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | The app's database. The database name is part of the address. |
| `MONGODB_TEST_URI` | The MongoDB server the tests use. Without it, the tests use the local Docker server. |
| `PUBLIC_ORIGIN` | The address people open. The server accepts changes only from this origin. `bun run preview` and `bun run dev:server` set it themselves. |
| `COMMONS_ORIGIN` | Optional. The Commons sign-in server. The default is `https://class.mit-sdg.dev`. |
| `GEMINI_API_KEY` | The key for the AI tutor, as described above. |
| `GEMINI_MODEL` | Optional. The tutor model for learners who have not chosen one. The default is `gemini-3.8-flash`. The server stops at startup if this names a model that the tutor catalog does not offer. |
| `GEMINI_TRANSCRIBE_MODEL` | Optional. The model that transcribes imported recordings and videos. Without it, the app uses `GEMINI_MODEL`. |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Optional. S3-compatible storage for uploaded files. If any S3 variable is set, these three are required. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_SESSION_TOKEN` | Optional. Further S3 settings. |

The class platform sets `HOST`, `PORT`, and `NODE_ENV` itself.

## Check and test

MongoDB must be running (`bun run db:up`). The tests replace Gemini with fixed answers, so they need no key.

```sh
bun run generate
bun run check
bun test --timeout 15000
bun run build
bunx --no-install sync-engine check-design design/concepts/*.md design/compositions/*.md design/stages/materials.md
```

- `bun run generate` rewrites the generated read-back of the design, `generated/stillgotit.md`, and the typed HTTP contract, `generated/wire.ts`, from the code. Run it after changing a concept, an endpoint, or a reaction, because `bun run check` fails while these files are out of date.
- `bun run check` compares each concept's code with its specification, confirms that the generated files are current, and type-checks the server and the interface. It reports 13 concepts because the app uses Preferring twice. It also reports 83 advisories, and the [diagnostic review](design/advisory-review.md) explains their two kinds.
- `bun test --timeout 15000`, which `bun run test` also runs, runs 1,078 tests in 95 files in about three minutes on an idle machine. Each test file creates its own database, named `stillgotit_test_<id>`, and drops it when it finishes, so the tests never touch the app's data. A run that is interrupted leaves its database behind; when many pile up, the local MongoDB container runs out of open files and every suite fails, so run `bun run db:clean` to drop the leftovers (`bun scripts/drop-test-databases.ts --list` only counts them).
- `bun run build` builds the interface into `frontend/dist`.
- The last command checks the form of the concept specifications, the compositions, and the application stage. The other files in `design/stages/` are earlier stages that bind the same types as `materials.md`, so check each of them on its own; checked together, they report duplicate bindings.

To try the interface without a Commons account or a Gemini key, build it and start the browser fixture:

```sh
bun run build
ALLOW_UI_FIXTURES=1 bun tests/fixtures/browser-app.ts
```

Then open **http://127.0.0.1:5174**. The fixture serves the built app with canned tutor answers and a stand-in Commons that signs you in as `ui_tester`. A banner at the top of every page says so. It keeps its data in a separate database and drops that database when you stop it with Ctrl+C. With `STILLGOTIT_LIVE_AI=1` added, it uses the real Gemini key from `.env` instead of the canned answers.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/concepts/` | One folder per concept, with its TypeScript class and its registry. SkillMapping's class and registry are the two files directly in this folder. |
| `src/compositions/` | The endpoints, reactions, views, and formers that connect the concepts. |
| `src/computations/` | Pure computations that the compositions use, such as the review planner. |
| `src/main.ts`, `src/host/`, `src/storage/` | The Bun server: HTTP and admission, the learner locks, Gemini, file storage, the import store, and the transcription worker. [design/host.md](design/host.md) describes each part. |
| `frontend/` | The Vue 3 interface. The bundled fonts are in `frontend/public/fonts`. |
| `design/` | The specifications and design notes. Start at [design/README.md](design/README.md). |
| `generated/` | The read-back and the HTTP contract that `bun run generate` writes. They are not edited by hand. |
| `generated.config.ts` | The application that the checks and `bun run generate` assemble. |
| `tests/` | Concept, HTTP, and scenario tests. `tests/fixtures/` holds the browser fixture and test files, and `tests/output/` holds the saved P3 test run. |
| `scripts/` | The MongoDB start-up check and the SkillMapping demonstrations from P2, listed as `demo:*` in `package.json`. |
| `docs/` | The design document, the status pages for P2 to P4, the tree-drawing research from P1, and the P1 sketches in `docs/images/`. |
| `docs/history/` | Earlier records kept for reference: the P1 design submission, the P1 concept design, and the [implementation steps](docs/history/implementation-steps.md) that the README listed until P4. |
| `reference_docs/` | Copies of the course pages: [background readings, rubrics, and project directions](reference_docs/README.md). |
| `compose.yaml` | The MongoDB server that `bun run db:up` starts. |
| `THIRD_PARTY_NOTICES.md`, `licenses/` | Attribution and licenses for reused code. |
