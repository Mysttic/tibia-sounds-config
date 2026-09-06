# Tests

```bash
npm test           # the whole suite
npm run test:watch # in a loop, while working on a module
npm run verify     # icon + tests, the same thing CI runs
```

We use the built-in `node --test`. No frameworks, no configuration.

## Layout

| file | what it checks | ffmpeg |
|---|---|---|
| `tests/protobuf.test.js` | varints, wire types, packed, resilience against truncated buffers | no |
| `tests/soundBank.test.js` | all five `Sounds` sections, ignoring unknown fields | no |
| `tests/descriptors.test.js` | parsing `FileDescriptorProto`, finding the blob in the binary, fallback | no |
| `tests/clientPaths.test.js` | client detection, tolerance for a subdirectory being selected | no |
| `tests/catalog.test.js` | the status matrix, action mapping, hash cache | no |
| `tests/changelog.test.js` | extracting a release section from `CHANGELOG.md` | no |
| `tests/icon.test.js` | the PNG encoder, whether `build/icon.png` is current | no |
| `tests/update.test.js` | version comparison, installer matching, reading the GitHub response | no |
| `tests/audio.test.js` | reading ogg headers, conversion, silence, error handling | **yes** |
| `tests/lifecycle.test.js` | the full cycle: replace, reset, drift, reapply | **yes** |

Tests that need ffmpeg skip themselves when it is missing (`tests/helpers/env.js`), with a
readable reason in the output. CI has ffmpeg installed, so everything runs there.

## Fixtures

`tools/make-fixture.js` builds a synthetic mini client in `%TEMP%`:

- `createRawFixture()`: files with deterministic content named after their own sha256.
  No ffmpeg needed. Enough for testing the parser, statuses and paths.
- `createFixture()`: real Vorbis files generated with ffmpeg (various sample rates and
  channel counts). Needed wherever the actual audio matters.

Both variants share the same bank: 3 sounds, 3 `NumericSoundEffect` entries (one of them
a `RandomSoundEffect` with packed varints), `AmbienceStream`, `AmbienceObjectStream`
and `MusicTemplate`, so every section is covered.

```bash
npm run fixture               # build it and print the path, for poking around by hand
```

No CipSoft assets in the repo, no touching a real installation.

## Verifying against a real client

For checking things against real data there is a **copy** of the client in `testclient/`:

```bash
robocopy "%LOCALAPPDATA%\Tibia" "%CD%\testclient" /E /MT:8
```

We never test against a working installation.

The app is launched with CDP enabled so the interface state can be inspected without
taking screenshots:

```bash
npx electron . --remote-debugging-port=9222
node tools/cdp-probe.js "document.querySelectorAll('#tb tr').length"
node tools/cdp-probe.js --file tools/e2e-probe.js
```

`tools/cdp-probe.js` connects to the renderer over the Chrome DevTools Protocol and
evaluates an expression in it. Ready-made scenarios:

| file | scenario |
|---|---|
| `tools/e2e-probe.js` | playback, replacement, A/B, mute, reset from a `___` backup |
| `tools/e2e-drift.js` | reaction to a launcher patch and the *Restore mine* bar |
| `tools/e2e-columns.js` | column widths, technical columns, fit to content, saved settings |
| `tools/e2e-ui-1-4.js` | the slimmed-down interface: status dot, conditional buttons, chips, menu |
| `tools/e2e-packaged.js` | the same against the packaged app from `dist/win-unpacked` |

The scripts read cells through `td[data-col="..."]` and drive the app through
`window.__tsc` (`refresh`, `setTech`, `setAuto`, `fit`, `entries`, `setUpdate`). They do not
click by button id and do not count columns by index, because both of those fell apart on
every layout change.

The "drift" step requires overwriting a file from the outside. This simulates what the
launcher does when it verifies assets:

```bash
V=$(ls -d vault/clients/testclient-*/)
F=sound-e3e1a76bce58857fbb12d6a3d5992ac8598de8eab331109f18b9634f0a9c7196.ogg
cp "$V/originals/$F" "testclient/packages/Tibia/sounds/$F"
node tools/cdp-probe.js --file tools/e2e-drift.js
```

The packaged app (different `userData`, resources inside `app.asar`):

```bash
npx electron-builder --dir --win
"./dist/win-unpacked/Tibia Sounds Config.exe" --remote-debugging-port=9223
CDP_PORT=9223 node tools/cdp-probe.js --file tools/e2e-packaged.js
```

## Verifying the updater

The update path cannot be exercised in development: `canInstallUpdate()` correctly returns
false when `app.isPackaged` is false, and a released build is never older than the latest
release. To test it end to end, build an installer with a version number lower than the
published one, install it, and let it update itself:

```bash
# temporarily lower the number in VERSION.md, then:
npm run version:sync
npm run icon
npx electron-builder --win nsis --publish never
# install dist/tibia-sounds-config-<lower>-win-x64-setup.exe, launch it,
# and use menu -> Check for updates
# afterwards: git checkout -- VERSION.md package.json
```

What should happen: the app reports `canInstall: true`, finds the published release,
downloads the installer with a progress bar, verifies its SHA-256, and after confirmation
runs it silently and exits. The registry entry under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` should then show the new version,
and settings plus the vault should survive untouched.

One trap: in Git Bash the `/S` flag is converted into a path (`C:/Program Files/Git/S`), so
running the installer silently from that shell needs `MSYS_NO_PATHCONV=1`. The app itself
passes the flag through `spawn`, where no conversion happens.

## Worth checking when changing file handling

1. the status goes back to `original` after a reset (`sha256` matches the file name)
2. the backup of the original in the vault was not overwritten by the replacement
3. writes are atomic, no `.tmp-*` files are left in the client directory
4. with the Tibia client running, the operation is refused with a readable message
