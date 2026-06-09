#!/usr/bin/env python3

import sys
import os

# Force color output
os.environ['FORCE_COLOR'] = '1'
sys.stdout.write('\033[2J\033[H')  # Clear screen

# Diff formatting utilities (similar to ToolFormatter.ts)
def format_diff_line(line_number, prefix, content, is_added=False, is_removed=False, terminal_width=80):
    """Format a single diff line with ANSI colors"""
    line_num = str(line_number).rjust(4, ' ')
    reset = '\x1b[0m'

    if is_added:
        # White text on muted green background
        green_bg = '\x1b[97;48;5;22m'
        formatted = f"{green_bg}{line_num} {prefix}  {content}{reset}"
    elif is_removed:
        # White text on muted red background
        red_bg = '\x1b[97;48;5;52m'
        formatted = f"{red_bg}{line_num} {prefix}  {content}{reset}"
    else:
        # Dimmed context lines
        formatted = f"\x1b[2m{line_num} {prefix}  {content}{reset}"

    # Handle line wrapping for long content
    max_width = terminal_width - 15
    if len(content) <= max_width:
        return formatted

    # Wrap long lines
    first_part = content[:max_width]
    remaining = content[max_width:]

    formatted_first = f"{line_num} {prefix}  {first_part}"
    formatted_cont = f"     {prefix}  {remaining}"

    if is_added:
        return f"{green_bg}{formatted_first}{reset}\n{green_bg}{formatted_cont}{reset}"
    elif is_removed:
        return f"{red_bg}{formatted_first}{reset}\n{red_bg}{formatted_cont}{reset}"
    else:
        return f"\x1b[2m{formatted_first}{reset}\n\x1b[2m{formatted_cont}{reset}"

def create_sample_diff():
    """Create a sample diff for demonstration"""
    return [
        # Context before
        (1, '  ', 'import { useState, useEffect } from "react";', False, False),
        (2, '  ', 'import { Box, Text } from "ink";', False, False),
        (3, '  ', '', False, False),
        # Changes
        (4, ' -', 'function OldComponent() {', False, True),
        (4, ' +', 'function NewComponent() {', True, False),
        (5, '  ', '  const [count, setCount] = useState(0);', False, False),
        (6, ' -', '  const [name, setName] = useState("");', False, True),
        (6, ' +', '  const [name, setName] = useState("OmniClaude");', True, False),
        (7, ' +', '  const [theme, setTheme] = useState("dark");', True, False),
        (8, '  ', '', False, False),
        (9, '  ', '  useEffect(() => {', False, False),
        (10, ' -', '    console.log("Component mounted");', False, True),
        (10, ' +', '    console.log(`Component ${name} mounted with theme ${theme}`);', True, False),
        # Context after
        (11, '  ', '  }, []);', False, False),
        (12, '  ', '', False, False),
        (13, '  ', '  return (', False, False),
    ]

def display_diff_with_theme(theme_name, theme_colors, diff_lines):
    """Display diff using specified theme colors"""
    width = 80
    print(f"\n\033[1m📎 FILE DIFF DISPLAY - {theme_name.upper()} THEME\033[0m")
    print(f"\033[{theme_colors['dimmed']}m{'─' * width}\033[0m")
    print(f"\033[{theme_colors['dimmed']}m Edit file src/components/App.tsx\033[0m")
    print(f"\033[{theme_colors['dimmed']}m{'╌' * width}\033[0m")

    for line_num, prefix, content, is_added, is_removed in diff_lines:
        if is_added:
            print(format_diff_line(line_num, prefix, content, True, False, width))
        elif is_removed:
            print(format_diff_line(line_num, prefix, content, False, True, width))
        else:
            print(format_diff_line(line_num, prefix, content, False, False, width))

    print(f"\033[{theme_colors['dimmed']}m{'╌' * width}\033[0m")

print("""
\033[36m\033[1m════════════════════════════════════════════════════════════════\033[0m
\033[36m\033[1m              OMNICLAUDE V4 CLI - COMPLETE THEME GALLERY         \033[0m
\033[36m\033[1m════════════════════════════════════════════════════════════════\033[0m

\033[1m📋 TABLE OF CONTENTS\033[0m
────────────────────────────────────────
\033[90m• Basic Colors & Styles\033[0m
\033[90m• 256 Color Palette & True Color\033[0m
\033[90m• Theme Examples (VS Code, Monokai, Dracula)\033[0m
\033[90m• Status Messages & Progress Indicators\033[0m
\033[90m• Tool Execution Display\033[0m
\033[90m• Syntax Highlighting\033[0m
\033[90m• File Diff Display (3 themes)\033[0m
\033[90m• Interactive Examples\033[0m

\033[1m📎 BASIC COLORS (8 colors)\033[0m
\033[30m\033[47m black \033[0m \033[31m red \033[0m \033[32m green \033[0m \033[33m yellow \033[0m
\033[34m blue \033[0m \033[35m magenta \033[0m \033[36m cyan \033[0m \033[37m white \033[0m

\033[1m📎 BRIGHT COLORS (High intensity)\033[0m
\033[90m gray/blackBright \033[0m \033[91m redBright \033[0m \033[92m greenBright \033[0m \033[93m yellowBright \033[0m
\033[94m blueBright \033[0m \033[95m magentaBright \033[0m \033[96m cyanBright \033[0m \033[97m whiteBright \033[0m

\033[1m📎 TEXT STYLES\033[0m
\033[1mBold text\033[0m
\033[2mDim text\033[0m
\033[3mItalic text\033[0m
\033[4mUnderlined text\033[0m
\033[7mInverse colors\033[0m
\033[9mStrikethrough\033[0m
\033[1m\033[3m\033[4mCombined: Bold + Italic + Underline\033[0m

\033[1m📎 256 COLOR PALETTE (Sample)\033[0m
Color cube: """, end="")

# 256 color cube sample
for i in range(16, 52):
    print(f"\033[48;5;{i}m  \033[0m", end="")
print()
print("            ", end="")
for i in range(52, 88):
    print(f"\033[48;5;{i}m  \033[0m", end="")
print()

# Grayscale
print("Grayscale:  ", end="")
for i in range(232, 256):
    print(f"\033[48;5;{i}m  \033[0m", end="")
print()

print("""
\033[1m📎 TRUE COLOR (RGB - 16 Million Colors)\033[0m
RGB Gradient: """, end="")

# RGB gradient
for i in range(40):
    r = int(255 * (i / 40))
    g = int(255 * (1 - i / 40))
    b = 128
    print(f"\033[38;2;{r};{g};{b}m█\033[0m", end="")
print()

# Rainbow text
print("Rainbow:      ", end="")
rainbow_colors = [
    (255, 0, 0), (255, 127, 0), (255, 255, 0), (0, 255, 0),
    (0, 0, 255), (75, 0, 130), (148, 0, 211)
]
text = "OMNICLAUDE V4 CLI"
for i, char in enumerate(text):
    color = rainbow_colors[i % len(rainbow_colors)]
    print(f"\033[38;2;{color[0]};{color[1]};{color[2]}\033[1m{char}\033[0m", end="")
print()

print("""
\033[1m📎 DARK THEME (VS Code One Dark)\033[0m
────────────────────────────────────────
\033[38;2;97;175;239mPrimary\033[0m \033[38;2;198;120;221mSecondary\033[0m \033[38;2;152;195;121mSuccess\033[0m
\033[38;2;229;192;123mWarning\033[0m \033[38;2;224;108;117mError\033[0m \033[38;2;86;182;194mInfo\033[0m
\033[38;2;171;178;191mRegular text\033[0m \033[38;2;92;99;112mDimmed text\033[0m

Code Example:
\033[38;2;198;120;221mfunction\033[0m \033[38;2;97;175;239mcalculate\033[0m\033[90m(\033[0m\033[38;2;229;192;123mx\033[0m\033[90m, \033[0m\033[38;2;229;192;123my\033[0m\033[90m) {\033[0m
  \033[38;2;198;120;221mreturn\033[0m \033[38;2;229;192;123mx\033[0m \033[90m+\033[0m \033[38;2;229;192;123my\033[0m\033[90m;\033[0m
\033[90m}\033[0m

\033[1m📎 MONOKAI THEME\033[0m
────────────────────────────────────────
\033[38;2;249;38;114mPink/Keywords\033[0m \033[38;2;166;226;46mGreen/Functions\033[0m \033[38;2;230;219;116mYellow/Strings\033[0m
\033[38;2;174;129;255mPurple/Numbers\033[0m \033[38;2;102;217;239mCyan/Types\033[0m \033[38;2;253;151;31mOrange/Params\033[0m

\033[38;2;249;38;114mclass\033[0m \033[38;2;166;226;46mOmniClaude\033[0m {
  \033[38;2;102;217;239mconstructor\033[0m(\033[38;2;253;151;31mmodel\033[0m: \033[38;2;102;217;239mstring\033[0m) {
    \033[38;2;249;38;114mthis\033[0m.model = \033[38;2;253;151;31mmodel\033[0m;
  }
}

\033[1m📎 DRACULA THEME\033[0m
────────────────────────────────────────
\033[38;2;139;233;253mCyan\033[0m \033[38;2;80;250;123mGreen\033[0m \033[38;2;255;184;108mOrange\033[0m
\033[38;2;255;121;198mPink\033[0m \033[38;2;189;147;249mPurple\033[0m \033[38;2;255;85;85mRed\033[0m \033[38;2;241;250;140mYellow\033[0m

\033[38;2;255;121;198masync function\033[0m \033[38;2;80;250;123mprocessMessage\033[0m(\033[38;2;255;184;108mtext\033[0m) {
  \033[38;2;255;121;198mreturn await\033[0m client.\033[38;2;80;250;123msend\033[0m(\033[38;2;241;250;140m"\033[0m\033[38;2;241;250;140mHello\033[0m\033[38;2;241;250;140m"\033[0m);
}

\033[1m📎 STATUS MESSAGES\033[0m
────────────────────────────────────────
\033[32m✓\033[0m \033[37mBuild completed successfully\033[0m
\033[31m✗\033[0m \033[37mError: Compilation failed\033[0m
\033[33m⚠\033[0m \033[37mWarning: Deprecated API usage\033[0m
\033[34mℹ\033[0m \033[37mInfo: Server running on port 3000\033[0m
\033[90m●\033[0m \033[90mDebug: Cache cleared\033[0m

Alternative style:
\033[42m\033[30m SUCCESS \033[0m Tests passed
\033[41m\033[37m ERROR \033[0m Connection timeout
\033[43m\033[30m WARNING \033[0m Low memory
\033[44m\033[37m INFO \033[0m Update available

\033[1m📎 PROGRESS INDICATORS\033[0m
────────────────────────────────────────
Spinner frames: \033[36m⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏\033[0m
\033[34m⏳\033[0m\033[90m Loading...\033[0m
\033[33m💭\033[0m\033[90m Thinking...\033[0m
\033[36m⚙️\033[0m\033[90m Processing...\033[0m
\033[32m✅\033[0m\033[90m Complete\033[0m

Progress Bar:
[\033[32m███████████████████\033[0m\033[90m░░░░░░░░░░░\033[0m] \033[33m65%\033[0m

\033[1m📎 BOX STYLES\033[0m
────────────────────────────────────────
\033[36m┌────────────────────┐
│ Single line box    │
└────────────────────┘\033[0m

\033[35m╔════════════════════╗
║ Double line box    ║
╚════════════════════╝\033[0m

\033[33m╭────────────────────╮
│ Rounded box        │
╰────────────────────╯\033[0m

\033[1m📎 SESSION HEADER EXAMPLE\033[0m
────────────────────────────────────────
\033[90m┌──────────────────────────────────────────────────────────┐\033[0m
\033[90m│\033[0m\033[36m\033[1m OmniClaude V4\033[0m                             \033[2m[Ctrl+C to exit]\033[0m \033[90m│\033[0m
\033[90m│\033[0m Model: \033[33mgemini-2.5-flash\033[0m      Session: \033[34mabc-123\033[0m         \033[90m│\033[0m
\033[90m│\033[0m Messages: \033[37m12\033[0m  |  Tokens: \033[37m45.2K\033[0m  |  Cost: \033[32m$0.03\033[0m          \033[90m│\033[0m
\033[90m└──────────────────────────────────────────────────────────┘\033[0m

\033[1m📎 TOOL EXECUTION DISPLAY\033[0m
────────────────────────────────────────
\033[90m⏳\033[0m \033[36mglob\033[0m\033[90m("**/*.ts")\033[0m\033[90m ...\033[0m
\033[36m⚙️\033[0m \033[36mgrep\033[0m\033[90m("TODO", {glob: "*.js"})\033[0m\033[90m ...\033[0m
\033[32m✓\033[0m \033[36mread\033[0m\033[90m("/src/index.ts")\033[0m
\033[31m✗\033[0m \033[36mwrite\033[0m\033[90m("/protected/file.txt")\033[0m\033[31m - Permission denied\033[0m

\033[1m📎 SYNTAX HIGHLIGHTING (JavaScript)\033[0m
────────────────────────────────────────
\033[38;2;92;99;112m\033[3m// OmniClaude V4 Example\033[0m
\033[38;2;198;120;221m\033[1mconst\033[0m \033[38;2;224;108;117mclient\033[0m = \033[38;2;198;120;221m\033[1mnew\033[0m \033[38;2;97;175;239mOmniClaudeClient\033[0m({
  \033[38;2;224;108;117mmodel\033[0m: \033[38;2;152;195;121m"gemini-2.5-flash"\033[0m,
  \033[38;2;224;108;117mtemperature\033[0m: \033[38;2;209;154;102m0.7\033[0m,
  \033[38;2;224;108;117mmaxTokens\033[0m: \033[38;2;209;154;102m4096\033[0m
});

\033[38;2;198;120;221m\033[1masync function\033[0m \033[38;2;97;175;239msendMessage\033[0m(\033[38;2;224;108;117mtext\033[0m) {
  \033[38;2;198;120;221m\033[1mreturn await\033[0m \033[38;2;224;108;117mclient\033[0m.\033[38;2;97;175;239mchat\033[0m(\033[38;2;224;108;117mtext\033[0m);
}

\033[1m📎 COMPARISON: WITH vs WITHOUT COLORS\033[0m
────────────────────────────────────────
With colors:
\033[32m✓\033[0m Build \033[32msucceeded\033[0m in \033[33m1.2s\033[0m
\033[31m✗\033[0m \033[31mError:\033[0m Cannot find module \033[33m'express'\033[0m

Without colors:
[OK] Build succeeded in 1.2s
[ERROR] Error: Cannot find module 'express'""")

# Sample diff data for demonstrations
sample_diff = create_sample_diff()

# Display diffs in different themes
themes = {
    "VS Code Dark": {
        "dimmed": "90",
        "success": "32",
        "error": "31",
        "primary": "36",
        "secondary": "35"
    },
    "Monokai": {
        "dimmed": "90",
        "success": "32",
        "error": "31",
        "primary": "33",
        "secondary": "35"
    },
    "Dracula": {
        "dimmed": "90",
        "success": "32",
        "error": "31",
        "primary": "36",
        "secondary": "35"
    }
}

for theme_name, theme_colors in themes.items():
    display_diff_with_theme(theme_name, theme_colors, sample_diff)

print("""
\033[1m📎 INTERACTIVE DIFF EXAMPLES\033[0m
────────────────────────────────────────
\033[36m●\033[0m \033[36medit\033[0m\033[90m("src/App.tsx", "old content", "new content")\033[0m
\033[32m✓\033[0m \033[36medit\033[0m\033[90m("src/App.tsx")\033[0m \033[32m- File updated successfully\033[0m

\033[90m⏳\033[0m \033[36mbash\033[0m\033[90m("git diff --cached")\033[0m\033[90m ...\033[0m
\033[32m✓\033[0m \033[36mbash\033[0m\033[90m("git diff --cached")\033[0m

\033[90m════════════════════════════════════════════════════════════════\033[0m
\033[36m\033[1m   End of Complete Theme Gallery + File Diff Demos\033[0m
\033[90m   This shows all themes, colors, UI components, and file diffs\033[0m
\033[90m   File diff display uses the same formatting as the CLI tools\033[0m
\033[90m   Run with: \033[33mpython3 view-all-themes.py\033[0m
\033[90m════════════════════════════════════════════════════════════════\033[0m
""")