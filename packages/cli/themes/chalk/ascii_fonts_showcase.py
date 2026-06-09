#!/usr/bin/env python3
"""
ASCII Art Fonts Showcase - Futuristic and Tron-style fonts
These create stylized text effects within any terminal font
"""

import sys
import os
from typing import List, Tuple

# Force color output
os.environ['FORCE_COLOR'] = '1'

# ANSI color codes for Tron-style theming
CYAN = '\033[96m'
BLUE = '\033[94m'
MAGENTA = '\033[95m'
WHITE = '\033[97m'
GRAY = '\033[90m'
RESET = '\033[0m'
BOLD = '\033[1m'
GLOW = '\033[38;5;51m'  # Bright cyan for glow effect

def print_header():
    """Print the showcase header"""
    print(f"{CYAN}{'═' * 80}{RESET}")
    print(f"{CYAN}║{RESET} {BOLD}{GLOW}ASCII FONT SHOWCASE - FUTURISTIC & TRON STYLES{RESET} {CYAN}║{RESET}")
    print(f"{CYAN}{'═' * 80}{RESET}\n")

def wide_text(text: str, char: str = '█') -> List[str]:
    """Create wide blocky text (width > height)"""
    # Simple wide font mapping
    chars = {
        'A': ['███ ', '█ █ ', '███ ', '█ █ ', '█ █ '],
        'B': ['███ ', '█ █ ', '███ ', '█ █ ', '███ '],
        'C': ['███ ', '█   ', '█   ', '█   ', '███ '],
        'D': ['██  ', '█ █ ', '█ █ ', '█ █ ', '██  '],
        'E': ['███ ', '█   ', '███ ', '█   ', '███ '],
        'F': ['███ ', '█   ', '███ ', '█   ', '█   '],
        'G': ['███ ', '█   ', '█ ██', '█ █ ', '███ '],
        'H': ['█ █ ', '█ █ ', '███ ', '█ █ ', '█ █ '],
        'I': ['███ ', ' █  ', ' █  ', ' █  ', '███ '],
        'J': ['  █ ', '  █ ', '  █ ', '█ █ ', '███ '],
        'K': ['█ █ ', '█ █ ', '██  ', '█ █ ', '█ █ '],
        'L': ['█   ', '█   ', '█   ', '█   ', '███ '],
        'M': ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
        'N': ['█  █', '██ █', '█ ██', '█  █', '█  █'],
        'O': ['███ ', '█ █ ', '█ █ ', '█ █ ', '███ '],
        'P': ['███ ', '█ █ ', '███ ', '█   ', '█   '],
        'Q': ['███ ', '█ █ ', '█ █ ', '█ ██', '████'],
        'R': ['███ ', '█ █ ', '███ ', '█ █ ', '█ █ '],
        'S': ['███ ', '█   ', '███ ', '  █ ', '███ '],
        'T': ['███ ', ' █  ', ' █  ', ' █  ', ' █  '],
        'U': ['█ █ ', '█ █ ', '█ █ ', '█ █ ', '███ '],
        'V': ['█ █ ', '█ █ ', '█ █ ', '█ █ ', ' █  '],
        'W': ['█   █', '█   █', '█ █ █', '██ ██', '█   █'],
        'X': ['█ █ ', '█ █ ', ' █  ', '█ █ ', '█ █ '],
        'Y': ['█ █ ', '█ █ ', '███ ', ' █  ', ' █  '],
        'Z': ['███ ', '  █ ', ' █  ', '█   ', '███ '],
        ' ': ['    ', '    ', '    ', '    ', '    '],
        '0': ['███ ', '█ █ ', '█ █ ', '█ █ ', '███ '],
        '1': [' █  ', '██  ', ' █  ', ' █  ', '███ '],
        '2': ['███ ', '  █ ', '███ ', '█   ', '███ '],
        '3': ['███ ', '  █ ', '███ ', '  █ ', '███ '],
        '4': ['█ █ ', '█ █ ', '███ ', '  █ ', '  █ '],
    }

    text = text.upper()
    lines = [''] * 5

    for ch in text:
        if ch in chars:
            for i, line in enumerate(chars[ch]):
                lines[i] += line + ' '
        else:
            for i in range(5):
                lines[i] += '    '

    return lines

def tron_style_text(text: str) -> List[str]:
    """Create Tron-style circuit board text"""
    lines = wide_text(text)
    styled = []

    for line in lines:
        # Add circuit-like decorations
        styled_line = line.replace('█', '▓')
        styled_line = f"├─{styled_line}─┤"
        styled.append(styled_line)

    # Add top and bottom borders
    width = len(styled[0])
    styled.insert(0, '┌' + '─' * (width - 2) + '┐')
    styled.append('└' + '─' * (width - 2) + '┘')

    return styled

def matrix_rain_text(text: str) -> List[str]:
    """Create Matrix-style digital rain effect"""
    lines = wide_text(text)
    styled = []

    for line in lines:
        # Replace blocks with Matrix-like characters
        styled_line = line.replace('█', '▒')
        styled_line = styled_line.replace(' ', '·')
        styled.append(styled_line)

    return styled

def neon_glow_text(text: str) -> List[str]:
    """Create neon glow effect using gradients"""
    lines = wide_text(text)
    styled = []

    for line in lines:
        # Create glow effect with different intensities
        styled_line = ''
        for char in line:
            if char == '█':
                styled_line += '█'
            elif char == ' ':
                styled_line += ' '
            else:
                styled_line += char
        styled.append(styled_line)

    return styled

def hologram_text(text: str) -> List[str]:
    """Create holographic-style text with scan lines"""
    lines = wide_text(text)
    styled = []

    for i, line in enumerate(lines):
        if i % 2 == 0:
            # Add scan line effect on even lines
            styled_line = line.replace('█', '▓')
        else:
            styled_line = line.replace('█', '░')
        styled.append(styled_line)

    return styled

def display_font_style(name: str, text: str, lines: List[str], color: str):
    """Display a font style with formatting"""
    print(f"{BOLD}{color}▌ {name}{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    for line in lines:
        print(f"{color}{line}{RESET}")
    print()

def futuristic_fonts_demo():
    """Demo all futuristic font styles"""
    demo_text = "TRON"

    # 1. Wide Block Font
    print(f"{BOLD}{WHITE}1. WIDE BLOCK FONT (Width > Height){RESET}")
    lines = wide_text(demo_text)
    display_font_style("Standard Wide", demo_text, lines, CYAN)

    # 2. Tron Circuit Style
    print(f"{BOLD}{WHITE}2. TRON CIRCUIT STYLE{RESET}")
    lines = tron_style_text(demo_text)
    display_font_style("Circuit Board", demo_text, lines, GLOW)

    # 3. Matrix Rain Style
    print(f"{BOLD}{WHITE}3. MATRIX DIGITAL RAIN{RESET}")
    lines = matrix_rain_text(demo_text)
    display_font_style("Digital Rain", demo_text, lines, '\033[32m')  # Green

    # 4. Neon Glow Style
    print(f"{BOLD}{WHITE}4. NEON GLOW EFFECT{RESET}")
    lines = neon_glow_text(demo_text)
    display_font_style("Neon", demo_text, lines, MAGENTA)

    # 5. Hologram Style
    print(f"{BOLD}{WHITE}5. HOLOGRAPHIC SCAN{RESET}")
    lines = hologram_text(demo_text)
    display_font_style("Hologram", demo_text, lines, BLUE)

def display_character_sets():
    """Display special character sets for futuristic UIs"""
    print(f"{BOLD}{CYAN}SPECIAL CHARACTER SETS FOR FUTURISTIC UI{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")

    # Box drawing characters
    print(f"{WHITE}Box Drawing (Tron Grid):{RESET}")
    print(f"{CYAN}┌─┬─┐  ╔═╦═╗  ┏━┳━┓{RESET}")
    print(f"{CYAN}├─┼─┤  ╠═╬═╣  ┣━╋━┫{RESET}")
    print(f"{CYAN}└─┴─┘  ╚═╩═╝  ┗━┻━┛{RESET}")
    print()

    # Block elements
    print(f"{WHITE}Block Elements (Pixel Art):{RESET}")
    print(f"{CYAN}█ ▓ ▒ ░  ▀ ▄ ▌ ▐ ▖ ▗ ▘ ▙ ▚ ▛ ▜ ▝ ▞ ▟{RESET}")
    print()

    # Geometric shapes
    print(f"{WHITE}Geometric Shapes:{RESET}")
    print(f"{CYAN}▲ ▼ ◀ ▶ ◆ ◇ ○ ● □ ■ ▪ ▫ ◈ ◉ ◊{RESET}")
    print()

    # Tech symbols
    print(f"{WHITE}Tech Symbols:{RESET}")
    print(f"{CYAN}⚡ ⚙ ⚛ ☢ ☣ ⚠ ⬡ ⬢ ⌬ ⏣ ⏤ ⏥ ⏦ ⏧{RESET}")
    print()

def create_tron_ui_frame(title: str, width: int = 60) -> List[str]:
    """Create a Tron-style UI frame"""
    lines = []

    # Top border with title
    title_line = f"═╡ {title} ╞"
    padding = width - len(title_line) - 2
    lines.append(f"╔{title_line}{'═' * padding}╗")

    # Content area (empty for demo)
    for _ in range(3):
        lines.append(f"║{' ' * (width - 2)}║")

    # Bottom border with indicators
    lines.append(f"╚{'═' * (width - 2)}╝")

    return lines

def main():
    """Main showcase function"""
    print_header()

    # Show futuristic fonts
    futuristic_fonts_demo()

    # Show character sets
    print()
    display_character_sets()

    # Show Tron UI frame
    print(f"{BOLD}{CYAN}TRON-STYLE UI FRAME{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    frame = create_tron_ui_frame("SYSTEM INTERFACE")
    for line in frame:
        print(f"{GLOW}{line}{RESET}")

    print(f"\n{CYAN}{'═' * 80}{RESET}")
    print(f"{GRAY}These ASCII fonts work in ANY terminal regardless of font{RESET}")
    print(f"{GRAY}The terminal font only affects the character width/height ratio{RESET}")
    print(f"{CYAN}{'═' * 80}{RESET}")

if __name__ == "__main__":
    main()