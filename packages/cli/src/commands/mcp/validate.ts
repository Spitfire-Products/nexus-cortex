/**
 * Validate MCP_CONFIG.md syntax and structure
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpValidateOptions {
  file?: string;
}

interface ValidationError {
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validate MCP configuration file
 */
export async function mcpValidate(options: McpValidateOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const configPath = options.file || join(process.cwd(), 'MCP_CONFIG.md');

  try {
    // Read config file
    const content = await readFile(configPath, 'utf-8');
    const errors: ValidationError[] = [];

    // Extract JSON blocks from markdown
    const jsonBlockRegex = /```json\n([\s\S]*?)\n```/g;
    let match;
    const configs: any[] = [];
    let blockIndex = 0;

    while ((match = jsonBlockRegex.exec(content)) !== null) {
      blockIndex++;
      const jsonStr = match[1]!;

      try {
        const config = JSON.parse(jsonStr);
        configs.push(config);

        // Validate required fields
        if (!config.name) {
          errors.push({
            message: `Block ${blockIndex}: Missing required field 'name'`,
            severity: 'error'
          });
        }

        if (!config.command) {
          errors.push({
            message: `Block ${blockIndex}: Missing required field 'command'`,
            severity: 'error'
          });
        }

        if (!Array.isArray(config.args)) {
          errors.push({
            message: `Block ${blockIndex}: 'args' must be an array`,
            severity: 'error'
          });
        }

        // Validate optional fields
        if (config.env && typeof config.env !== 'object') {
          errors.push({
            message: `Block ${blockIndex}: 'env' must be an object`,
            severity: 'error'
          });
        }

        if (config.timeout && typeof config.timeout !== 'number') {
          errors.push({
            message: `Block ${blockIndex}: 'timeout' must be a number`,
            severity: 'warning'
          });
        }

      } catch (parseError: any) {
        errors.push({
          message: `Block ${blockIndex}: Invalid JSON - ${parseError.message}`,
          severity: 'error'
        });
      }
    }

    // Check for duplicate names
    const names = configs.map(c => c.name).filter(Boolean) as string[];
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push({
        message: `Duplicate server names: ${duplicates.join(', ')}`,
        severity: 'error'
      });
    }

    // Display results
    console.log(theme.colors.primary('\nMCP Configuration Validation'));
    console.log(theme.colors.muted(`File: ${configPath}`));
    console.log();

    if (errors.length === 0) {
      console.log(theme.colors.success('✓ Configuration is valid'));
      console.log(theme.colors.muted(` Found ${configs.length} server configuration(s)`));

      if (configs.length > 0) {
        console.log();
        console.log(theme.colors.secondary('Configured servers:'));
        configs.forEach(config => {
          if (config.name) {
            const desc = config.description || 'No description';
            console.log(theme.colors.muted(` • ${config.name}: ${desc}`));
          }
        });
      }
      console.log();
    } else {
      const errorCount = errors.filter(e => e.severity === 'error').length;
      const warningCount = errors.filter(e => e.severity === 'warning').length;

      console.log(theme.colors.error(`✗ Validation failed`));
      console.log(theme.colors.muted(` ${errorCount} error(s), ${warningCount} warning(s)`));
      console.log();

      errors.forEach(error => {
        const color = error.severity === 'error' ? theme.colors.error : theme.colors.warning;
        const prefix = error.severity === 'error' ? '✗' : '⚠';
        console.log(color(` ${prefix} ${error.message}`));
      });
      console.log();

      process.exit(1);
    }

  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(theme.colors.error('✗ MCP_CONFIG.md not found'));
      console.log(theme.colors.muted(' Run: cortex mcp init'));
      process.exit(1);
    }
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
