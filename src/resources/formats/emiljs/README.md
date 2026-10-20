# emil.js (vendored)

`emiljs-build.mjs` is the single-file build of [emil.js](https://github.com/EmilHvitfeldt/emil.js) that `format: emiljs` runs in-process on Quarto's own Deno. It turns the Markdown that Pandoc writes (`<stem>-emiljs.md`) into the final deck HTML. It is generated, so do not edit it.

| | |
|---|---|
| Version | 0.1.0 (`EMILJS` in `configuration`) |
| Source | `@emiljs/cli` at emil.js commit `042e86781ead0a868336f545887ebdc1d7466c98` (`pnpm --filter @emiljs/cli embed:release`) |
| SHA-256 | `a50220f92b081bb5020259a734efdcdf5f2584cf70cd99ed2b6a5b6f7cf80fad` |
| License | MIT, see `LICENSE`; bundled dependencies in `LICENSE-3RD-PARTY.txt` |

## Updating

1. In the emil.js repo, `pnpm install && pnpm -r build && pnpm --filter @emiljs/cli embed:release`, or download the same files from the GitHub release for the tag.
2. Copy `emiljs-build.mjs`, `LICENSE` and `LICENSE-3RD-PARTY.txt` from `packages/cli/dist/embed-release/` into this folder.
3. Update the version, commit and SHA-256 above and `EMILJS` in `configuration` (a unit test checks that the bundle's `VERSION` matches the pin).

## Development override

Set `QUARTO_EMILJS_BUILD` to the path of a local `emiljs-build.mjs` to render with a build other than the vendored one.

## Scope of the embedded build

It writes one HTML file with CSS and the runtime inlined. It does not support npm-package themes, `ogImage` social cards, `--fetch-fonts` or the sanitizing mode, because those need a browser, the network or dependencies the bundle leaves out.
