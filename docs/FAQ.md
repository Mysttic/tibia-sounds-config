# Frequently asked questions

## The game and safety

**Does replacing sounds give any in-game advantage?**
No. Only what you hear changes. The app does not touch the files that decide how the game
behaves, does not inject code, does not read process memory and does not change any
information available to the player. A sound of a different length neither speeds anything
up nor delays it; it is only a sound. Longer version:
[Why this does not affect the game](HOW_IT_WORKS.md#why-this-does-not-affect-the-game).

**Can this break the client?**
The app writes only to `.ogg` files in the `sounds/` directory and re-encodes every file to
the original's format (the same sample rate and channel count), so the engine gets exactly
what it expects. It does not touch executables or game data. If anything did go wrong, there
are two ways back: the **Przywroc** button in the app, or running the Tibia launcher, whose
file verification restores the client to a 100% factory state.

**Can I get banned for this?**
Nobody can honestly guarantee an answer, neither I nor anyone outside CipSoft. What can be
said fairly: the project is deliberately designed to do nothing beyond replacing the sound
layer, and it gives no advantage over other players. CipSoft supports the client only in its
original state, and every modification of its files, including a purely cosmetic one, is at
your own risk. If you have doubts, play on an unmodified client.

**Will other players hear my sounds?**
No. The changes exist only on your computer.

**What is the app definitely not doing?**
It does not modify the client executable, `.dat` files or asset catalogs (`assets.json`).
It does not inject code, does not hook into the game process and does not read its memory.
It sends no data about you: no telemetry, no account. It does not run in the background:
it changes game files only when you click. The full list of places where it writes anything
is in [HOW_IT_WORKS.md](HOW_IT_WORKS.md#places-where-the-app-writes-anything).

## Backups and recovery

**Where are the backups of the originals?**
In `%APPDATA%\Tibia Sounds Config\vault`, separately for each client installation.
Details in [HOW_IT_WORKS.md](HOW_IT_WORKS.md#backups-the-vault).

**I changed client version and my replacements are gone. Can I get them back?**
Yes. If the app detected that the launcher overwrote the files, it will offer
**Przywroc moje** above the list. And if you reinstalled the client or are moving to another
computer, the menu (the **&#8943;** button in the top right corner) has
**Zapisz kopie moich podmianek** (which saves them *together with the audio* into one file)
and **Wczytaj kopie** on the new installation. Sounds that no longer exist in the new client
version are skipped and listed.

**How do I remove all the changes completely?**
Click **Przywroc** on the replaced sounds, or simply run the Tibia launcher, whose file
verification restores the client to a 100% factory state.

## Interface

**The app is in Polish. Is there an English interface?**
Not at the moment. The application ships with a Polish interface; only the documentation is
in English. Menu items and buttons referenced in these documents are given with their Polish
labels so you can find them on screen.

**Where are the technical details: file name, id, size?**
The **&#8943;** menu has a *Pokaz szczegoly techniczne* entry, which adds columns with the
reference, id, file name and size. They are hidden by default because you do not need them
to replace a sound.

**Can I switch to a light theme?**
Yes, in the **&#8943;** menu, the *Wyglad* row: **Auto** (the default, follows Windows),
**Jasny**, **Ciemny**.

## Accounts, network, licensing

**Does the app require anything from me? An account, a login?**
For everything except generation, no. No account, no registration, no telemetry; searching
for sounds online also works without logging in. For browsing and previewing alone you do
not need the internet at all.

The exception is **generating a sound from a description**. That feature is inactive by
default and needs your own API key with an external provider, because the app has no key of
its own and pays for nothing. We store the key encrypted with a system mechanism and it
never leaves your computer. Until you paste it, nothing happens.

**Where do the sounds from the search come from and may I use them?**
The built-in sources are **Openverse** (an aggregator of free content, including Freesound)
and curated **Internet Archive** collections. Both are filtered exclusively to the **CC0**
license, meaning the public domain, so you may use them without attribution. The app records
the author and license of every downloaded sound anyway.

You can also add a custom source or paste a direct link to a file. In that case checking the
license and terms of that site is your responsibility.

**When does the app connect to the internet?**
Only when you click *Szukaj*, *Wygeneruj*, *Uzyj* or *Sprawdz aktualizacje*. No telemetry and
no statistics. The only background request is the version check, which is off by default and
which you enable yourself. The list of addresses:
[HOW_IT_WORKS.md](HOW_IT_WORKS.md#when-the-app-connects-to-the-internet).

## Updates

**How do I update the app without downloading the installer by hand?**
The **&#8943;** menu, then *Sprawdz aktualizacje*. If a newer release exists, the app shows a
bar above the list and, after your confirmation, downloads the installer, verifies its
SHA-256 and runs it, closing itself for the duration of the installation. Next to it is a
*Sprawdzaj sam* toggle, which makes it ask once a day at startup; it is off by default.
Replacements, backups of originals and settings survive the update, because the installer
goes into the same place and does not touch the `%APPDATA%` folder.

**I use the portable build and I do not see an install button.**
That is intended. The installer would put a second copy next to it while the directory the
program runs from stayed old. The app will tell you a newer version exists and give you a
link to the release page, where you download the new portable file yourself. Details:
[HOW_IT_WORKS.md](HOW_IT_WORKS.md#updates-from-inside-the-app).

## Installation

**Windows says "Windows protected your PC". What now?**
**More info**, then **Run anyway**. The reason is mundane: a publisher certificate costs a
few hundred euros a year and this project has no sponsor, and without one Windows treats
every program as coming from an "unknown publisher", regardless of what it does.

Instead of taking that on faith, you can **check what you downloaded**:

- **checksum**: compare the result with the SHA-256 list in the release description:
  ```powershell
  Get-FileHash .\tibia-sounds-config-1.7.0-win-x64-setup.exe -Algorithm SHA256
  ```
- **file provenance**: proof that the binary was built from a specific commit in this
  repository, on GitHub's servers rather than on someone's computer
  (needs the [GitHub CLI](https://cli.github.com/)):
  ```bash
  gh attestation verify tibia-sounds-config-1.7.0-win-x64-setup.exe --repo Mysttic/tibia-sounds-config
  ```
- **your own build**: all the code is here, you can
  [build the app yourself](DEVELOPMENT.md) and download nothing ready-made.

**What is ffmpeg for?**
It converts your mp3 into the format the game engine expects (the same sample rate and
channel count as the original). Without it, browsing and previewing work; replacing and
muting do not. The app then shows a bar with an installation link and a *Sprawdz ponownie*
button.
