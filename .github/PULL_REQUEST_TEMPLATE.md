## What this changes

<!-- Which phase of docs/ARCHITECTURE.md is this, and what does it add or fix? -->

## Checklist

- [ ] Developed on its own branch for this phase, targeting `main`
- [ ] Tests for what it adds or changes (unit, component, end-to-end, security, performance, packaging), passing on Linux, Windows and macOS
- [ ] `CHANGELOG.md` lines added under **Unreleased**
- [ ] Documentation updated (README, the user guide in both languages, and `FORMAT.md` / `VIEWER-GUIDELINES.md` / `ARCHITECTURE.md` / `PAGEKEEP-ZIP.md` if behaviour changed)
- [ ] If `FORMAT.md` or `MANIFEST-SIGNING.md` changed: `node scripts/format-sync.mjs --update` run, and the three files copied to PageKeep
- [ ] If a library the application imports changed: `npm run notices` run
- [ ] No real captures or private files added (fixtures are synthetic)
