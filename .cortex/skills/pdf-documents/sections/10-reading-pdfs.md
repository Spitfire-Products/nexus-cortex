# Reading and Deconstructing PDFs

## The Problem

Agents currently read PDFs via OCR or text extraction, which destroys:
- Table structure (becomes ambiguous whitespace)
- Diagram/chart data (becomes nothing or alt text)
- Heading hierarchy (inferred from font size, unreliable)
- Image-text association (captions detach from figures)
- Links (become plain text)

## Runtime Context — Choose Your Path

| Runtime | Best Tool | How |
|---|---|---|
| **Claude Code** | Built-in Read tool | `Read({ file_path: "doc.pdf", pages: "1-10" })` — up to 20 pages/request |
| **CORTEX / NPC (Nexus Terminal)** | nexus-browser-sandbox | `run_command` with `pdf2html` utility or `pdf2htmlEX` (both pre-installed) |
| **Server-side / CLI** | PyMuPDF directly | `pip install pymupdf` then Python script |
| **Browser-only (no sandbox)** | Vision model on screenshots | Browse PDF, screenshot pages, send to VLM |

---

## Nexus Browser Sandbox (Preferred for CORTEX / NPC Agents)

The `nexus-browser-sandbox` container has **PyMuPDF**, **pdf2htmlEX**, and a pre-built extraction utility installed. Any agent with nexus-browser MCP access can use them via `run_command` or `run_code` — no setup, no pip install.

### Container Additions (Dockerfile)

```dockerfile
# ── PDF Reading Toolkit ──────────────────────────────────────
# PyMuPDF — structured HTML extraction, image extraction, text
RUN pip install --no-cache-dir pymupdf beautifulsoup4

# pdf2htmlEX — pixel-perfect visual fidelity conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    pdf2htmlex \
    && rm -rf /var/lib/apt/lists/*

# Pre-built extraction utility
COPY pdf2html /usr/local/bin/pdf2html
RUN chmod +x /usr/local/bin/pdf2html
```

### Extraction Utility: `/usr/local/bin/pdf2html`

A Python script pre-installed in the container. Takes a PDF path, outputs structured HTML + a JSON manifest to stdout. Agents call it via `run_command` and get agent-ready output with zero boilerplate.

```python
#!/usr/bin/env python3
"""pdf2html — Extract structured HTML + manifest from a PDF.

Usage:
  pdf2html input.pdf                     # structured HTML (agent consumption)
  pdf2html input.pdf --manifest          # JSON manifest only (outline, tables, images)
  pdf2html input.pdf --images /out/dir   # also extract images as PNG files
  pdf2html input.pdf --lossless          # delegates to pdf2htmlEX (pixel-perfect)
  pdf2html input.pdf --text              # plain text only (cheapest)
  pdf2html input.pdf --pages 1-5         # specific page range
"""

import sys
import os
import json
import argparse

def extract_structured(pdf_path, pages=None, extract_images_dir=None):
    """PyMuPDF structured extraction — HTML + manifest."""
    import fitz
    doc = fitz.open(pdf_path)

    page_range = range(len(doc))
    if pages:
        start, end = pages
        page_range = range(max(0, start - 1), min(len(doc), end))

    html_parts = []
    manifest = {
        "source": os.path.basename(pdf_path),
        "pages": len(doc),
        "extracted_pages": list(page_range),
        "images": [],
        "tables": [],
        "headings": [],
    }

    for i in page_range:
        page = doc[i]
        page_num = i + 1

        html_parts.append(f'<div class="page" data-page="{page_num}">')
        html_parts.append(page.get_text('html'))
        html_parts.append('</div>')

        # Extract images
        images = page.get_images(full=True)
        for img_idx, img_info in enumerate(images):
            img_id = f"img-p{page_num}-{img_idx}"
            manifest["images"].append({
                "id": img_id,
                "page": page_num,
                "xref": img_info[0],
                "width": img_info[2],
                "height": img_info[3],
            })

            if extract_images_dir:
                xref = img_info[0]
                pix = fitz.Pixmap(doc, xref)
                if pix.n >= 5:  # CMYK
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                out_path = os.path.join(extract_images_dir, f"{img_id}.png")
                pix.save(out_path)
                manifest["images"][-1]["file"] = out_path

        # Extract text blocks for headings (heuristic: large font = heading)
        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    size = span["size"]
                    text = span["text"].strip()
                    if text and size >= 14:
                        level = 1 if size >= 22 else 2 if size >= 16 else 3
                        manifest["headings"].append({
                            "level": level,
                            "text": text,
                            "page": page_num,
                            "font_size": round(size, 1),
                        })

        # Detect tables (PyMuPDF table detection)
        try:
            tables = page.find_tables()
            for t_idx, table in enumerate(tables):
                t_id = f"table-p{page_num}-{t_idx}"
                extracted = table.extract()
                headers = extracted[0] if extracted else []
                manifest["tables"].append({
                    "id": t_id,
                    "page": page_num,
                    "headers": [h for h in headers if h],
                    "rows": len(extracted),
                    "cols": len(headers),
                })
        except Exception:
            pass  # table detection not available in older PyMuPDF

    full_html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>{manifest['source']}</title>
<style>
  .page {{ border-bottom: 2px solid #ccc; padding: 20px 0; margin-bottom: 20px; }}
  .page::before {{ content: "Page " attr(data-page); font-size: 10pt; color: #888;
                   display: block; margin-bottom: 10px; }}
  img {{ max-width: 100%; height: auto; }}
  table {{ border-collapse: collapse; margin: 10px 0; }}
  td, th {{ border: 1px solid #ddd; padding: 4px 8px; }}
</style>
</head><body>{''.join(html_parts)}</body></html>"""

    return full_html, manifest


def extract_text_only(pdf_path, pages=None):
    """Cheapest extraction — plain text."""
    import fitz
    doc = fitz.open(pdf_path)
    page_range = range(len(doc))
    if pages:
        start, end = pages
        page_range = range(max(0, start - 1), min(len(doc), end))

    parts = []
    for i in page_range:
        parts.append(f"\n--- PAGE {i+1} ---\n")
        parts.append(doc[i].get_text("text"))
    return ''.join(parts)


def run_pdf2htmlex(pdf_path):
    """Delegate to pdf2htmlEX for pixel-perfect conversion."""
    import subprocess
    out_dir = "/tmp/pdf2htmlex_out"
    os.makedirs(out_dir, exist_ok=True)
    basename = os.path.splitext(os.path.basename(pdf_path))[0]
    result = subprocess.run(
        ["pdf2htmlEX", "--zoom", "1.5", "--process-outline", "1",
         "--dest-dir", out_dir, pdf_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"pdf2htmlEX error: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    out_file = os.path.join(out_dir, f"{basename}.html")
    if os.path.exists(out_file):
        with open(out_file) as f:
            print(f.read())
    else:
        print(f"Output not found at {out_file}", file=sys.stderr)
        sys.exit(1)


def parse_pages(pages_str):
    """Parse '1-5' or '3' into (start, end) tuple."""
    if '-' in pages_str:
        parts = pages_str.split('-')
        return (int(parts[0]), int(parts[1]))
    else:
        n = int(pages_str)
        return (n, n)


def main():
    parser = argparse.ArgumentParser(description="Extract structured HTML from PDF")
    parser.add_argument("pdf", help="Path to PDF file")
    parser.add_argument("--manifest", action="store_true", help="Output JSON manifest only")
    parser.add_argument("--images", metavar="DIR", help="Extract images to directory")
    parser.add_argument("--lossless", action="store_true", help="Use pdf2htmlEX (pixel-perfect)")
    parser.add_argument("--text", action="store_true", help="Plain text only (cheapest)")
    parser.add_argument("--pages", metavar="RANGE", help="Page range, e.g. 1-5 or 3")
    args = parser.parse_args()

    if not os.path.exists(args.pdf):
        print(f"File not found: {args.pdf}", file=sys.stderr)
        sys.exit(1)

    pages = parse_pages(args.pages) if args.pages else None

    if args.lossless:
        run_pdf2htmlex(args.pdf)
        return

    if args.text:
        print(extract_text_only(args.pdf, pages))
        return

    if args.images:
        os.makedirs(args.images, exist_ok=True)

    html, manifest = extract_structured(args.pdf, pages, args.images)

    if args.manifest:
        print(json.dumps(manifest, indent=2))
    else:
        # Print manifest as HTML comment at top, then full HTML
        print(f"<!-- MANIFEST\n{json.dumps(manifest, indent=2)}\n-->")
        print(html)


if __name__ == "__main__":
    main()
```

### Agent Workflow via nexus-browser MCP

```bash
# ── Structured extraction (default — best for agent consumption) ──
run_command({ command: "pdf2html /tmp/document.pdf" })
# Returns: HTML comment with JSON manifest + structured HTML body

# ── Manifest only (cheapest — just the outline, tables, image refs) ──
run_command({ command: "pdf2html /tmp/document.pdf --manifest" })
# Returns: JSON with pages, headings, table summaries, image locations

# ── Plain text only (cheapest tokens) ──
run_command({ command: "pdf2html /tmp/document.pdf --text" })
# Returns: raw text with page markers

# ── Extract images to files ──
run_command({ command: "pdf2html /tmp/document.pdf --images /tmp/pdf-images/" })
# Returns: HTML + manifest with image file paths

# ── Pixel-perfect lossless conversion (pdf2htmlEX) ──
run_command({ command: "pdf2html /tmp/document.pdf --lossless" })
# Returns: pixel-perfect HTML (absolute-positioned divs, visually exact)

# ── Specific pages only ──
run_command({ command: "pdf2html /tmp/document.pdf --pages 1-5 --manifest" })
```

**Getting the PDF into the sandbox:**
```bash
# Option 1: Download from URL
run_command({ command: "curl -sL -o /tmp/document.pdf 'https://example.com/report.pdf'" })

# Option 2: Browse to PDF URL (Chromium downloads it)
browse({ url: "https://example.com/report.pdf" })
# Then find it in the browser's download directory

# Option 3: If PDF is already in VFS, copy via the agent's file tools
# (depends on sandbox ↔ VFS bridge)
```

### When to Use --lossless (pdf2htmlEX)

The `--lossless` flag delegates to pdf2htmlEX instead of PyMuPDF. Use it when:
- User asks for **exact visual reproduction** of the PDF in a browser
- The PDF has complex **multi-column layouts** that PyMuPDF misinterprets
- The output will be **displayed to a human**, not parsed by an agent
- You need to **embed the PDF in a web page** with exact fidelity

Do NOT use `--lossless` for agent consumption — the output is CSS absolute-positioned divs that are impossible to parse semantically. Use the default PyMuPDF path for anything an agent needs to understand.

---

## Direct PyMuPDF Usage (CLI / Server-Side)

When you have Python available (Claude Code bash, server-side scripts, CI), use PyMuPDF directly:

```bash
pip install pymupdf
python3 -c "
import fitz
doc = fitz.open('input.pdf')
html_parts = []
for i, page in enumerate(doc):
    html_parts.append(f'<div class=\"page\" data-page=\"{i+1}\">')
    html_parts.append(page.get_text('html'))
    html_parts.append('</div>')
with open('output.html', 'w') as f:
    f.write('<html><body>' + ''.join(html_parts) + '</body></html>')
"
```

## Deconstructing PDF-to-HTML for Agent Consumption

Once you have HTML from any extraction method, deconstruct it into an indexed structure:

### Step 1: Build a Media Index

```python
from bs4 import BeautifulSoup
import json

with open('converted.html') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

media_index = {
    "images": [],
    "tables": [],
    "headings": [],
    "links": [],
    "figures": [],
}

for i, img in enumerate(soup.find_all('img')):
    media_index["images"].append({
        "id": f"img-{i}",
        "src": img.get('src', '')[:100],
        "alt": img.get('alt', ''),
        "page": img.find_parent(attrs={"data-page": True}).get("data-page", "?"),
        "width": img.get('width'),
        "height": img.get('height'),
    })

for i, table in enumerate(soup.find_all('table')):
    rows = table.find_all('tr')
    headers = [th.get_text(strip=True) for th in rows[0].find_all(['th', 'td'])] if rows else []
    media_index["tables"].append({
        "id": f"table-{i}",
        "headers": headers,
        "row_count": len(rows),
        "page": table.find_parent(attrs={"data-page": True}).get("data-page", "?"),
    })

for h in soup.find_all(['h1','h2','h3','h4','h5','h6']):
    media_index["headings"].append({
        "level": int(h.name[1]),
        "text": h.get_text(strip=True),
    })

print(json.dumps(media_index, indent=2))
```

### Step 2: Extract Text as Structured Markdown

```python
def html_to_agent_markdown(html_path):
    with open(html_path) as f:
        soup = BeautifulSoup(f.read(), 'html.parser')

    sections = []
    for page_div in soup.find_all('div', class_='page'):
        page_num = page_div.get('data-page', '?')
        sections.append(f"\n<!-- PAGE {page_num} -->\n")

        for elem in page_div.children:
            if elem.name in ('h1','h2','h3','h4','h5','h6'):
                level = int(elem.name[1])
                sections.append(f"{'#' * level} {elem.get_text(strip=True)}\n")
            elif elem.name == 'table':
                sections.append(table_to_markdown(elem))
            elif elem.name == 'p':
                text = elem.get_text(strip=True)
                if text:
                    sections.append(f"{text}\n")
            elif elem.name == 'img':
                alt = elem.get('alt', 'image')
                sections.append(f"![{alt}](ref:img-{id})\n")
            elif elem.name == 'figure':
                caption = elem.find('figcaption')
                sections.append(f"[FIGURE: {caption.get_text(strip=True) if caption else 'untitled'}]\n")

    return '\n'.join(sections)
```

### Step 3: Agent Consumption Format

The final output for agent ingestion should be:

```
DOCUMENT_MANIFEST:
  source: input.pdf
  pages: 13
  images: 4 (indexed as img-0 through img-3)
  tables: 3 (indexed as table-0 through table-2)
  headings: 12 (see outline below)

OUTLINE:
  1. Introduction
    1.1 Background
    1.2 Methodology
  2. Findings
    2.1 Data Analysis (contains table-0, table-1)
    2.2 Visual Results (contains img-1, img-2)
  3. Conclusions

TABLE_SUMMARIES:
  table-0 (page 4): Revenue by Quarter | 4 cols | 12 rows
  table-1 (page 5): Cost Breakdown | 6 cols | 8 rows
  table-2 (page 9): Comparison Matrix | 5 cols | 5 rows

IMAGE_DESCRIPTIONS:
  img-0 (page 1): [cover photo] — requires vision model for description
  img-1 (page 6): [bar chart] — requires vision model for data extraction
  img-2 (page 7): [photograph] — requires vision model for description
  img-3 (page 11): [diagram] — requires vision model for description

TEXT_CONTENT:
  [structured markdown follows...]
```

## Handling Charts and Diagrams in PDFs

Charts in PDFs are stored as either:
1. **Vector paths** (lines, curves, fills) — can be extracted as SVG but lose data labels
2. **Rasterized images** — requires vision model to extract data

**Recommended approach for charts:**
```
1. Extract chart region as image (PyMuPDF page.get_pixmap(clip=rect))
2. Send image to vision model: "Extract the data from this chart as a markdown table"
3. Include both: image reference (for visual context) + extracted data table (for agent reasoning)
```

```python
import fitz

doc = fitz.open('input.pdf')
page = doc[5]  # page with the chart

chart_rect = fitz.Rect(50, 200, 500, 450)
pix = page.get_pixmap(clip=chart_rect, dpi=300)
pix.save('chart-page6.png')
```

## Tool Selection Guide

| Tool | Text | Tables | Images | Layout | Speed | Available In |
|------|------|--------|--------|--------|-------|-------------|
| **pdf2html utility** | Excellent | Good | Extract as PNG | Positioned HTML | Fast | nexus-browser-sandbox |
| **pdf2htmlEX** | Excellent | Visual only | Embeds | **Pixel-perfect** | Medium | nexus-browser-sandbox |
| **PyMuPDF (fitz)** | Excellent | Good (HTML mode) | Extract as PNG | Positioned HTML | Fast | sandbox, CLI, server |
| **Claude Code Read** | Good | Basic | No | Text only | Instant | Claude Code |
| **Tabula** | N/A | **Best** (structured) | N/A | N/A | Medium | CLI (Java) |
| **Camelot** | N/A | Excellent | N/A | N/A | Medium | CLI (Python) |
| **Vision model** | Good | Good | **Best** (understanding) | Visual | Expensive | Any agent |

**Decision tree:**
```
Agent in Nexus Terminal (CORTEX / NPC)?
  → run_command("pdf2html doc.pdf")              # structured extraction
  → run_command("pdf2html doc.pdf --lossless")    # visual fidelity

Agent in Claude Code?
  → Read tool for text (up to 20 pages)
  → Bash + PyMuPDF for structured HTML

Need tables specifically?
  → Tabula or Camelot (CLI only)

Need chart/diagram data?
  → Extract image region + vision model

User wants exact visual reproduction?
  → pdf2htmlEX via --lossless flag
```
