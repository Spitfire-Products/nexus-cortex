---
name: pdf-documents
description: Create rich PDF documents (reports, blueprints, posters, banners) from HTML and read/deconstruct existing PDFs for agent consumption. Covers page sizes, print CSS, SVG charts, scaled output, and lossless PDF-to-HTML conversion.
triggers:
  - create a pdf
  - generate a pdf
  - write a pdf
  - pdf document
  - pdf report
  - read a pdf
  - parse a pdf
  - convert pdf
  - pdf to html
  - html to pdf
  - blueprint
  - poster layout
  - banner layout
  - print layout
  - paper size
  - A4 document
  - letter size
  - pdf charts
  - pdf tables
metadata:
  created: "2026-05-17"
  author: "nexus-cortex"
  version: "2.0.0"
---

# PDF Documents Skill

**HTML is the translation layer** between agents and PDF.

```
WRITE:  Research → Semantic HTML + Print CSS + SVG → PDF (chromium --print-to-pdf)
READ:   PDF → HTML extraction (PyMuPDF / pdf2htmlEX) → Media index + DOM text → Agent
```

---

## Task Routing — Weighted Spoke Scores

**STOP.** Before writing ANY HTML or reading ANY PDF, score your task against this matrix. Read ALL spoke files scoring **8+** for your task type — these are **MANDATORY**. Read **5–7** if token budget allows. Skip below 5.

Spoke files live in `sections/` alongside this file.

| Spoke File | Create Report | Illustrated Doc | Blueprint / Poster | Read PDF | Match a Template | Invoice / Form |
|---|---|---|---|---|---|---|
| **01-image-acquisition.md** — mandatory image capture, model-aware embed (both models: save files + relative refs; platform inlines on download), sizing | 9 | **10** | 3 | 2 | 5 | 4 |
| **02-ai-image-generation.md** — CF FLUX, xAI, OpenAI, HF; img2img grounding | 4 | **10** | 2 | 1 | 3 | 2 |
| **03-paper-sizes.md** — ISO A/B, US/ANSI, JIS; orientation; Chromium flags | 6 | 6 | **10** | 2 | 5 | 5 |
| **04-design-system.md** — typography, fonts, OKLCH color, spacing, texture, layout, starter template | **8** | **9** | 4 | 2 | **10** | 7 |
| **05-css-print-rules.md** — @page, page breaks, pitfall table | **10** | **10** | **10** | 2 | **8** | **9** |
| **06-svg-charts.md** — bar, pie, line, map patterns | 7 | 5 | 3 | 2 | 3 | 2 |
| **07-templates.md** — layout snippets, external template sources, conversion, recipes | 5 | 5 | 3 | 2 | **10** | **8** |
| **08-scaled-output.md** — 1:1 blueprints, posters, banners, scale bars, Puppeteer | 2 | 2 | **10** | 1 | 2 | 2 |
| **09-preview-qa.md** — print-to-pdf QA loop, browser preview, checklist | 7 | **8** | **9** | 2 | 6 | 6 |
| **10-reading-pdfs.md** — PyMuPDF, pdf2htmlEX, deconstruction, media index, charts | 2 | 2 | 2 | **10** | 4 | 2 |

**Scoring examples** (read spokes in descending score order):
- *"Create a research report with charts"* → 05(10), 01(9), 04(8), 06(7), 09(7)
- *"Make an illustrated history document"* → 01(10), 02(10), 05(10), 04(9), 09(8)
- *"Read this PDF and extract the data"* → 10(10) — done
- *"Recreate this Word template as HTML"* → 04(10), 07(10), 05(8)
- *"Create a 1:1 blueprint"* → 03(10), 05(10), 08(10), 09(9)
- *"Generate an invoice PDF"* → 05(9), 07(8), 04(7)

---

## ⚠️ DELIVERY MODEL DECIDES EVERYTHING — read this first

How the PDF reaches the user determines the final conversion step. There are
TWO models. **Both use the same image approach: save files, reference by path.**

### Model A — Nexus (file-based, user prints from browser)

In Nexus there is **no in-platform print-to-PDF you can invoke**. The
deliverable is HTML + image files written to the VFS. The user downloads the
HTML from the FILE manager and prints it to PDF from **their own browser**
(Ctrl/Cmd+P → Save as PDF). Tell the user to do this.

**Image workflow:** Save images to the VFS via `cortex_write_binary`, then
reference them with relative `<img src="images/photo.jpg">` in the HTML.
**The platform's download step automatically inlines VFS-referenced images
as base64 data URIs**, producing a self-contained HTML file. You NEVER emit
base64 yourself. No output-token cap on images. No size ceiling.

### Model B — Sandbox Chromium: full agent-driven PDF cycle

When `run_command` is available (requires the **nexus-browser** backend, not
the Playwright MCP backend), the sandbox container has `html2pdf` and
`pdf2html` pre-installed alongside headless Chrome. Save image FILES into
the sandbox working dir, reference them by **relative path**
`<img src="images/photo.jpg">`, and convert:

```bash
run_command("html2pdf /tmp/report.html --base64 --no-header --paper a4")
```

The base64 PDF appears in the tool result. Write it to VFS:

```
cortex_write_binary({ path: "/sandbox/documents/report.pdf",
                      data: "<base64 from tool result>",
                      mimeType: "application/pdf" })
```

**Token cost caveat**: base64 PDF flows through model output. A 500KB PDF
costs ~170K output tokens. For documents >100KB, prefer Model A (HTML
delivery, zero image token cost). Reserve Model B for small files or when
the user specifically requests `.pdf`.

**Timeout**: `run_command` defaults to 30s. For large PDFs, pass
`timeout: 75000` to `run_command` and `--timeout 60` to `html2pdf`.

> **Both models → save files + relative refs.** Model A's download surface
> bundles images automatically. See `sections/01-image-acquisition.md`.

## The Pipeline

```
1. Research / gather content; capture images (screenshots, downloads)
2. Save images:
   - Model A: cortex_write_binary to VFS  (images MUST use cortex_write_binary,
     NOT cortex_write — the download inliner only recognizes data URIs)
   - Model B: curl/save to sandbox disk alongside HTML
3. Write semantic HTML with inline CSS
   - Reference images with relative <img src>
   - Wrap every image in <figure> with <figcaption>
   - SVG preferred for charts/diagrams (inline markup)
4. (Model B only) print-to-pdf QA loop — preview, fix breaks, repeat
5. Deliver:
   - Model A: cortex_write the .html to the VFS; images alongside via
     cortex_write_binary; tell user to download and print from browser
     (download auto-inlines images for self-contained output)
   - Model B: html2pdf --base64 → cortex_write_binary to VFS
```

**Why HTML, not Markdown:** semantic structure (`<table>`,`<figure>`,`<aside>`),
inline SVG charts, `@media print` pagination control, round-trip fidelity.

---

## Conversion Commands (Always Needed)

```bash
# ── html2pdf (pre-installed in sandbox — recommended) ─────
html2pdf input.html -o output.pdf --no-header --paper a4
html2pdf input.html --base64 --no-header --paper a4   # base64 to stdout (for cortex_write_binary)
html2pdf input.html --fetch-images --no-header         # download remote <img src> for offline render
html2pdf input.html --landscape --paper letter          # landscape letter
html2pdf input.html --inject-css extra.css              # inject additional CSS before render

# ── Chromium (direct — same engine html2pdf wraps) ────────
chromium --headless --no-sandbox --disable-gpu \
  --print-to-pdf=output.pdf \
  --print-to-pdf-no-header \
  input.html

# With explicit paper size (default: Letter)
chromium --headless --no-sandbox --disable-gpu \
  --print-to-pdf=output.pdf \
  --print-to-pdf-no-header \
  --paper-width=8.27 --paper-height=11.69 \
  input.html

# ── WeasyPrint (Python — excellent CSS support) ────────────
weasyprint input.html output.pdf

# ── Puppeteer (Node.js — full control, exact page sizes) ───
# See 08-scaled-output.md for the Puppeteer recipe
```

`html2pdf` wraps Chrome headless with convenience flags. Use `--base64` for piping into `cortex_write_binary`. Chromium `--paper-width` and `--paper-height` are in **inches**. See `03-paper-sizes.md` for the full conversion table.

---

## Universal Rules (Apply to ALL PDF Tasks)

These gotchas are critical enough that skipping them causes the most common failures. They are here — not in spokes — so no task routing can bypass them.

### Rule 1: Images Are Mandatory

**Every image you view during research MUST be captured and included.** A "rich PDF" without the images you researched is just a text document with extra CSS.

```
# Both models: save images as files, reference with relative paths.
#
# Model A (Nexus): cortex_write_binary to save images to VFS,
#   then <img src="images/photo.jpg"> in your HTML.
#   The platform download step inlines them automatically.
#   IMPORTANT: images MUST be saved via cortex_write_binary (NOT cortex_write).
#   The download inliner only recognizes data: URI content in VFS storage.
#   NEVER emit base64 yourself — no output-token cost for images.
#
# Model B (sandbox chromium): download images to sandbox disk (curl/screenshot),
#   <img src="images/photo.jpg"> — html2pdf/chromium resolves at render.
#   Then pipe: html2pdf --base64 → cortex_write_binary to deliver the PDF.
#
# Always use SVG (inline markup) for charts/diagrams — both models.
```

### Rule 2: The Blank Page Bug

`break-inside: avoid` on an element **taller than one page** creates a blank page before it. Chromium pushes the entire element to the next page, leaving the previous page empty.

```css
/* BAD — timeline section is multi-page, creates blank page */
.timeline { break-inside: avoid; }

/* GOOD — individual items are shorter than a page */
.timeline-item { break-inside: avoid; }
.timeline { /* no break-inside rule */ }
```

### Rule 3: Heading Orphans

Always prevent headings from sitting alone at the bottom of a page:

```css
h1, h2, h3, h4 { break-after: avoid; }
```

### Rule 4: Table Continuity

```css
thead { display: table-header-group; }  /* repeat header on each page */
tr { break-inside: avoid; }
```

### Rule 5: Print Units

Use `pt` for text, `mm`/`in` for layout — never `px` in print CSS. `1pt = 1/72 inch`. Body text minimum: **10pt** (comfortable reading), captions: **8pt** minimum.

### Rule 6: Font Choice

**NEVER** use Arial, Inter, Roboto, Calibri, or system-ui as the primary font. These are non-decisions that make the document look auto-generated. See `04-design-system.md` for 30+ categorized alternatives with pairing guides.

### Rule 7: Color for Print

- Never use pure `#000` — use `oklch(0.18 0.01 hue)` for body text
- Never use pure white backgrounds — use `oklch(0.97 0.005 hue)` for warmth
- Keep background chroma below `0.03` (high chroma wastes ink)
- See `04-design-system.md` for the full OKLCH color system

---

## Quick Reference Card

### Create PDF — Fastest Path

```bash
# Sandbox (pre-installed):
html2pdf input.html -o output.pdf --no-header --paper a4
html2pdf input.html --base64 --no-header   # base64 to stdout for cortex_write_binary

# Or direct Chromium:
chromium --headless --no-sandbox --disable-gpu \
  --print-to-pdf=output.pdf --print-to-pdf-no-header \
  input.html
```

### Read PDF — Fastest Path

```bash
# Sandbox (pre-installed):
pdf2html input.pdf              # structured HTML
pdf2html input.pdf --manifest   # JSON structure only
pdf2html input.pdf --images     # extract images
```

```python
# Or Python directly:
import fitz
doc = fitz.open('input.pdf')
for page in doc:
    print(page.get_text('html'))
```

### Paper Sizes (Most Common)

```
A4:     210 x 297mm    (8.27 x 11.69in)    @page { size: A4; }
Letter: 215.9 x 279.4mm (8.5 x 11in)      @page { size: letter; }
A3:     297 x 420mm    (11.69 x 16.54in)   @page { size: A3; }
Legal:  215.9 x 355.6mm (8.5 x 14in)      @page { size: legal; }
ANSI D: 558.8 x 863.6mm (22 x 34in)       @page { size: 558.8mm 863.6mm; }
```

### Chromium Paper Size Flags

```bash
# --paper-width and --paper-height are in INCHES
# A4:     --paper-width=8.27 --paper-height=11.69
# Letter: --paper-width=8.5 --paper-height=11
# Custom: --paper-width=11.81 --paper-height=59.06  (300mm x 1500mm banner)
```
