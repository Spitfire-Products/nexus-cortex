# Image Acquisition and Embedding (MANDATORY)

Every rich PDF document MUST include relevant images discovered during research. A text-only document dressed up with CSS is not a rich document.

## ⚠️ First: which delivery model? (see SKILL.md "DELIVERY MODEL DECIDES EVERYTHING")

The embedding mechanism is **not absolute — it depends on how the PDF reaches the user.**

- **Model A — Nexus (file-based).** Save images as files to the VFS via `cortex_write_binary`, then reference them with **relative `<img src="...">`** in the HTML. The platform's download step **automatically inlines** VFS-referenced images as base64 data URIs, producing a self-contained HTML file the user can print to PDF. **You never emit base64 yourself.** No output-token cap on images. No size ceiling.
- **Model B — sandbox / real Chromium.** A real shell runs `chromium --print-to-pdf`. Save image **files** next to the HTML and reference them by **relative path**; Chromium resolves them at render. NEVER inline base64 here either.

**Both models use the same approach: save files, reference by path.** Model A's download surface handles the self-contained bundling automatically.

## Acquisition Methods (both models)

**Method 1: Browser screenshot during research**
```bash
# nexus-browser MCP:
browse({ url: "https://example.com/museum" })
screenshot({ format: "jpeg", quality: 85 })   # returns a base64 dataUrl

# Save to VFS (Model A):
cortex_write_binary({ path: "images/museum.jpg", data: "<base64 from screenshot>", mimeType: "image/jpeg" })

# Puppeteer (sandbox/real env):
await page.screenshot({ path: 'images/museum.jpg', type: 'jpeg', quality: 85 });
```

**Method 2: Direct download (Model B / sandbox — runs where the shell is)**
```bash
curl -L -o images/museum.jpg "https://example.com/photo.jpg"
```

**Method 3: Extract from a referenced PDF**
```python
import fitz
doc = fitz.open('reference.pdf')
for i, info in enumerate(doc[0].get_images(full=True)):
    pix = fitz.Pixmap(doc, info[0])
    if pix.n >= 5: pix = fitz.Pixmap(fitz.csRGB, pix)
    pix.save(f'images/extracted-{i}.png')
```

## Model A — Nexus: save files + relative references (PREFERRED)

Save images to the VFS with `cortex_write_binary`, then reference them in HTML
with relative paths. The platform download step resolves every `<img src>` against
the VFS and inlines the data URI automatically — the downloaded `.html` is fully
self-contained with zero model output-token cost for images.

**IMPORTANT:** Images MUST be written via `cortex_write_binary` (not `cortex_write`).
The download inliner only recognizes `data:` URI content in VFS storage — raw base64
text strings written by `cortex_write` will not be inlined.

```html
<!-- In your HTML (written via cortex_write to VFS): -->
<figure>
  <img src="images/museum.jpg"
       alt="Museum entrance with replica Spanish cannons"
       style="max-width:100%; height:auto;"/>
  <figcaption>Fig 1. Maritime Museum entrance. <span class="photo-credit">Photo: R. Nunez / Flickr</span></figcaption>
</figure>
```

```
VFS layout:
  reports/
    report.html          <img src="images/museum.jpg">
    images/
      museum.jpg         (saved via cortex_write_binary)
      diagram.svg        (inline SVG still preferred for charts)
```

Delivery: `cortex_write` the `.html` to the VFS, save images alongside via
`cortex_write_binary`, then tell the user: *"Download this file from the FILE
manager and open it in your browser, then Ctrl/Cmd+P → Save as PDF. Images are
bundled automatically on download."*

## Model B — sandbox Chromium: full agent-driven PDF cycle

Requires the **nexus-browser** backend (not Playwright MCP). Download images
directly in the sandbox, write HTML alongside them, convert with `html2pdf`:

```
/tmp/report/
  report.html          <img src="images/museum.jpg">
  images/
    museum.jpg         (downloaded via curl in sandbox)
```
```bash
# Download images in sandbox (no output-token cost):
run_command("curl -L -o /tmp/report/images/museum.jpg 'https://example.com/museum.jpg'")

# Convert — base64 output for piping back to VFS:
run_command("html2pdf /tmp/report/report.html --base64 --no-header --paper a4")

# Write PDF to VFS:
cortex_write_binary({ path: "/sandbox/documents/report.pdf",
                      data: "<base64 from tool result>",
                      mimeType: "application/pdf" })
```

No image output-token cost (images stay in sandbox; only the final PDF base64
flows through the model). Token cost of a 500KB PDF ≈ ~170K output tokens —
prefer Model A for large documents.

**Timeout**: `run_command` defaults to 30s. For large PDFs, pass
`timeout: 75000` and use `html2pdf --timeout 60`.

## Image Sizing Guidelines

| Use | Resolution | Target size | Notes |
|-----|-----------|-------------|-------|
| Full-width photo | 300 DPI (~1800px/6in) | ~2MB | Download inliner handles any size |
| Half-width photo | 200 DPI (~600px/3in) | ~800KB | No model output cap applies |
| Thumbnail | 150 DPI (~300px) | ~200KB | |
| Diagram/chart | SVG preferred | inline SVG | Compact markup, no base64 needed |

## Embedding Rules (both models)

```
[ ] Every section with a visual subject has ≥1 image
[ ] Every <img> has descriptive alt text
[ ] Every <figure> has a <figcaption> with description + attribution
[ ] Photo credits included where the source is known
[ ] Images saved as files (cortex_write_binary or disk), referenced by relative path
[ ] HTML and images in the same VFS directory tree
[ ] SVG preferred for charts/diagrams (inline markup, not files)
```

**Format choice:** JPEG for photos, PNG for sharp-edge/transparent diagrams,
**SVG preferred** for anything non-photographic (compact in both models).
