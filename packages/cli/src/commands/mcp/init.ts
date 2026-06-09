/**
 * Initialize MCP configuration for a project
 */
import * as fs from 'fs/promises';
import { join } from 'path';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpInitOptions {
  force?: boolean;
  template?: string;
}

const DEFAULT_MCP_CONFIG = `# MCP Server Configuration

This file configures which MCP (Model Context Protocol) servers are automatically
enabled for this project. MCP servers provide additional tools and capabilities
beyond the base tool set.

## Enabled Servers

### nexus-browser
**Status**: [OK] Enabled
**Description**: Headless Chrome browser automation (34 tools — browse, scan, click, type, screenshot, evaluate, run_code, etc.). Hosted MCP service. Auto-provisions a free-tier API key on first connect; subscribers can override via the **Headers** field with their permanent key.
**Transport**: http
**URL**: \`https://browser.spitfire-products.com/mcp\`
**Auto-start**: true
**Timeout**: 30000


## Available Servers

### filesystem
**Status**: ⏸ Available
**Description**: Local filesystem access with safety restrictions
**Command**: \`npx\`
**Args**: \`-y\`, \`@modelcontextprotocol/server-filesystem\`, \`/path/to/allowed/directory\`
**Auto-start**: false


### github
**Status**: ⏸ Available
**Description**: GitHub repos and issues (set GITHUB_TOKEN env first)
**Command**: \`npx\`
**Args**: \`-y\`, \`@modelcontextprotocol/server-github\`
**Env**: \`GITHUB_TOKEN=your-token-here\`
**Auto-start**: false


### postgres
**Status**: ⏸ Available
**Description**: PostgreSQL query and management
**Command**: \`npx\`
**Args**: \`-y\`, \`@modelcontextprotocol/server-postgres\`, \`postgresql://user:pass@localhost/db\`
**Auto-start**: false


---

**Notes**:
- Enabled servers auto-start when session begins
- Available servers can be enabled on-demand via \`cortex mcp enable <name>\`
- Validate this file with \`cortex mcp validate\`
- Two transports supported: \`stdio\` (Command + Args) and \`http\` (URL [+ optional Headers])
- nexus-browser is the canonical browser-automation MCP for Nexus Cortex. The Worker handles API key auto-provisioning and rate limiting at the protocol layer — clients should connect via this URL and never hit the underlying sandbox or Worker endpoints directly
- For subscriber permanent keys, add: \`**Headers**: \\\`Authorization=Bearer YOUR_KEY\\\`\`
`;

/**
 * Initialize MCP_CONFIG.md in current directory
 */
export async function mcpInit(options: McpInitOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  try {
    const configPath = join(process.cwd(), 'MCP_CONFIG.md');

    // Check if file already exists
    try {
      await fs.access(configPath);

      if (!options.force) {
        console.log(theme.colors.warning('⚠ MCP_CONFIG.md already exists'));
        console.log(theme.colors.muted(' Use --force to overwrite'));
        console.log(theme.colors.muted(` Path: ${configPath}`));
        process.exit(1);
      }
    } catch (error: any) {
      // File doesn't exist, continue
    }

    // Write config file
    await fs.writeFile(configPath, DEFAULT_MCP_CONFIG, 'utf-8');

    console.log(theme.colors.success('✓ MCP configuration initialized'));
    console.log(theme.colors.muted(` Created: ${configPath}`));
    console.log();
    console.log(theme.colors.secondary('Next steps:'));
    console.log(theme.colors.muted(' 1. Edit MCP_CONFIG.md to configure your servers'));
    console.log(theme.colors.muted(' 2. Validate: cortex mcp validate'));
    console.log(theme.colors.muted(' 3. Enable a server: cortex mcp enable <name>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
