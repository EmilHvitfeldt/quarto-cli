-- emiljs.lua
-- Copyright (C) 2026 Posit Software, PBC

-- Reshapes the document into the Markdown dialect that emil.js reads. Pandoc's
-- commonmark_x writer then prints it, and the emiljs output recipe builds the
-- result into HTML. Custom nodes (figures, tables, callouts, tabsets) are
-- rendered in customnodes/emiljs.lua; this filter handles the rest.

-- Quarto-internal markup that means nothing to emil.js (and, for some
-- attributes, that emil.js would reject: it reserves `width`, `height` and a
-- few other attribute names for per-block positioning).
local function is_internal_class(class)
  return class == "cell" or class == "sourceCode" or class == "hidden" or
    class == "panel-tabset" or class == "number-lines" or
    class:match("^cell%-") ~= nil or class:match("^quarto%-") ~= nil or
    class:match("^fig%-") ~= nil or class:match("^layout") ~= nil or
    class:match("^column%-") ~= nil
end

local function is_internal_key(key)
  return key:match("^fig%-") ~= nil or key:match("^tbl%-") ~= nil or
    key:match("^lst%-") ~= nil or key:match("^layout") ~= nil or
    key:match("^cap%-") ~= nil or key:match("^code%-") ~= nil or
    key:match("^ref%-") ~= nil or
    key:match("^output") ~= nil or key:match("^quarto%-") ~= nil
end

-- The attributes worth keeping: the author's own id, classes and attributes.
local function clean_attr(attr, keep_id)
  local classes = pandoc.List()
  for _, class in ipairs(attr.classes) do
    if not is_internal_class(class) then
      classes:insert(class)
    end
  end
  local attributes = {}
  for key, value in pairs(attr.attributes) do
    if not is_internal_key(key) then
      attributes[#attributes + 1] = { key, value }
    end
  end
  return pandoc.Attr(keep_id and attr.identifier or "", classes, attributes)
end

local function is_empty_attr(attr)
  return attr.identifier == "" and #attr.classes == 0 and #attr.attributes == 0
end

local function html_escape(text)
  return (text:gsub("&", "&amp;"):gsub('"', "&quot;"):gsub("<", "&lt;"))
end

local function is_empty_div(block)
  return block.t == "Div" and #block.content == 0
end

local function is_slide_options(block)
  return block.t == "CodeBlock" and block.classes:includes("yaml") and
    block.classes:includes("slide")
end

-- Per-slide options: the first block of a slide, a code block with classes
-- `yaml` and `slide`, becomes that slide's own frontmatter (a `---` fenced YAML
-- block at the start of the slide). emil.js validates it. A `---` block cannot
-- be written directly in a .qmd, because Pandoc would read it as metadata.
local function slide_blocks(slide)
  local out = pandoc.Blocks({})
  for i, block in ipairs(slide) do
    if is_slide_options(block) then
      if i == 1 then
        out:insert(pandoc.RawBlock("markdown", "---\n" .. block.text:gsub("%s+$", "") .. "\n---"))
      else
        emiljs_warn_once("slide-options-position",
          "a `{.yaml .slide}` options block must be the first block of its slide; it was ignored.")
      end
    else
      out:insert(block)
    end
  end
  return out
end

-- Only a top-level horizontal rule is a slide break. Pandoc prints one as a long
-- dashed line, which emil.js would read as a YAML fence, so write `***` instead.
-- Leading, trailing and doubled rules would make empty slides, so collapse them.
local function slide_breaks(blocks)
  local slides = { pandoc.Blocks({}) }
  for _, block in ipairs(blocks) do
    if block.t == "HorizontalRule" then
      slides[#slides + 1] = pandoc.Blocks({})
    else
      slides[#slides]:insert(block)
    end
  end

  local out = pandoc.Blocks({})
  for _, slide in ipairs(slides) do
    -- Quarto can leave empty divs after the content, which do not count
    local has_content = false
    for _, block in ipairs(slide) do
      if not is_empty_div(block) then
        has_content = true
      end
    end
    if has_content then
      if #out > 0 then
        out:insert(pandoc.RawBlock("markdown", "***"))
      end
      out:extend(slide_blocks(slide))
    end
  end
  return out
end

-- Alt text, and the width and height Quarto puts on images. emil.js reserves
-- bare `width` and `height` attributes for per-block positioning (0 to 100), so
-- an image's size is written as inline CSS instead.
local function fix_image(img)
  local alt = img.attributes["fig-alt"] or img.attributes["alt"]
  if #img.caption == 0 and alt ~= nil and alt ~= "" then
    img.caption = pandoc.Inlines({ pandoc.Str(alt) })
  end

  local css = {}
  for _, key in ipairs({ "width", "height" }) do
    local value = img.attributes[key]
    if value ~= nil then
      if value:match("^%d+%.?%d*$") then
        value = value .. "px"
      end
      css[#css + 1] = key .. ": " .. value
    end
  end
  local style = img.attributes["style"]
  if style ~= nil and style ~= "" then
    css[#css + 1] = (style:gsub(";%s*$", ""))
  end

  img.attr = clean_attr(img.attr, false)
  img.attributes["alt"] = nil
  img.attributes["width"] = nil
  img.attributes["height"] = nil
  img.attributes["style"] = nil
  if #css > 0 then
    img.attributes["style"] = table.concat(css, "; ")
  end
  return img
end

-- `.column` widths are a percentage in Quarto (`60%`) and a bare number, 0 to
-- 100, in emil.js.
local function fix_column(div)
  local width = div.attributes["width"]
  if width ~= nil then
    local percent = width:match("^(%d+%.?%d*)%%$")
    if percent ~= nil then
      div.attributes["width"] = percent
    else
      emiljs_warn_once("column-width",
        "column widths other than percentages are not supported; `width=\"" .. width .. "\"` was dropped.")
      div.attributes["width"] = nil
    end
  end
end

local function fix_div(div)
  if div.classes:includes("notes") then
    emiljs_warn_once("notes", "speaker notes are not supported yet; `.notes` content was removed.")
    return pandoc.Blocks({})
  end

  div.attr = clean_attr(div.attr, true)
  if div.classes:includes("column") then
    fix_column(div)
  end

  -- an empty or attribute-free wrapper (Quarto leaves some) only prints as `::: {}`
  if #div.content == 0 then
    return pandoc.Blocks({})
  end
  if is_empty_attr(div.attr) then
    return div.content
  end
  return div
end

-- A code block keeps its language and nothing else: Quarto's `cell-code` and
-- `sourceCode` classes, filenames and line numbers have no emil.js meaning.
local function fix_code_block(block)
  if is_slide_options(block) then
    return nil
  end
  -- Quarto turns `code-line-numbers` into Pandoc's `number-lines` class
  if block.classes:includes("number-lines") then
    emiljs_warn_once("code-line-numbers", "code line numbers are not supported yet; they were ignored.")
  end
  local clean = clean_attr(block.attr, false)
  local lang = nil
  for _, class in ipairs(clean.classes) do
    lang = lang or class
  end
  block.attr = pandoc.Attr("", lang and { lang } or {}, {})
  return block
end

-- commonmark_x prints a bracketed span as `[text]{.cls}`, which emil.js shows
-- literally, so write the equivalent inline HTML.
local function fix_span(span)
  local attr = clean_attr(span.attr, true)
  if is_empty_attr(attr) then
    return span.content
  end
  local html = "<span"
  if attr.identifier ~= "" then
    html = html .. ' id="' .. html_escape(attr.identifier) .. '"'
  end
  if #attr.classes > 0 then
    html = html .. ' class="' .. html_escape(table.concat(attr.classes, " ")) .. '"'
  end
  for key, value in pairs(attr.attributes) do
    html = html .. " " .. key .. '="' .. html_escape(value) .. '"'
  end
  html = html .. ">"

  local out = pandoc.Inlines({ pandoc.RawInline("markdown", html) })
  out:extend(span.content)
  out:insert(pandoc.RawInline("markdown", "</span>"))
  return out
end

-- A table's own caption (a labeled one is a float, rendered in
-- customnodes/emiljs.lua) is written as a paragraph after it.
local function fix_table(tbl)
  local long = tbl.caption.long
  if long ~= nil and #long > 0 then
    local inlines = pandoc.utils.blocks_to_inlines(long)
    local caption = pandoc.Para(inlines)
    caption.content:insert(pandoc.RawInline("markdown", " {.caption}"))
    tbl.caption = pandoc.Caption({})
    return { tbl, caption }
  end
  return nil
end

-- A figure Pandoc built from a lone image (`![caption](src)`): commonmark_x
-- would print raw <figure> HTML, so write the image and, when there is a
-- caption, a `{.caption}` paragraph after it, which emil.js merges (A29).
local function fix_figure(fig)
  local out = pandoc.Blocks({})
  for _, block in ipairs(fig.content) do
    if block.t == "Plain" then
      out:insert(pandoc.Para(block.content))
    else
      out:insert(block)
    end
  end
  local long = fig.caption.long
  if long ~= nil and #long > 0 then
    local caption = pandoc.Para(pandoc.utils.blocks_to_inlines(long))
    caption.content:insert(pandoc.RawInline("markdown", " {.caption}"))
    out:insert(caption)
  end
  return out
end

-- Raw HTML (an htmlwidget, highlighted code, MathML): written as a `{=html}`
-- fence, which emil.js passes through verbatim. commonmark_x would print the
-- block as is, and a blank line inside it ends it as an HTML block, or turns
-- into `&#10;`. The fence is longer than any run of backticks in the content.
local function html_fence(html)
  local longest = 2
  for run in html:gmatch("`+") do
    longest = math.max(longest, #run)
  end
  local fence = string.rep("`", longest + 1)
  local text = html:gsub("\n+$", "")
  return pandoc.RawBlock("markdown", fence .. "{=html}\n" .. text .. "\n" .. fence)
end

local function fix_raw_block(block)
  if block.format ~= "html" then
    return nil
  end
  return html_fence(block.text)
end

-- Math is written as MathML by Pandoc, so emil.js needs no math library.
local function mathml(math_el)
  local opts = pandoc.WriterOptions({ html_math_method = "mathml" })
  local html = pandoc.write(pandoc.Pandoc({ pandoc.Plain({ math_el }) }), "html5", opts)
  return (html:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function fix_math(math_el)
  return pandoc.RawInline("markdown", mathml(math_el))
end

-- Display math alone in its paragraph is a block, so it gets a `{=html}`
-- fence (SPEC A34) rather than sitting inside a <p>. Inlines are walked before
-- their paragraph, so by now the math is the MathML raw inline from `fix_math`.
local function fix_para(para)
  local only = para.content[1]
  if #para.content == 1 and only.t == "RawInline" and only.format == "markdown"
      and only.text:match('^<math[^>]*display="block"') then
    return html_fence(only.text)
  end
  return nil
end

-- Inline raw HTML needs no fence: commonmark_x would wrap it as
-- `` `<b>`{=html} ``, which emil.js does not read, so write it verbatim.
local function fix_raw_inline(inline)
  if inline.format ~= "html" then
    return nil
  end
  return pandoc.RawInline("markdown", inline.text)
end

function render_emiljs_fixups()
  if not _quarto.format.isEmiljsOutput() then
    return {}
  end
  return {
    RawBlock = fix_raw_block,
    RawInline = fix_raw_inline,
    Image = fix_image,
    Div = fix_div,
    CodeBlock = fix_code_block,
    Span = fix_span,
    Table = fix_table,
    Figure = fix_figure,

    -- cross-references are plain text ("Figure 1"): emil.js has no anchors
    Link = function(link)
      if link.classes:includes("quarto-xref") then
        return link.content
      end
      link.attr = clean_attr(link.attr, false)
      return link
    end,

    Header = function(header)
      header.attr = clean_attr(header.attr, true)
      return header
    end,

    Code = function(code)
      code.attr = clean_attr(code.attr, false)
      return code
    end,

    Note = function(_)
      emiljs_warn_once("footnote", "footnotes are not supported; they were removed.")
      return pandoc.Inlines({})
    end,

    Math = fix_math,
    Para = fix_para,

    Pandoc = function(doc)
      doc.blocks = slide_breaks(doc.blocks)
      -- what is left is a rule inside some block, which is not a slide break
      doc.blocks = doc.blocks:walk({
        HorizontalRule = function()
          return pandoc.RawBlock("html", "<hr>")
        end
      })
      -- the slide breaks above are raw blocks already, so they are not touched
      return doc
    end
  }
end
