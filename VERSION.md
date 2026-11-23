# Version

1.9.0

---

This file is the **source of truth** for the application version number.

The version is the first standalone number in the file in
[SemVer](https://semver.org/) format (`MAJOR.MINOR.PATCH`, optionally with a `v` prefix
and a suffix such as `-rc.1`). Markdown decoration around it (heading, bold, bullet)
is ignored.

## How to bump the version

1. Change the number above.
2. `npm run version:sync`, which copies it into `package.json`.
3. Add a `## [<version>]` section to [`CHANGELOG.md`](CHANGELOG.md).
4. Open a `develop` to `master` pull request. After the merge the workflow builds the
   installers, tags `v<version>` and publishes the release.

Merging to `master` **without** bumping this number publishes nothing, because the workflow
checks whether the tag `v<version>` already exists and finishes without doing anything.

CI makes sure `VERSION.md` and `package.json` agree (`npm run version:check`).
The number from here also goes into the app bar and the window title.
