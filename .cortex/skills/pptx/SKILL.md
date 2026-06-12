---
name: pptx
description: >
  Create, read, and edit PowerPoint presentations (.pptx). Use whenever the
  deliverable is a slide deck — building presentations from content or data,
  editing existing decks, extracting slide text, or deck-to-PDF conversion. Do
  not trigger when the requested output is a document or web page.
metadata:
  short-description: "Create, read, and edit PowerPoint (.pptx) decks"
  author: "nexus-cortex"
---

# PPTX — Presentations

Build and edit .pptx decks with open-source tooling. Decks are a LAYOUT medium:
the most common failure isn't broken files, it's unreadable slides — too much
text, overflowing frames, invisible contrast. Design for the back of the room.

## Tooling (pick by job)

| Job | Tool | Notes |
|-----|------|-------|
| Create / edit programmatically | `python-pptx` | Slides, layouts, placeholders, text frames, images, tables, charts, notes |
| Markdown → deck quickly | `pandoc` | `pandoc slides.md -o deck.pptx` (`---`-separated slides; `--reference-doc` for branding) |
| Extract slide text | `python-pptx` walk | Iterate slides → shapes → `text_frame` |
| pptx → PDF | LibreOffice headless | `soffice --headless --convert-to pdf deck.pptx --outdir out/` |

Install on demand: `pip install python-pptx`.

## Core patterns (python-pptx)

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor

prs = Presentation()                          # or Presentation("existing.pptx")
prs.slide_width  = Inches(13.333)             # 16:9 — set BEFORE adding slides
prs.slide_height = Inches(7.5)

title_slide = prs.slides.add_slide(prs.slide_layouts[0])   # 0=title, 1=title+content
title_slide.shapes.title.text = "Q3 Results"
title_slide.placeholders[1].text = "Engineering review — 2026"

slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "Highlights"
body = slide.placeholders[1].text_frame
body.text = "Latency down 40%"                # first bullet
p = body.add_paragraph(); p.text = "Cost per request halved"; p.level = 1

slide.shapes.add_picture("chart.png", Inches(7), Inches(1.5), width=Inches(5.5))
slide.notes_slide.notes_text_frame.text = "Mention the cache work here."
prs.save("deck.pptx")
```

Editing an existing deck: iterate `prs.slides` → `slide.shapes`; only shapes
with `shape.has_text_frame` carry text. Edit at the run level
(`text_frame.paragraphs[i].runs[j].text`) to preserve formatting. To match the
deck's branding, ALWAYS build new slides from `prs.slide_layouts` of the same
file rather than a fresh `Presentation()`.

## Slide design rules (what makes decks fail review)

- **One idea per slide; ≤ 6 bullets; ≤ 10 words per bullet.** Prose belongs in
  the speaker notes, not the slide.
- **Minimum 18pt body text** (titles 28pt+). If content doesn't fit at 18pt,
  split the slide — never shrink the font to fit.
- **Check contrast** — light text needs a dark fill behind it; never place text
  straight onto a busy image without a scrim shape.
- **Charts as images** (matplotlib → PNG → `add_picture`) are more reliable than
  native chart XML for complex visuals; use native `pptx.chart` only for simple
  bar/line/pie that must stay editable.
- Position with explicit `Inches()` — overlapping autolayout shapes are the #1
  source of "looks broken" decks.

## Verification (mandatory)

1. **Re-open** with `Presentation("deck.pptx")` — corruption throws.
2. **Assert structure**: slide count, expected titles, image/shape presence.
3. **Render-check when layout matters**: convert to PDF via LibreOffice and
   inspect the pages (text overflow and overlap are invisible in the XML — only
   a render shows them).

## Limits to know

- SmartArt, animations, and transitions are not supported by `python-pptx` —
  preserved if present, but not creatable/editable. Say so; don't fake it.
- Embedded video/audio: insert as a linked file or warn — round-trip is fragile.
- Fonts must exist on the rendering machine; stick to widely-available families
  (Calibri, Arial, Helvetica) unless the user supplies brand fonts.
