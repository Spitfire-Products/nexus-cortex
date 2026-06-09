# Splash Screen Chip Art Configurator

Tools for customizing the Nexus Cortex CLI splash screen chip art center text.

## Files

- `splash_font_library.py` - ASCII art font library with full alphabet
- `splash_configurator.py` - Interactive tool for generating chip art

## Quick Start

```bash
cd packages/cli/themes/chalk

# Preview chip art with different text
python3 splash_configurator.py --preview NEON
python3 splash_configurator.py --preview NEO
python3 splash_configurator.py --preview V4

# Generate TypeScript code to paste into CortexApp.tsx
python3 splash_configurator.py NEON

# Directly update CortexApp.tsx (with confirmation)
python3 splash_configurator.py --update NEON

# Show full font alphabet
python3 splash_configurator.py --alphabet
```

## Font System

### Character Set

The font uses Unicode block drawing characters:
```
█ ▓ ▒ ░  ▀ ▄ ▌ ▐ ▖ ▗ ▘ ▙ ▚ ▛ ▜ ▝ ▞ ▟
```

### Standard Font (3-wide characters)

- Full alphabet: A-Z
- Numbers: 0-9
- Symbols: . - + ! ? : / \ _ < > = # * ^
- Height: 3 lines
- Width: 3 characters per letter + 1 space between

### Compact Font (2-wide characters)

Used automatically when text is too wide for the 25-character inner box.

### Character Styling

Letters with curved shapes (N, O, C, G, U) use a "fat left side" style:
```
N:  █▜▐    O:  █▀▜    C:  █▀▀    G:  █▀▀    U:  █ ▐
    █▐▐        █▌▐        █          █ █        █ █
    ▌ █        █▄▟        █▄▄        █▄▟        █▄▟
```

## Chip Art Structure

The chip art is 17 lines tall, 57 characters wide:

```
Line  0: Solder pads (top traces)
Line  1: Trace connections
Line  2: Trace connections
Line  3: Trace connections
Line  4: Top chip border (╭───...───╮)
Line  5: Pin row with top pins (▀)
Line  6: Inner box top border (╔═══...═══╗)
Line  7: Text line 1 (║ ... ║)
Line  8: Text line 2 (║ ... ║)
Line  9: Text line 3 (║ ... ║)
Line 10: Inner box bottom border (╚═══...═══╝)
Line 11: Pin row with bottom pins (▄)
Line 12: Bottom chip border (╰───...───╯)
Line 13: Trace connections
Line 14: Trace connections
Line 15: Trace connections
Line 16: Solder pads (bottom traces)
```

### Inner Box Dimensions

- Total width between ║ characters: 25 characters
- Text is automatically centered within this space

## Color Mapping (in CortexApp.tsx)

| Element | Characters | Theme Color |
|---------|-----------|-------------|
| Solder pads | ● | success (green) |
| Pin markers | ■ | error (red) |
| Top/bottom pins | ▀▄ (lines 5,11) | error (red) |
| Inner box border | ╔═╗║╚╝ | text |
| Inner text | ▛▀▜▌▐▙▄▟▚▞█ | secondary |
| Traces/borders | ╭╮╯╰─│┴┬┤├ | warning |

## Manual Editing

If you need to manually edit the chip art in `CortexApp.tsx`:

1. Find the `chipArt` array (around line 150)
2. Lines 7-9 contain the center text
3. The text area is exactly 25 characters between the `║` borders
4. Ensure line lengths remain consistent (57 chars)

## Adding New Characters

To add a new character to the font library:

1. Edit `splash_font_library.py`
2. Add to the `ChipFont._define_alphabet()` or `_define_symbols()` method:

```python
self.characters['@'] = [
    '▛▀▜',  # Line 1
    '█▀█',  # Line 2
    '█▄█',  # Line 3
]
```

3. Each character must be exactly 3 lines tall
4. Standard width is 3 characters, but can vary

## Troubleshooting

### Text too wide

If you get "Text too wide" error:
- The configurator will try the compact font automatically
- If still too wide, use a shorter text
- Max ~6-7 standard characters or ~10 compact characters

### Misaligned borders

If the chip art borders look misaligned after editing:
- Check that each line is exactly 57 characters
- The inner box content must be exactly 25 characters
- Use the configurator's `--preview` mode to verify alignment
