# Architecture

## Processes

```
                 main process (electron/main.js)
                 - the only one with disk and ffmpeg access
                 - registers the tsound:// protocol
                 - holds state: client, vault, profile, catalog
                          |
                    IPC (ipcMain.handle)
                          |
                 preload (electron/preload.js)
                 - contextBridge -> window.api
                 - contextIsolation: true, nodeIntegration: false
                          |
                 renderer (renderer/app.js)
                 - table, filters, playback
                 - no access to node
```

The renderer cannot see `require`, `fs` or `path`. Everything that touches the disk goes
through the named IPC channels listed in `preload.js`. The CSP in `renderer/index.html`
allows media only from `tsound:`.

## Data flow at startup

```
app:init
  -> detectFfmpeg()                     audio.js       is ffmpeg + libvorbis present
  -> readSettings()                     main.js        remembered client path
  -> autodetect()                       clientPaths.js %LOCALAPPDATA%\Tibia and friends
  -> useClient(dir)
       -> validateClientDir(dir)        clientPaths.js looks for packages/Tibia/sounds/catalog-sound.json
       -> loadProfile(vault)            profile.js     vault/clients/<slug>/profile.json
       -> buildCatalog(...)             catalog.js
            -> loadSoundBank(soundsDir) soundBank.js   catalog-sound.json -> sounds-<sha256>.dat
            -> loadEnums(clientExe)     descriptors.js descriptor from client.exe or snapshot
            -> buildUsageMap(bank,enums)               soundId -> [{event, category, ref}]
            -> sha256 of every file (pool of 8, cached by size+mtime)
            -> computeStatus(...)                      original / replaced / drifted / foreign / missing
  <- publicState()                                     goes to the renderer
```

## Modules

| file | responsibility | dependencies |
|---|---|---|
| `electron/lib/protobuf.js` | wire format reader: varints, fields, packed, prefix scan | none |
| `electron/lib/soundBank.js` | `sounds-<sha256>.dat` -> `{sounds, numericEffects, ambienceStreams, ambienceObjectStreams, musicTemplates}` | protobuf |
| `electron/lib/descriptors.js` | `FileDescriptorProto` from `client.exe` -> enums; falls back to `data/enums.snapshot.json` | protobuf |
| `electron/lib/clientPaths.js` | detecting and validating a client installation | none |
| `electron/lib/audio.js` | ffmpeg (conversion, silence) + reading ogg headers without ffprobe | ffmpeg in PATH |
| `electron/lib/catalog.js` | join of bank + names + sha256 -> list of entries with status, hash cache | soundBank, descriptors, audio |
| `electron/lib/profile.js` | vault, backups of originals, apply / reset / reapply | catalog, audio |
| `electron/lib/processes.js` | whether the Tibia client is running (write lock) | none |
| `electron/lib/update.js` | version comparison, installer matching, reading the GitHub response | none (`fetchJson` injected) |

Dependencies point one way: `protobuf` <- `soundBank`/`descriptors` <- `catalog` <- `profile`.
Nothing imports `main.js`, so all the logic is testable without launching Electron.

## Why a hand-written protobuf parser

The bank has five message types and a dozen or so fields in total. A full protobuf
library (`protobufjs`) means about 1 MB of dependencies and code generation from a schema
CipSoft does not publish, so it would have to be recovered from the descriptor anyway.
The hand-written reader is around 100 lines, has no dependencies and ignores unknown
fields, so a newer client version will not break it (test: `tests/soundBank.test.js`).

## Where the action names come from

`client.exe` is built with full protobuf, so its data section contains a serialized
`FileDescriptorProto` for `sounds-common.proto`. `descriptors.js` looks for the sequence
`0x0a <length> "sounds-common.proto"` and then parses the blob until the following fields
stop being valid (`scanValidPrefix`), because the blob length is not known up front.

The effect: names come from the *selected* installation, so a new client version with new
sounds gets its names automatically. When the scan fails, `data/enums.snapshot.json`
(client 15.32.df7b29) takes over and the top bar says the names come from a snapshot.

## File statuses

The name `sound-<sha256>.ogg` **is** the sha256 of the original content. The whole state
detection comes down to comparing hashes: no manifest of our own, no state file, and it
survives someone editing the files by hand.

| status | condition |
|---|---|
| `original` | `sha256(file) == hash from the name`, no profile entry |
| `replaced` | hash differs from the name, matches `profile.entries[id].appliedHash` |
| `drifted` | hash **matches** the name, but a profile entry exists, so the launcher overwrote the replacement |
| `foreign` | hash differs from the name and does not come from the profile |
| `missing` | the bank lists a sound that is not on disk |

## Vault

```
vault/clients/<name>-<sha1(path)[0:10]>/
  profile.json     { version, clientRoot, entries: { "<soundId>": {...} } }
  originals/       backups of originals, named sound-<sha256>.ogg
  library/         converted replacements, <uuid>.ogg
  hashcache.json   { "<file>": { size, mtimeMs, hash } }
```

The slug is computed from the normalized path, so every installation gets its own vault
and the profiles never mix. In development the vault lives in the repo (gitignored); in
the packaged app it is under `app.getPath('userData')/vault`.

Backups are kept locally because fetching the original from the CDN is not an option:
`https://static.tibia.com/launcher/assets-current/sounds/...` returns HTTP 403
(Cloudflare challenge). The second source of an original is a manual backup following the
`___sound-<sha256>.ogg` convention placed next to the replacement. `profile.js` recognizes it.

## Safety of file operations

- every name goes through `FILENAME_HASH` (`^sound-[0-9a-f]{64}\.ogg$`), so `../` or any
  other path will not get through
- writes are atomic: `copyFile` to `<target>.tmp-<rand>`, then `rename`
- a backup of the original is made before the first overwrite; without it `applySound` refuses
- writes are blocked while `client.exe` / `Tibia.exe` are running (`processes.js`)
- `assets.json`, the client's `package.json`, `.dat` files and binaries are never touched

## The tsound:// protocol

```
tsound://sound/<file.ogg>     the current file from the client directory
tsound://original/<file.ogg>  the backup of the original from the vault (A/B preview)
```

Registered as `standard` + `secure` + `supportFetchAPI`, served by `protocol.handle`
in `main.js`. The alternative (`file://` with `webSecurity` turned off) would open the
whole disk to the renderer. The file name is validated with the same pattern as on write,
and `?v=<hash>` is there to bust the cache after a replacement.
