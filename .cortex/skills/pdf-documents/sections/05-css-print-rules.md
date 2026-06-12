# CSS Print Rules — The Complete Toolkit

## Base Template (copy-paste starting point)

```css
/* ── Print Reset ─────────────────────────────────────────── */
@media print {
  body {
    background: white;
    color: black;
    font-size: 11pt;           /* pt not px for print */
    line-height: 1.5;
    max-width: none;
    padding: 0;
    margin: 0;
  }

  /* Hide screen-only elements */
  .no-print, .screen-only, nav, .toolbar { display: none !important; }

  /* Links: show URL for informational, hide for navigation */
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; color: #666; }
  a[href^="#"]::after { content: none; }
  a { color: black; text-decoration: none; }
}

/* ── Page Configuration ──────────────────────────────────── */
@page {
  size: A4 portrait;
  margin: 20mm 15mm 25mm 15mm;  /* top right bottom left */

  /* Running header/footer (WeasyPrint + Prince; NOT Chromium) */
  @top-center { content: "Document Title"; font-size: 9pt; color: #888; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; }
}

/* First page: no header, larger top margin for cover */
@page :first {
  margin-top: 40mm;
  @top-center { content: none; }
}
```

## Page Break Control (CRITICAL for quality output)

```css
/* ── GOLDEN RULES ────────────────────────────────────────── */

/* 1. NEVER let headings orphan at page bottom */
h1, h2, h3, h4 {
  break-after: avoid;      /* don't break right after a heading */
  page-break-after: avoid; /* legacy fallback */
}

/* 2. Keep tables, charts, figures together */
table, figure, .chart-container, svg {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* 3. Force page breaks where you WANT them */
.page-break { break-before: page; page-break-before: always; }
.cover { break-after: page; page-break-after: always; }

/* 4. Avoid widows and orphans (single lines stranded) */
p {
  widows: 3;   /* min lines at top of new page */
  orphans: 3;  /* min lines at bottom before break */
}

/* 5. For LONG sections that MUST break, remove avoid */
/* LESSON LEARNED: break-inside:avoid on a section taller than
   one page creates a BLANK page before it. Only use avoid on
   elements shorter than one full page. */
.timeline-item { break-inside: avoid; }  /* individual items OK */
.timeline { /* NO break-inside:avoid — section is multi-page */ }

/* 6. Table rows: keep header visible after break */
thead { display: table-header-group; }  /* repeat header on each page */
tfoot { display: table-footer-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
```

## Common Print Pitfalls and Fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| **Blank page before section** | `break-inside: avoid` on element taller than page | Remove `avoid` from container; apply to children |
| **Table split mid-row** | Missing `break-inside: avoid` on `<tr>` | Add `tr { break-inside: avoid; }` |
| **Heading alone at page bottom** | No `break-after: avoid` on `<h2>` | Add heading break rules |
| **Background colors missing** | Chromium strips backgrounds by default | Use `--print-background` flag or `color-adjust: exact` |
| **SVG chart cut in half** | SVG inside a div without `break-inside: avoid` | Wrap SVG in `.chart-container { break-inside: avoid; }` |
| **Margins too small for binding** | Equal margins all sides | Use asymmetric: `@page :left { margin-left: 25mm; }` |
| **Dark backgrounds waste ink** | Designed for screen | Use `@media print` to flip to light backgrounds |
| **Font size too small** | Using `px` (screen) not `pt` (print) | `1pt = 1/72 inch`. Use 10-12pt body, 8-9pt captions |
| **Images overflow page** | Fixed-width images | `img { max-width: 100%; height: auto; }` |
| **Code blocks cut off** | Long lines + `overflow: hidden` | `pre { white-space: pre-wrap; word-wrap: break-word; }` |

## Named Pages (Mixed Layouts in One Document)

```css
/* Define named page types */
@page cover-page { size: A4; margin: 0; }
@page content-page { size: A4; margin: 20mm 15mm 25mm 15mm; }
@page landscape-page { size: A4 landscape; margin: 15mm; }

/* Assign sections to page types */
.cover { page: cover-page; break-after: page; }
.content { page: content-page; }
.wide-table { page: landscape-page; break-before: page; break-after: page; }
```

## Chromium-Specific Print Flags

```bash
# Print with backgrounds (colors, gradients)
chromium --headless --no-sandbox --disable-gpu \
  --print-to-pdf=output.pdf \
  --print-to-pdf-no-header \
  --run-all-compositor-stages-before-draw \
  input.html

# Note: --print-background is implied by --print-to-pdf in modern Chromium
# The CSS property `color-adjust: exact` forces background printing per-element
```

```css
/* Force background printing for specific elements */
.colored-header {
  background: oklch(0.30 0.08 250);
  color: white;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
```
