---
name: xlsx
description: >
  Create, read, edit, and clean spreadsheets (.xlsx, .csv, .tsv). Use whenever a
  spreadsheet file is the primary input or output — adding columns/formulas,
  formatting, charting, cleaning messy tabular data, converting between tabular
  formats, or building a workbook from scratch. The deliverable must be a
  spreadsheet file; do not trigger for HTML reports or database pipelines that
  merely involve tabular data.
metadata:
  short-description: "Create, read, edit, and clean spreadsheets (.xlsx/.csv)"
  author: "nexus-cortex"
---

# XLSX — Spreadsheets

Work with spreadsheet files using open-source tooling. Two layers: **pandas**
for data operations (load/clean/transform), **openpyxl** for Excel-native
features (formulas, formatting, charts, multiple sheets).

## Tooling (pick by job)

| Job | Tool | Notes |
|-----|------|-------|
| Load / clean / transform data | `pandas` | `read_excel` / `read_csv` → operate → `to_excel(index=False)` |
| Formulas, formatting, charts, multi-sheet | `openpyxl` | The Excel-native layer |
| Both in one file | pandas first, then reopen with openpyxl to format | Standard two-pass pattern |
| Huge files | `openpyxl` `read_only=True` / `write_only=True` | Streamed, low-memory |
| csv/tsv ↔ xlsx | pandas | `read_csv(sep="\t")` for .tsv |

Install on demand: `pip install pandas openpyxl`.

## Core patterns

```python
import pandas as pd
df = pd.read_excel("in.xlsx", sheet_name="Data")      # or read_csv
df["margin"] = (df["revenue"] - df["cost"]) / df["revenue"]
df.to_excel("out.xlsx", sheet_name="Data", index=False)
```

```python
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference

wb = load_workbook("out.xlsx")
ws = wb["Data"]

ws["E1"] = "total"
for row in range(2, ws.max_row + 1):
    ws[f"E{row}"] = f"=B{row}+C{row}"        # live formula, recalculated on open

for cell in ws[1]:                            # header styling
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="4472C4")
ws.freeze_panes = "A2"
for col in range(1, ws.max_column + 1):       # readable widths
    ws.column_dimensions[get_column_letter(col)].width = 14

chart = BarChart(); chart.title = "Revenue by region"
chart.add_data(Reference(ws, min_col=2, min_row=1, max_row=ws.max_row), titles_from_data=True)
chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=ws.max_row))
ws.add_chart(chart, "G2")
wb.save("out.xlsx")
```

## The formula gotcha (most common failure)

openpyxl **writes formula strings but never computes them**. A freshly written
`=SUM(...)` has no value until the file opens in Excel/LibreOffice.
- Reading: `load_workbook(path, data_only=True)` returns the **cached** values
  from the last real save — `None` if the file was never opened by an app.
- If you must verify computed results headlessly, recalculate once via
  LibreOffice: `soffice --headless --convert-to xlsx file.xlsx --outdir out/`,
  then read with `data_only=True` — or compute the expected value in pandas and
  compare.

## Cleaning messy tabular data

1. Inspect first (`df.head(20)`, `df.dtypes`, `df.isna().sum()`) — never clean blind.
2. Fix structure before values: misplaced headers (`header=N`, `skiprows`),
   merged-cell artifacts (`ffill`), junk rows (`dropna(how="all")`).
3. Normalize types explicitly (`pd.to_numeric(errors="coerce")`,
   `pd.to_datetime`) and report what got coerced — silent coercion hides data loss.
4. Write the cleaned result to a NEW file; never overwrite the user's original.

## Verification (mandatory)

1. **Re-open the file** (`load_workbook` / `read_excel`) — corruption throws.
2. **Assert the data**: row/column counts, key cell values, sheet names.
3. **Formulas**: confirm the formula STRING landed where intended; verify
   computed values via the LibreOffice recalc pass or a pandas recomputation.

## Limits to know

- `.xls` (legacy) needs `xlrd`/LibreOffice conversion — convert to .xlsx first.
- Pivot tables and macros (`.xlsm` VBA) are preserved by openpyxl
  (`keep_vba=True`) but not editable — say so rather than faking it.
- Excel's 1,048,576-row limit: route bigger data to CSV/parquet and say why.
