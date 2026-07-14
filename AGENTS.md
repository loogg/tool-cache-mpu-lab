# Repository Rules

## Scope

- This repository owns only the Cache & MPU interactive teaching tool and its GitHub Pages site.
- Keep the simulation model independent from React presentation code.
- Teaching examples are pseudocode and must not be presented as production-ready GD32 initialization code.
- Architecture statements must distinguish generic cache concepts, Armv7-M/Cortex-M7 behavior, and GD32H75E SoC behavior.
- Releases and version bumps in this repository must not modify `toolbox` or sibling repositories.

## Verification

- Run `npm ci`, `npm test`, `npm run lint`, and `npm run build` before committing.
- Use browser automation to verify the guided course, configuration controls, animation transport, quiz flow, memory map, and responsive layout.
- Do not commit `dist`, source maps, credentials, browser traces, or local environment files.

## Release

- `package.json.version` is the single source of truth for the displayed and released version.
- Create later releases with `npm version patch|minor|major -m "chore(release): v%s"`.
- Push release commits and immutable tags with `git push origin main --follow-tags`.
- Only `v*.*.*` tags deploy GitHub Pages.
