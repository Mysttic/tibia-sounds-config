# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning based on [SemVer](https://semver.org/).

The version in [`VERSION.md`](VERSION.md) is the source of truth for releases. The release
workflow publishes the tag `v<version>` after a merge to `master`, provided that tag does
not exist yet.

## [Unreleased]

### Added

- **Releases are copied to the shared site repository.** A `site` job in the release workflow
  copies the three files to [`Mysttic/Mysttic`](https://github.com/Mysttic/Mysttic) under the
  tag `tibia-sounds-config-v<version>`, which is what
  <https://mysttic.github.io/Mysttic/tibia-sounds-config/> shows. One version stands there,
  always the newest; the full history stays in this repository. The new release is created
  before the older ones are removed, so the page is never empty. Needs a `HUB_TOKEN` secret.

### Changed

- **The update check now reads the site repository instead of this one.** Releases of several
  projects live there, so the "latest release" endpoint no longer fits: it answers for the
  whole repository and would return another project's version as ours. The app fetches the
  release list and keeps only tags starting with `tibia-sounds-config-v`. A list with none of
  ours in it means "nothing new", not an error.
- The *Co sie zmienilo* button still points at this repository, because the release body on the
  site is only a name, a number and a page address, while the full changelog lives here.
- All documentation translated into English: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `VERSION.md`, `CHANGELOG.md`, everything under `docs/`, the issue templates and the pull
  request template. `docs/JAK_TO_DZIALA.md` was renamed to `docs/HOW_IT_WORKS.md` and every
  link to it updated.
- The application interface stays in Polish, and so do code and comments, as
  `CONTRIBUTING.md` requires. Where the documentation refers to a button or a menu entry, it
  quotes the Polish label so it can be found on screen.

### Security

- The download address is checked against a host allowlist (`github.com`,
  `objects.githubusercontent.com`) before anything is fetched. It now arrives from a repository
  shared with other projects, so where it points is verified rather than assumed.
- The *Co sie zmienilo* address is assembled locally from the version number rather than taken
  from the API response, so a tampered `html_url` cannot send `shell.openExternal` anywhere.

## [1.7.0] - 2026-09-06

### Added

- **Updates from inside the app.** The menu entry *Sprawdz aktualizacje* asks GitHub's public
  API about the newest release. When a newer one exists, the app downloads the installer,
  checks its size and the SHA-256 sum published by GitHub, and after confirmation runs it
  silently and exits. The installer goes into the same place, so replacements, the vault and
  settings stay untouched.
- A *Sprawdzaj sam* toggle next to that entry, **off by default**. Once enabled, the app asks
  at most once a day, a few seconds after startup, and shows the result in a bar above the
  list. Until you enable it, the app never reaches out to the network on its own.
- The portable build and the unpacked zip **refuse to install** and show a link to the release
  page: the installer would put a second copy alongside while the directory the program runs
  from stayed old. They are recognized by `PORTABLE_EXECUTABLE_DIR` and by the absence of an
  uninstaller next to the executable.

### Changed

- `downloadToTemp` reports progress, so downloading the installer (78 MB) shows a progress bar
  instead of a frozen window. Progress is counted in megabytes and sent when a full MB
  changes, so the IPC channel is not flooded with tens of thousands of messages.
- The network description in `README.md`, `docs/FAQ.md` and `docs/HOW_IT_WORKS.md` gained two
  new addresses (`api.github.com`, `objects.githubusercontent.com`) and a note about when the
  app may ask about a version on its own.

### Security

- The address of the downloaded file does not come from the app window. The main process
  remembers what it found during the last check and can fetch only that, so the renderer has
  no way to point at an arbitrary download address or an arbitrary path to execute.
- The release page opens through `shell.openExternal` only after checking that the address
  points at this repository. Without that, one compromised field in GitHub's response would
  open an arbitrary page for the user.
- A mismatched checksum deletes the downloaded file and aborts the update. The documentation
  says plainly what that sum does not prove: it arrives in the same response as the address,
  so it protects against a corrupted download, not against a compromised publisher account.

## [1.6.1] - 2026-08-21

A housekeeping release before the repository was made public. The application code behaves
the same; the texts and documentation changed.

### Changed

- **README cut from 242 to 104 lines and given screenshots.** Twelve FAQ questions, the
  "what it does and does not do" section and the description of how to verify a downloaded
  file moved into the new `docs/FAQ.md`. Nothing disappeared; it simply stopped blocking the
  first screen.
- Dashes removed from all the documentation, from the texts visible in the app and from the
  release description template. Banners, hints in the replacement window and the selected
  client label read differently while meaning the same.
- `SECURITY.md` describing how to report security problems privately.

### A note about the repository history

The repository started with a clean history at the moment it was made public, which is why it
shows a single initial commit rather than the development from 1.0.0 onwards. The sections
below describe how the work went. Releases older than 1.6.1 no longer have pages on GitHub.

## [1.6.0] - 2026-08-17

### Added

- **Sound sets (presets).** One click mutes all the music, keeps only combat sounds, or keeps
  only notifications. A set is **rules, not files**: it says what should be muted, what should
  be left original, and what should be replaced with a sound from your library. It weighs a
  few hundred bytes and contains no audio.
- Five built-in sets: *Wszystko oryginalne*, *Bez muzyki*, *Bez odglosow otoczenia*,
  *Cicho, tylko walka*, *Tylko powiadomienia*.
- **Custom sets**: the *Zapisz obecny uklad* button turns the current state of the catalog
  into rules. They live in `presets.json` and can be renamed and deleted. The built-in ones
  cannot be modified.
- Before applying one, the app shows in the row exactly what it will do (how many it will
  mute, restore, or leave unchanged) and waits for confirmation, because a set overwrites the
  current state and should not do that quietly.

The resolution rule: **the last matching rule wins**. Without it there would be no concise way
to express "mute everything except weapons". Sounds that no rule touches stay untouched, which
is why *Bez muzyki* leaves the other replacements alone.

Measured against the real client 15.32 bank (844 sounds):

| operation | sounds | time |
|---|---|---|
| *Cicho, tylko walka* | 600 mutes | 14.9 s |
| *Wszystko oryginalne* | 600 restores | 8.4 s |
| *Bez muzyki* | 25 mutes | 0.8 s |
| replanning the same set | 0 to change | 1 ms |

### Changed

- Batch muting no longer calls ffmpeg once per sound. Silence with given parameters is always
  identical, so it is produced **once per combination of `sampleRate` and channel count** and
  shared. For 600 muted sounds, **two** silence files are created instead of 600, because that
  is how many distinct combinations the bank has.
- The profile is written in one go when applying a set, rather than after every file. An error
  on a single sound does not abort the batch; it lands on a list of skipped entries.
- A profile entry remembers `libraryId` when the sound came from the library. That lets a set
  recreate a layout and recognize that nothing changed.
- `resetSound` uses the extracted `restoreOriginalFile`, which does not touch the profile.
  This is needed so a batch writes the profile once instead of several hundred times.

### Security

- **The check for whether the game is closed repeats during a set being applied**, not only
  before it. With several hundred files the operation takes a dozen or so seconds, so the game
  could start halfway through. When that happens the batch is aborted, and whatever was
  already done is saved and reported.

### For developers

- A new module `electron/lib/presets.js` (rule model, built-in sets, saving custom ones) plus
  `applyPreset` in `electron/lib/profile.js`.
- 19 new tests, 189 in total. The batch is tested against a synthetic client with real ffmpeg,
  including the fact that the number of silence files matches the number of parameter
  combinations rather than the number of sounds.

## [1.5.0] - 2026-08-16

Three things: a new color scheme with a light mode, generating sounds from a description, and
a library of your own sounds.

### Added

- **Generating a sound from a description.** The replacement window gained a *Wygeneruj* tab:
  you write in English what you want and get a finished file. Two built-in sources:
  **ElevenLabs** (sound effects, up to 30 s, with a looping option) and **OpenRouter** (speech,
  for raid announcements and messages). A generated file follows the same path as a file from
  disk: a backup of the original, conversion with ffmpeg preserving the original's `sampleRate`
  and channel count, an atomic write.
- The feature is **inactive by default** and needs the user's own API key. The app has no
  built-in key and pays for nothing.
- **A library of your own sounds** (the *Moje dzwieki* tab). Everything you brought in lands
  here: generated sounds (marked `AI`) and files picked from disk (marked `z dysku`). Each can
  be played, given your own name, used for any entry and reused for another, without paying
  twice for the same thing and without hunting for the file again. The library is independent
  of the client: it survives Tibia updates and pointing the app at a different installation.
- **A light theme** and an appearance switch in the menu: one *Wyglad* row with *Auto* (the
  default, follows Windows), *Jasny* and *Ciemny*. The change is immediate and does not close
  the menu, so the variants can be compared with a single click. The choice is stored in
  `settings.json`, and the theme is applied before the window opens, so startup does not flash
  the other color.

### Changed

- **A new color scheme.** The stylesheet rests on semantic tokens rather than raw colors:
  hierarchy is built from surface levels instead of borders around everything, buttons lost
  their outlines, the corner radius grew from 3 to between 6 and 12 px, and the accent color
  is reserved for what is interactive or active. Previously the same gold was used for the
  header, the version number, sorting and the active button at once. The background was
  desaturated from a strongly brown `#14100c` to a nearly neutral `#111010`.
- **The replacement window split into tabs**: *Moje dzwieki*, *Wygeneruj*, *Znajdz w sieci*,
  *Z dysku*. Previously the four sources sat one below another and the window took up the
  whole screen height. Now one source is visible at a time.
- **Named actions sort before generated labels.** 406 of 844 entries have no real name, only a
  label such as `ambience_stream #2651`, and when sorting by name they filled the entire first
  screen. The catalog now carries a `named` flag and such entries go last.
- Picking a file from disk (including dragging it onto a row) puts a copy into the library so
  it can be reused. Files over 25 MB and non-audio files are skipped; the replacement itself
  works as before.
- The network layer handles `POST` with a body and headers; the provider's error body is passed
  through to the user, because it is usually the only information about why it refused.
- The description of search safety from release 1.3.0 was clarified in `docs/HOW_IT_WORKS.md`:
  a result's address does reach the window together with the result, but the window has no
  network access and cannot use it.

### Security

- **The API key never sits in the open.** The system's `safeStorage` encrypts it (on Windows
  this rests on DPAPI, meaning the user account key). When encryption is unavailable, the app
  **refuses to save** rather than writing the key in plain text. The key never leaves the main
  process; the window can at most ask *whether* it is set. The `secrets.json` file is separate
  from the plain `settings.json`.
- Library entries are reachable through `tsound://library/<id>`, where the path is computed
  solely by the library from its own index, so the address cannot point at a file outside it.
  Covered by tests that try to substitute a path for an identifier.
- The window background color follows the system theme, so startup does not flash the other
  color before the renderer has drawn itself.

### For developers

- New modules: `electron/lib/generate.js` (generator adapters, modelled on `providers.js`),
  `electron/lib/secrets.js` (keys through `safeStorage`) and `electron/lib/library.js`
  (the library of your own sounds).
- 32 new unit tests, 170 in total.

## [1.4.0] - 2026-08-16

A release about slimming down the interface and about bugs that could have cost you a profile.

### Changed

- **The interface shows sounds, not the state of the program.** The *Ref*, *Plik*, *Rozmiar*
  and *Id* columns are gone from the table, as are the *ffmpeg*, *names from client.exe* and
  *client 15.32* badges from the bar, the *streams only* checkbox, and the *Odswiez*,
  *Dopasuj kolumny*, *auto*, *stop*, *Eksport profilu*, *Import profilu* and *Vault* buttons.
  Four columns remain (in-game sound, category, length, actions) and six controls in the header
  instead of twenty. The reason: everything removed described the internal state of the program
  rather than the sounds in the game. The *streams only* filter, for example, returned exactly
  the same 220 entries as the MUSIC + AMBIENCE_STREAM + AMBIENCE_OBJECT categories, and *Rozmiar*
  correlated with *Dlugosc* at r = 0.99.
- **Row buttons render only when they do something.** There were 5064 controls, of which 843
  greyed-out *Przywroc* and 844 inactive *A/B* on a fresh installation. Now there are 1690
  controls and not one dead. Muting moved into the replacement window (it is the same operation
  anyway), and *show in Explorer* and *copy id* moved to the right mouse button.
- **Status as a dot next to the name instead of its own column.** 843 of 844 rows showed the
  same word, so only the deviation from the original carries meaning. The status counters above
  the list double as filters.
- **Exceptional states as bars above the list, not badges in the header.** A missing ffmpeg,
  names from a saved list and files overwritten by the launcher appear only when they actually
  happen, together with a button that deals with them. A badge told you when everything worked
  and stayed silent when it stopped.
- The client path, the *Zmien...* button and the client version merged into a single context
  button; rare actions moved into the menu. Refreshing happens by itself when the window is
  focused again (and on <kbd>F5</kbd>), because that is the only moment statuses can be stale.
- The technical columns (*Ref*, *Id*, *Plik*, *Rozmiar*) come back with one click through
  *Pokaz szczegoly techniczne* in the menu. They were hidden, not removed.
- The sum of minimum column widths dropped from 904 to 532 px, so `MIN_WINDOW_WIDTH` went from
  940 to 580 and the window fits on half of a much narrower screen.
- The search box covers the action name, category, id and replacement source. The reference and
  file name dropped out along with their columns, so results no longer land on rows where the
  searched text is not visible.
- Messages from the main process reach the user without Electron's wrapper
  (`Error invoking remote method 'sound:replace': Error: ...`), decline correctly by number, and
  name the sound instead of saying `#677`.
- You can see the app working: a bar under the header (with real progress while fingerprints
  are computed), a wait cursor and a highlight on the changed row.
- The description of search safety from release 1.3.0 was clarified. The earlier wording said
  the app window had no access "to addresses"; in reality a result's address reaches the window
  together with the search result. What the window does not have is network access, so it
  cannot use it.

### Fixed

- **The profile was written non-atomically.** An interrupted write (closing the window, running
  out of space) left truncated JSON, after which every replacement became "foreign". Now it is
  tmp plus rename, the same as with sound files.
- **No second-instance lock.** Two copies of the app pointing at the same client each kept their
  own profile in memory and wiped each other's replacements on save. A second instance now
  brings the first one's window to the front.
- **Export, import and reapplying replacements without a client selected** ended in a raw
  `Cannot read properties of null`, and only after going through the file picker. They now
  refuse straight away and in plain language.
- **A failed client load left mixed state**: `state.client` pointed at the new installation while
  the directory described the previous one. The whole thing is now built in local variables and
  assigned to the state in one substitution.
- **Detecting a running client was fail-open**: a `tasklist` error (a timeout, for example) was
  quietly treated as "the game is not running" and let a write through while Tibia was up. The
  result is now tri-state, and a failed check blocks the write.
- **ffmpeg was detected only at startup**, so anyone who installed it later saw the "missing
  ffmpeg" message for the rest of the session. A *Sprawdz ponownie* button was added.
- **The memory of web previews grew without bound**, and every address ever found stayed
  downloadable for the life of the process. There is now a limit of the 200 most recent.
- Writes to `settings.json` are serialized and atomic. A concurrent write of the window geometry
  and the client path used to lose one of the changes.
- The window remembers its size and position (validated against the connected displays), the
  preview volume survives a restart, and a failed sound load no longer leaves a row lit up
  permanently.

### Security

- Resolving `tsound://` addresses was extracted from `main.js` into `electron/lib/tsound.js` as
  a pure function. It is the only barrier between a name sent by the app window and a file read
  from disk, and inside the main process there was no way to test it without launching the whole
  of Electron. Tests for attempts to escape the directory were added, including percent-encoded ones.
- Network layer tests: rejecting addresses other than `https`, aborting a download that exceeds
  the limit despite a lying `Content-Length`, cleaning up the temporary directory after an error.
- `setWindowOpenHandler` and a `will-navigate` block. The window has no links and no navigation,
  so any such attempt means something went wrong.

### For developers

- Columns are defined in `renderer/app.js` and cells carry `data-col`. The scripts in `tools/`
  used to read them by index and quietly fell apart on every layout change; they now read by name
  and drive the app through `window.__tsc` instead of clicking by identifier.
  `tools/e2e-columns.js` had its own hand-copied map of minimum widths; it now takes it from a
  single source.
- 34 new unit tests (`tests/tsound.test.js`, `tests/net.test.js`, `tests/processes.test.js`);
  138 in total.

## [1.3.0] - 2026-08-16

### Added

- **Searching for sounds online.** The *Podmien* button opens a window where you can type a
  phrase (for example "big explosion"), listen to the results and replace a sound in the client
  with one click. Clicking the play icon again stops the preview. A downloaded file follows the
  same path as a file from disk: a backup of the original, conversion with ffmpeg, an atomic write.
- Two built-in sources, both without registration or an API key: **Openverse** (an aggregator of
  free content, including Freesound) and **Internet Archive**. Results are filtered hard to the
  CC0 license; Internet Archive is additionally restricted to collections that are CC0 in their
  entirety.
- Custom user sources: declarative JSON adapters (`searchUrl`, `resultsPath`, field mapping).
  Making sure they comply with the site's terms and licensing is the user's responsibility.
- Pasting a direct link to an audio file.
- The provenance of a downloaded sound (author, license, source address) recorded in the profile.
- **Profile import.** Export saves the replacements **together with the audio** in a single JSON
  file, and import writes them back. This solves the situation where files revert to the original
  after a client update or reinstall: you load the profile and the replacements are back, along
  with the provenance and license information. Import does not need ffmpeg, because the audio in
  the profile is already in the game's format.
- Sounds that do not exist in the current client version (because CipSoft re-encoded them, so the
  file name changed) are skipped on import and **reported** rather than quietly lost. The same
  goes for entries with damaged audio, which are checked before anything is overwritten.

### Security

- All network traffic leaves from the main process only, and only at the user's request. The app
  window has no network access; it receives previews through a key and the `tsound://` protocol,
  so the CSP stays closed.
- Only `https` is allowed; `http`, `file` and `data` addresses are rejected. The URL prefix in
  custom sources is only prepended to relative paths, so an absolute `http://` address cannot be
  glued into a seemingly correct `https` one.
- A 25 MB limit on downloaded files, enforced during the transfer.

### Changed

- README and `docs/HOW_IT_WORKS.md`: the network mechanism, the list of queried addresses and the
  safeguards are described. The earlier sentence about having no connections at all stopped being
  true and was replaced with specifics.

## [1.2.0] - 2026-08-14

A release about distribution: nothing changes in how the app works; the point is being able to
check what you downloaded.

### Added

- A third download variant: a `.zip` archive with the same app as the portable build. Browsers
  treat archives more gently than bare `.exe` files, so it is a fallback for when downloading the
  installer is blocked.
- Build provenance attestation (`actions/attest-build-provenance`): cryptographic proof that a
  given file was built from a specific commit in this repository on GitHub's servers.
  Verification: `gh attestation verify <file> --repo <repo>`. GitHub offers this only for public
  repositories, so the step turns itself on once the repository visibility changes.
- SHA-256 sums of all artifacts in every release description, together with instructions for
  checking them (`Get-FileHash`).

### Changed

- README: the installation section split into three download variants plus a separate paragraph
  about the SmartScreen warning and three ways to verify a file.

## [1.1.0] - 2026-08-14

### Added

- The window starts at half the screen's working area (no less than 940 px, which is what the
  table needs without horizontal scrolling).
- Fitting column widths to the window: *auto* mode (the default) reacts to window and filter
  changes, and the *Dopasuj kolumny* button does it once. Every column has its own minimum width,
  so nothing gets squeezed to zero in a narrow window.
- `start.bat` for launching with one click. The same file works next to an installed app (running
  the `.exe`) and in the source directory (installing dependencies and running `npm start`).
  It also ships inside the installer package.

### Changed

- README rewritten for end users (what the app does with files, safety, FAQ). The details of how
  it works moved to `docs/HOW_IT_WORKS.md`, and developer content to `docs/DEVELOPMENT.md`.
- Action buttons in the table are now icons with tooltips instead of text. The column narrowed
  from 296 to 206 px, which lets the table fit on half of a 1920 px screen without scrolling
  sideways.
- Column widths are measured from the data model rather than through `innerText`, so fitting them
  does not force a layout recalculation of 844 rows.

### Fixed

- The `slugForClient` test had Windows paths hard-coded and broke CI on `ubuntu-latest`. On Linux
  a backslash is not a separator, so `path.basename('C:\\...')` returns the whole path instead of
  the last segment. Test paths are now assembled with `path.join`.

## [1.0.0] - 2026-08-13

The first release.

### Added

- Reading the client sound bank (`sounds-<sha256>.dat`, protobuf `tibia.protobuf.sound.Sounds`)
  together with action names extracted from the descriptors in `client.exe`; falling back to a
  snapshot from client 15.32 in `data/enums.snapshot.json`.
- A table of all the sounds: action, category, reference, id, file, size, length, status; a search
  box, category and status filters, sorting by every column.
- Resizing columns by dragging the header boundary; double-clicking the boundary fits the column
  to its longest content. The settings are kept in `localStorage`.
- Playing a sound from the client and comparing it A/B against the original from the vault (the
  `tsound://` protocol, with file name validation).
- Replacing a sound with your own file (mp3/wav/flac/m4a/ogg/opus/aac/wma), converted through
  ffmpeg to Vorbis while preserving the original's `sampleRate` and channel count. Dragging and
  dropping a file straight onto a table row is supported.
- Muting a single sound (0.05 s of silence with the original's parameters).
- Restoring an original from the vault or from a manual `___sound-<sha256>.ogg` backup.
- Detecting file state by sha256: `oryginal`, `podmieniony`, `nadpisany przez launcher`, `obcy`,
  `brak pliku`.
- The *Zastosuj ponownie* button, which reapplies replacements after a launcher patch.
- Exporting the profile to JSON.
- A write lock while the Tibia client is running.
- A hash cache keyed by `size` + `mtime`, so reloading 844 files (110 MB) takes about 0.3 s.
- Windows installers: NSIS and portable.
- `VERSION.md` as the source of truth for the version number, which is shown in the app bar and
  in the window title.

### Security

- `contextIsolation: true`, `nodeIntegration: false`, a CSP in the renderer; all disk access
  through `contextBridge`.
- Writes only to `<client>/packages/Tibia/sounds/*.ogg` and the app's own vault; file names are
  validated with the `sound-<64 hex>.ogg` pattern, so there is no way out of the sounds directory.

[Unreleased]: https://github.com/Mysttic/tibia-sounds-config/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/Mysttic/tibia-sounds-config/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/Mysttic/tibia-sounds-config/releases/tag/v1.6.1

Versions older than 1.6.1 have no links, because they predate the repository history being
restarted. Their descriptions stay above as a record of what changed and when.
