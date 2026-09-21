# Working on this project

## Rule number one

**We do not test against a working Tibia installation.** Testing uses the copy in
`testclient/`. The app overwrites files in the client directory, and a mistake on a live
installation means, at best, having to verify the files with the launcher.

```bash
robocopy "%LOCALAPPDATA%\Tibia" "%CD%\testclient" /E /MT:8
```

`testclient/` is in `.gitignore`. Never commit client files. `.gitignore` blocks `*.ogg`,
`*.dat`, `client.exe` and `packages/`, but it is worth checking `git status` before committing.

## Environment

- Node >= 20.11 (CI uses 22)
- `ffmpeg` with the `libvorbis` encoder in `PATH`, or a path in `FFMPEG_PATH`

```bash
npm install
npm start          # the app
npm test           # tests
npm run verify     # icon + tests, the same thing CI runs
```

Tests that depend on ffmpeg skip themselves when it is missing; the rest (bank parser,
descriptors, statuses, paths) works without it.

## Branches and workflow

```
feature/x  --PR-->  develop  --PR-->  master  --automatic-->  GitHub Release
```

- `master`: released code. Every push here starts the release workflow, which publishes
  only when the number in [`VERSION.md`](VERSION.md) has been bumped.
- `develop`: the integration branch, where day-to-day work lands.
- `feature/*`, `fix/*`: working branches, pull requests go to `develop`.

Only a `develop` to `master` pull request runs [CI](.github/workflows/ci.yml): the tests on
Windows. Pushes to `develop` and pull requests aimed at `develop` run nothing, and the trial
installer build is a manual `workflow_dispatch` option. A pull request that touches only
`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/**` or the Markdown files under
`.github/` does not start a run either. `VERSION.md` and `CHANGELOG.md` are deliberately
kept off that list even though they are Markdown: they are the release gate, so a release
pull request, which often changes nothing else, still runs the tests. The Actions minutes
on this account are capped, so CI pays only for the merge into `master`.

## Conventions

- **Code and comments are written in Polish without diacritics.** This is deliberate and
  consistent with the rest of the repo: no encoding trouble in a Windows console. The same
  goes for user-facing strings in the renderer, because the application ships with a Polish
  interface. Documentation is in English.
- Commit messages in the imperative: `dodaj filtr statusu`, `napraw detekcje ffmpeg`.
- No runtime dependencies. Everything the app does while running must rest on built-in Node
  and Electron modules. `devDependencies` are fine.
- A new feature means a test. Logic without files (statuses, parsers) gets a unit test;
  operations on files get a test against a fixture from `tools/make-fixture.js`.

## Where things are

Module split and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Sound bank format: [docs/SOUND_FORMAT.md](docs/SOUND_FORMAT.md).
How to test: [docs/TESTING.md](docs/TESTING.md).
How to release: [docs/RELEASING.md](docs/RELEASING.md).

## Boundaries we do not cross

The app writes only to:

- `<client>/packages/Tibia/sounds/sound-<sha256>.ogg`, where the name is validated with a
  pattern, so there is no way out of the directory
- its own vault (`vault/` in development, `userData/vault` in the packaged app)

We never touch `assets.json`, the client's `package.json`, `.dat` files or binaries.
If a change requires stepping outside those boundaries, that is a topic for an issue,
not for a pull request.
