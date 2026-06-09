#!/usr/bin/env python3
"""
Custom Wide Font Generator - Tron-Style Futuristic Fonts
Creates custom ASCII fonts with width > height for futuristic aesthetics
"""

import os
import json
from typing import List, Dict, Tuple

os.environ['FORCE_COLOR'] = '1'

# ANSI Colors for Tron theme
CYAN = '\033[96m'
BLUE = '\033[94m'
MAGENTA = '\033[95m'
GREEN = '\033[92m'
YELLOW = '\033[93m'
WHITE = '\033[97m'
GRAY = '\033[90m'
RESET = '\033[0m'
BOLD = '\033[1m'

# Glow effects
GLOW_CYAN = '\033[38;5;51m'
GLOW_BLUE = '\033[38;5;39m'
NEON_PINK = '\033[38;5;198m'

class WideFont:
    """Base class for wide ASCII fonts"""

    def __init__(self, name: str, height: int = 5, char_width: int = 6):
        self.name = name
        self.height = height
        self.char_width = char_width
        self.characters = {}

    def add_char(self, char: str, pattern: List[str]):
        """Add a character pattern to the font"""
        if len(pattern) != self.height:
            raise ValueError(f"Pattern must have {self.height} lines")
        self.characters[char.upper()] = pattern

    def render(self, text: str, spacing: int = 1) -> List[str]:
        """Render text using this font"""
        lines = [''] * self.height
        space = ' ' * spacing

        for char in text.upper():
            if char in self.characters:
                for i, line in enumerate(self.characters[char]):
                    lines[i] += line + space
            elif char == ' ':
                for i in range(self.height):
                    lines[i] += ' ' * self.char_width + space
            else:
                # Unknown character - use placeholder
                for i in range(self.height):
                    lines[i] += '?' * self.char_width + space

        return lines

class TronBlockFont(WideFont):
    """Ultra-wide Tron-style block font (6x5 ratio)"""

    def __init__(self):
        super().__init__("Tron Block", height=5, char_width=6)
        self._define_characters()

    def _define_characters(self):
        # Define wide block characters (6 chars wide, 5 tall)
        self.add_char('A', [
            '██████',
            '██  ██',
            '██████',
            '██  ██',
            '██  ██'
        ])
        self.add_char('B', [
            '█████ ',
            '██  ██',
            '█████ ',
            '██  ██',
            '█████ '
        ])
        self.add_char('C', [
            '██████',
            '██    ',
            '██    ',
            '██    ',
            '██████'
        ])
        self.add_char('D', [
            '█████ ',
            '██  ██',
            '██  ██',
            '██  ██',
            '█████ '
        ])
        self.add_char('E', [
            '██████',
            '██    ',
            '████  ',
            '██    ',
            '██████'
        ])
        self.add_char('F', [
            '██████',
            '██    ',
            '████  ',
            '██    ',
            '██    '
        ])
        self.add_char('G', [
            '██████',
            '██    ',
            '██ ███',
            '██  ██',
            '██████'
        ])
        self.add_char('H', [
            '██  ██',
            '██  ██',
            '██████',
            '██  ██',
            '██  ██'
        ])
        self.add_char('I', [
            '██████',
            '  ██  ',
            '  ██  ',
            '  ██  ',
            '██████'
        ])
        self.add_char('J', [
            '   ███',
            '    ██',
            '    ██',
            '██  ██',
            '██████'
        ])
        self.add_char('K', [
            '██  ██',
            '██ ██ ',
            '████  ',
            '██ ██ ',
            '██  ██'
        ])
        self.add_char('L', [
            '██    ',
            '██    ',
            '██    ',
            '██    ',
            '██████'
        ])
        self.add_char('M', [
            '██  ██',
            '██████',
            '██████',
            '██  ██',
            '██  ██'
        ])
        self.add_char('N', [
            '██  ██',
            '███ ██',
            '██████',
            '██ ███',
            '██  ██'
        ])
        self.add_char('O', [
            '██████',
            '██  ██',
            '██  ██',
            '██  ██',
            '██████'
        ])
        self.add_char('P', [
            '██████',
            '██  ██',
            '██████',
            '██    ',
            '██    '
        ])
        self.add_char('Q', [
            '██████',
            '██  ██',
            '██  ██',
            '██ ███',
            '███████'
        ])
        self.add_char('R', [
            '██████',
            '██  ██',
            '██████',
            '██ ██ ',
            '██  ██'
        ])
        self.add_char('S', [
            '██████',
            '██    ',
            '██████',
            '    ██',
            '██████'
        ])
        self.add_char('T', [
            '██████',
            '  ██  ',
            '  ██  ',
            '  ██  ',
            '  ██  '
        ])
        self.add_char('U', [
            '██  ██',
            '██  ██',
            '██  ██',
            '██  ██',
            '██████'
        ])
        self.add_char('V', [
            '██  ██',
            '██  ██',
            '██  ██',
            ' ████ ',
            '  ██  '
        ])
        self.add_char('W', [
            '██  ██',
            '██  ██',
            '██████',
            '██████',
            '██  ██'
        ])
        self.add_char('X', [
            '██  ██',
            ' ████ ',
            '  ██  ',
            ' ████ ',
            '██  ██'
        ])
        self.add_char('Y', [
            '██  ██',
            '██  ██',
            '██████',
            '  ██  ',
            '  ██  '
        ])
        self.add_char('Z', [
            '██████',
            '   ██ ',
            '  ██  ',
            ' ██   ',
            '██████'
        ])
        # Numbers
        self.add_char('0', [
            '██████',
            '██  ██',
            '██  ██',
            '██  ██',
            '██████'
        ])
        self.add_char('1', [
            '  ██  ',
            ' ███  ',
            '  ██  ',
            '  ██  ',
            '██████'
        ])
        self.add_char('2', [
            '██████',
            '    ██',
            '██████',
            '██    ',
            '██████'
        ])
        self.add_char('3', [
            '██████',
            '    ██',
            '██████',
            '    ██',
            '██████'
        ])
        self.add_char('4', [
            '██  ██',
            '██  ██',
            '██████',
            '    ██',
            '    ██'
        ])

class CircuitFont(WideFont):
    """Circuit board style font with connected lines"""

    def __init__(self):
        super().__init__("Circuit", height=5, char_width=6)
        self._define_characters()

    def _define_characters(self):
        # Circuit-style characters using box drawing
        self.add_char('T', [
            '╦═══╦═',
            '║   ║ ',
            '║   ║ ',
            '║   ║ ',
            '╩   ╩ '
        ])
        self.add_char('R', [
            '╔═══╗ ',
            '║   ╚╗',
            '╠═══╗║',
            '║   ╚╣',
            '╩    ╩'
        ])
        self.add_char('O', [
            '╔═══╗ ',
            '║   ║ ',
            '║   ║ ',
            '║   ║ ',
            '╚═══╝ '
        ])
        self.add_char('N', [
            '╔╗  ╔╗',
            '║╚╗ ║║',
            '║ ╚╗║║',
            '║  ╚║║',
            '╩   ╚╝'
        ])

class NeonGlowFont(WideFont):
    """Neon glow effect font using gradient blocks"""

    def __init__(self):
        super().__init__("Neon Glow", height=5, char_width=7)
        self._define_characters()

    def _define_characters(self):
        # Using gradient blocks for glow effect
        self.add_char('T', [
            '███████',
            '▓▓▓█▓▓▓',
            '▒▒▒█▒▒▒',
            '░░░█░░░',
            '   █   '
        ])
        self.add_char('R', [
            '████▓░ ',
            '█▓▒░█░ ',
            '████▓░ ',
            '█▓▒█░  ',
            '█░ ░█  '
        ])
        self.add_char('O', [
            '░▓███▓░',
            '▓█▒░▒█▓',
            '█▒░░░▒█',
            '▓█▒░▒█▓',
            '░▓███▓░'
        ])
        self.add_char('N', [
            '█▓░░░█▓',
            '██▓░░█▓',
            '█▓██░█▓',
            '█▓░██▓▓',
            '█▓░░███'
        ])

class MatrixFont(WideFont):
    """Matrix-style digital rain font"""

    def __init__(self):
        super().__init__("Matrix", height=5, char_width=5)
        self._define_characters()

    def _define_characters(self):
        # Digital rain style
        self.add_char('M', [
            '10001',
            '11011',
            '10101',
            '10001',
            '10001'
        ])
        self.add_char('A', [
            '01110',
            '10001',
            '11111',
            '10001',
            '10001'
        ])
        self.add_char('T', [
            '11111',
            '00100',
            '00100',
            '00100',
            '00100'
        ])
        self.add_char('R', [
            '11110',
            '10001',
            '11110',
            '10010',
            '10001'
        ])
        self.add_char('I', [
            '11111',
            '00100',
            '00100',
            '00100',
            '11111'
        ])
        self.add_char('X', [
            '10001',
            '01010',
            '00100',
            '01010',
            '10001'
        ])

class HologramFont(WideFont):
    """Holographic projection style with scanlines"""

    def __init__(self):
        super().__init__("Hologram", height=6, char_width=8)
        self._define_characters()

    def _define_characters(self):
        # Holographic with scanlines
        self.add_char('H', [
            '▓▓    ▓▓',
            '──────',
            '▓▓▓▓▓▓▓▓',
            '░░░░░░░░',
            '▓▓    ▓▓',
            '────────'
        ])
        self.add_char('O', [
            '▓▓▓▓▓▓▓▓',
            '░░    ░░',
            '▓▓    ▓▓',
            '──────',
            '▓▓▓▓▓▓▓▓',
            '░░░░░░░░'
        ])
        self.add_char('L', [
            '▓▓      ',
            '──────',
            '▓▓      ',
            '░░      ',
            '▓▓▓▓▓▓▓▓',
            '────────'
        ])
        self.add_char('O', [
            '▓▓▓▓▓▓▓▓',
            '░░    ░░',
            '▓▓    ▓▓',
            '──────',
            '▓▓▓▓▓▓▓▓',
            '░░░░░░░░'
        ])

def render_with_effects(font: WideFont, text: str, effect: str = 'glow') -> None:
    """Render text with special effects"""
    lines = font.render(text)

    if effect == 'glow':
        # Add glow effect with colors
        print(f"{GLOW_CYAN}╔{'═' * (len(lines[0]) + 4)}╗{RESET}")
        for line in lines:
            # Gradient effect
            colored_line = line.replace('█', f'{GLOW_CYAN}█{RESET}')
            colored_line = colored_line.replace('▓', f'{CYAN}▓{RESET}')
            colored_line = colored_line.replace('▒', f'{BLUE}▒{RESET}')
            colored_line = colored_line.replace('░', f'{GRAY}░{RESET}')
            print(f"{GLOW_CYAN}║ {colored_line} ║{RESET}")
        print(f"{GLOW_CYAN}╚{'═' * (len(lines[0]) + 4)}╝{RESET}")

    elif effect == 'matrix':
        # Matrix green with falling effect
        for i, line in enumerate(lines):
            if i == 0:
                colored = f'\033[38;5;46m{line}{RESET}'  # Bright green
            elif i == len(lines) - 1:
                colored = f'\033[38;5;22m{line}{RESET}'  # Dark green
            else:
                colored = f'\033[38;5;34m{line}{RESET}'  # Medium green
            print(colored)

    elif effect == 'scan':
        # Scanline effect
        for i, line in enumerate(lines):
            if i % 2 == 0:
                print(f"{BOLD}{CYAN}{line}{RESET}")
            else:
                print(f"{GRAY}{line}{RESET}")

    elif effect == 'rainbow':
        # Rainbow gradient
        colors = ['\033[91m', '\033[93m', '\033[92m', '\033[96m', '\033[94m', '\033[95m']
        for i, line in enumerate(lines):
            color = colors[i % len(colors)]
            print(f"{color}{line}{RESET}")

    else:
        # No effect
        for line in lines:
            print(line)

def create_custom_font_showcase():
    """Showcase all custom wide fonts"""

    print(f"{BOLD}{GLOW_CYAN}{'═' * 80}{RESET}")
    print(f"{BOLD}{GLOW_CYAN}CUSTOM WIDE FONTS - TRON STYLE (WIDTH > HEIGHT){RESET}")
    print(f"{GLOW_CYAN}{'═' * 80}{RESET}\n")

    # Tron Block Font
    print(f"{BOLD}{CYAN}1. TRON BLOCK FONT (6x5 ratio - Ultra Wide){RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    tron_font = TronBlockFont()
    render_with_effects(tron_font, "TRON", 'glow')
    print()

    # Circuit Font
    print(f"{BOLD}{CYAN}2. CIRCUIT BOARD FONT{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    circuit_font = CircuitFont()
    lines = circuit_font.render("TRON")
    for line in lines:
        print(f"{GLOW_BLUE}{line}{RESET}")
    print()

    # Neon Glow Font
    print(f"{BOLD}{NEON_PINK}3. NEON GLOW FONT{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    neon_font = NeonGlowFont()
    render_with_effects(neon_font, "TRON", 'glow')
    print()

    # Matrix Font
    print(f"{BOLD}{GREEN}4. MATRIX DIGITAL RAIN FONT{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    matrix_font = MatrixFont()
    render_with_effects(matrix_font, "MATRIX", 'matrix')
    print()

    # Hologram Font
    print(f"{BOLD}{MAGENTA}5. HOLOGRAPHIC PROJECTION FONT{RESET}")
    print(f"{GRAY}{'─' * 60}{RESET}")
    holo_font = HologramFont()
    render_with_effects(holo_font, "HOLO", 'scan')
    print()

def create_tron_ui_with_custom_font():
    """Create a complete Tron UI using custom fonts"""

    print(f"{BOLD}{GLOW_CYAN}COMPLETE TRON INTERFACE WITH CUSTOM FONTS{RESET}\n")

    # Title in custom font
    tron_font = TronBlockFont()
    title_lines = tron_font.render("SYSTEM")

    # Render with frame
    width = len(title_lines[0]) + 10
    print(f"{GLOW_CYAN}╔{'═' * width}╗{RESET}")

    # Title
    for line in title_lines:
        colored = line.replace('█', f'{GLOW_CYAN}█{RESET}')
        padding = (width - len(line)) // 2
        print(f"{GLOW_CYAN}║{' ' * padding}{colored}{' ' * (width - padding - len(line))}║{RESET}")

    print(f"{GLOW_CYAN}╠{'═' * width}╣{RESET}")

    # Status info
    status_lines = [
        f"USER: {GLOW_CYAN}FLYNN{RESET}      STATUS: {GREEN}●ONLINE{RESET}",
        f"GRID: {GLOW_CYAN}ACTIVE{RESET}     SECTOR: {YELLOW}7G{RESET}",
        f"PROGRAMS: {GREEN}12{RESET}     MEM: {YELLOW}████████░░{RESET} 80%"
    ]

    for line in status_lines:
        # Calculate actual display length without ANSI codes
        clean_line = line.replace(GLOW_CYAN, '').replace(GREEN, '').replace(YELLOW, '').replace(RESET, '')
        padding = width - len(clean_line) - 2
        print(f"{GLOW_CYAN}║ {line}{' ' * padding} ║{RESET}")

    print(f"{GLOW_CYAN}╚{'═' * width}╝{RESET}")

def font_comparison():
    """Compare different font styles side by side"""

    print(f"{BOLD}{WHITE}FONT WIDTH COMPARISON - 'GRID'{RESET}")
    print(f"{GRAY}{'─' * 80}{RESET}\n")

    fonts = [
        (TronBlockFont(), "Tron Block (6x5)", GLOW_CYAN),
        (NeonGlowFont(), "Neon Glow (7x5)", NEON_PINK),
        (MatrixFont(), "Matrix (5x5)", GREEN),
    ]

    for font, name, color in fonts:
        print(f"{BOLD}{color}{name}:{RESET}")
        lines = font.render("GRID")
        for line in lines:
            colored = line.replace('█', f'{color}█{RESET}')
            colored = colored.replace('▓', f'{color}▓{RESET}')
            colored = colored.replace('▒', f'{GRAY}▒{RESET}')
            colored = colored.replace('░', f'{GRAY}░{RESET}')
            print(f"  {colored}")
        print()

def save_font_to_json(font: WideFont, filename: str):
    """Save font definition to JSON file"""
    font_data = {
        'name': font.name,
        'height': font.height,
        'char_width': font.char_width,
        'characters': font.characters
    }

    with open(filename, 'w') as f:
        json.dump(font_data, f, indent=2)

    print(f"Font saved to {filename}")

def main():
    """Main demonstration"""

    # Full showcase
    create_custom_font_showcase()
    create_tron_ui_with_custom_font()
    font_comparison()

    # Usage instructions
    print(f"\n{GRAY}{'─' * 80}{RESET}")
    print(f"{BOLD}{WHITE}CUSTOM FONT FEATURES:{RESET}")
    print(f"  • {CYAN}Width > Height ratio{RESET} for futuristic feel")
    print(f"  • {CYAN}Block characters{RESET} (█▓▒░) for solid appearance")
    print(f"  • {CYAN}Box drawing{RESET} (╔═╗║╚╝) for circuit style")
    print(f"  • {CYAN}Gradient effects{RESET} using shaded blocks")
    print(f"  • {CYAN}Customizable spacing{RESET} between characters")

    print(f"\n{BOLD}{WHITE}ADVANTAGES:{RESET}")
    print(f"  • Works in {GREEN}ANY{RESET} terminal")
    print(f"  • No external dependencies")
    print(f"  • Fully customizable characters")
    print(f"  • Can combine with ANSI colors")
    print(f"  • Consistent across platforms")

    print(f"\n{GRAY}These fonts are pure ASCII/Unicode and work regardless of terminal font!{RESET}")

if __name__ == "__main__":
    main()