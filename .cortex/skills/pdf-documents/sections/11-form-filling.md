# PDF Form Detection & Filling

## Overview

Detect AcroForm fields in existing PDF documents, inventory every field for the
user, fill values programmatically with baked appearance streams, and deliver
a completed PDF. Works with interactive AcroForm PDFs and provides a coordinate-overlay
fallback for scanned/non-interactive forms.

All processing via PyMuPDF. Install: `pip install pymupdf`

---

## Step 1: Install PyMuPDF (if needed)

```bash
pip install pymupdf
```

## Step 2: Detect and Inventory All Fields

```python
import fitz
import json

doc = fitz.open('form.pdf')

# PyMuPDF widget field_type values:
# 0=unknown, 1=PushButton, 2=CheckBox, 3=RadioButton,
# 4=ListBox, 5=ComboBox, 6=Signature, 7=Text
TYPE_NAMES = {0:'unknown', 1:'button', 2:'checkbox', 3:'radio',
              4:'listbox', 5:'combobox', 6:'signature', 7:'text'}

fields = []
for page_num in range(len(doc)):
    page = doc[page_num]
    for widget in page.widgets():
        field = {
            'page': page_num + 1,
            'index': len(fields),
            'name': widget.field_name,
            'type': TYPE_NAMES.get(widget.field_type, 'unknown'),
            'type_id': widget.field_type,
            'value': widget.field_value,
            'rect': list(widget.rect),
            'read_only': bool(widget.field_flags & 1),
        }
        if widget.field_type in (4, 5) and widget.choice_values:
            field['options'] = widget.choice_values
        if widget.field_type == 7 and widget.text_maxlen > 0:
            field['max_length'] = widget.text_maxlen
        fields.append(field)

doc.close()

print(f'Found {len(fields)} form fields across {len(doc)} pages')
for f in fields:
    ro = ' [READ-ONLY]' if f['read_only'] else ''
    val = f' = "{f["value"]}"' if f['value'] else ''
    opts = f' options: {f["options"]}' if 'options' in f else ''
    print(f'  [{f["index"]:2d}] p{f["page"]} | {f["type"]:12} | {f["name"]}{val}{opts}{ro}')
```

Present the inventory to the user and collect values before filling.

**IMPORTANT:** Fields with duplicate names (e.g., multiple "County" fields on the same
form) must be addressed by index, not by name. The index is the widget's position
in the `page.widgets()` list.

## Step 3: Fill the Form

```python
import fitz

fill_data = {
    'Full Name': 'John A. Smith',
    'Date of Birth': '03/15/1985',
    'State': 'TX',
    'I Agree': True,
}

# For duplicate field names, use index-based overrides:
# fill_by_index = { 10: 'Jefferson', 12: 'Jefferson', 23: 'Jefferson' }

doc = fitz.open('form.pdf')

for page in doc:
    widgets = list(page.widgets())
    for i, widget in enumerate(widgets):
        # Set font properties for baked appearance streams
        if widget.field_type in (6, 7):  # Signature or Text
            widget.text_fontsize = 0     # auto-fit to field rect
            widget.text_color = (0, 0, 0)

        # Index-based overrides first (for duplicate field names)
        # if i in fill_by_index:
        #     widget.field_value = fill_by_index[i]
        #     widget.update()
        #     continue

        name = widget.field_name
        if name not in fill_data:
            continue

        value = fill_data[name]

        if widget.field_type == 2:  # checkbox
            widget.field_value = 'Yes' if value else 'Off'
        elif widget.field_type == 3:  # radio
            widget.field_value = str(value)
        elif widget.field_type == 6:  # signature — typed name
            widget.field_value = str(value)
        else:
            widget.field_value = str(value)

        widget.update()

# ── CRITICAL: Bake appearance streams ──────────────────────────
# Set NeedAppearances=false so ALL PDF viewers render the filled
# values. Without this, many viewers (web, mobile, lightweight)
# show blank fields — the #1 cause of "it filled but looks empty."
cat_xref = doc.pdf_catalog()
acro_ref = doc.xref_get_key(cat_xref, 'AcroForm')
if acro_ref[0] == 'xref':
    af_xref = int(acro_ref[1].split()[0])
    doc.xref_set_key(af_xref, 'NeedAppearances', 'false')

doc.save('form-filled.pdf', garbage=3, deflate=True)
doc.close()
print('Saved filled form with baked appearances')
```

### Why NeedAppearances Matters

PDF forms have two rendering modes:
- **NeedAppearances=true** — asks the viewer to regenerate visual appearances at
  open time. Many viewers DON'T support this → fields appear blank.
- **NeedAppearances=false** — PyMuPDF's `widget.update()` bakes an AP (appearance
  stream) into each field. These render in ALL viewers.

**Always set NeedAppearances=false after filling.** This is the difference between
a form that works everywhere and one that looks empty in half of all viewers.

## Step 4: Verify All Fields Filled

```python
import fitz

doc = fitz.open('form-filled.pdf')
filled = 0
empty = []
for page in doc:
    for i, w in enumerate(page.widgets()):
        v = w.field_value or ''
        if v and v != 'Off':
            filled += 1
        elif w.field_type != 2:
            empty.append(f'[{i}] {w.field_name}')
        else:
            filled += 1

total = filled + len(empty)
if empty:
    print(f'WARNING: {len(empty)}/{total} fields empty: {empty}')
else:
    print(f'All {total} fields verified')
doc.close()
```

## Step 5: Flatten (Optional — Lock Fields)

```python
import fitz

doc = fitz.open('form-filled.pdf')

for page in doc:
    for widget in list(page.widgets()):
        rect = widget.rect
        value = widget.field_value or ''
        if value and value != 'Off':
            page.insert_text(
                fitz.Point(rect.x0 + 2, rect.y1 - 2),
                value, fontsize=10, fontname='helv',
            )
    page.clean_contents()

doc.save('form-final.pdf', garbage=4, deflate=True)
doc.close()
```

---

## Fallback: Scanned / Non-Interactive Forms

If the PDF has no AcroForm fields, overlay text at specific coordinates:

```python
import fitz

doc = fitz.open('scanned-form.pdf')
page = doc[0]

# 1. Render as image to identify field locations
pix = page.get_pixmap(dpi=150)
pix.save('form-preview.png')

# 2. Overlay text at identified positions (coordinates in PDF points, 72/inch)
fields = [
    (fitz.Point(150, 245), 'John A. Smith'),
    (fitz.Point(150, 290), '03/15/1985'),
    (fitz.Point(150, 335), '123 Main St, Dallas, TX 75201'),
]

for point, text in fields:
    page.insert_text(point, text, fontsize=11, fontname='helv', color=(0, 0, 0))

doc.save('scanned-filled.pdf')
doc.close()
```

---

## Field Type Reference

| Type ID | Type | Fill Pattern | Notes |
|---------|------|-------------|-------|
| 2 | Checkbox | `'Yes'` / `'Off'` | Some PDFs use custom on_state values |
| 3 | Radio | Option label text | Set to the option's export value |
| 4 | Listbox | Option value | Must match one of `choice_values` |
| 5 | Combobox | Option value or free text | Depends on field flags |
| 6 | Signature | `/s/ Name` | Accepts text for typed signatures |
| 7 | Text | Any string | Set `text_fontsize=0` for auto-fit |

## Tips

- Always inventory fields first — present to user before filling
- Watch for duplicate field names — use index-based filling when names collide
- `text_fontsize = 0` tells PyMuPDF to auto-scale text to fit the field rect
- **Always set NeedAppearances=false** — this is the #1 cause of blank fields
- Signature fields (type 6) accept typed text like `/s/ Full Name` for e-signatures
