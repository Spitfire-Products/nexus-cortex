# SVG Charts and Diagrams (Inline)

Always use **inline SVG** for charts — no external dependencies, scales perfectly in print.

## Bar Chart Pattern

```html
<div class="chart-container">
  <p class="chart-title">Monthly Revenue</p>
  <svg viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
    <!-- Y-axis -->
    <line x1="50" y1="20" x2="50" y2="250" stroke="#333" stroke-width="1"/>
    <!-- X-axis -->
    <line x1="50" y1="250" x2="580" y2="250" stroke="#333" stroke-width="1.5"/>
    <!-- Grid lines (light, behind bars) -->
    <line x1="50" y1="150" x2="580" y2="150" stroke="#eee" stroke-width="1"/>
    <!-- Bars: x = 60 + (i * barSpacing), height = value * scale -->
    <rect x="70" y="100" width="35" height="150" rx="3" fill="#2563eb"/>
    <text x="87" y="270" text-anchor="middle" font-size="10">Jan</text>
    <text x="87" y="95" text-anchor="middle" font-size="9" fill="#333">$15K</text>
    <!-- ... more bars ... -->
  </svg>
</div>
```

**Key SVG print rules:**
- Use `viewBox` + `style="width:100%;height:auto;"` for responsive scaling
- Font sizes in SVG are independent of CSS — use `font-size="10"` (unitless = px in SVG)
- Colors: use `fill` and `stroke`, not CSS `color`
- For print, avoid very thin strokes (`stroke-width` < 0.5) — they may vanish
- Prefer `font-family="sans-serif"` in SVG for cross-platform rendering

## Pie Chart Pattern (Path-based)

```html
<!-- Pie slice: M center, L start-point, A rx,ry rotation large-arc-flag sweep-flag end-point Z -->
<!-- 25% slice (90 degrees) starting at 12 o'clock -->
<path d="M150,150 L150,50 A100,100 0 0,1 250,150 Z" fill="#2563eb"/>
```

**Calculating pie slices:**
```
For a pie centered at (cx, cy) with radius r:
  Start angle (radians) = (startPercent / 100) * 2 * PI - PI/2
  End angle (radians) = (endPercent / 100) * 2 * PI - PI/2
  Start point: (cx + r * cos(startAngle), cy + r * sin(startAngle))
  End point: (cx + r * cos(endAngle), cy + r * sin(endAngle))
  Large arc flag: 1 if slice > 50%, else 0
```

## Line Chart Pattern

```html
<svg viewBox="0 0 600 300" style="width:100%;height:auto;">
  <!-- Data line -->
  <polyline
    points="60,200 120,180 180,120 240,140 300,80 360,60 420,90"
    fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round"/>
  <!-- Area fill (optional) -->
  <polygon
    points="60,200 120,180 180,120 240,140 300,80 360,60 420,90 420,250 60,250"
    fill="#2563eb" fill-opacity="0.1"/>
  <!-- Data points -->
  <circle cx="60" cy="200" r="4" fill="#2563eb"/>
  <!-- ... more circles ... -->
</svg>
```

## Map / Diagram Pattern

Use simplified SVG `<path>` for geographic outlines. For complex maps, trace from a reference SVG and simplify to essential boundaries. Keep path data minimal — agents don't need cartographic precision, just recognisable shapes with labelled regions.

```html
<svg viewBox="0 0 400 300" style="width:100%;height:auto;">
  <!-- Simplified coastline/boundary -->
  <path d="M50,150 C80,100 120,80 160,90 S240,120 280,100 S360,130 380,160"
        fill="none" stroke="#333" stroke-width="1.5"/>
  <!-- Region labels -->
  <text x="200" y="80" text-anchor="middle" font-size="12" font-weight="bold">Region A</text>
  <!-- Route line -->
  <path d="M80,180 Q200,220 350,140" fill="none" stroke="#e53e3e" 
        stroke-width="2" stroke-dasharray="5,3"/>
  <!-- Location markers -->
  <circle cx="80" cy="180" r="5" fill="#e53e3e"/>
  <circle cx="350" cy="140" r="5" fill="#e53e3e"/>
</svg>
```

## Print-Specific Chart Considerations

- Wrap ALL charts in `.chart-container { break-inside: avoid; }` to prevent page splits
- Use `fill-opacity` instead of RGBA for better print rendering
- Minimum `stroke-width="0.5"` for lines that must be visible in print
- For color-blind accessibility, add patterns or labels to distinguish series:
  ```html
  <pattern id="stripe" patternUnits="userSpaceOnUse" width="4" height="4">
    <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="#333" stroke-width="0.5"/>
  </pattern>
  <rect ... fill="url(#stripe)"/>
  ```
