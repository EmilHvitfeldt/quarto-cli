/*
* watch.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { warning } from "log/mod.ts";
import { extname, join, relative } from "path/mod.ts";
import { existsSync } from "fs/mod.ts";

import * as ld from "../../core/lodash.ts";

import { pathWithForwardSlashes, removeIfExists } from "../../core/path.ts";
import { md5Hash } from "../../core/hash.ts";

import { logError } from "../../core/log.ts";
import { isRevealjsOutput } from "../../config/format.ts";

import { kProjectLibDir, ProjectContext } from "../../project/types.ts";
import { projectOutputDir } from "../../project/project-shared.ts";
import { projectContext } from "../../project/project-context.ts";

import { copyProjectForServe } from "./serve-shared.ts";

import { ProjectWatcher, ServeOptions } from "./types.ts";
import { httpDevServer } from "../../core/http-devserver.ts";
import { RenderFlags, RenderResult } from "../../command/render/types.ts";
import { renderProject } from "../../command/render/project.ts";
import { PromiseQueue } from "../../core/promise.ts";
import { render } from "../../command/render/render-shared.ts";
import { isRStudio } from "../../core/platform.ts";
import { inputTargetIndexForOutputFile } from "../../project/project-index.ts";
import { createTempContext } from "../../core/temp.ts";
import { watchForFileChanges } from "../../core/watch.ts";

interface WatchChanges {
  config?: boolean;
  output?: boolean;
}

export function watchProject(
  project: ProjectContext,
  serveProject: ProjectContext,
  resourceFiles: string[],
  flags: RenderFlags,
  pandocArgs: string[],
  options: ServeOptions,
  renderingOnReload: boolean,
  renderQueue: PromiseQueue<RenderResult>,
  outputFile?: () => string,
): Promise<ProjectWatcher> {
  // helper to refresh project config
  const refreshProjectConfig = async () => {
    // get project and temporary serve project
    project = (await projectContext(project.dir, flags, false, true))!;
    serveProject =
      (await projectContext(serveProject.dir, flags, false, true))!;
  };

  // proj dir
  const projDir = Deno.realPathSync(project.dir);
  const projDirHidden = projDir + "/.";

  // output dir
  const outputDir = projectOutputDir(project);

  // lib dir
  const libDirConfig = project.config?.project[kProjectLibDir];
  const libDirSource = libDirConfig
    ? join(project.dir, libDirConfig)
    : undefined;
  const libDir = libDirConfig ? join(outputDir, libDirConfig) : undefined;

  // if any of the paths are in the output dir (but not the lib dir) then return true
  const inOutputDir = (path: string) => {
    if (path.startsWith(outputDir)) {
      // exclude lib dir
      if (libDir && path.startsWith(libDir)) {
        return false;
      } else {
        return true;
      }
    } else {
      return false;
    }
  };

  // is this a resource file?
  const isResourceFile = (path: string) => {
    // exclude libdir
    if (libDirSource && path.startsWith(libDirSource)) {
      return false;
    } else {
      // check project resources and resources derived from
      // indvidual files
      return project.files.resources?.includes(path) ||
        resourceFiles.includes(path);
    }
  };

  // is this an input file?
  const isInputFile = (path: string) => {
    return project.files.input.includes(path);
  };

  // track every path that has been modified since the last reload
  const modified: string[] = [];

  // track rendered inputs so we don't double render if the file notifications are chatty
  const rendered = new Map<string, string>();

  // handle a watch event (return true if a reload should occur)
  const handleWatchEvent = async (
    event: Deno.FsEvent,
  ): Promise<WatchChanges | undefined> => {
    try {
      // filter out paths in hidden folders (e.g. .quarto, .git, .Rproj.user)
      const paths = ld.uniq(
        event.paths.filter((path) => !path.startsWith(projDirHidden)),
      );
      if (paths.length === 0) {
        return;
      }

      if (["modify", "create"].includes(event.kind)) {
        // note modified
        modified.push(...paths);

        // render changed input files (if we are watching). then return false
        // as another set of events will come in to trigger the reload
        if (options.watchInputs) {
          // get inputs (filter by whether the last time we rendered
          // this input had the exact same content hash)
          const inputs = paths.filter(isInputFile).filter((input) => {
            return !rendered.has(input) ||
              rendered.get(input) !== md5Hash(Deno.readTextFileSync(input));
          });
          if (inputs.length) {
            // record rendered time
            for (const input of inputs) {
              rendered.set(input, md5Hash(Deno.readTextFileSync(input)));
            }
            // render
            const tempContext = createTempContext();
            try {
              const result = await renderQueue.enqueue(() => {
                if (inputs.length > 1) {
                  return renderProject(
                    project!,
                    {
                      temp: tempContext,
                      progress: true,
                      flags,
                      pandocArgs,
                    },
                    inputs,
                  );
                } else {
                  return render(inputs[0], {
                    temp: tempContext,
                    flags,
                    pandocArgs: pandocArgs,
                  });
                }
              });

              if (result.error) {
                if (result.error.message) {
                  logError(result.error);
                }
                return undefined;
              } else {
                return {
                  config: false,
                  output: true,
                };
              }
            } finally {
              tempContext.cleanup();
            }
          }
        }

        const configFile = paths.some((path) =>
          (project.files.config || []).includes(path)
        );
        const inputFileRemoved = project.files.input.some((file) =>
          !existsSync(file)
        );
        const configResourceFile = paths.some((path) =>
          (project.files.configResources || []).includes(path)
        );
        const resourceFile = paths.some(isResourceFile);

        const outputDirFile = !outputFile && paths.some(inOutputDir);

        const reload = configFile || configResourceFile || resourceFile ||
          outputDirFile || inputFileRemoved;

        if (reload) {
          return {
            config: configFile || inputFileRemoved,
            output: outputDirFile,
          };
        } else {
          return;
        }
      } else {
        return;
      }
    } catch (e) {
      logError(e);
      return;
    }
  };

  // http devserver
  const devServer = httpDevServer(options.port);

  // debounced function for notifying all clients of a change
  // (ensures that we wait for bulk file copying to complete
  // before triggering the reload)
  const reloadClients = ld.debounce(async (changes: WatchChanges) => {
    const tempContext = createTempContext();
    try {
      // render project for non-output changes if we aren't aleady rendering on reload
      if (!changes.output && !renderingOnReload) {
        await refreshProjectConfig();
        const result = await renderQueue.enqueue(() =>
          renderProject(
            project,
            {
              temp: tempContext,
              useFreezer: true,
              devServerReload: true,
              flags,
              pandocArgs,
            },
          )
        );
        if (result.error) {
          logError(result.error);
        }
      }

      // copy the project (refresh if requested)
      if (changes.config) {
        // remove input files
        serveProject.files.input.forEach(removeIfExists);
      }
      copyProjectForServe(project, !renderingOnReload, serveProject.dir);
      if (changes.config) {
        await refreshProjectConfig();
      }

      // see if there is a reload target (last html file modified)
      const lastHtmlFile = (ld.uniq(modified) as string[]).reverse().find(
        (file) => {
          return extname(file) === ".html";
        },
      );

      // clear out the modified list
      modified.splice(0, modified.length);

      // if this is a reveal presentation running inside rstudio then bail
      // because rstudio is handling preview separately
      if (lastHtmlFile && await preventReload(project, lastHtmlFile, options)) {
        return;
      }

      // verify that its okay to reload this file
      let reloadTarget = "";
      if (lastHtmlFile && options.navigate) {
        if (lastHtmlFile.startsWith(outputDir)) {
          reloadTarget = relative(outputDir, lastHtmlFile);
        } else {
          reloadTarget = relative(projDir, lastHtmlFile);
        }
        if (existsSync(join(outputDir, reloadTarget))) {
          reloadTarget = "/" + pathWithForwardSlashes(reloadTarget);
        } else {
          reloadTarget = "";
        }
      }

      // reload clients
      devServer.reloadClients(reloadTarget);
    } catch (e) {
      logError(e);
    } finally {
      tempContext.cleanup();
    }
  }, 100);

  // if we have been given an explicit outputFile function
  // for monitoring then do that with a timer (this is for PDFs which
  // sometimes miss their notification b/c there are too many fs
  // events generated by latex compilatons)
  if (outputFile) {
    const kPollingInterval = 100;
    const lastOutput = new Map<string, Date | null>();
    const pollForOutputChange = async () => {
      const file = outputFile();
      if (existsSync(file)) {
        const lastMod = Deno.statSync(file).mtime;
        const prevMod = lastOutput.get(file);
        lastOutput.set(file, lastMod);
        if (
          prevMod !== undefined && lastMod?.getTime() !== prevMod?.getTime()
        ) {
          await reloadClients({ output: true });
        }
      }
      setTimeout(pollForOutputChange, 100);
    };
    setTimeout(pollForOutputChange, kPollingInterval);
  }

  // helper function to handle watch event
  const handleFileChange = async (event: Deno.FsEvent) => {
    try {
      const result = await handleWatchEvent(event);
      if (result) {
        await reloadClients(result);
      }
    } catch (e) {
      logError(e);
    }
  };

  // watch input and config files + any special outputFile (special
  // outputFile is for PDFs which sometimes miss their notification b/c
  // there are too many fs events generated by latex compilatons)
  // note that we don't do this using Deno.watchFS b/c we'd need to
  // watch the project dir resursively and this could create thousands
  // of watchers esp. if there is a .git directory and/or env dirs
  const filesWatcher = watchForFileChanges(() => {
    const files = (options.watchInputs ? project.files.input : [])
      .concat(project.files.config || [])
      .concat(project.files.configResources || [])
      .concat(project.files.resources || []);
    return files;
  });
  const watchForInputChanges = async () => {
    for await (const event of filesWatcher) {
      handleFileChange(event);
    }
  };
  watchForInputChanges();

  // watch project output dir recursively (can fail if the os
  // is out of file watching handles so handle that gracefully)
  try {
    const watcher = Deno.watchFs(projectOutputDir(project), {
      recursive: true,
    });
    const watchForOutputChanges = async () => {
      for await (const event of watcher) {
        handleFileChange(event);
      }
    };
    watchForOutputChanges();
  } catch (err) {
    warning(
      "Error attempting to initialize preview file watcher.\n" +
        "You may need to manually refresh to see changes.\n" +
        "(" + err.mesage + ")",
    );
  }

  // return watcher interface
  return Promise.resolve({
    handle: (req: Request) => {
      return devServer.handle(req);
    },
    connect: devServer.connect,
    injectClient: (file: Uint8Array, inputFile?: string) => {
      return devServer.injectClient(file, inputFile);
    },
    project: () => project,
    serveProject: () => serveProject,
    refreshProject: async () => {
      await refreshProjectConfig();
      return serveProject;
    },
  });
}

async function preventReload(
  project: ProjectContext,
  lastHtmlFile: string,
  options: ServeOptions,
) {
  // if we are in rstudio with watchInputs off then we are using rstudio tooling
  // for the site preview -- in this case presentations are going to be handled
  // separately by the presentation pane
  if (isRStudio() && !options.watchInputs) {
    const index = await inputTargetIndexForOutputFile(
      project,
      relative(projectOutputDir(project), lastHtmlFile),
    );
    if (index) {
      return isRevealjsOutput(Object.keys(index.formats)[0]);
    }
  }

  return false;
}
