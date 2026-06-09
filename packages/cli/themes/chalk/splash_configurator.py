#!/usr/bin/env python3
"""
OmniClaude V4 - Splash Screen Configurator

Interactive tool to configure and generate splash screen chip art
for the Ink UI. Outputs ready-to-paste TypeScript code.

Usage:
    python splash_configurator.py                  # Interactive mode
    python splash_configurator.py NEO              # Generate for 'NEO'
    python splash_configurator.py --preview NEON   # Preview only
    python splash_configurator.py --update NEO     # Update OmniClaudeApp.tsx directly
"""

import os
import sys
import re
import argparse
from typing import List, Optional

# Add path for font library
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from splash_font_library import (
    ChipFont,
    ChipFontCompact,
    generate_chip_center_lines,
    generate_chip_art_tsx,
    print_chip_art_preview,
    preview_text,
    Colors,
)


# Path to OmniClaudeApp.tsx (relative to this script)
OMNICLAUDE_APP_PATH = os.path.join(
    os.path.dirname(__file__),
    '..',
    '..',
    'src',
    'ink-ui',
    'OmniClaudeApp.tsx'
)


def generate_title_art_tsx(text: str) -> str:
    """
    Generate the main title ASCII art (the large banner below chip).

    This creates the large "CORTEX" style banner using block characters
    with shadow effect.
    """
    # For now, return a simple implementation
    # The title uses a different, larger font than the chip center

    # We'll use a simple mapping for the main title
    title_chars = {
        'N': [
            '██  ██',
            '███ ██',
            '██████',
            '██ ███',
            '██  ██'
        ],
        'E': [
            '██████',
            '██    ',
            '████  ',
            '██    ',
            '██████'
        ],
        'O': [
            '██████',
            '██  ██',
            '██  ██',
            '██  ██',
            '██████'
        ],
        'C': [
            '██████',
            '██    ',
            '██    ',
            '██    ',
            '██████'
        ],
        'R': [
            '██████',
            '██  ██',
            '██████',
            '██ ██ ',
            '██  ██'
        ],
        'T': [
            '██████',
            '  ██  ',
            '  ██  ',
            '  ██  ',
            '  ██  '
        ],
        'X': [
            '██  ██',
            ' ████ ',
            '  ██  ',
            ' ████ ',
            '██  ██'
        ],
        'V': [
            '██  ██',
            '██  ██',
            '██  ██',
            ' ████ ',
            '  ██  '
        ],
        '4': [
            '██  ██',
            '██  ██',
            '██████',
            '    ██',
            '    ██'
        ],
        ' ': [
            '      ',
            '      ',
            '      ',
            '      ',
            '      '
        ],
    }

    # Shadow versions (using box drawing for shadow effect)
    shadow_chars = {
        'N': [
            '██╗  ██╗',
            '███╗ ██║',
            '██╔██╗█║',
            '██║╚██╔╝',
            '██║ ╚██║'
        ],
        'E': [
            '███████╗',
            '██╔════╝',
            '█████╗  ',
            '██╔══╝  ',
            '███████╗'
        ],
        'O': [
            ' ██████╗',
            '██╔═══██╗',
            '██║   ██║',
            '██║   ██║',
            '╚██████╔╝'
        ],
        # Add more as needed
    }

    lines = ['', '', '', '', '']
    for char in text.upper():
        if char in title_chars:
            for i, line in enumerate(title_chars[char]):
                lines[i] += line + ' '
        else:
            for i in range(5):
                lines[i] += '      '

    return lines


def preview_title_options():
    """Preview different title text options"""
    options = ['NEO', 'NEON', 'CORTEX', 'V4', 'OMNI']

    print(f"\n{Colors.BOLD}{Colors.CYAN}=== Title Options Preview ==={Colors.RESET}\n")

    for opt in options:
        try:
            lines = generate_chip_center_lines(opt, target_width=25)
            width = len(lines[0])
            print(f"{Colors.GREEN}'{opt}' ({width} chars):{Colors.RESET}")
            for line in lines:
                print(f"  {Colors.YELLOW}{line}{Colors.RESET}")
            print()
        except ValueError as e:
            print(f"{Colors.RED}'{opt}': {e}{Colors.RESET}\n")


def update_omniclaude_app(center_text: str, dry_run: bool = False) -> bool:
    """
    Update OmniClaudeApp.tsx with new chip art center text.

    Args:
        center_text: Text to display in chip center
        dry_run: If True, print changes without modifying file

    Returns:
        True if successful
    """
    app_path = os.path.abspath(OMNICLAUDE_APP_PATH)

    if not os.path.exists(app_path):
        print(f"{Colors.RED}Error: Cannot find {app_path}{Colors.RESET}")
        return False

    # Read current file
    with open(app_path, 'r') as f:
        content = f.read()

    # Generate new chip art lines
    try:
        center_lines = generate_chip_center_lines(center_text, target_width=25)
    except ValueError as e:
        print(f"{Colors.RED}Error: {e}{Colors.RESET}")
        return False

    # Find and replace the chip art section
    # Look for the chipArt array definition
    chip_art_pattern = r"(const chipArt = \[[\s\S]*?\];)"

    # Generate new chip art
    # The inner box area is exactly 25 chars wide (between ║ chars)
    new_chip_art = [
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

    # Build replacement string
    replacement_lines = ["const chipArt = ["]
    for line in new_chip_art:
        replacement_lines.append(f"    '{line}',")
    replacement_lines.append("  ];")
    replacement = '\n'.join(replacement_lines)

    # Find the old chipArt definition
    match = re.search(chip_art_pattern, content)
    if not match:
        print(f"{Colors.RED}Error: Could not find chipArt array in {app_path}{Colors.RESET}")
        return False

    old_chip_art = match.group(1)

    if dry_run:
        print(f"\n{Colors.BOLD}{Colors.CYAN}=== Dry Run - Changes to be made ==={Colors.RESET}\n")
        print(f"{Colors.RED}OLD:{Colors.RESET}")
        print(old_chip_art[:500] + "...")
        print(f"\n{Colors.GREEN}NEW:{Colors.RESET}")
        print(replacement)
        return True

    # Replace
    new_content = content.replace(old_chip_art, replacement)

    # Write back
    with open(app_path, 'w') as f:
        f.write(new_content)

    print(f"{Colors.GREEN}Successfully updated {app_path} with '{center_text}'{Colors.RESET}")
    return True


def interactive_mode():
    """Run interactive configuration mode"""
    print(f"\n{Colors.BOLD}{Colors.CYAN}")
    print("╔═══════════════════════════════════════════════════════════╗")
    print("║     OMNICLAUDE V4 - SPLASH SCREEN CONFIGURATOR            ║")
    print("║                  Interactive Mode                         ║")
    print("╚═══════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}")

    # Show current options
    preview_title_options()

    while True:
        print(f"\n{Colors.CYAN}Commands:{Colors.RESET}")
        print("  preview <text>  - Preview chip art with text")
        print("  generate <text> - Generate TypeScript code")
        print("  update <text>   - Update OmniClaudeApp.tsx")
        print("  alphabet        - Show full font alphabet")
        print("  quit            - Exit")

        try:
            cmd = input(f"\n{Colors.GREEN}>>> {Colors.RESET}").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if not cmd:
            continue

        parts = cmd.split(maxsplit=1)
        action = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ''

        if action == 'quit' or action == 'q' or action == 'exit':
            break
        elif action == 'preview' or action == 'p':
            if arg:
                print_chip_art_preview(arg)
            else:
                print(f"{Colors.RED}Usage: preview <text>{Colors.RESET}")
        elif action == 'generate' or action == 'g':
            if arg:
                try:
                    tsx = generate_chip_art_tsx(arg)
                    print(f"\n{Colors.GREEN}TypeScript code for '{arg}':{Colors.RESET}\n")
                    print(tsx)
                except ValueError as e:
                    print(f"{Colors.RED}Error: {e}{Colors.RESET}")
            else:
                print(f"{Colors.RED}Usage: generate <text>{Colors.RESET}")
        elif action == 'update' or action == 'u':
            if arg:
                # First show preview
                print_chip_art_preview(arg)
                confirm = input(f"\n{Colors.YELLOW}Update OmniClaudeApp.tsx with '{arg}'? (y/n): {Colors.RESET}")
                if confirm.lower() == 'y':
                    update_omniclaude_app(arg)
            else:
                print(f"{Colors.RED}Usage: update <text>{Colors.RESET}")
        elif action == 'alphabet' or action == 'a':
            from splash_font_library import preview_alphabet
            preview_alphabet(compact=False)
            preview_alphabet(compact=True)
        else:
            print(f"{Colors.RED}Unknown command: {action}{Colors.RESET}")

    print(f"\n{Colors.CYAN}Goodbye!{Colors.RESET}")


def main():
    parser = argparse.ArgumentParser(
        description='OmniClaude V4 Splash Screen Configurator',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    %(prog)s                        # Interactive mode
    %(prog)s NEO                    # Generate TSX for 'NEO'
    %(prog)s --preview NEON         # Preview chip art
    %(prog)s --update NEO           # Update OmniClaudeApp.tsx
    %(prog)s --update NEO --dry-run # Show changes without modifying
        """
    )

    parser.add_argument('text', nargs='?', help='Text for chip center')
    parser.add_argument('--preview', '-p', action='store_true',
                        help='Preview chip art only')
    parser.add_argument('--update', '-u', action='store_true',
                        help='Update OmniClaudeApp.tsx directly')
    parser.add_argument('--dry-run', '-n', action='store_true',
                        help='Show changes without modifying files')
    parser.add_argument('--alphabet', '-a', action='store_true',
                        help='Show full font alphabet')

    args = parser.parse_args()

    if args.alphabet:
        from splash_font_library import preview_alphabet
        preview_alphabet(compact=False)
        preview_alphabet(compact=True)
        return

    if args.text:
        if args.preview:
            print_chip_art_preview(args.text)
        elif args.update:
            update_omniclaude_app(args.text, dry_run=args.dry_run)
        else:
            # Default: generate TSX
            try:
                tsx = generate_chip_art_tsx(args.text)
                print(tsx)
            except ValueError as e:
                print(f"Error: {e}", file=sys.stderr)
                sys.exit(1)
    else:
        interactive_mode()


if __name__ == '__main__':
    main()
