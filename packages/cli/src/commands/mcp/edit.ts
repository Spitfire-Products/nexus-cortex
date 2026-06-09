/**
 * Edit MCP_CONFIG.md in default editor
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpEditOptions {
  file?: string;
  editor?: string;
}

/**
 * Open MCP_CONFIG.md in default editor
 */
export async function mcpEdit(options: McpEditOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const configPath = options.file || join(process.cwd(), 'MCP_CONFIG.md');

  try {
    // Check if file exists
    const fs = await import('fs/promises');
    try {
      await fs.access(configPath);
    } catch (error) {
      console.error(theme.colors.error('✗ MCP_CONFIG.md not found'));
      console.log(theme.colors.muted(' Run: cortex mcp init'));
      process.exit(1);
    }

    // Determine editor
    const editor = options.editor ||
                   process.env.EDITOR ||
                   process.env.VISUAL ||
                   (process.platform === 'win32' ? 'notepad' : 'vi');

    console.log(theme.colors.secondary(`Opening ${configPath} with ${editor}...`));
    console.log();

    // Spawn editor
    const editorProcess = spawn(editor, [configPath], {
      stdio: 'inherit',
      shell: true
    });

    editorProcess.on('exit', (code) => {
      if (code === 0) {
        console.log();
        console.log(theme.colors.success('✓ Editor closed'));
        console.log(theme.colors.muted(' Validate your changes: cortex mcp validate'));
      } else {
        console.log();
        console.log(theme.colors.warning(`⚠ Editor exited with code ${code}`));
      }
    });

    editorProcess.on('error', (error) => {
      console.error(theme.colors.error(`Error launching editor: ${error.message}`));
      console.log();
      console.log(theme.colors.muted('Try setting EDITOR environment variable:'));
      console.log(theme.colors.muted(' export EDITOR=vim'));
      console.log(theme.colors.muted(' export EDITOR=nano'));
      console.log(theme.colors.muted(' export EDITOR=code'));
      process.exit(1);
    });

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
