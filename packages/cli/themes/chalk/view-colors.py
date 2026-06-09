#!/usr/bin/env python3

import sys
import os

# ANSI color codes
RED = '\033[31m'
GREEN = '\033[32m'
YELLOW = '\033[33m'
BLUE = '\033[34m'
MAGENTA = '\033[35m'
CYAN = '\033[36m'
WHITE = '\033[37m'
RESET = '\033[0m'
BOLD = '\033[1m'

# Force color output
os.environ['FORCE_COLOR'] = '1'
sys.stdout.write('\033[?25h')  # Show cursor
sys.stdout.write('\033[2J\033[H')  # Clear screen

print(f"""
{CYAN}{BOLD}═══════════════════════════════════════════════════════{RESET}
{CYAN}{BOLD}           OMNICLAUDE V4 CLI - THEME SHOWCASE          {RESET}
{CYAN}{BOLD}═══════════════════════════════════════════════════════{RESET}

{BOLD}🎨 COLORS WORKING TEST{RESET}
{RED}■ This should be RED{RESET}
{GREEN}■ This should be GREEN{RESET}
{BLUE}■ This should be BLUE{RESET}
{YELLOW}■ This should be YELLOW{RESET}
{MAGENTA}■ This should be MAGENTA{RESET}
{CYAN}■ This should be CYAN{RESET}

{BOLD}📌 STATUS MESSAGES{RESET}
{GREEN}✓{RESET} Success: Operation completed
{RED}✗{RESET} Error: Connection failed
{YELLOW}⚠{RESET} Warning: Low memory
{BLUE}ℹ{RESET} Info: Server started

{BOLD}📦 SESSION HEADER{RESET}
┌──────────────────────────────────────────────────┐
│{CYAN}{BOLD} OmniClaude V4{RESET}                    [Ctrl+C] │
│ Model: {YELLOW}gemini-2.5-flash{RESET}  Session: {BLUE}abc-123{RESET}  │
│ Messages: {WHITE}12{RESET} | Tokens: {WHITE}45K{RESET} | Cost: {GREEN}$0.03{RESET}    │
└──────────────────────────────────────────────────┘

{BOLD}📊 PROGRESS BAR{RESET}
[{GREEN}███████████████████{RESET}░░░░░░░░░░░] {YELLOW}65%{RESET}

{BOLD}🛠️  TOOL EXECUTION{RESET}
{BLUE}⏳{RESET} {CYAN}glob{RESET}("**/*.ts") ...
{GREEN}✓{RESET} {CYAN}read{RESET}("/src/index.ts")
{RED}✗{RESET} {CYAN}write{RESET}("/protected") {RED}- Permission denied{RESET}

{BOLD}🌈 RAINBOW TEXT{RESET}
{RED}O{YELLOW}M{GREEN}N{CYAN}I{BLUE}C{MAGENTA}L{RED}A{YELLOW}U{GREEN}D{CYAN}E {BLUE}V{MAGENTA}4 {RED}C{YELLOW}L{GREEN}I{RESET}

If you see colors above, your terminal supports ANSI colors!
If not, try running this in VS Code's terminal or another modern terminal.
""")