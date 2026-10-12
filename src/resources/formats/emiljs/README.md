# emil.js (vendored)

`emiljs-build.mjs` is the single-file build of [emil.js](https://github.com/EmilHvitfeldt/emil.js) that `format: emiljs` runs in-process on Quarto's own Deno. It turns the Markdown that Pandoc writes (`<stem>-emiljs.md`) into the final deck HTML. It is generated, so do not edit it.

| | |
|---|---|
| Version | 0.1.0 (`EMILJS` in `configuration`) |
| Source | `@emiljs/cli` at emil.js commit `fd0b09dbdcb72ea9bee51ce657e05cf55afe1ff3` (`pnpm --filter @emiljs/cli embed:release`) |
| SHA-256 | `c27587f8f4926e4f8e1b464ee3fc576342dbdcd78076d3940cd23a9bca1e6de7` |
| License | MIT, see `LICENSE`; bundled dependencies in `LICENSE-3RD-PARTY.txt` |

## Updating

1. In the emil.js repo, `pnpm install && pnpm -r build && pnpm --filter @emiljs/cli embed:release`, or download the same files from the GitHub release for the tag.
2. Copy `emiljs-build.mjs`, `LICENSE` and `LICENSE-3RD-PARTY.txt` from `packages/cli/dist/embed-release/` into this folder.
3. Update the version, commit and SHA-256 above and `EMILJS` in `configuration` (a unit test checks that the bundle's `VERSION` matches the pin).

## Development override

Set `QUARTO_EMILJS_BUILD` to the path of a local `emiljs-build.mjs` to render with a build other than the vendored one.

## Scope of the embedded build

It writes one HTML file with CSS and the runtime inlined. It does not support npm-package themes, `ogImage` social cards, `--fetch-fonts` or the sanitizing mode, because those need a browser, the network or dependencies the bundle leaves out.
