# Theme System Guide

Complete guide to the Nexus Cortex CLI theme system.

---

## Table of Contents

- [Overview](#overview)
- [Available Themes](#available-themes)
- [Switching Themes](#switching-themes)
- [Color Reference](#color-reference)
- [Use Cases](#use-cases)
- [Advanced Usage](#advanced-usage)
- [Creating Custom Themes](#creating-custom-themes)

---

## Overview

The Nexus Cortex CLI uses a pluggable theme system to control output formatting and colors. Themes allow you to customize the CLI appearance for different environments and use cases.

**Key Features:**
- ✅ Multiple built-in themes
- ✅ Easy theme switching
- ✅ CI/CD friendly (minimal theme)
- ✅ Accessibility support
- ✅ Extensible architecture

---

## Available Themes

### Default Theme

**Name:** `default`
**Description:** Colorful theme with syntax highlighting
**Recommended For:** Interactive terminal use, development

**Features:**
- Full color support
- Syntax highlighting
- Visual hierarchy
- Easy to read

**Example Output:**
```
📋 Available Models (4 total)

anthropic (2 models):
  ✓ claude-sonnet-4-5                        200K ctx $3.00/$15.00 per 1M
  ✓ claude-opus-4-1                          200K ctx $15.00/$75.00 per 1M

openai (2 models):
  ✓ gpt-4o                                   128K ctx $2.50/$10.00 per 1M
  ✓ gpt-4-turbo                              128K ctx $10.00/$30.00 per 1M
```

**Color Scheme:**
- **Primary** (Headers): Cyan/Yellow (bold)
- **Secondary** (Sections): Cyan
- **Success** (Indicators): Green
- **Error** (Messages): Red
- **Warning** (Alerts): Yellow
- **Info** (Details): Blue
- **Muted** (Secondary Info): Gray
- **Highlight** (Emphasis): Bold

---

### Minimal Theme

**Name:** `minimal`
**Description:** Plain text theme with no colors
**Recommended For:** CI/CD pipelines, logs, accessibility, scripting

**Features:**
- No ANSI color codes
- Plain text output
- Parser-friendly
- Screen reader compatible

**Example Output:**
```
📋 Available Models (4 total)

anthropic (2 models):
  ✓ claude-sonnet-4-5                        200K ctx $3.00/$15.00 per 1M
  ✓ claude-opus-4-1                          200K ctx $15.00/$75.00 per 1M

openai (2 models):
  ✓ gpt-4o                                   128K ctx $2.50/$10.00 per 1M
  ✓ gpt-4-turbo                              128K ctx $10.00/$30.00 per 1M
```

**Note:** Output looks the same but contains no ANSI escape codes.

---

## Switching Themes

### Method 1: Configuration File

Edit `~/.cortex/config.json`:

```json
{
  "theme": "default"
}
```

or

```json
{
  "theme": "minimal"
}
```

**Persistence:** Changes are permanent until config is modified.

**Example:**
```bash
# Edit config
nano ~/.cortex/config.json

# Change theme to minimal
{
  "theme": "minimal"
}

# Save and exit

# All commands now use minimal theme
cortex models list
```

---

### Method 2: Environment Variable

Set `OMNICLAUDE_THEME` environment variable:

```bash
# Use minimal theme for one command
OMNICLAUDE_THEME=minimal cortex models list

# Use default theme for one command
OMNICLAUDE_THEME=default cortex models list

# Set for entire session
export OMNICLAUDE_THEME=minimal
cortex models list
cortex session list
```

**Persistence:** Only for current shell session.

---

### Method 3: CLI Flag

Use `--no-color` flag to force minimal theme:

```bash
# Force minimal theme (no colors)
cortex models list --no-color

# Works with any command
cortex session list --no-color
cortex chat --no-color
```

**Persistence:** Only for single command.

---

### Priority Order

Theme selection follows this priority order (highest first):

```
1. CLI Flag (--no-color)
2. Environment Variable (OMNICLAUDE_THEME)
3. Configuration File (theme property)
4. Built-in Default (default theme)
```

**Example:**
```bash
# Config file has "default" theme
cat ~/.cortex/config.json
# → { "theme": "default" }

# Environment variable overrides config
OMNICLAUDE_THEME=minimal cortex models list
# → Uses minimal theme

# CLI flag overrides everything
OMNICLAUDE_THEME=default cortex models list --no-color
# → Uses minimal theme (--no-color forces minimal)
```

---

## Color Reference

### Default Theme Colors

**Primary** (Headers, Provider Names)
- Color: Cyan bold (or Yellow bold)
- Usage: Main headers, provider names
- Example: `anthropic (2 models):`

**Secondary** (Section Headers)
- Color: Cyan
- Usage: Section titles, counts
- Example: `📋 Available Models (4 total)`

**Success** (Indicators)
- Color: Green
- Usage: Success indicators, checkmarks
- Example: `✓`

**Error** (Error Messages)
- Color: Red
- Usage: Error messages, failures
- Example: `Error: Connection failed`

**Warning** (Warnings)
- Color: Yellow
- Usage: Warning messages, alerts
- Example: `Warning: Server slow to respond`

**Info** (Information)
- Color: Blue
- Usage: Informational messages
- Example: `Info: Using cached data`

**Muted** (Secondary Info)
- Color: Gray
- Usage: Secondary information, metadata
- Example: `200K ctx $3.00/$15.00 per 1M`

**Highlight** (Emphasis)
- Color: Bold
- Usage: Important text, model IDs
- Example: `claude-sonnet-4-5`

---

### Minimal Theme Colors

**All colors** → Plain text (no ANSI codes)

The minimal theme uses the same text content but outputs plain text without any ANSI escape sequences.

---

## Use Cases

### Use Case 1: Interactive Terminal (Development)

**Recommended Theme:** `default`

**Setup:**
```json
{
  "theme": "default"
}
```

**Why:**
- Colors improve readability
- Visual hierarchy helps scan output
- Syntax highlighting aids understanding
- Pleasant for extended use

---

### Use Case 2: CI/CD Pipelines

**Recommended Theme:** `minimal`

**Setup:**
```json
{
  "theme": "minimal"
}
```

**Why:**
- No ANSI codes in logs
- Clean, parseable output
- Compatible with log aggregators
- Smaller log file sizes

**Example:**
```yaml
# GitHub Actions
- name: Run CLI
  run: |
    # Force minimal theme in CI
    export OMNICLAUDE_THEME=minimal
    cortex models list > models.txt
```

---

### Use Case 3: Log Files

**Recommended Theme:** `minimal`

**Setup:**
```bash
# Use minimal theme for logging
cortex models list --no-color > models.log
```

**Why:**
- Clean text without escape codes
- Easy to grep and parse
- Smaller file size
- Human-readable in editors

---

### Use Case 4: Screen Readers (Accessibility)

**Recommended Theme:** `minimal`

**Setup:**
```json
{
  "theme": "minimal"
}
```

**Why:**
- No ANSI codes to confuse screen readers
- Plain text is easier to process
- Better compatibility
- Improved accessibility

---

### Use Case 5: Scripting / Parsing

**Recommended Theme:** `minimal`

**Setup:**
```bash
# Parse output in scripts
OMNICLAUDE_THEME=minimal cortex models list --json | jq .
```

**Why:**
- Predictable output format
- No color codes to strip
- Easy to parse
- Compatible with text processing tools

---

### Use Case 6: Remote SSH Sessions

**Recommended Theme:** `default` (if colors work) or `minimal`

**Setup:**
```bash
# Test colors
echo -e "\033[31mRed\033[0m"

# If colors work, use default
# If not, use minimal
OMNICLAUDE_THEME=minimal cortex models list
```

**Why:**
- Some terminals don't support colors
- Minimal theme works everywhere
- Fallback for compatibility

---

## Advanced Usage

### Detecting Current Theme

```bash
# Check config file
cat ~/.cortex/config.json | jq -r .theme

# Check environment variable
echo $OMNICLAUDE_THEME
```

---

### Conditional Theme Selection

```bash
# Use default in interactive, minimal in non-interactive
if [ -t 1 ]; then
  # Interactive (terminal)
  export OMNICLAUDE_THEME=default
else
  # Non-interactive (pipe, redirect)
  export OMNICLAUDE_THEME=minimal
fi

cortex models list
```

---

### Testing Themes

```bash
# Compare themes side by side
echo "=== Default Theme ===" cortex models list

echo "\n=== Minimal Theme ==="
cortex models list --no-color
```

---

## Creating Custom Themes

### Architecture

Themes implement the `Theme` interface:

```typescript
interface Theme {
  name: string;
  colors: {
    primary(text: string): string;
    secondary(text: string): string;
    success(text: string): string;
    error(text: string): string;
    warning(text: string): string;
    info(text: string): string;
    muted(text: string): string;
    highlight(text: string): string;
  };
}
```

---

### Example: Creating a Custom Theme

1. **Create theme file** `src/themes/CustomTheme.ts`:

```typescript
import { Theme } from './Theme.interface.js';
import chalk from 'chalk';

export class CustomTheme implements Theme {
  name = 'custom';

  colors = {
    primary: (text: string) => chalk.magenta.bold(text),
    secondary: (text: string) => chalk.cyan(text),
    success: (text: string) => chalk.green(text),
    error: (text: string) => chalk.red.bold(text),
    warning: (text: string) => chalk.yellow(text),
    info: (text: string) => chalk.blue(text),
    muted: (text: string) => chalk.gray(text),
    highlight: (text: string) => chalk.white.bold(text),
  };
}
```

2. **Register theme** in `src/themes/ThemeManager.ts`:

```typescript
import { CustomTheme } from './CustomTheme.js';

private static themes: Record<string, Theme> = {
  default: new DefaultTheme(),
  minimal: new MinimalTheme(),
  custom: new CustomTheme(),  // Add custom theme
};
```

3. **Add tests** in `tests/unit/themes/CustomTheme.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { CustomTheme } from '../../../src/themes/CustomTheme.js';

describe('CustomTheme', () => {
  const theme = new CustomTheme();

  test('should have name "custom"', () => {
    expect(theme.name).toBe('custom');
  });

  test('should have all color methods', () => {
    expect(theme.colors.primary).toBeDefined();
    expect(theme.colors.secondary).toBeDefined();
    // ... test all colors
  });
});
```

4. **Use custom theme**:

```json
{
  "theme": "custom"
}
```

---

### Theme Best Practices

**1. Consistent Color Mapping**
- Use same colors for same concepts across themes
- Primary = Headers
- Success = Positive indicators
- Error = Negative indicators
- Muted = Less important info

**2. Accessibility**
- Provide sufficient contrast
- Don't rely solely on color
- Include text indicators (✓, ✗, etc.)

**3. Testing**
- Test on different terminal emulators
- Test with color blindness simulators
- Test with screen readers

**4. Documentation**
- Document color scheme
- Provide examples
- Explain use cases

---

## Troubleshooting

### Colors Not Showing

**Problem:** Terminal shows escape codes instead of colors

**Causes:**
- Terminal doesn't support ANSI colors
- `TERM` environment variable not set
- Running in non-interactive mode

**Solutions:**
```bash
# Check TERM variable
echo $TERM

# Set if not set
export TERM=xterm-256color

# Use minimal theme instead
cortex models list --no-color
```

---

### Wrong Theme Applied

**Problem:** Theme doesn't match configuration

**Check:**
```bash
# 1. Check config file
cat ~/.cortex/config.json | jq -r .theme

# 2. Check environment variable
echo $OMNICLAUDE_THEME

# 3. Clear environment variable
unset OMNICLAUDE_THEME

# 4. Verify theme name is valid
# Valid: "default", "minimal"
# Invalid: "dark", "light", "custom" (unless you created them)
```

---

### Broken Colors in SSH

**Problem:** Colors broken over SSH

**Solutions:**
```bash
# Option 1: Force minimal theme
cortex models list --no-color

# Option 2: Fix terminal
export TERM=xterm-256color

# Option 3: Use tmux/screen
tmux
cortex models list
```

---

## Related Documentation

- [Configuration Guide](CONFIGURATION.md) - General configuration
- [CLI README](../README.md) - Main documentation
- [Formatters](FORMATTERS.md) - Output formatting

---

## Summary

**Key Points:**
- ✅ Two built-in themes: `default` (colorful), `minimal` (plain)
- ✅ Switch via config file, env var, or CLI flag
- ✅ Priority: CLI Flag > Env Var > Config > Default
- ✅ Use `default` for interactive, `minimal` for CI/CD
- ✅ Extensible: create custom themes

**Quick Reference:**
```bash
# Configuration file
{ "theme": "minimal" }

# Environment variable
export OMNICLAUDE_THEME=minimal

# CLI flag
cortex models list --no-color
```

**Recommendations:**
- **Development:** Use `default` theme
- **CI/CD:** Use `minimal` theme
- **Logging:** Use `minimal` theme
- **Screen Readers:** Use `minimal` theme
