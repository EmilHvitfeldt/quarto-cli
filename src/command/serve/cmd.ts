/*
* cmd.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { Command } from "cliffy/command/mod.ts";

import { serve } from "./serve.ts";

export const serveCommand = new Command()
  .name("serve")
  .arguments("<input:string>")
  .option(
    "--no-render",
    "Do not render the document before serving.",
  )
  .option(
    "-p, --port [port:number]",
    "The TCP port that the application should listen on.",
  )
  .option(
    "--host [host:string]",
    "Hostname to bind to (defaults to 127.0.0.1)",
  )
  .description(
    "Serve an interactive document.\n\nBy default, the document will be rendered first and then served. " +
      "If you have previously rendered the document, pass --no-render to skip the rendering step.",
  )
  .example(
    "Serve an interactive Shiny document",
    "quarto run dashboard.Rmd",
  )
  .example(
    "Serve a document without rendering",
    "quarto run dashboard.Rmd --no-render",
  )
  // deno-lint-ignore no-explicit-any
  .action(async (options: any, input: string) => {
    const result = await serve({
      input,
      render: options.render,
      port: options.port,
      host: options.host,
    });

    if (!result.success) {
      // error diagnostics already written to stderr
      Deno.exit(result.code);
    }
  });
