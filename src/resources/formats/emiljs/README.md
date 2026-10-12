# emil.js (vendored)

`emiljs-build.mjs` is the single-file build of [emil.js](https://github.com/EmilHvitfeldt/emil.js) that `format: emiljs` runs in-process on Quarto's own Deno. It turns the Markdown that Pandoc writes (`<stem>-emiljs.md`) into the final deck HTML. It is generated, so do not edit it.

| | |
|---|---|
| Version | 0.1.0 (`EMILJS` in `configuration`) |
| Source | `@emiljs/cli` at emil.js commit `a25ee205d28da597e0a35c1b64ed443cc559a846` (`pnpm --filter @emiljs/cli embed:release`) |
| SHA-256 | `31e2f9ba1ac1f2d356976ad55029e70fff0900514be779e9e132eeb21bfb0d41` |
| License | MIT, see `LICENSE`; bundled dependencies in `LICENSE-3RD-PARTY.txt` |

## Updating

1. In the emil.js repo, `pnpm install && pnpm -r build && pnpm --filter @emiljs/cli embed:release`, or download the same files from the GitHub release for the tag.
2. Copy `emiljs-build.mjs`, `LICENSE` and `LICENSE-3RD-PARTY.txt` from `packages/cli/dist/embed-release/` into this folder.
3. Update the version, commit and SHA-256 above and `EMILJS` in `configuration` (a unit test checks that the bundle's `VERSION` matches the pin).

## Development override

Set `QUARTO_EMILJS_BUILD` to the path of a local `emiljs-build.mjs` to render with a build other than the vendored one.

## Scope of the embedded build

It writes one HTML file with CSS and the runtime inlined. It does not support npm-package themes, `ogImage` social cards, `--fetch-fonts` or the sanitizing mode, because those need a browser, the network or dependencies the bundle leaves out.
