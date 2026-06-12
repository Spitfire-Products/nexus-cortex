---
name: docx
description: >
  Create, read, and edit Word documents (.docx). Use whenever the deliverable is
  a Word document, or the user asks to open/modify/extract from an existing
  .docx — reports, letters, templated documents, doc-to-PDF conversion. The
  deliverable must be a .docx (or a PDF derived from one); do not trigger when
  plain markdown or HTML is the requested output.
metadata:
  short-description: "Create, read, and edit Word (.docx) documents"
  author: "nexus-cortex"
---

# DOCX — Word Documents

Work with .docx files using open-source tooling. A .docx is a ZIP of XML parts —
never hand-edit the XML when a library can do it safely.

## Tooling (pick by job)

| Job | Tool | Notes |
|-----|------|-------|
| Create / edit programmatically | `python-docx` | Paragraphs, runs, styles, tables, images, headers/footers, sections |
| Fill a template with data | `docxtpl` | Jinja2 placeholders inside a .docx template — best for repeated/templated docs |
| Markdown/HTML → docx | `pandoc` | `pandoc in.md -o out.docx` (use `--reference-doc=style.docx` for branding) |
| Extract text quickly | `python-docx` walk, or `pandoc out.docx -t plain` | For search/summarize jobs |
| docx → PDF | LibreOffice headless | `soffice --headless --convert-to pdf file.docx --outdir out/` |

Install on demand: `pip install python-docx docxtpl` (don't assume preinstalled).

## Core patterns (python-docx)

```python
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()                      # or Document("existing.docx") to edit
doc.add_heading("Quarterly Report", level=1)

p = doc.add_paragraph("Revenue grew ")
run = p.add_run("18%")                # runs carry character formatting
run.bold = True

table = doc.add_table(rows=1, cols=3)
table.style = "Light Grid Accent 1"
hdr = table.rows[0].cells
hdr[0].text, hdr[1].text, hdr[2].text = "Region", "Q1", "Q2"

doc.add_picture("chart.png", width=Inches(5.5))
doc.save("report.docx")
```

Editing an existing document: iterate `doc.paragraphs` / `doc.tables`, modify
`run.text` in place (replacing at the **run** level preserves formatting;
replacing `paragraph.text` wholesale destroys it). For find-and-replace across
runs, match on the concatenated paragraph text but write back run-by-run.

## Styles and structure

- Prefer **named styles** (`doc.styles`) over per-run formatting — consistent
  and editable later. Set `style="Heading 2"` / `p.style = doc.styles["Quote"]`.
- Page setup lives on `doc.sections[0]` (margins, orientation, headers/footers).
- Numbered/bulleted lists: apply the `List Number` / `List Bullet` styles.

## Verification (mandatory)

The deliverable is the FILE, so verify the file, not your intent:
1. **Re-open it** with `Document("out.docx")` — a corrupt file throws here.
2. **Assert the content**: walk paragraphs/tables and check the key strings,
   counts, and ordering you were asked to produce.
3. If converting to PDF, check the PDF exists and is non-trivial in size, and
   render/read at least one page when the layout matters.

## Limits to know

- `python-docx` does not evaluate fields (TOC, page numbers) — they refresh
  when the document opens in Word/LibreOffice. To force-update a TOC, convert
  with LibreOffice once.
- Tracked changes and comments have limited library support — when asked to
  "accept changes", convert via LibreOffice or warn explicitly.
- Exotic layout (text boxes, SmartArt) round-trips poorly — preserve, don't
  rebuild, those parts when editing.
