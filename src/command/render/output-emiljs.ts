/*
 * output-emiljs.ts
 *
 * Copyright (C) 2026 Posit Software, PBC
 */

import {
  basename,
  dirname,
  join,
  normalize,
  relative,
  toFileUrl,
} from "../../deno_ral/path.ts";
import { ensureDirSync, safeRemoveSync } from "../../deno_ral/fs.ts";
import { warning } from "../../deno_ral/log.ts";

import {
  kKeepEmiljs,
  kOutputExt,
  kOutputFile,
} from "../../config/constants.ts";
import { Format } from "../../config/types.ts";
import { isEmiljsOutput } from "../../config/format.ts";
import { ErrorEx } from "../../core/lib/error.ts";
import { writeFileToStdout } from "../../core/console.ts";
import { dirAndStem, expandPath } from "../../core/path.ts";
import { resourcePath } from "../../core/resources.ts";
import { kStdOut, replacePandocOutputArg } from "./flags.ts";
import { isSelfContained } from "./render-info.ts";
import { OutputRecipe, PandocOptions, RenderOptions } from "./types.ts";
import { normalizeOutputPath } from "./output-shared.ts";

// The surface of the vendored emil.js build that Quarto uses
// (src/resources/formats/emiljs/emiljs-build.mjs).
interface EmiljsBuild {
  VERSION: string;
  buildDeck(options: {
    input: string;
    outFile: string;
    assets?: "inline" | "external";
    onWarning?: (warning: { code: string; message: string }) => void;
  }): { outFile: string };
}

// QUARTO_EMILJS_BUILD points at a local emiljs-build.mjs (for developing
// emil.js against Quarto), in the spirit of QUARTO_TYPST.
async function loadEmiljsBuild(): Promise<EmiljsBuild> {
  const path = Deno.env.get("QUARTO_EMILJS_BUILD") ||
    resourcePath("formats/emiljs/emiljs-build.mjs");
  return await import(toFileUrl(path).href) as EmiljsBuild;
}

export function useEmiljsOutputRecipe(format: Format) {
  return isEmiljsOutput(format) && format.render[kOutputExt] === "html";
}

export function emiljsOutputRecipe(
  input: string,
  finalOutput: string,
  options: RenderOptions,
  format: Format,
): OutputRecipe {
  // Pandoc writes an intermediate Markdown file (emil.js's dialect), which we
  // then build into the final .html. `-emiljs.md` follows Quarto's `-<format>.md`
  // naming; `keep-md` would use `.emiljs.md`.
  const [inputDir, inputStem] = dirAndStem(input);
  const output = inputStem + "-emiljs.md";
  let args = options.pandocArgs || [];
  const pandoc = { ...format.pandoc };
  if (options.flags?.output) {
    args = replacePandocOutputArg(args, output);
  } else {
    pandoc[kOutputFile] = output;
  }

  const complete = async (pandocOptions: PandocOptions) => {
    const liveFormat = pandocOptions.format;
    const mdInput = join(inputDir, output);
    const htmlOutput = join(inputDir, inputStem + ".html");

    const emiljs = await loadEmiljsBuild();
    try {
      emiljs.buildDeck({
        input: mdInput,
        outFile: htmlOutput,
        // embed-resources inlines the figures too; otherwise they stay files
        // under <stem>_files/ and resolve relative to the .html
        assets: isSelfContained(options.flags || {}, liveFormat)
          ? "inline"
          : "external",
        onWarning: (w) => warning(w.message),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new ErrorEx(
        "Error",
        `emil.js could not build ${basename(input)}: ${detail}`,
        false,
        false,
      );
    }

    // keep the intermediate Markdown if requested
    if (!liveFormat.render[kKeepEmiljs]) {
      safeRemoveSync(mdInput);
    }

    // copy (or write for stdout) the built html to the final output location
    if (finalOutput) {
      if (finalOutput === kStdOut) {
        writeFileToStdout(htmlOutput);
        safeRemoveSync(htmlOutput);
      } else {
        const outputHtml = expandPath(finalOutput);
        if (normalize(htmlOutput) !== normalize(outputHtml)) {
          ensureDirSync(dirname(outputHtml));
          Deno.renameSync(htmlOutput, outputHtml);
        }
      }
      return normalizeOutputPath(mdInput, finalOutput);
    } else {
      return normalizeOutputPath(mdInput, htmlOutput);
    }
  };

  const htmlFinal = finalOutput
    ? finalOutput === kStdOut
      ? undefined
      : normalizeOutputPath(input, finalOutput)
    : normalizeOutputPath(input, join(inputDir, inputStem + ".html"));

  return {
    output,
    keepYaml: false,
    args,
    format: { ...format, pandoc },
    complete,
    finalOutput: htmlFinal ? relative(inputDir, htmlFinal) : undefined,
  };
}
