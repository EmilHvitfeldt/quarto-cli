/*
 * format-emiljs.ts
 *
 * Copyright (C) 2026 Posit Software, PBC
 */

import { join } from "../../deno_ral/path.ts";

import {
  kEcho,
  kFigHeight,
  kFigWidth,
  kKeepEmiljs,
  kLang,
  kOutputDivs,
  kOutputExt,
  kWarning,
  kWrap,
} from "../../config/constants.ts";
import {
  Format,
  FormatExtras,
  Metadata,
  PandocFlags,
} from "../../config/types.ts";
import { stringify as stringifyYaml } from "../../core/yaml.ts";
import { formatResourcePath } from "../../core/resources.ts";
import { createFormat } from "../formats-shared.ts";
import { registerWriterFormatHandler } from "../format-handlers.ts";
import { markdownFormat } from "../markdown/format-markdown.ts";

// The keys emil.js accepts in a deck's front matter. emil.js validates the
// document strictly (unknown keys are an error), so only these are emitted.
// Quarto-only keys (author, date, toc, ...) are dropped: there is no generated
// title slide, so there is nothing to put them on.
const kEmiljsDocumentKeys = [
  "title",
  "theme",
  "aspect",
  "dir",
  "writing-mode",
  "autoplay",
  "style",
  "fonts",
  "defaults",
  "vocabulary",
  "shiki",
  "shiki-style",
];

// Reveal-style convenience keys, mapped into emil.js `defaults:` unless the
// document already sets the same key there.
const kEmiljsDefaultsAliases = ["footer", "logo", "slide-number"];

export function emiljsFormat(): Format {
  const displayName = "emil.js";
  return createFormat(displayName, "html", markdownFormat(displayName), {
    execute: {
      [kEcho]: false,
      [kWarning]: false,
      [kFigWidth]: 10,
      [kFigHeight]: 5,
    },
    render: {
      [kOutputExt]: "html",
      [kOutputDivs]: false,
      [kKeepEmiljs]: false,
    },
    pandoc: {
      standalone: true,
      [kWrap]: "none",
    },
    formatExtras: (
      _input: string,
      _markdown: string,
      _flags: PandocFlags,
      format: Format,
    ): Promise<FormatExtras> => {
      const frontMatter = emiljsFrontMatter(format);
      return Promise.resolve({
        templateContext: {
          template: join(
            formatResourcePath("emiljs", "pandoc"),
            "template.md",
          ),
          partials: [],
        },
        // Prepended to Pandoc's output rather than passed through the template,
        // because Pandoc would parse a metadata string as Markdown.
        postprocessors: frontMatter ? [prependFrontMatter(frontMatter)] : [],
      });
    },
  });
}

// The emil.js document front matter (a `---` fenced YAML block), or undefined
// when the document sets none of the supported keys.
export function emiljsFrontMatter(format: Format): string | undefined {
  const source: Metadata = format.metadata || {};
  const out: Metadata = {};

  for (const key of kEmiljsDocumentKeys) {
    if (source[key] !== undefined && source[key] !== null) {
      out[key] = source[key];
    }
  }
  const lang = source[kLang];
  if (typeof lang === "string") {
    out.lang = lang;
  }

  const defaults = { ...(out.defaults as Metadata | undefined) };
  for (const key of kEmiljsDefaultsAliases) {
    if (source[key] !== undefined && defaults[key] === undefined) {
      defaults[key] = source[key];
    }
  }
  if (Object.keys(defaults).length > 0) {
    out.defaults = defaults;
  }

  if (Object.keys(out).length === 0) {
    return undefined;
  }
  return `---\n${
    stringifyYaml(out, { indent: 2, lineWidth: -1 }).trimEnd()
  }\n---\n\n`;
}

function prependFrontMatter(frontMatter: string) {
  return (output: string): Promise<void> => {
    Deno.writeTextFileSync(
      output,
      frontMatter + Deno.readTextFileSync(output),
    );
    return Promise.resolve();
  };
}

registerWriterFormatHandler((format) => {
  if (format === "emiljs") {
    return {
      format: emiljsFormat(),
      pandocTo: "commonmark_x",
    };
  }
});
