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
  resolve,
  toFileUrl,
} from "../../deno_ral/path.ts";
import { ensureDirSync, existsSync, safeRemoveSync } from "../../deno_ral/fs.ts";
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
import { readYamlFromString } from "../../core/yaml.ts";
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
    assetInlineLimit?: number;
    extensions?: EmiljsExtensionInput[];
    onWarning?: (warning: { code: string; message: string }) => void;
  }): { outFile: string };
  // The loader pieces the bundle shares with the `emiljs` CLI, so a document's
  // `extensions:` list is read, and an extension folder loaded, the same way.
  normalizeEntries(entries: unknown): EmiljsEntry[];
  loadExtensionFolder(
    dir: string,
    reader: EmiljsFileReader,
  ): Promise<Record<string, unknown>>;
}

interface EmiljsEntry {
  kind: "name" | "path";
  ref: string;
  options: Record<string, unknown>;
  enabled: boolean;
}

interface EmiljsFileReader {
  readText(path: string): string | undefined;
  importModule(path: string): Promise<unknown>;
}

// An extension object with where it came from and its `options` entry.
interface EmiljsExtensionInput {
  extension: Record<string, unknown>;
  options: Record<string, unknown>;
  source: string;
}

// QUARTO_EMILJS_BUILD points at a local emiljs-build.mjs (for developing
// emil.js against Quarto), in the spirit of QUARTO_TYPST.
async function loadEmiljsBuild(): Promise<EmiljsBuild> {
  const path = Deno.env.get("QUARTO_EMILJS_BUILD") ||
    resourcePath("formats/emiljs/emiljs-build.mjs");
  return await import(toFileUrl(path).href) as EmiljsBuild;
}

// Extensions emil.js carries itself: the embedded build registers them from the
// document, so the host does not load them. `graphviz` is first-party but is not
// in the single-file build (its WASM would double the bundle).
const kBuiltInExtensions = ["shiki", "katex"];
const kUnavailableExtensions = ["graphviz"];

const emiljsFileReader: EmiljsFileReader = {
  readText(path) {
    try {
      return Deno.readTextFileSync(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return undefined;
      }
      throw e;
    }
  },
  // A fresh import each render, so `quarto preview` sees an edited entry file.
  importModule(path) {
    return import(`${toFileUrl(path).href}?v=${Date.now()}`);
  },
};

// The document's own front matter: the leading `---` block of the Markdown
// Pandoc wrote (per-slide blocks come after it and are not the document's).
function emiljsDocumentExtensions(markdown: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  if (!match) {
    return undefined;
  }
  const metadata = readYamlFromString(match[1]) as Record<string, unknown>;
  return metadata?.extensions;
}

// Load the extensions the document lists, as `emiljs build` does: a bare name is
// a folder (or file) in `emiljs-extensions/` next to the document, a `./` or `/`
// entry is a path from the document. Quarto trusts the document it renders just
// as the CLI does, so a listed extension runs.
async function loadEmiljsExtensions(
  emiljs: EmiljsBuild,
  markdown: string,
  documentDir: string,
): Promise<EmiljsExtensionInput[]> {
  const entries = emiljs.normalizeEntries(emiljsDocumentExtensions(markdown));
  const loaded: EmiljsExtensionInput[] = [];
  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }
    if (entry.kind === "name" && kBuiltInExtensions.includes(entry.ref)) {
      continue;
    }
    if (entry.kind === "name" && kUnavailableExtensions.includes(entry.ref)) {
      warning(
        `emil.js extension "${entry.ref}" is not available in format: emiljs yet, so it was not loaded`,
      );
      continue;
    }
    let path: string;
    let source: string;
    if (entry.kind === "path") {
      path = resolve(documentDir, entry.ref);
      source = entry.ref;
    } else {
      const local = join(documentDir, "emiljs-extensions");
      const found = [entry.ref, `${entry.ref}.js`, `${entry.ref}.mjs`]
        .map((name) => join(local, name))
        .find((candidate) => existsSync(candidate));
      if (!found) {
        throw new Error(
          `extension "${entry.ref}" is not built in and was not found in emiljs-extensions/ next to the document (looked for emiljs-extensions/${entry.ref}/ and emiljs-extensions/${entry.ref}.js)`,
        );
      }
      path = found;
      source = `emiljs-extensions/${basename(found)}`;
    }
    if (!existsSync(path)) {
      throw new Error(`extension "${entry.ref}": no such file or folder (${path})`);
    }
    try {
      const extension = Deno.statSync(path).isDirectory
        ? await emiljs.loadExtensionFolder(path, emiljsFileReader)
        : await loadEmiljsModule(path);
      loaded.push({ extension, options: entry.options, source });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`extension "${entry.ref}": ${detail}`);
    }
  }
  return loaded;
}

async function loadEmiljsModule(path: string): Promise<Record<string, unknown>> {
  const mod = await emiljsFileReader.importModule(path) as {
    default?: unknown;
  };
  const exported = "default" in mod ? mod.default : mod;
  if (
    !exported || typeof exported !== "object" ||
    typeof (exported as { name?: unknown }).name !== "string"
  ) {
    throw new Error(
      `${path} must default-export an extension object (defineExtension({ name, apiVersion, ... }))`,
    );
  }
  return exported as Record<string, unknown>;
}

export function useEmiljsOutputRecipe(format: Format) {
  return isEmiljsOutput(format) && format.render[kOutputExt] === "html";
}

export function emiljsOutputRecipe(
  input: string,
  finalOutput: string,
  options: RenderOptions,
  format: Format,
  source: string,
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
    const selfContained = isSelfContained(options.flags || {}, liveFormat);
    try {
      // The embedded build never loads modules, so the document's extensions
      // are loaded here, with the shared reader the bundle exports.
      const extensions = await loadEmiljsExtensions(
        emiljs,
        Deno.readTextFileSync(mdInput),
        inputDir,
      );
      emiljs.buildDeck({
        extensions,
        input: mdInput,
        outFile: htmlOutput,
        // embed-resources inlines the figures too; otherwise they stay files
        // under <stem>_files/ and resolve relative to the .html
        assets: selfContained ? "inline" : "external",
        // Quarto removes <stem>_files for self-contained output, so nothing may
        // stay external: a widget's script (Plotly is several MB) is inlined too
        assetInlineLimit: selfContained ? Number.MAX_SAFE_INTEGER : undefined,
        onWarning: (w) => warning(w.message),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new ErrorEx(
        "Error",
        `emil.js could not build ${basename(source)}: ${detail}`,
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
