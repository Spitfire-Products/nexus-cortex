# Preview and QA Loop

> **Delivery model note (see SKILL.md).** The print-to-pdf QA loop below is
> **Model B only** — it needs a real `chromium`. In **Model A (Nexus)** you
> cannot print-to-pdf to inspect your own output; QA by re-reading your
> generated HTML for the checklist issues (structure, page-break CSS, image
> embedding correctness, overflow), then deliver the `.html` to the VFS and
> tell the user to print it from their browser. The user's browser print *is*
> the final render — get the print CSS right by reading, you won't see the
> rendered pages yourself.

## Strategy: Print-to-PDF then Review (Cheapest)

The most token-efficient QA loop is:

```
1. Write HTML
2. chromium --print-to-pdf (fast, headless, no browser session cost)
3. Read the PDF (agent reads pages via PDF reader tool)
4. Check: blank pages, orphaned headings, cut tables, chart overflow
5. Fix CSS and repeat
```

This costs fewer tokens than maintaining a browser session because:
- No browser startup / scan / screenshot overhead
- PDF reader gives structured text extraction (faster to parse than screenshots)
- One command generates the PDF — no interactive steps

## When to Use Browser Preview Instead

Use nexus-browser or a headless browser session when:
- The document has **interactive elements** (forms, expandable sections) to verify before flattening
- You need **visual diff comparison** between two versions (screenshot comparison)
- The document uses **web fonts** that may not load in headless file:// mode
- You need to verify **responsive layout** at specific viewport sizes before print

```
# Browser preview workflow:
1. browse({ url: "file:///path/to/document.html" })
2. screenshot()  — verify screen layout
3. Ctrl+P / print preview (not automatable in headless — use print-to-pdf instead)
4. close_session()
```

## Automated QA Checklist

After generating the PDF, check for these common issues:

```
[ ] No blank pages (caused by break-inside:avoid on tall elements)
[ ] No orphaned headings (heading alone at page bottom, content on next page)
[ ] Tables not split mid-row (thead repeats on new pages)
[ ] SVG charts fully visible (not cut at page boundary)
[ ] Images not overflowing margins
[ ] Page numbers correct (if using running footers)
[ ] Cover page breaks correctly to its own page
[ ] Fonts readable at intended print size (11pt+ body, 8pt+ captions)
[ ] Scale bar accurate (for blueprints/scaled output)
[ ] Dark backgrounds removed or inverted for print (save ink)
[ ] Links show URLs in parentheses (for print readability)
[ ] No screen-only UI elements visible (navigation, toolbars)
```

## QA by PDF Page Count

A useful quick check: if the task is a ~5 page report and you get 7 pages, there are probably 2 blank pages from the break-inside bug. Read the PDF and look for pages with no content.
