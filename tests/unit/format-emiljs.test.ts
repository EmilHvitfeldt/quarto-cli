/*
 * format-emiljs.test.ts
 *
 * Copyright (C) 2026 Posit Software, PBC
 */

import { unitTest } from "../test.ts";
import { assert, assertEquals } from "testing/asserts";
import { toFileUrl } from "../../src/deno_ral/path.ts";
import { resourcePath } from "../../src/core/resources.ts";
import { isEmiljsOutput, isMarkdownOutput } from "../../src/config/format.ts";
import { defaultWriterFormat } from "../../src/format/formats.ts";
import "../../src/format/imports.ts";
import { emiljsFrontMatter } from "../../src/format/emiljs/format-emiljs.ts";
import { createMockFormat } from "./format-utils.ts";

unitTest(
  "emiljs - is a markdown-family format that Pandoc writes as commonmark_x",
  // deno-lint-ignore require-await
  async () => {
    const format = defaultWriterFormat("emiljs");
    assertEquals(format.identifier["base-format"], "emiljs");
    assertEquals(format.pandoc.to, "commonmark_x");
    assertEquals(format.render["output-ext"], "html");
    assert(isEmiljsOutput(format));
    assert(isMarkdownOutput(format));
    // explicit flavor lists are not widened to include emiljs
    assert(!isMarkdownOutput(format, ["gfm", "commonmark"]));
    assert(!isEmiljsOutput(defaultWriterFormat("gfm")));
    assert(!isEmiljsOutput(defaultWriterFormat("html")));
  },
);

unitTest(
  "emiljs front matter - only emil.js's own keys are emitted",
  // deno-lint-ignore require-await
  async () => {
    const format = createMockFormat();
    format.metadata = {
      title: "Penguins",
      author: "Not emitted",
      date: "2026-01-01",
      toc: true,
      theme: "dark",
      aspect: 1.7778,
      lang: "da",
    };
    assertEquals(
      emiljsFrontMatter(format),
      "---\ntitle: Penguins\ntheme: dark\naspect: 1.7778\nlang: da\n---\n\n",
    );
  },
);

unitTest(
  "emiljs front matter - footer, logo and slide-number map into defaults",
  // deno-lint-ignore require-await
  async () => {
    const format = createMockFormat();
    format.metadata = {
      footer: "Team",
      "slide-number": true,
      defaults: { footer: "Kept", "slide-number": false, logo: "logo.png" },
    };
    // a value already under `defaults` wins over the shorthand
    assertEquals(
      emiljsFrontMatter(format),
      "---\ndefaults:\n  footer: Kept\n  slide-number: false\n  logo: logo.png\n---\n\n",
    );

    format.metadata = { footer: "Team", "slide-number": true };
    assertEquals(
      emiljsFrontMatter(format),
      "---\ndefaults:\n  footer: Team\n  slide-number: true\n---\n\n",
    );
  },
);

unitTest(
  "emiljs front matter - none is written when no supported key is set",
  // deno-lint-ignore require-await
  async () => {
    const format = createMockFormat();
    format.metadata = { author: "Nobody", toc: true };
    assertEquals(emiljsFrontMatter(format), undefined);
  },
);

unitTest(
  "emiljs - the vendored build matches the version pinned in `configuration`",
  async () => {
    const configuration = Deno.readTextFileSync(
      new URL("../../configuration", import.meta.url),
    );
    const pinned = /^export EMILJS=(\S+)$/m.exec(configuration)?.[1];
    assert(pinned, "configuration has no EMILJS pin");

    const build = await import(
      toFileUrl(resourcePath("formats/emiljs/emiljs-build.mjs")).href
    );
    assertEquals(build.VERSION, pinned);
    assertEquals(typeof build.buildDeck, "function");
  },
);
