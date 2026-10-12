-- emiljs.lua
-- Copyright (C) 2026 Posit Software, PBC

-- Reshapes the document into the Markdown dialect that emil.js reads. Pandoc's
-- commonmark_x writer then prints it, and the emiljs output recipe builds the
-- result into HTML.

local function is_empty_div(block)
  return block.t == "Div" and #block.content == 0
end

-- Only a top-level horizontal rule is a slide break. Pandoc prints one as a long
-- dashed line, which emil.js would read as a YAML fence, so write `***` instead.
-- Leading, trailing and doubled rules would make empty slides, so collapse them.
local function slide_breaks(blocks)
  local out = pandoc.List()
  for _, block in ipairs(blocks) do
    if block.t == "HorizontalRule" then
      if #out > 0 and out[#out].t ~= "HorizontalRule" then
        out:insert(block)
      end
    else
      out:insert(block)
    end
  end

  -- Quarto can leave empty divs after the content, so look past them
  local last = #out
  while last > 0 and is_empty_div(out[last]) do
    last = last - 1
  end
  if last > 0 and out[last].t == "HorizontalRule" then
    out:remove(last)
  end

  return out:map(function(block)
    if block.t == "HorizontalRule" then
      return pandoc.RawBlock("markdown", "***")
    end
    return block
  end)
end

function render_emiljs_fixups()
  if not _quarto.format.isEmiljsOutput() then
    return {}
  end
  return {
    Pandoc = function(doc)
      doc.blocks = slide_breaks(doc.blocks)
      return doc
    end
  }
end
