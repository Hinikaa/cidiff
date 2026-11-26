# Contributing to cidiff

## Setup

Requires Node.js 20 or later. No runtime dependencies are permitted.

```sh
npm install
npm run typecheck
npm run build
npm test
```

## Build Artifacts

`dist/` is tracked in git so the GitHub Action (`runs.using: node20`, `main: dist/action.js`) runs without a build step. Run `npm run build` before committing changes to `src/`.

## Code Rules

- Keep zero entries in `dependencies` in `package.json`.
- Never construct shell commands with string interpolation.
- Escape `&`, `<`, `>`, `"`, and `'` for all dynamic values rendered into HTML.
- Add unit tests in `test/` for every parser, diff rule, CLI flag, and action input.
