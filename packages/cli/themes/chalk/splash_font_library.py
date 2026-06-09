#!/usr/bin/env python3
"""
OmniClaude V4 - Splash Screen Font Library

Compact ASCII art fonts designed for the chip art center text.
These fonts use Unicode block drawing characters (▛▀▜▌▐▙▄▟▚▞█)
to create 3-line high characters that fit within the chip's inner box.

Character Set:
- Full alphabet (A-Z)
- Numbers (0-9)
- Common symbols

Font Characteristics:
- Height: 3 lines (to fit in chip's 3-line center area)
- Width: 3-4 characters per letter with 1 space between
- Uses: ▛▀▜▌▐▙▄▟▚▞█ and spaces
"""

from typing import List, Dict, Tuple
import json
import os

# Characters available in our font system (matches OmniClaudeApp.tsx innerTextChars)
# ▛ = top-left quadrant + top-right
# ▀ = top half
# ▜ = top-left + top-right + bottom-right
# ▌ = left half
# ▐ = right half
# ▙ = top-left + bottom-left + bottom-right
# ▄ = bottom half
# ▟ = top-right + bottom-left + bottom-right
# ▚ = top-left + bottom-right (diagonal)
# ▞ = top-right + bottom-left (diagonal)
# █ = full block


class ChipFont:
    """
    Compact 3-line font for chip center text.
    Designed to fit within the chip art's inner box area.
    """

    def __init__(self):
        self.height = 3
        self.characters: Dict[str, List[str]] = {}
        self._define_alphabet()
        self._define_numbers()
        self._define_symbols()

    def _define_alphabet(self):
        """Define A-Z characters"""

        # A - 3 wide
        self.characters['A'] = [
            '▛▀▜',
            '█▀█',
            '▌ ▐',
        ]

        # B - 3 wide
        self.characters['B'] = [
            '█▀▜',
            '█▀▜',
            '█▄▟',
        ]

        # C - 3 wide (fat left side)
        self.characters['C'] = [
            '█▀▀',
            '█  ',
            '█▄▄',
        ]

        # D - 3 wide
        self.characters['D'] = [
            '█▀▜',
            '█ ▐',
            '█▄▟',
        ]

        # E - 3 wide
        self.characters['E'] = [
            '█▀▀',
            '█▀ ',
            '█▄▄',
        ]

        # F - 3 wide
        self.characters['F'] = [
            '█▀▀',
            '█▀ ',
            '█  ',
        ]

        # G - 3 wide (fat left side)
        self.characters['G'] = [
            '█▀▀',
            '█ █',
            '█▄▟',
        ]

        # H - 3 wide
        self.characters['H'] = [
            '▌ ▐',
            '█▀█',
            '▌ ▐',
        ]

        # I - 3 wide
        self.characters['I'] = [
            '▀█▀',
            ' █ ',
            '▄█▄',
        ]

        # J - 3 wide
        self.characters['J'] = [
            '  █',
            '  █',
            '▙▄▟',
        ]

        # K - 3 wide
        self.characters['K'] = [
            '█ ▐',
            '██ ',
            '█ ▐',
        ]

        # L - 3 wide
        self.characters['L'] = [
            '█  ',
            '█  ',
            '█▄▄',
        ]

        # M - 3 wide
        self.characters['M'] = [
            '█▄█',
            '█▀█',
            '▌ ▐',
        ]

        # N - 3 wide (fat left side)
        self.characters['N'] = [
            '█▜▐',
            '█▐▐',
            '▌ █',
        ]

        # O - 3 wide (fat left side)
        self.characters['O'] = [
            '█▀▜',
            '█▌▐',
            '█▄▟',
        ]

        # P - 3 wide
        self.characters['P'] = [
            '█▀▜',
            '█▀▘',
            '█  ',
        ]

        # Q - 3 wide
        self.characters['Q'] = [
            '▛▀▜',
            '█ █',
            '▙▄█',
        ]

        # R - 3 wide
        self.characters['R'] = [
            '█▀▜',
            '██ ',
            '█ ▐',
        ]

        # S - 3 wide
        self.characters['S'] = [
            '▛▀▀',
            '▀▀▜',
            '▄▄▟',
        ]

        # T - 3 wide
        self.characters['T'] = [
            '▀█▀',
            ' █ ',
            ' █ ',
        ]

        # U - 3 wide (fat left side)
        self.characters['U'] = [
            '█ ▐',
            '█ █',
            '█▄▟',
        ]

        # V - 3 wide
        self.characters['V'] = [
            '▌ ▐',
            '█ █',
            '▝█▘',
        ]

        # W - 3 wide
        self.characters['W'] = [
            '▌ ▐',
            '█▄█',
            '█▀█',
        ]

        # X - 3 wide
        self.characters['X'] = [
            '▚ ▞',
            ' █ ',
            '▞ ▚',
        ]

        # Y - 3 wide
        self.characters['Y'] = [
            '▚ ▞',
            ' █ ',
            ' █ ',
        ]

        # Z - 3 wide
        self.characters['Z'] = [
            '▀▀█',
            ' █ ',
            '█▄▄',
        ]

    def _define_numbers(self):
        """Define 0-9 characters"""

        self.characters['0'] = [
            '▛▀▜',
            '█▞█',
            '▙▄▟',
        ]

        self.characters['1'] = [
            '▄█ ',
            ' █ ',
            '▄█▄',
        ]

        self.characters['2'] = [
            '▀▀▜',
            '▛▀▘',
            '█▄▄',
        ]

        self.characters['3'] = [
            '▀▀▜',
            ' ▀▜',
            '▄▄▟',
        ]

        self.characters['4'] = [
            '█ █',
            '▀▀█',
            '  █',
        ]

        self.characters['5'] = [
            '█▀▀',
            '▀▀▜',
            '▄▄▟',
        ]

        self.characters['6'] = [
            '▛▀▀',
            '█▀▜',
            '▙▄▟',
        ]

        self.characters['7'] = [
            '▀▀█',
            '  █',
            '  █',
        ]

        self.characters['8'] = [
            '▛▀▜',
            '█▀█',
            '▙▄▟',
        ]

        self.characters['9'] = [
            '▛▀▜',
            '▙▄█',
            '▄▄▟',
        ]

    def _define_symbols(self):
        """Define common symbols"""

        self.characters[' '] = [
            '   ',
            '   ',
            '   ',
        ]

        self.characters['.'] = [
            '   ',
            '   ',
            ' ▄ ',
        ]

        self.characters['-'] = [
            '   ',
            '▀▀▀',
            '   ',
        ]

        self.characters['+'] = [
            ' ▄ ',
            '▀█▀',
            ' ▀ ',
        ]

        self.characters['!'] = [
            ' █ ',
            ' █ ',
            ' ▄ ',
        ]

        self.characters['?'] = [
            '▀▀▜',
            ' ▛▘',
            ' ▄ ',
        ]

        self.characters[':'] = [
            ' ▄ ',
            '   ',
            ' ▄ ',
        ]

        self.characters['/'] = [
            '  ▞',
            ' ▞ ',
            '▞  ',
        ]

        self.characters['\\'] = [
            '▚  ',
            ' ▚ ',
            '  ▚',
        ]

        self.characters['_'] = [
            '   ',
            '   ',
            '▄▄▄',
        ]

        self.characters['<'] = [
            ' ▗▘',
            '▗▘ ',
            ' ▝▖',
        ]

        self.characters['>'] = [
            '▝▖ ',
            ' ▝▖',
            '▗▘ ',
        ]

        self.characters['='] = [
            '▀▀▀',
            '   ',
            '▀▀▀',
        ]

        self.characters['#'] = [
            '▐█▌',
            '▀█▀',
            '▐█▌',
        ]

        self.characters['*'] = [
            '▚█▞',
            '▀█▀',
            '▞█▚',
        ]

        self.characters['V'] = [
            '▌ ▐',
            '█ █',
            '▝█▘',
        ]

        self.characters['^'] = [
            '▗█▖',
            '▘ ▝',
            '   ',
        ]

    def render(self, text: str, spacing: int = 1) -> List[str]:
        """
        Render text using this font.

        Args:
            text: Text to render (will be uppercased)
            spacing: Spaces between characters

        Returns:
            List of 3 strings (one per line)
        """
        text = text.upper()
        lines = ['', '', '']
        space = ' ' * spacing

        for i, char in enumerate(text):
            if char in self.characters:
                char_lines = self.characters[char]
                for j in range(3):
                    lines[j] += char_lines[j]
                    if i < len(text) - 1:
                        lines[j] += space
            else:
                # Unknown character - use question mark
                for j in range(3):
                    lines[j] += self.characters['?'][j]
                    if i < len(text) - 1:
                        lines[j] += space

        return lines

    def get_width(self, text: str, spacing: int = 1) -> int:
        """Get the rendered width of text"""
        rendered = self.render(text, spacing)
        return len(rendered[0]) if rendered else 0


class ChipFontCompact:
    """
    Ultra-compact 3-line font with 2-wide characters.
    For when you need more text in less space.
    """

    def __init__(self):
        self.height = 3
        self.characters: Dict[str, List[str]] = {}
        self._define_alphabet()

    def _define_alphabet(self):
        """Define compact A-Z characters (2 wide)"""

        self.characters['A'] = ['▛▜', '██', '▌▐']
        self.characters['B'] = ['█▜', '█▜', '█▟']
        self.characters['C'] = ['▛▀', '█ ', '▙▄']
        self.characters['D'] = ['█▜', '█▐', '█▟']
        self.characters['E'] = ['█▀', '█▀', '█▄']
        self.characters['F'] = ['█▀', '█▀', '█ ']
        self.characters['G'] = ['▛▀', '█▜', '▙▟']
        self.characters['H'] = ['▌▐', '██', '▌▐']
        self.characters['I'] = ['█▀', ' █', '▄█']
        self.characters['J'] = [' █', ' █', '▙▟']
        self.characters['K'] = ['█▐', '█▘', '█▐']
        self.characters['L'] = ['█ ', '█ ', '█▄']
        self.characters['M'] = ['██', '██', '▌▐']
        self.characters['N'] = ['█▐', '██', '▌█']
        self.characters['O'] = ['▛▜', '▌▐', '▙▟']
        self.characters['P'] = ['█▜', '█▘', '█ ']
        self.characters['Q'] = ['▛▜', '▌▐', '▙█']
        self.characters['R'] = ['█▜', '█▘', '█▐']
        self.characters['S'] = ['▛▀', '▀▜', '▄▟']
        self.characters['T'] = ['█▀', ' █', ' █']
        self.characters['U'] = ['▌▐', '▌▐', '▙▟']
        self.characters['V'] = ['▌▐', '▌▐', '▝▘']
        self.characters['W'] = ['▌▐', '██', '██']
        self.characters['X'] = ['▚▞', ' █', '▞▚']
        self.characters['Y'] = ['▚▞', ' █', ' █']
        self.characters['Z'] = ['▀█', ' █', '█▄']
        self.characters[' '] = ['  ', '  ', '  ']

    def render(self, text: str, spacing: int = 1) -> List[str]:
        """Render text using compact font"""
        text = text.upper()
        lines = ['', '', '']
        space = ' ' * spacing

        for i, char in enumerate(text):
            if char in self.characters:
                char_lines = self.characters[char]
                for j in range(3):
                    lines[j] += char_lines[j]
                    if i < len(text) - 1:
                        lines[j] += space
            else:
                for j in range(3):
                    lines[j] += '??'
                    if i < len(text) - 1:
                        lines[j] += space

        return lines


# ANSI Colors for preview
class Colors:
    RESET = '\033[0m'
    BOLD = '\033[1m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    MAGENTA = '\033[95m'
    BLUE = '\033[94m'
    GRAY = '\033[90m'
    WHITE = '\033[97m'


def preview_text(text: str, font: ChipFont = None, compact: bool = False):
    """Preview rendered text with colors"""
    if font is None:
        font = ChipFontCompact() if compact else ChipFont()

    lines = font.render(text)
    width = len(lines[0])

    print(f"\n{Colors.CYAN}Text: '{text}' ({width} chars wide){Colors.RESET}")
    print(f"{Colors.GRAY}{'─' * (width + 4)}{Colors.RESET}")

    for line in lines:
        print(f"{Colors.YELLOW}  {line}  {Colors.RESET}")

    print(f"{Colors.GRAY}{'─' * (width + 4)}{Colors.RESET}")


def preview_alphabet(font: ChipFont = None, compact: bool = False):
    """Preview full alphabet"""
    if font is None:
        font = ChipFontCompact() if compact else ChipFont()

    font_name = "Compact" if compact else "Standard"
    print(f"\n{Colors.BOLD}{Colors.CYAN}=== {font_name} Chip Font - Full Alphabet ==={Colors.RESET}\n")

    # Preview in groups
    groups = [
        ('A-F', 'ABCDEF'),
        ('G-L', 'GHIJKL'),
        ('M-R', 'MNOPQR'),
        ('S-X', 'STUVWX'),
        ('Y-Z + 0-4', 'YZ0123'),
        ('5-9', '45678'),
        ('9 + Symbols', '9.-+!?'),
    ]

    for name, chars in groups:
        lines = font.render(chars)
        print(f"{Colors.GREEN}{name}:{Colors.RESET}")
        for line in lines:
            print(f"  {Colors.YELLOW}{line}{Colors.RESET}")
        print()


def generate_chip_center_lines(text: str, target_width: int = 25) -> List[str]:
    """
    Generate properly formatted lines for chip art center.

    Args:
        text: Text to render (e.g., 'CORTEX', 'NEO', 'NEON')
        target_width: Target width (default 25 for chip inner box)

    Returns:
        List of 3 lines, padded/centered to target_width
    """
    font = ChipFont()
    lines = font.render(text)
    text_width = len(lines[0])

    # Center the text within target width
    if text_width < target_width:
        left_pad = (target_width - text_width) // 2
        right_pad = target_width - text_width - left_pad
        lines = [' ' * left_pad + line + ' ' * right_pad for line in lines]
    elif text_width > target_width:
        # Try compact font
        font = ChipFontCompact()
        lines = font.render(text)
        text_width = len(lines[0])

        if text_width <= target_width:
            left_pad = (target_width - text_width) // 2
            right_pad = target_width - text_width - left_pad
            lines = [' ' * left_pad + line + ' ' * right_pad for line in lines]
        else:
            raise ValueError(f"Text '{text}' is too wide ({text_width}) for target width ({target_width})")

    return lines


def generate_chip_art_tsx(center_text: str = 'CORTEX') -> str:
    """
    Generate complete chip art array for OmniClaudeApp.tsx

    Args:
        center_text: Text to display in chip center

    Returns:
        TypeScript array literal string
    """
    # Generate center text lines
    center_lines = generate_chip_center_lines(center_text, target_width=25)

    # Chip art template with placeholders for center text
    # The inner box area is exactly 25 chars wide (between ║ chars)
    # Line format: "       ●───┤■  ║" + 25 chars + "║  ■├───●       "
    # Total line length: 57 chars
    chip_template = [
        "           ●          ●     ●     ●          ●           ",
        "           │          ╰──╮  │  ╭──╯          │           ",
        "       ●───╯  ●──╮       │  │  │       ╭──●  ╰───●       ",
        "                 ╰─╮     │  │  │     ╭─╯                 ",
        "           ╭───────┴─────┴──┴──┴─────┴───────╮           ",
        "       ●───┤■      ▀     ▀  ▀  ▀     ▀      ■├───●       ",
        "           │   ╔═════════════════════════╗   │           ",
        "       ●───┤■  ║{LINE_0}║  ■├───●       ",
        "           │   ║{LINE_1}║   │           ",
        "       ●───┤■  ║{LINE_2}║  ■├───●       ",
        "           │   ╚═════════════════════════╝   │           ",
        "       ●───┤■      ▄     ▄  ▄  ▄     ▄      ■├───●       ",
        "           ╰───────┬─────┬──┬──┬─────┬───────╯           ",
        "                 ╭─╯     │  │  │     ╰─╮                 ",
        "       ●───╮  ●──╯       │  │  │       ╰──●  ╭───●       ",
        "           │          ╭──╯  │  ╰──╮          │           ",
        "           ●          ●     ●     ●          ●           ",
    ]

    # Replace placeholders with actual center text
    chip_art = []
    for line in chip_template:
        if '{LINE_0}' in line:
            chip_art.append(line.replace('{LINE_0}', center_lines[0]))
        elif '{LINE_1}' in line:
            chip_art.append(line.replace('{LINE_1}', center_lines[1]))
        elif '{LINE_2}' in line:
            chip_art.append(line.replace('{LINE_2}', center_lines[2]))
        else:
            chip_art.append(line)

    # Generate TypeScript array
    tsx_lines = ["  const chipArt = ["]
    for line in chip_art:
        tsx_lines.append(f"    '{line}',")
    tsx_lines.append("  ];")

    return '\n'.join(tsx_lines)


def print_chip_art_preview(center_text: str = 'CORTEX'):
    """Print a colored preview of the chip art"""
    center_lines = generate_chip_center_lines(center_text, target_width=25)

    print(f"\n{Colors.BOLD}{Colors.CYAN}=== Chip Art Preview: '{center_text}' ==={Colors.RESET}\n")

    chip_art = [
        "           ●          ●     ●     ●          ●           ",
        "           │          ╰──╮  │  ╭──╯          │           ",
        "       ●───╯  ●──╮       │  │  │       ╭──●  ╰───●       ",
        "                 ╰─╮     │  │  │     ╭─╯                 ",
        "           ╭───────┴─────┴──┴──┴─────┴───────╮           ",
        "       ●───┤■      ▀     ▀  ▀  ▀     ▀      ■├───●       ",
        "           │   ╔═════════════════════════╗   │           ",
        f"       ●───┤■  ║{center_lines[0]}║  ■├───●       ",
        f"           │   ║{center_lines[1]}║   │           ",
        f"       ●───┤■  ║{center_lines[2]}║  ■├───●       ",
        "           │   ╚═════════════════════════╝   │           ",
        "       ●───┤■      ▄     ▄  ▄  ▄     ▄      ■├───●       ",
        "           ╰───────┬─────┬──┬──┬─────┬───────╯           ",
        "                 ╭─╯     │  │  │     ╰─╮                 ",
        "       ●───╮  ●──╯       │  │  │       ╰──●  ╭───●       ",
        "           │          ╭──╯  │  ╰──╮          │           ",
        "           ●          ●     ●     ●          ●           ",
    ]

    # Color mapping
    for i, line in enumerate(chip_art):
        colored = ''
        for char in line:
            if char in '●':
                colored += f'{Colors.GREEN}{char}{Colors.RESET}'
            elif char in '■':
                colored += f'{Colors.RED}{char}{Colors.RESET}'
            elif char in '▀▄' and (i == 5 or i == 11):
                colored += f'{Colors.RED}{char}{Colors.RESET}'
            elif char in '╔═╗║╚╝':
                colored += f'{Colors.WHITE}{char}{Colors.RESET}'
            elif char in '▛▀▜▌▐▙▄▟▚▞█':
                colored += f'{Colors.MAGENTA}{char}{Colors.RESET}'
            elif char in '╭╮╯╰─│┴┬┤├':
                colored += f'{Colors.YELLOW}{char}{Colors.RESET}'
            else:
                colored += char
        print(colored)


def export_font_json(filename: str = 'chip_font.json'):
    """Export font definitions to JSON for potential TypeScript use"""
    font = ChipFont()
    compact = ChipFontCompact()

    data = {
        'standard': {
            'height': font.height,
            'characters': font.characters
        },
        'compact': {
            'height': compact.height,
            'characters': compact.characters
        }
    }

    with open(filename, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Font exported to {filename}")


def main():
    """Main demonstration and configuration tool"""
    import sys

    print(f"{Colors.BOLD}{Colors.CYAN}")
    print("╔═══════════════════════════════════════════════════════════╗")
    print("║     OMNICLAUDE V4 - SPLASH SCREEN FONT CONFIGURATOR       ║")
    print("╚═══════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}")

    # Check for command line args
    if len(sys.argv) > 1:
        text = ' '.join(sys.argv[1:])
    else:
        text = 'NEO'

    # Preview fonts
    print(f"\n{Colors.BOLD}Standard Font Preview:{Colors.RESET}")
    preview_alphabet(compact=False)

    print(f"\n{Colors.BOLD}Compact Font Preview:{Colors.RESET}")
    preview_alphabet(compact=True)

    # Preview specific texts
    texts = ['NEO', 'NEON', 'V4', 'CORTEX', 'OMNI']
    for t in texts:
        try:
            print_chip_art_preview(t)
        except ValueError as e:
            print(f"{Colors.RED}Error with '{t}': {e}{Colors.RESET}")

    # Generate TSX for requested text
    print(f"\n{Colors.BOLD}{Colors.GREEN}=== TypeScript Code for '{text}' ==={Colors.RESET}\n")
    try:
        tsx_code = generate_chip_art_tsx(text)
        print(tsx_code)
    except ValueError as e:
        print(f"{Colors.RED}Error: {e}{Colors.RESET}")

    # Export JSON
    export_font_json()


if __name__ == '__main__':
    main()
