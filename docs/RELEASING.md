# Build and releases

## The rule

The version number has a single source of truth: [`VERSION.md`](../VERSION.md).
`package.json` only repeats it, because electron-builder uses it to name the artifacts.
`npm run version:check` in CI guards that the two agree.

Merging a `develop` to `master` pull request triggers the
[Release](../.github/workflows/release.yml) workflow, which:

1. checks that `VERSION.md` and `package.json` carry the same number (a mismatch stops the
   release before anything is built)
2. reads the version from `VERSION.md` and checks whether the tag `v<version>` already exists
3. **if it does, finishes without publishing** (merging a documentation fix breaks nothing)
4. if it does not, builds the installers, creates the tag and the GitHub Release with the
   text from `CHANGELOG.md` (the tests are not repeated here: the same tree ran through CI
   on the pull request)

The practical consequence: **a release is a version bump in `VERSION.md` in a pull request
to master.**

## Release procedure

```bash
git switch develop
git pull
```

1. Bump the number in `VERSION.md` (semver: patch / minor / major).
2. Copy it into `package.json`:

```bash
npm run version:sync
```

3. Describe the changes in `CHANGELOG.md` under a `## [<version>] - YYYY-MM-DD` heading
   (the `Unreleased` section is left empty).
4. Check locally what CI will check:

```bash
npm run verify
```

5. Commit and push:

```bash
git add VERSION.md package.json CHANGELOG.md
git commit -m "release 1.1.0"
git push
```

Then a `develop` to `master` pull request, review, merge. The rest happens on its own.

After the merge:

- the workflow creates the tag `v<version>` and a release with the artifacts
- the release body is the `## [<version>]` section from `CHANGELOG.md` plus the standing
  disclaimer (unofficial project, cosmetic change only, modification at your own risk)
- installed copies find the release on their next update check. The app asks this
  repository's releases through the GitHub API without a token, so that works only while the
  repository is public

The number from `VERSION.md` also goes into the app bar (next to the name) and into the
window title. The file is bundled into the package, so an installed app shows exactly what
was in the repo at build time.

When the same number has to be released again (for example when an artifact failed to
build), use `workflow_dispatch` with the **force** option, which overwrites the tag and
the release.

If the `release` job itself fails (for example `CHANGELOG.md` has no `## [<version>]`
section for `changelog-section.js`), re-run it **the same day**. The installers travel from
the Windows `build` job to `release` as a run artifact kept for one day only, so a later
*Re-run failed jobs* finds nothing to download and the whole workflow has to be repeated,
including the paid ~30-minute Windows build.

## Tags and file names are part of the contract

```
v<version>
tibia-sounds-config-<version>-win-x64-setup.exe
tibia-sounds-config-<version>-win-x64-portable.exe
tibia-sounds-config-<version>-win-x64.zip
```

Releases are published only in this repository. The updater inside the app reads them,
accepts only tags of the form `v<version>` and builds the expected installer name from the
version. A release tagged differently or an artifact renamed therefore blinds every
already-installed copy, which would then have to be updated by hand once. Treat these names
as fixed.

## Artifacts

| file | what it is |
|---|---|
| `tibia-sounds-config-<version>-win-x64-setup.exe` | NSIS installer, per-user, with a directory picker |
| `tibia-sounds-config-<version>-win-x64-portable.exe` | portable build, no installation |
| `*.blockmap`, `latest.yml` | electron-builder metadata |

Configuration: [`electron-builder.yml`](../electron-builder.yml). Only `electron/`,
`renderer/`, `data/` and `package.json` go into the package. `tests/`, `tools/`, `docs/`,
`testclient/` and `vault/` stay out of the installer.

## Adding another platform

`electron-builder.yml` already has `linux` (AppImage + deb) and `mac` (dmg) sections ready.
To enable one, uncomment the matching entry in the `build` matrix in
[`release.yml`](../.github/workflows/release.yml):

```yaml
- os: ubuntu-latest
  name: linux
  builder: --linux
  artifacts: |
    dist/*.AppImage
    dist/*.deb
```

All artifacts land in a single release (`download-artifact` with `merge-multiple: true`),
so nothing else needs to change.

A note about macOS: without an Apple Developer certificate the builds will be neither
signed nor notarized, so Gatekeeper will warn on first launch.

## Local build

```bash
npm run icon      # build/icon.png from tools/make-icon.js
npm run pack      # unpacked app only -> dist/win-unpacked
npm run dist:win  # full installers -> dist/
```

### Known problem on Windows: "Cannot create symbolic link"

`npm run dist:win` can fail while unpacking the `winCodeSign` package:

```
ERROR: Cannot create symbolic link : Klient nie ma wymaganych uprawnien.
  ...winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

(The message is quoted verbatim from a Polish Windows install; it means "the client does not
have the required privileges".)

The package contains symbolic links for macOS, and Windows only allows creating those with
developer mode enabled or with elevated privileges. electron-builder needs that package not
for signing (we do not sign) but for `rcedit`, which writes the icon and metadata into the `.exe`.

To confirm this is the case:

```cmd
mklink test.lnk C:\Windows\win.ini
```

If you see "You do not have sufficient privilege", that is it. Ways out:

1. **Settings, Privacy and security, For developers, Developer Mode** (permanent)
2. one-off: open a terminal as administrator and run `npm run dist:win`, which unpacks the
   package into the cache so later builds work normally
3. `npm run pack` alone (no installer) works without privileges and is enough to check that
   the app assembles and starts

On `windows-latest` in GitHub Actions the problem does not occur, because the runner may
create links. Should it ever appear there, the same workaround (the elevated step) applies.

## Code signing

We do not sign. The installer has no certificate, so SmartScreen shows a
"Windows protected your PC" warning on first launch. That is normal for unsigned applications.

If a certificate were added: `electron-builder` reads `CSC_LINK` (the base64 of a `.pfx`
file) and `CSC_KEY_PASSWORD` from environment variables. The workflow would then have to
pass them from repository secrets and drop `CSC_IDENTITY_AUTO_DISCOVERY: false`.

## Checklist before merging to master

- [ ] `npm run verify` passes locally
- [ ] the version in `package.json` is bumped
- [ ] a pull request touching `electron-builder.yml`, `build/` or the packaging fields of
      `package.json`: run the CI workflow manually first (*Actions, CI, Run workflow*), so
      the `Probny build instalatora` job packages the tree before the merge. No pull request
      runs electron-builder on its own, so without that manual run packaging config reaches
      `master` unexercised and breaks first in the release build
- [ ] `CHANGELOG.md` has a section for this version
- [ ] `npm run pack` assembles, the app from `dist/win-unpacked` starts and loads a client
- [ ] tested against `testclient/`, not against a working installation
- [ ] the repository is public, otherwise installed copies cannot see the release, because the
      update check asks the GitHub API without a token
