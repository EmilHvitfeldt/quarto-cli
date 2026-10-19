-- emiljs.lua
-- Copyright (C) 2026 Posit Software, PBC

-- Renderers for Quarto's custom nodes when the output is emil.js's Markdown
-- dialect (see quarto-post/emiljs.lua for the rest of the writer). They are
-- registered here, after the default renderers, because the most recently
-- added renderer whose condition matches wins.

local emiljs_warned = {}

-- Warn about an unsupported construct once per document, however often it
-- occurs, so a long deck does not repeat the same message.
function emiljs_warn_once(key, message)
  if emiljs_warned[key] then
    return
  end
  emiljs_warned[key] = true
  warn("emil.js: " .. message)
end

local function is_emiljs()
  return _quarto.format.isEmiljsOutput()
end

-- A paragraph carrying the `.caption` class: emil.js merges an image-only
-- paragraph and the paragraph after it into <figure> and <figcaption> (A29),
-- and a theme can style the same class on a table caption.
local function caption_para(inlines)
  local para = pandoc.Para(inlines)
  para.content:insert(pandoc.RawInline("markdown", " {.caption}"))
  return para
end

-- An image on its own line, wrapped in a Plain, must be a Para to count as an
-- image-only paragraph.
local function plain_to_para(block)
  if block.t == "Plain" then
    return pandoc.Para(block.content)
  end
  return block
end

-- Give the first image in `blocks` alt text, if it has none. `walk_block`
-- returns a modified copy, so the blocks are replaced in place.
local function fill_first_alt(blocks, alt)
  local done = false
  for i, block in ipairs(blocks) do
    blocks[i] = pandoc.walk_block(block, {
      Image = function(img)
        if done then
          return nil
        end
        done = true
        if #img.caption == 0 and img.attributes["fig-alt"] == nil and
            img.attributes["alt"] == nil then
          img.caption = pandoc.Inlines({ pandoc.Str(alt) })
          return img
        end
        return nil
      end
    })
  end
end

_quarto.ast.add_renderer("FloatRefTarget", function(_)
  return is_emiljs()
end, function(float)
  local content = pandoc.Blocks({})
  if float.content ~= nil then
    for _, block in ipairs(quarto.utils.as_blocks(float.content)) do
      content:insert(plain_to_para(block))
    end
  end

  -- the alt text falls back to the caption text, before the "Figure 1:" prefix
  -- is added, when neither `fig-alt` nor an explicit alt was given
  local raw_caption = pandoc.utils.stringify(float.caption_long or pandoc.Inlines({}))
  -- a panel's subfigures each get their own alt text from their own caption
  if raw_caption ~= "" and not float.has_subfloats then
    fill_first_alt(content, raw_caption)
  end

  decorate_caption_with_crossref(float)
  local caption = quarto.utils.as_inlines(float.caption_long or pandoc.Inlines({}))
  if #caption == 0 then
    return content
  end

  -- a figure's caption follows the image (A29); a table's can lead
  local result = pandoc.Blocks({})
  local is_table = ref_type_from_float(float) == "tbl"
  if is_table and cap_location(float) == "top" then
    result:insert(caption_para(caption))
    result:extend(content)
  else
    result:extend(content)
    result:insert(caption_para(caption))
  end
  return result
end)

-- A layout panel (`layout-ncol`, `layout-nrow` or `layout` on a div or a
-- float) maps onto emil.js's own `.columns` and `.column`, one `.columns` per
-- row; the cell widths Quarto computes are turned into column widths in
-- quarto-post/emiljs.lua. A float with subfigures keeps each subfigure's image
-- and `(a) First` caption in its column, and its own caption follows the rows.
_quarto.ast.add_renderer("PanelLayout", function(_)
  return is_emiljs()
end, function(panel)
  local out = pandoc.Blocks({})
  if panel.rows == nil then
    return out
  end
  for _, row in ipairs(panel.rows.content) do
    if row.t == "Div" then
      local columns = pandoc.Div({}, pandoc.Attr("", { "columns" }))
      for _, cell in ipairs(row.content) do
        if cell.t == "Div" then
          cell.attr.classes = cell.attr.classes:filter(function(class)
            return class ~= "quarto-layout-cell-subref"
          end)
          cell.attr.classes:insert("column")
          cell.attr.attributes["ref-parent"] = nil
        end
        columns.content:insert(cell)
      end
      out:insert(columns)
    else
      out:insert(row)
    end
  end

  if panel.float then
    decorate_caption_with_crossref(panel.float)
    local caption = quarto.utils.as_inlines(panel.float.caption_long or pandoc.Inlines({}))
    if #caption > 0 then
      local is_table = ref_type_from_float(panel.float) == "tbl"
      if is_table and cap_location(panel.float) == "top" then
        out:insert(1, caption_para(caption))
      else
        out:insert(caption_para(caption))
      end
    end
  end
  return out
end)

_quarto.ast.add_renderer("Callout", function(_)
  return is_emiljs()
end, function(node)
  node = _quarto.modules.callouts.decorate_callout_title_with_crossref(node)

  local default_appearance = _quarto.modules.constants.kCalloutAppearanceDefault
  if node.collapse ~= nil or node.icon == false or
      (node.appearance ~= nil and node.appearance ~= default_appearance) then
    emiljs_warn_once("callout-options",
      "callout options `appearance`, `icon` and `collapse` are ignored.")
  end

  local title = quarto.utils.as_inlines(node.title)
  if #title == 0 and (node.appearance == nil or node.appearance == default_appearance) then
    title = pandoc.Inlines({ pandoc.Str(_quarto.modules.callouts.displayName(node.type)) })
  end

  local blocks = pandoc.Blocks({})
  if #title > 0 then
    local para = pandoc.Para(title)
    para.content:insert(pandoc.RawInline("markdown", " {.callout-title}"))
    blocks:insert(para)
  end
  blocks:extend(quarto.utils.as_blocks(node.content))

  local classes = pandoc.List({ "callout-" .. node.type })
  for _, class in ipairs(node.attr.classes) do
    if class ~= "callout" and not class:match("^callout%-") then
      classes:insert(class)
    end
  end
  return pandoc.Div(blocks, pandoc.Attr("", classes))
end)
