# Document Layout Templates and External Template Sources

## Built-In CSS Layout Snippets

### Research Report (A4/Letter)

```css
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; }
@page { size: A4; margin: 25mm 20mm 30mm 20mm; }
h1 { font-size: 22pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
table { font-size: 9.5pt; }
figcaption { font-size: 9pt; }
.cover { text-align: center; padding-top: 80mm; break-after: page; }
```

### Technical Specification (A4 two-column)

```css
body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; }
@page { size: A4; margin: 15mm 12mm 20mm 12mm; }
.content { column-count: 2; column-gap: 8mm; }
.content h2 { column-span: all; }  /* headers span full width */
table { font-size: 8.5pt; break-inside: avoid; }
code { font-size: 8pt; }
```

### Presentation / Slide Deck (Landscape)

```css
@page { size: A4 landscape; margin: 10mm; }
.slide {
  height: 170mm;       /* A4 landscape height minus margins */
  break-after: page;
  display: flex; flex-direction: column; justify-content: center;
  padding: 15mm;
}
.slide h1 { font-size: 28pt; text-align: center; }
```

### Book / Booklet (Facing Pages)

```css
@page { size: B5; margin: 20mm 15mm 25mm 20mm; }
@page :left { margin-left: 25mm; margin-right: 15mm; }   /* gutter on left */
@page :right { margin-left: 15mm; margin-right: 25mm; }  /* gutter on right */
@page :first { margin-top: 50mm; }  /* extra space on title page */
```

---

## Using Existing Document Templates

Thousands of professionally designed templates already exist. Use them as **conversion targets** (direct HTML extraction) or **design references** (extract the tokens, rebuild in clean HTML).

### Template Sources by Format

| Source | Formats | Cost | Best For |
|--------|---------|------|----------|
| **Microsoft Office Templates** | `.docx`, `.pptx` | Free (with Office) | Business reports, letters, proposals, invoices |
| **Google Docs/Slides Templates** | Google Docs (export `.docx`) | Free | Quick collaborative drafts |
| **LaTeX Document Classes** | `.cls`, `.sty`, `.tex` | Free | Academic papers, theses, CVs, books |
| **Canva** | Export as PDF | Free tier + Pro | Marketing, social media, presentations |
| **Adobe InDesign** | `.indd`, export PDF/IDML | Paid | Magazines, brochures, print-heavy layouts |
| **Figma** | Export PDF/SVG | Free tier | Modern UI-influenced layouts, cards |
| **HTML Template Libraries** | HTML/CSS | Free-Paid | Direct drop-in — already HTML |
| **Typst** | `.typ` | Free | Modern LaTeX alternative, cleaner syntax |

### Direct Conversion: Template → HTML

**DOCX → HTML (Best fidelity for Word templates)**

```bash
# Mammoth.js — semantic conversion (recommended for clean HTML)
npx mammoth input.docx --output=output.html --style-map="p[style-name='Title'] => h1:fresh"

# LibreOffice headless — preserves visual layout more closely
libreoffice --headless --convert-to html input.docx

# Pandoc — universal converter (good for body text, loses complex layout)
pandoc input.docx -o output.html --standalone --embed-resources
```

Mammoth produces the cleanest HTML. LibreOffice preserves visual layout but generates messy markup. **Always Mammoth first**, fall back to LibreOffice when layout fidelity matters more than clean code.

**PPTX → HTML**

```bash
libreoffice --headless --convert-to html input.pptx
pandoc input.pptx -o output.html --standalone
```

PowerPoint templates are better treated as **design references** — the absolute-positioned HTML from converters is unusable for responsive print CSS.

**LaTeX → HTML**

```bash
# make4ht — best LaTeX→HTML (preserves math as MathML or SVG)
make4ht input.tex "html5,mathml" "" "" "--output-dir=out"

# Pandoc — simpler, handles most LaTeX well
pandoc input.tex -o output.html --standalone --mathjax --embed-resources

# LaTeXML — highest fidelity for complex documents
latexml input.tex | latexmlpost --dest=output.html
```

**LaTeX class → CSS equivalents:**

| LaTeX Class | CSS Equivalent |
|-------------|---------------|
| `\documentclass[twocolumn]{article}` | `column-count: 2; column-gap: 8mm;` |
| `\geometry{margin=1in}` | `@page { margin: 25.4mm; }` |
| `\setmainfont{Palatino}` | `body { font-family: 'Palatino Linotype', Palatino, serif; }` |
| `\linespread{1.25}` | `body { line-height: 1.25; }` |
| `\parindent 1.5em` | `p + p { text-indent: 1.5em; }` |

**Typst → HTML/PDF**

```bash
typst compile input.typ output.pdf
pandoc -f typst input.typ -o output.html --standalone  # experimental
```

**Canva / Figma → HTML**: No reliable direct conversion. Use the design reference workflow below.

**HTML Template Libraries (Direct Use)**

| Library | License | Templates |
|---------|---------|-----------|
| **HTML5 UP** | CC BY 3.0 (free) | 40+ responsive templates |
| **Tailwind UI** | Paid | Component library — cards, heroes, pricing |
| **Bootstrap Examples** | MIT | 20+ example layouts |
| **Paged.js Templates** | MIT | Print-specific — book, report, thesis (built for `@page`) |

Paged.js templates are the best starting point — built specifically for `@page` rules, `break-*` properties, and running headers/footers.

### The Design Reference Workflow

When direct conversion produces messy HTML (most of the time), treat the template as a **visual specification**:

```
1. BROWSE the template (open in viewer/browser/renderer)
   → Screenshot key pages (cover, body, table page, chart page)

2. EXTRACT design tokens: fonts, colors, spacing, column layout, decorative elements

3. BUILD a CSS custom properties block:
   :root {
     --font-heading: 'Playfair Display', Georgia, serif;
     --font-body: 'Source Sans 3', 'Segoe UI', sans-serif;
     --color-bg: oklch(0.99 0.005 240);
     --color-text: oklch(0.20 0.02 240);
     --color-accent: oklch(0.55 0.18 250);
     --margin-page: 20mm 18mm 25mm 18mm;
     --font-size-body: 10.5pt;
   }

4. WRITE the HTML using your token system (normal pipeline from SKILL.md onward)
```

This produces **cleaner, more maintainable HTML** than any automated converter.

### Ready-to-Use Template Recipes

**Academic Paper (from LaTeX `article` class)**

```css
@page { size: letter; margin: 1in; }
body { font-family: 'Computer Modern Serif', 'Latin Modern Roman', Georgia, serif;
       font-size: 10pt; line-height: 1.4; }
h1 { font-size: 17pt; text-align: center; margin-bottom: 6pt; }
h2 { font-size: 12pt; font-style: italic; }
.abstract { font-size: 9pt; margin: 0 15mm; font-style: italic; }
.two-col { column-count: 2; column-gap: 6mm; }
p + p { text-indent: 1.5em; margin-top: 0; }
```

**Corporate Report (from Word "Facet" template)**

```css
@page { size: A4; margin: 20mm 18mm 25mm 18mm; }
body { font-family: 'Source Sans 3', 'Segoe UI', sans-serif;
       font-size: 10.5pt; line-height: 1.5; color: oklch(0.25 0.02 250); }
h1 { font-size: 26pt; font-weight: 300; color: oklch(0.35 0.15 250);
     border-bottom: 3px solid oklch(0.55 0.20 250); padding-bottom: 8pt; }
h2 { font-size: 14pt; font-weight: 600; color: oklch(0.35 0.15 250); }
.cover { break-after: page; display: flex; flex-direction: column;
         justify-content: center; height: 100vh;
         background: linear-gradient(135deg, oklch(0.30 0.12 250), oklch(0.20 0.08 250)); color: white; }
table thead { background: oklch(0.35 0.12 250); color: white; }
```

**Magazine / Newsletter (from InDesign layout)**

```css
@page { size: A4; margin: 12mm 10mm 15mm 10mm; }
body { font-family: 'Libre Franklin', 'Helvetica Neue', sans-serif;
       font-size: 9.5pt; line-height: 1.45; }
.spread { column-count: 3; column-gap: 5mm; }
.pullquote { font-size: 18pt; font-family: 'Playfair Display', Georgia, serif;
             font-style: italic; color: oklch(0.50 0.20 30);
             border-left: 4px solid oklch(0.50 0.20 30); padding-left: 12pt;
             column-span: all; margin: 16pt 0; }
.caption { font-size: 7.5pt; color: oklch(0.45 0.02 250); }
figure { break-inside: avoid; margin: 0 0 8pt 0; }
```

**Invoice / Receipt (from Google Docs template)**

```css
@page { size: letter; margin: 15mm; }
body { font-family: 'Inter', system-ui, sans-serif;
       font-size: 9pt; line-height: 1.4; color: oklch(0.25 0 0); }
.header { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid oklch(0.85 0 0); padding-bottom: 12pt; margin-bottom: 16pt; }
.company { font-size: 18pt; font-weight: 700; }
.invoice-number { font-size: 14pt; color: oklch(0.45 0 0); text-align: right; }
table { width: 100%; border-collapse: collapse; }
table th { text-align: left; border-bottom: 1px solid oklch(0.80 0 0);
           font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em;
           padding: 6pt 8pt; color: oklch(0.45 0 0); }
table td { padding: 8pt; border-bottom: 1px solid oklch(0.92 0 0); }
.total-row td { font-weight: 700; font-size: 11pt; border-top: 2px solid oklch(0.25 0 0); }
```
