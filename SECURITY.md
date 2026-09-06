# Reporting security problems

## How to report

Please do not open a public issue for a security problem.

Use **[private vulnerability reporting on GitHub](https://github.com/Mysttic/tibia-sounds-config/security/advisories/new)**
(*Security* tab, *Report a vulnerability*). Only the author of the project sees the report
until a fix is released.

This is a one-person project run after hours. I do not promise a response time or a bounty.
What I do promise is to read the report, reply, and, if the issue is real, describe it
honestly in `CHANGELOG.md` together with what it affected.

## What is in scope

The app writes files into the game directory and stores the user's API key, so I am
especially interested in reports about:

- **escaping the sounds directory**: writing or reading a file outside
  `<client>/packages/Tibia/sounds` or the app's own working directory,
- **the `tsound://` protocol**: the only barrier between a name sent by the app window and
  a file read from disk (`electron/lib/tsound.js`),
- **API key storage**: the key must never reach the disk in plain text or leave the main
  process (`electron/lib/secrets.js`),
- **the network layer**: bypassing the `https` requirement, the download size limit or the
  timeout (`electron/lib/net.js`),
- **the update path**: substituting the downloaded installer, bypassing the checksum
  verification, or making the app run a file it did not download itself
  (`electron/lib/update.js` and the `update:*` handlers in `electron/main.js`),
- **renderer isolation**: code execution in the renderer, bypassing `contextIsolation`,
  the CSP or the `preload.js` bridge,
- **loss of user data**: scenarios where a replacement or a backup of an original can
  disappear without warning.

## What is not a vulnerability

- **The mere fact that the app modifies Tibia client files.** That is its stated purpose,
  described in the README, and it only happens when the user clicks.
- **The SmartScreen warning on launch.** The files are not signed with a publisher
  certificate; the README describes how to verify what you downloaded.
- **The behaviour of custom search sources** that the user defined themselves. The app
  forces `https` and enforces limits on them, but choosing the service is up to the user.
- **Costs and quotas at an external sound generation provider.** The key and the billing
  belong to the user.
- **The fact that the SHA-256 of an update comes from the same GitHub API response as the
  download URL.** This is a known and documented property: the checksum protects against a
  corrupted download, not against a compromised publisher account. Build provenance
  (`gh attestation verify`) is the stronger check and it is linked from every release.

## Versions

Fixes go into the latest release. I do not maintain older versions, so always update to the
newest one from [Releases](https://github.com/Mysttic/tibia-sounds-config/releases).
