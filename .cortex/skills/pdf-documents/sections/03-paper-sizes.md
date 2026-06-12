# Paper Sizes — Complete Reference

All dimensions in **mm (millimetres)** with **inches** and **CSS** equivalents.

## ISO A Series (International Standard — EU, Asia, most of world)

| Size | mm (W x H) | inches (W x H) | CSS @page | Common Use |
|------|-------------|-----------------|-----------|------------|
| **A0** | 841 x 1189 | 33.11 x 46.81 | `size: 841mm 1189mm` | Technical drawings, posters |
| **A1** | 594 x 841 | 23.39 x 33.11 | `size: 594mm 841mm` | Architectural plans, flip charts |
| **A2** | 420 x 594 | 16.54 x 23.39 | `size: 420mm 594mm` | Posters, diagrams |
| **A3** | 297 x 420 | 11.69 x 16.54 | `size: 297mm 420mm` | Tabloid drawings, large charts |
| **A4** | 210 x 297 | 8.27 x 11.69 | `size: A4` | **Default document worldwide** |
| **A5** | 148 x 210 | 5.83 x 8.27 | `size: 148mm 210mm` | Booklets, notebooks |
| **A6** | 105 x 148 | 4.13 x 5.83 | `size: 105mm 148mm` | Postcards, pocket guides |

## ISO B Series (Intermediate sizes — envelopes, posters)

| Size | mm (W x H) | inches (W x H) | Common Use |
|------|-------------|-----------------|------------|
| **B0** | 1000 x 1414 | 39.37 x 55.67 | Large posters |
| **B1** | 707 x 1000 | 27.83 x 39.37 | Posters |
| **B2** | 500 x 707 | 19.69 x 27.83 | Posters |
| **B3** | 353 x 500 | 13.90 x 19.69 | Large menus |
| **B4** | 250 x 353 | 9.84 x 13.90 | Newspapers, maps |
| **B5** | 176 x 250 | 6.93 x 9.84 | Books, magazines |

## North American Sizes (US, Canada)

| Size | mm (W x H) | inches (W x H) | CSS @page | Common Use |
|------|-------------|-----------------|-----------|------------|
| **Letter** | 215.9 x 279.4 | 8.5 x 11 | `size: letter` | **Default US document** |
| **Legal** | 215.9 x 355.6 | 8.5 x 14 | `size: legal` | Legal documents, contracts |
| **Tabloid / Ledger** | 279.4 x 431.8 | 11 x 17 | `size: ledger` | Spreadsheets, newspapers |
| **Half Letter** | 139.7 x 215.9 | 5.5 x 8.5 | `size: 139.7mm 215.9mm` | Booklets, flyers |
| **Executive** | 184.2 x 266.7 | 7.25 x 10.5 | `size: 184.2mm 266.7mm` | Memos, shorter letters |
| **ANSI C** | 431.8 x 558.8 | 17 x 22 | `size: 431.8mm 558.8mm` | Engineering drawings |
| **ANSI D** | 558.8 x 863.6 | 22 x 34 | `size: 558.8mm 863.6mm` | Architectural plans |
| **ANSI E** | 863.6 x 1117.6 | 34 x 44 | `size: 863.6mm 1117.6mm` | Large-format engineering |

## Japanese (JIS) Sizes

| Size | mm (W x H) | Common Use |
|------|-------------|------------|
| **JIS B4** | 257 x 364 | Newspapers, atlases |
| **JIS B5** | 182 x 257 | Books, magazines |
| **Shiroku-ban 4** | 264 x 379 | Magazines |
| **Kiku 4** | 227 x 306 | Magazines |

## Orientation

```css
/* Portrait (default — taller than wide) */
@page { size: A4 portrait; }

/* Landscape (wider than tall) */
@page { size: A4 landscape; }

/* Mixed orientation per named page */
@page wide-chart { size: A4 landscape; }
.landscape-page { page: wide-chart; }
```

## Chromium Paper Size Flags

Chromium `--paper-width` and `--paper-height` are in **inches**:

```bash
# A4:
--paper-width=8.27 --paper-height=11.69

# Letter:
--paper-width=8.5 --paper-height=11

# A3:
--paper-width=11.69 --paper-height=16.54

# Legal:
--paper-width=8.5 --paper-height=14

# Tabloid/Ledger:
--paper-width=11 --paper-height=17

# ANSI D:
--paper-width=22 --paper-height=34

# Custom (300mm x 1500mm banner):
--paper-width=11.81 --paper-height=59.06
```
