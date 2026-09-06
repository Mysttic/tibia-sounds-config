## What and why

<!-- One or two sentences: what this change does and which problem it solves. -->

## How it was checked

<!-- Be specific. "I ran the tests" is not enough, write what you saw. -->

- [ ] `npm test` passes
- [ ] checked by hand in the app (`npm start`) against a **copy** of the client, not a working installation
- [ ] if the change touches file writing: I went through replace, then reset, and the status came back to `oryginal`

## Version and changelog

- [ ] an entry in `CHANGELOG.md`
- [ ] `version` in `package.json` bumped, if this change is meant to ship in a release
      (merging to `master` without a version bump does **not** create a release)

## Risk

<!-- What can go wrong? Does the change touch writes into the client directory? -->
