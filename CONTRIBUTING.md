# Contributing

## Workflow

- The repository is `asantos43/folder-browser`. Work is split into the phases of
  [`TODO.md`](TODO.md). **Each phase is developed on its own branch and delivered as its
  own pull request against `main`** (for example `phase-1-browse`, `phase-2-file-operations`). Nothing else is pushed to
  `main`, except documentation agreed beforehand.
- Commit messages start with a short summary line in the imperative ("Add …", "Fix …"), then explain why.
- A pull request is complete only with:
  1. **tests** for what it adds (unit, component, end-to-end, security, performance or packaging, as
     [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), "Tests", says), passing on the developer's computer (nothing runs on GitHub for a pull request: the free quota is spared, see [`docs/RELEASING.md`](docs/RELEASING.md));
  2. its lines in **`CHANGELOG.md`**, under **Unreleased**;
  3. the **documentation** it affects (the README in both languages, the user guides, `TODO.md`, and
     `ARCHITECTURE.md` if behaviour changed). The WSNP format (`FORMAT.md`, `MANIFEST-SIGNING.md`) is not in this
     repository: it lives in [`wsnp-format`](https://github.com/asantos43/wsnp-format), shared with PageKeep and WSNP Viewer;
     a change to the format is made there first.

## Before you push

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

## Things to know

- The tests live next to the code (`*.test.ts`) and in `e2e/` (they open windows: leave the computer alone while they run).
- Test files are always synthetic (see `fixtures/`). Real captures come from private sites and are never committed.
- Code is TypeScript in ES modules, formatted like the code around it, and linted with oxlint.

## Licence

Folder Browser is under the [Mozilla Public License 2.0](LICENSE). A contribution is under the same licence. Pull requests are taken from collaborators; anyone can open an issue.
