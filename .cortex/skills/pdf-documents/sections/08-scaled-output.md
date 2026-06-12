# Scaled / Blueprint / Poster Output

## Principles of 1:1 Scaled Output

For blueprints, engineering drawings, and physical-dimension-accurate output, the PDF must print at **exact real-world measurements**. This means:

1. **CSS dimensions in physical units** (`mm`, `cm`, `in`) — never `px` or `%`
2. **No browser scaling** — `@page` margins + content must exactly fill the paper
3. **User must print at 100% scale** (no "Fit to page") — include a scale verification bar

## Scale Verification Bar (ALWAYS include)

```html
<!-- Place this on every blueprint page -->
<div class="scale-bar" style="break-inside:avoid; margin:5mm 0;">
  <svg width="100mm" height="8mm" viewBox="0 0 100 8" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="2" width="100" height="4" fill="none" stroke="black" stroke-width="0.5"/>
    <rect x="0" y="2" width="10" height="4" fill="black"/>
    <rect x="20" y="2" width="10" height="4" fill="black"/>
    <rect x="40" y="2" width="10" height="4" fill="black"/>
    <rect x="60" y="2" width="10" height="4" fill="black"/>
    <rect x="80" y="2" width="10" height="4" fill="black"/>
    <text x="0" y="1.5" font-size="2" font-family="sans-serif">0</text>
    <text x="50" y="1.5" font-size="2" font-family="sans-serif" text-anchor="middle">50mm</text>
    <text x="100" y="1.5" font-size="2" font-family="sans-serif" text-anchor="end">100mm</text>
  </svg>
  <p style="font-size:7pt;color:#666;margin:1mm 0 0;">
    VERIFY: This bar should measure exactly 100mm when printed at 100% scale.
  </p>
</div>
```

## Common Scaled Formats

### Architectural Blueprint (ANSI D — 22" x 34")

```css
@page {
  size: 558.8mm 863.6mm;  /* ANSI D */
  margin: 10mm;
}
body {
  font-family: 'Courier New', monospace;  /* traditional blueprint font */
  font-size: 10pt;
}
/* Title block: bottom-right corner, standard 150mm x 50mm */
.title-block {
  position: fixed;
  bottom: 10mm;
  right: 10mm;
  width: 150mm;
  height: 50mm;
  border: 0.5mm solid black;
}
/* Drawing area uses remaining space */
.drawing-area {
  width: 833.6mm;
  height: 508.8mm;
}
/* Grid: 10mm squares */
.grid-overlay {
  background-image:
    linear-gradient(rgba(0,0,0,0.1) 0.3mm, transparent 0.3mm),
    linear-gradient(90deg, rgba(0,0,0,0.1) 0.3mm, transparent 0.3mm);
  background-size: 10mm 10mm;
}
```

### Scale Ratios for Blueprints

| Scale | Meaning | CSS Factor | Use Case |
|-------|---------|-----------|----------|
| **1:1** | Full size | `1mm = 1mm` | Small parts, PCBs, jewelry |
| **1:2** | Half size | `1mm = 0.5mm` on paper | Mechanical parts |
| **1:5** | Fifth size | `1mm = 0.2mm` on paper | Furniture, cabinets |
| **1:10** | Tenth size | `1mm = 0.1mm` on paper | Room layouts |
| **1:20** | | `1mm = 0.05mm` | Floor plans |
| **1:50** | | `1m = 20mm` on paper | Building floor plans |
| **1:100** | | `1m = 10mm` on paper | Site plans |
| **1:200** | | `1m = 5mm` on paper | Large site plans |
| **1:500** | | `1m = 2mm` on paper | Master plans, neighborhoods |
| **1:1000** | | `1m = 1mm` on paper | City blocks, terrain |

**CSS scale helper:**
```css
/* 1:50 scale — every 1mm CSS = 50mm real world */
.scale-1-50 {
  /* A room 5m x 4m = 5000mm x 4000mm real
     At 1:50: 100mm x 80mm on paper */
}
.scale-label::after { content: "Scale 1:50"; font-size: 8pt; }
```

### Poster (A1 Portrait — Conference Poster)

```css
@page {
  size: 594mm 841mm;  /* A1 */
  margin: 15mm;
}
body { font-family: 'Helvetica Neue', Arial, sans-serif; }
/* Poster text must be readable from 1-2 metres */
h1 { font-size: 72pt; }          /* title: readable from 3m */
h2 { font-size: 36pt; }          /* section heads */
p, li { font-size: 24pt; }       /* body: readable from 1.5m */
figcaption { font-size: 18pt; }  /* captions */
/* Three-column layout */
.poster-body {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10mm;
}
```

### Banner (Custom — e.g. 300mm x 1500mm)

```css
@page {
  size: 300mm 1500mm;  /* tall/narrow banner */
  margin: 5mm;
}
body {
  font-family: Impact, 'Arial Black', sans-serif;
  text-align: center;
}
h1 { font-size: 96pt; letter-spacing: 2mm; }
```

**Chromium custom size:**
```bash
# Chromium --paper-width and --paper-height are in INCHES
# 300mm = 11.81in, 1500mm = 59.06in
chromium --headless --no-sandbox --disable-gpu \
  --print-to-pdf=banner.pdf \
  --print-to-pdf-no-header \
  --paper-width=11.81 --paper-height=59.06 \
  banner.html
```

## Puppeteer for Exact Control (Recommended for Scaled Work)

```javascript
const puppeteer = require('puppeteer');

async function printBlueprint(htmlPath, outputPath, widthMM, heightMM) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  await page.pdf({
    path: outputPath,
    width: `${widthMM}mm`,
    height: `${heightMM}mm`,
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    preferCSSPageSize: true,  // CRITICAL: respect @page CSS, don't override
  });

  await browser.close();
}

// Usage:
// printBlueprint('/path/to/blueprint.html', 'output.pdf', 558.8, 863.6);  // ANSI D
```
