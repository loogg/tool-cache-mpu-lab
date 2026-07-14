# Repository Rules

## Template scope

- Keep this repository generic and suitable for creating independent React/Vite tools.
- A generated tool must replace the placeholder package name, title, description, and initial version before its first release.
- `package.json.version` is the single source of truth for the displayed and released version.

## Verification

- Run `npm ci`, `npm run lint`, and `npm run build` before committing.
- Confirm the built asset base matches the GitHub repository name.
- Do not commit `dist`, source maps, credentials, or local environment files.

## Release

- Follow semantic versioning: patch for compatible fixes, minor for compatible features, and major for incompatible changes.
- Create releases with `npm version patch|minor|major -m "chore(release): v%s"`.
- Push the release commit and tag with `git push origin main --follow-tags`.
- Never move or reuse an existing release tag. Rollbacks require a new patch version.
- Only `v*.*.*` tags deploy GitHub Pages; ordinary commits run CI only.
- Releasing a generated tool must not modify or deploy `toolbox`.
