/*
 * slide-options.ts
 *
 * Copyright (C) 2026 Posit Software, PBC
 */

import { readYamlFromMarkdown, readYamlFromString } from "../../core/yaml.ts";

const kFence = /^-{3,}\s*$/;
const kFenceEnd = /^(-{3,}|\.{3})\s*$/;
const kCodeFence = /^\s*(```+|~~~+)/;
const kBlank = /^\s*$/;

// Pandoc reads a `---` block in the middle of a document as metadata and drops
// it from the content, so a slide's own `---` options (emil.js's per-slide
// frontmatter) never reaches the filters. Rewrite each one into an `emiljs`
// fenced code block before Pandoc runs; the emiljs Lua filter turns that back
// into a `---` block in the output. Only what Pandoc itself would take as
// metadata is rewritten: an opening `---` after a blank line and directly
// followed by text, closed by `---` or `...`, that is a YAML mapping. Code
// fences and the document's own front matter are left alone.
export function protectSlideOptions(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;

  // the document front matter at the top is Quarto's, not a slide's
  let first = 0;
  while (first < lines.length && kBlank.test(lines[first])) first++;
  if (first < lines.length && kFence.test(lines[first])) {
    for (let j = first + 1; j < lines.length; j++) {
      if (kFenceEnd.test(lines[j])) {
        out.push(...lines.slice(0, j + 1));
        i = j + 1;
        break;
      }
    }
  }

  let fence: string | undefined;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const code = kCodeFence.exec(line);
    if (code) {
      const marker = code[1];
      if (fence === undefined) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      out.push(line);
      continue;
    }

    const previousBlank = out.length === 0 || kBlank.test(out[out.length - 1]);
    if (
      fence === undefined && previousBlank && kFence.test(line) &&
      i + 1 < lines.length && !kBlank.test(lines[i + 1])
    ) {
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (kCodeFence.test(lines[j])) break;
        if (kFenceEnd.test(lines[j])) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        const body = lines.slice(i + 1, close).join("\n");
        if (isMapping(body)) {
          out.push("```emiljs", ...lines.slice(i + 1, close), "```");
          i = close;
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function isMapping(yaml: string): boolean {
  try {
    const value = readYamlFromString(yaml);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

// Whether a document is being rendered to emil.js alone: `--to emiljs`, or a
// front matter `format` that is just `emiljs`. A document that also renders to
// other formats is left alone, as an `emiljs` fence would show in them.
export function targetsEmiljs(
  markdown: string,
  to: string | undefined,
): boolean {
  if (to !== undefined) {
    return to.split("+")[0] === "emiljs";
  }
  try {
    const format = readYamlFromMarkdown(markdown).format;
    if (typeof format === "string") {
      return format.split("+")[0] === "emiljs";
    }
    if (typeof format === "object" && format !== null) {
      const keys = Object.keys(format);
      return keys.length === 1 && keys[0].split("+")[0] === "emiljs";
    }
  } catch {
    // invalid YAML is reported later
  }
  return false;
}
