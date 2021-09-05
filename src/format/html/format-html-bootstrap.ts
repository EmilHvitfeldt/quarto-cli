/*
* format-html-bootstrap.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { Document, Element } from "deno_dom/deno-dom-native.ts";
import { join } from "path/mod.ts";

import { renderEjs } from "../../core/ejs.ts";
import { formatResourcePath } from "../../core/resources.ts";

import {
  kHtmlMathMethod,
  kLinkCitations,
  kSectionDivs,
  kTheme,
  kTocTitle,
} from "../../config/constants.ts";
import {
  Format,
  FormatExtras,
  kBodyEnvelope,
  kDependencies,
  kHtmlPostprocessors,
  kSassBundles,
  Metadata,
} from "../../config/types.ts";
import { isHtmlOutput } from "../../config/format.ts";
import { PandocFlags } from "../../config/types.ts";
import {
  hasTableOfContents,
  hasTableOfContentsTitle,
} from "../../config/toc.ts";

import { resolveBootstrapScss } from "./format-html-scss.ts";
import {
  kBootstrapDependencyName,
  kDocumentCss,
  kFootnoteSectionTitle,
  kPageLayout,
  kPageLayoutArticle,
  kPageLayoutCustom,
  kPageLayoutNone,
} from "./format-html-shared.ts";

export function formatHasBootstrap(format: Format) {
  if (format && isHtmlOutput(format.pandoc, true)) {
    const theme = format.metadata[kTheme];
    return theme !== "none" && theme !== "pandoc";
  } else {
    return false;
  }
}

// Returns a boolean indicating whether dark mode is requested
// (true or false) or undefined if the dark mode support isn't present
// Key order determines whether dark mode is true or false
export function formatDarkMode(format: Format): boolean | undefined {
  const isBootstrap = formatHasBootstrap(format);
  if (isBootstrap) {
    return darkModeDefault(format.metadata);
  }
  return undefined;
}

function darkModeDefault(metadata?: Metadata): boolean | undefined {
  if (metadata !== undefined) {
    const theme = metadata[kTheme];
    if (theme && typeof (theme) === "object") {
      const keys = Object.keys(theme);
      if (keys.includes("dark")) {
        if (keys[0] === "dark") {
          return true;
        } else {
          return false;
        }
      }
    }
  }
  return undefined;
}

export function formatPageLayout(format: Format) {
  return format.metadata[kPageLayout] || kPageLayoutArticle;
}

export function formatHasPageLayout(format: Format) {
  return format.metadata[kPageLayout] === undefined ||
    format.metadata[kPageLayout] !== kPageLayoutNone;
}

export function formatHasArticlePageLayout(format: Format) {
  return format.metadata[kPageLayout] === undefined ||
    format.metadata[kPageLayout] === kPageLayoutArticle;
}

export function formatHasCustomPageLayout(format: Format) {
  return format.metadata[kPageLayout] == kPageLayoutCustom;
}

export function bootstrapFormatDependency() {
  const boostrapResource = (resource: string) =>
    formatResourcePath(
      "html",
      join("bootstrap", "dist", resource),
    );
  const bootstrapDependency = (resource: string) => ({
    name: resource,
    path: boostrapResource(resource),
  });

  return {
    name: kBootstrapDependencyName,
    stylesheets: [
      bootstrapDependency("bootstrap-icons.css"),
    ],
    scripts: [
      bootstrapDependency("bootstrap.min.js"),
    ],
    resources: [
      bootstrapDependency("bootstrap-icons.woff"),
    ],
  };
}

export function boostrapExtras(
  input: string,
  flags: PandocFlags,
  format: Format,
): FormatExtras {
  const toc = hasTableOfContents(flags, format);

  const renderTemplate = (template: string, pageLayout: string) => {
    return renderEjs(formatResourcePath("html", `templates/${template}`), {
      toc,
      pageLayout,
    });
  };

  const bodyEnvelope = formatHasArticlePageLayout(format)
    ? {
      before: renderTemplate("before-body-article.ejs", kPageLayoutArticle),
      after: renderTemplate("after-body-article.ejs", kPageLayoutArticle),
    }
    : formatHasCustomPageLayout(format)
    ? {
      before: renderTemplate("before-body-custom.ejs", kPageLayoutCustom),
      after: renderTemplate("after-body-custom.ejs", kPageLayoutCustom),
    }
    : undefined;

  return {
    pandoc: {
      [kSectionDivs]: true,
      [kHtmlMathMethod]: "mathjax",
    },
    metadata: {
      [kDocumentCss]: false,
      [kLinkCitations]: true,
    },
    [kTocTitle]: !hasTableOfContentsTitle(flags, format)
      ? "Table of contents"
      : undefined,

    html: {
      [kSassBundles]: resolveBootstrapScss(input, format),
      [kDependencies]: [bootstrapFormatDependency()],
      [kBodyEnvelope]: bodyEnvelope,
      [kHtmlPostprocessors]: [
        bootstrapHtmlPostprocessor(format),
      ],
    },
  };
}

function bootstrapHtmlPostprocessor(format: Format) {
  return (doc: Document): Promise<string[]> => {
    // use display-7 style for title
    const title = doc.querySelector("header > .title");
    if (title) {
      title.classList.add("display-7");
    }

    // add 'lead' to subtitle
    const subtitle = doc.querySelector("header > .subtitle");
    if (subtitle) {
      subtitle.classList.add("lead");
    }

    // add 'blockquote' class to blockquotes
    const blockquotes = doc.querySelectorAll("blockquote");
    for (let i = 0; i < blockquotes.length; i++) {
      const classList = (blockquotes[i] as Element).classList;
      classList.add("blockquote");
    }

    // add figure classes to figures
    const figures = doc.querySelectorAll("figure");
    for (let i = 0; i < figures.length; i++) {
      const figure = (figures[i] as Element);
      figure.classList.add("figure");
      const images = figure.querySelectorAll("img");
      for (let j = 0; j < images.length; j++) {
        (images[j] as Element).classList.add("figure-img");
      }
      const captions = figure.querySelectorAll("figcaption");
      for (let j = 0; j < captions.length; j++) {
        (captions[j] as Element).classList.add("figure-caption");
      }
    }

    // move the toc if there is a sidebar
    const toc = doc.querySelector('nav[role="doc-toc"]');
    const tocSidebar = doc.getElementById("quarto-toc-sidebar");
    if (toc && tocSidebar) {
      tocSidebar.appendChild(toc);

      // add nav-link class to the TOC links
      const tocLinks = doc.querySelectorAll('nav[role="doc-toc"] > ul a');
      for (let i = 0; i < tocLinks.length; i++) {
        // Mark the toc links as nav-links
        const tocLink = tocLinks[i] as Element;
        tocLink.classList.add("nav-link");
        if (i === 0) {
          tocLink.classList.add("active");
        }

        // move the raw href to the target attribute (need the raw value, not the full path)
        if (!tocLink.hasAttribute("data-scroll-target")) {
          tocLink.setAttribute(
            "data-scroll-target",
            tocLink.getAttribute("href")?.replaceAll(":", "\\:"),
          );
        }
      }

      // default collapse non-top level TOC nodes
      const nestedUls = toc.querySelectorAll("ul ul");
      for (let i = 0; i < nestedUls.length; i++) {
        const ul = nestedUls[i] as Element;
        ul.classList.add("collapse");
      }
    }

    // add .table class to pandoc tables
    const tableHeaders = doc.querySelectorAll("tbody > tr:first-child.odd");
    for (let i = 0; i < tableHeaders.length; i++) {
      const th = tableHeaders[i];
      if (th.parentNode?.parentNode) {
        const table = th.parentNode.parentNode as Element;
        table.removeAttribute("style");
        table.classList.add("table");
      }
    }

    // add .table class to pandas tables
    const pandasTables = doc.querySelectorAll("table.dataframe");
    for (let i = 0; i < pandasTables.length; i++) {
      const table = pandasTables[i] as Element;
      table.removeAttribute("border");
      table.classList.add("table");
      const headerRows = table.querySelectorAll("tr");
      for (let r = 0; r < headerRows.length; r++) {
        (headerRows[r] as Element).removeAttribute("style");
      }
      if (
        table.previousElementSibling &&
        table.previousElementSibling.tagName === "STYLE"
      ) {
        table.previousElementSibling.remove();
      }
    }

    // provide data-anchor-id to headings
    const sections = doc.querySelectorAll('section[class^="level"]');
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i] as Element;
      const heading = section.querySelector("h2") ||
        section.querySelector("h3") || section.querySelector("h4") ||
        section.querySelector("h5") || section.querySelector("h6");
      if (heading) {
        heading.setAttribute("data-anchor-id", section.id);
      }
    }

    // provide heading for footnotes
    const footnotes = doc.querySelector('section[role="doc-endnotes"]');
    if (footnotes) {
      const h2 = doc.createElement("h2");
      const title =
        (format.metadata[kFootnoteSectionTitle] || "Footnotes") as string;
      if (typeof (title) == "string" && title !== "none") {
        h2.innerHTML = title;
      }
      footnotes.insertBefore(h2, footnotes.firstChild);
      const hr = footnotes.querySelector("hr");
      if (hr) {
        hr.remove();
      }
    }

    // no resource refs
    return Promise.resolve([]);
  };
}
