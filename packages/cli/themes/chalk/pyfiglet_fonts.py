#!/usr/bin/env python3
"""
PyFiglet Font Showcase - Futuristic and Wide Fonts
Demonstrates actual ASCII art fonts that create Tron/futuristic aesthetics
"""

import os
import sys

# Force color output
os.environ['FORCE_COLOR'] = '1'

# Try to import pyfiglet, provide instructions if not available
try:
    from pyfiglet import Figlet, figlet_format
    PYFIGLET_AVAILABLE = True
except ImportError:
    PYFIGLET_AVAILABLE = False
    print("pyfiglet not installed. Install with: pip install pyfiglet")

# ANSI colors for Tron theming
class Colors:
    CYAN = '\033[96m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    WHITE = '\033[97m'
    GRAY = '\033[90m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    # Tron-specific colors
    GLOW_CYAN = '\033[38;5;51m'
    GLOW_BLUE = '\033[38;5;39m'
    NEON_PINK = '\033[38;5;198m'
    ELECTRIC_PURPLE = '\033[38;5;165m'
    GRID_ORANGE = '\033[38;5;208m'

# Futuristic and wide fonts available in pyfiglet
FUTURISTIC_FONTS = {
    'Wide Fonts': [
        'banner',      # Very wide, blocky
        'banner3',     # Wide with style
        'banner3-D',   # 3D effect, wide
        'banner4',     # Another wide variant
        'block',       # Blocky and wide
        'bubble',      # Bubble letters
        'digital',     # Digital display style
        'letters',     # Wide letter blocks
        'univers',     # Wide universe font
    ],
    'Tech/Cyber Fonts': [
        'cybermedium', # Cyberpunk style
        'cyberlarge',  # Large cyber font
        'cosmic',      # Cosmic/space style
        'cosmike',     # Cosmic variant
        'computer',    # Computer terminal style
        'decimal',     # Digital decimal style
        'binary',      # Binary style
        'hex',         # Hexadecimal style
        'octal',       # Octal style
    ],
    'Futuristic Style': [
        'epic',        # Epic gaming style
        'fender',      # Sleek style
        'future',      # Future font (if available)
        'georgi16',    # Georgian style
        'ghost',       # Ghostly effect
        'graceful',    # Graceful curves
        'gradient',    # Gradient effect
        'isometric1',  # Isometric 3D
        'isometric2',  # Isometric variant
        'isometric3',  # Another isometric
        'isometric4',  # Fourth isometric
    ],
    'Matrix/LCD Style': [
        'lcd',         # LCD display
        'lean',        # Lean angular
        'mini',        # Minimalist
        'mnemonic',    # Mnemonic style
        'morse',       # Morse code style
        'npn__',       # NPN transistor style
        'ntgreek',     # Greek tech style
        'nvscript',    # Script variant
    ],
    'Special Effects': [
        '3-d',         # 3D effect
        '3x5',         # 3x5 grid
        '4max',        # Maximum style
        '5lineoblique',# 5 line oblique
        'alligator',   # Alligator style
        'alligator2',  # Alligator variant
        'arrows',      # Arrow style
        'doom',        # DOOM game style
    ]
}

def display_font_sample(text, font_name, color=Colors.CYAN):
    """Display a text sample in a specific font"""
    if not PYFIGLET_AVAILABLE:
        print(f"{color}{font_name}: [pyfiglet required]{Colors.RESET}")
        return

    try:
        fig = Figlet(font=font_name)
        rendered = fig.renderText(text)

        print(f"{Colors.BOLD}{color}▌ {font_name.upper()}{Colors.RESET}")
        print(f"{Colors.GRAY}{'─' * 60}{Colors.RESET}")

        # Apply color to each line
        for line in rendered.split('\n'):
            if line.strip():  # Only print non-empty lines
                print(f"{color}{line}{Colors.RESET}")
        print()

    except Exception as e:
        print(f"{Colors.RED}Font '{font_name}' not available: {e}{Colors.RESET}")

def create_tron_grid(width=60, height=5):
    """Create a Tron-style background grid"""
    grid = []

    # Top border
    grid.append(f"{Colors.GLOW_CYAN}┌{'─' * (width-2)}┐{Colors.RESET}")

    # Middle lines with grid pattern
    for i in range(height):
        if i % 2 == 0:
            line = f"{Colors.GLOW_CYAN}│{Colors.GRAY}{'·' * (width-2)}{Colors.GLOW_CYAN}│{Colors.RESET}"
        else:
            line = f"{Colors.GLOW_CYAN}│{Colors.GRAY}{' ' * (width-2)}{Colors.GLOW_CYAN}│{Colors.RESET}"
        grid.append(line)

    # Bottom border
    grid.append(f"{Colors.GLOW_CYAN}└{'─' * (width-2)}┘{Colors.RESET}")

    return grid

def showcase_wide_fonts():
    """Showcase wide fonts perfect for futuristic displays"""
    print(f"{Colors.BOLD}{Colors.GLOW_CYAN}{'═' * 80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GLOW_CYAN}WIDE FONTS - WIDTH > HEIGHT (FUTURISTIC FEEL){Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}{'═' * 80}{Colors.RESET}\n")

    demo_text = "TRON"

    # Wide fonts that work well for futuristic themes
    wide_fonts = ['banner', 'banner3-D', 'block', 'digital', 'letters']

    for font in wide_fonts:
        display_font_sample(demo_text, font, Colors.GLOW_CYAN)

def showcase_cyber_fonts():
    """Showcase cyberpunk/tech fonts"""
    print(f"{Colors.BOLD}{Colors.ELECTRIC_PURPLE}{'═' * 80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.ELECTRIC_PURPLE}CYBERPUNK & TECH FONTS{Colors.RESET}")
    print(f"{Colors.ELECTRIC_PURPLE}{'═' * 80}{Colors.RESET}\n")

    demo_text = "CYBER"

    cyber_fonts = ['cybermedium', 'computer', 'digital']

    for font in cyber_fonts:
        display_font_sample(demo_text, font, Colors.NEON_PINK)

def showcase_matrix_fonts():
    """Showcase Matrix/LCD style fonts"""
    print(f"{Colors.BOLD}{Colors.GREEN}{'═' * 80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}MATRIX & LCD DISPLAY FONTS{Colors.RESET}")
    print(f"{Colors.GREEN}{'═' * 80}{Colors.RESET}\n")

    demo_text = "MATRIX"

    matrix_fonts = ['lcd', 'binary', 'hex']

    for font in matrix_fonts:
        display_font_sample(demo_text, font, Colors.GREEN)

def showcase_3d_fonts():
    """Showcase 3D effect fonts"""
    print(f"{Colors.BOLD}{Colors.GLOW_BLUE}{'═' * 80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GLOW_BLUE}3D EFFECT FONTS{Colors.RESET}")
    print(f"{Colors.GLOW_BLUE}{'═' * 80}{Colors.RESET}\n")

    demo_text = "3D"

    effect_fonts = ['3-d', 'isometric1', 'doom']

    for font in effect_fonts:
        display_font_sample(demo_text, font, Colors.GLOW_BLUE)

def create_tron_interface():
    """Create a complete Tron-style interface"""
    print(f"{Colors.BOLD}{Colors.GLOW_CYAN}{'═' * 80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GLOW_CYAN}COMPLETE TRON INTERFACE DEMO{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}{'═' * 80}{Colors.RESET}\n")

    # Title in banner font
    if PYFIGLET_AVAILABLE:
        title = figlet_format("SYSTEM", font='banner3')
        for line in title.split('\n'):
            if line.strip():
                print(f"{Colors.GLOW_CYAN}{line}{Colors.RESET}")

    # Create UI frame
    print(f"{Colors.GLOW_CYAN}╔{'═' * 60}╗{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}║{Colors.WHITE} USER: {Colors.GLOW_CYAN}flynn{Colors.WHITE}    STATUS: {Colors.GREEN}●ONLINE{Colors.WHITE}    GRID: {Colors.GLOW_CYAN}ACTIVE{' ' * 16}{Colors.GLOW_CYAN}║{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}╠{'═' * 60}╣{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}║{Colors.GRAY} ▓▓▓ PROGRAMS ▓▓▓              ░░░ MEMORY ░░░           {Colors.GLOW_CYAN}║{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}║{Colors.GREEN} ■ Recognizer    [ACTIVE]      {Colors.YELLOW}████████░░ 80%           {Colors.GLOW_CYAN}║{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}║{Colors.GREEN} ■ Light Cycle   [READY]       {Colors.BLUE}CPU: ▁▃▅▇▅▃▁             {Colors.GLOW_CYAN}║{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}║{Colors.RED} ■ MCP          [THREAT]       {Colors.MAGENTA}I/O: ⟨⟩⟨⟩⟨⟩⟨⟩            {Colors.GLOW_CYAN}║{Colors.RESET}")
    print(f"{Colors.GLOW_CYAN}╚{'═' * 60}╝{Colors.RESET}")

def display_font_comparison():
    """Display the same text in multiple fonts for comparison"""
    print(f"{Colors.BOLD}{Colors.WHITE}FONT COMPARISON - 'TRON' IN DIFFERENT STYLES{Colors.RESET}")
    print(f"{Colors.GRAY}{'─' * 80}{Colors.RESET}\n")

    text = "TRON"
    comparison_fonts = [
        ('banner', Colors.GLOW_CYAN, "Ultra Wide"),
        ('digital', Colors.GREEN, "Digital Display"),
        ('3-d', Colors.GLOW_BLUE, "3D Effect"),
        ('doom', Colors.RED, "Game Style"),
    ]

    for font, color, description in comparison_fonts:
        print(f"{Colors.BOLD}{color}{description}:{Colors.RESET}")
        display_font_sample(text, font, color)

def list_all_fonts():
    """List all available fonts in pyfiglet"""
    if not PYFIGLET_AVAILABLE:
        print("pyfiglet not available")
        return

    fig = Figlet()
    fonts = fig.getFonts()

    print(f"{Colors.BOLD}{Colors.WHITE}ALL AVAILABLE FONTS ({len(fonts)} total):{Colors.RESET}")
    print(f"{Colors.GRAY}{'─' * 80}{Colors.RESET}")

    # Group fonts by characteristics
    wide = []
    narrow = []
    special = []

    for font in fonts:
        if any(x in font.lower() for x in ['banner', 'block', 'wide', 'univers', 'letters']):
            wide.append(font)
        elif any(x in font.lower() for x in ['thin', 'small', 'mini', 'narrow']):
            narrow.append(font)
        else:
            special.append(font)

    print(f"{Colors.GLOW_CYAN}WIDE FONTS:{Colors.RESET}")
    for i, font in enumerate(wide, 1):
        print(f"  {font}", end='')
        if i % 4 == 0:
            print()
    print("\n")

    print(f"{Colors.YELLOW}NARROW FONTS:{Colors.RESET}")
    for i, font in enumerate(narrow, 1):
        print(f"  {font}", end='')
        if i % 4 == 0:
            print()
    print("\n")

def main():
    """Main demonstration"""
    # Check if specific font requested
    if len(sys.argv) > 1:
        font_name = sys.argv[1]
        text = sys.argv[2] if len(sys.argv) > 2 else "DEMO"
        display_font_sample(text, font_name, Colors.GLOW_CYAN)
        return

    # Full showcase
    showcase_wide_fonts()
    showcase_cyber_fonts()
    showcase_matrix_fonts()
    showcase_3d_fonts()
    create_tron_interface()
    display_font_comparison()

    print(f"\n{Colors.GRAY}{'─' * 80}{Colors.RESET}")
    print(f"{Colors.WHITE}USAGE:{Colors.RESET}")
    print(f"  {Colors.CYAN}python pyfiglet_fonts.py{Colors.RESET} - Show all demos")
    print(f"  {Colors.CYAN}python pyfiglet_fonts.py [font_name] [text]{Colors.RESET} - Test specific font")
    print(f"  {Colors.CYAN}python pyfiglet_fonts.py banner TRON{Colors.RESET} - Example")
    print(f"\n{Colors.GRAY}Install pyfiglet: pip install pyfiglet{Colors.RESET}")

if __name__ == "__main__":
    main()