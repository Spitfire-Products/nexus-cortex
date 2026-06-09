/**
 * MCP Integration Test
 *
 * Tests the MCP infrastructure with the @modelcontextprotocol/server-filesystem server.
 * This is a manual integration test to verify the MCP implementation works with a real server.
 */

import { McpClientManager } from './index.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testMcpIntegration() {
  console.log('=== MCP Integration Test ===\n');

  try {
    // 1. Create MCP Client Manager
    console.log('1. Creating MCP Client Manager...');
    const manager = new McpClientManager(true); // Enable debug mode
    console.log('[OK] Manager created\n');

    // 2. Add filesystem server configuration
    console.log('2. Adding filesystem MCP server configuration...');
    const testDir = resolve(__dirname, '..', '..', 'test-mcp-workspace');

    manager.addServerConfig('filesystem', {
      name: 'filesystem',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', testDir],
      timeout: 30000,
    });
    console.log(`[OK] Server configured with test directory: ${testDir}\n`);

    // 3. Connect to the server
    console.log('3. Connecting to filesystem MCP server...');
    await manager.connectToServer('filesystem');
    console.log('[OK] Connected successfully\n');

    // Wait a moment for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Discover tools
    console.log('4. Discovering tools from server...');
    const tools = await manager.discoverServerTools('filesystem');
    console.log(`[OK] Discovered ${tools.length} tools:`);
    tools.forEach((tool, index) => {
      console.log(` ${index + 1}. ${tool.name} - ${tool.description || 'No description'}`);
    });
    console.log('');

    // 5. Discover resources
    console.log('5. Discovering resources from server...');
    try {
      const resources = await manager.discoverServerResources('filesystem');
      console.log(`[OK] Discovered ${resources.length} resources`);
      if (resources.length > 0) {
        resources.forEach((resource, index) => {
          console.log(` ${index + 1}. ${resource.uri} - ${resource.name || 'No name'}`);
        });
      }
    } catch (error: any) {
      if (error.message.includes('Method not found')) {
        console.log(' ⚠  Server does not support resources (this is OK)');
      } else {
        throw error;
      }
    }
    console.log('');

    // 6. Get all tools from manager
    console.log('6. Getting all tools from manager...');
    const allTools = manager.getAllTools();
    console.log(`[OK] Manager reports ${allTools.length} total tools\n`);

    // 7. Test tool execution
    console.log('7. Testing tool execution...');
    if (tools.length > 0) {
      // Try to find list_allowed_directories tool
      const listDirTool = tools.find(t => t.name === 'list_allowed_directories');

      if (listDirTool) {
        console.log(' Executing: list_allowed_directories');
        const result = await manager.callTool('filesystem', 'list_allowed_directories', {});
        console.log(' Result:', JSON.stringify(result, null, 2));
        console.log('[OK] Tool execution successful\n');
      } else {
        console.log(' ⚠  list_allowed_directories tool not found');
        console.log(' Available tools:', tools.map(t => t.name).join(', '));
        console.log('');
      }
    }

    // 8. Get server info
    console.log('8. Getting server information...');
    const serverInfo = manager.getServerInfo();
    console.log('[OK] Server info:');
    serverInfo.forEach(info => {
      console.log(` - ${info.name}: ${info.status} (${info.toolCount} tools, ${info.resourceCount} resources)`);
    });
    console.log('');

    // 9. Cleanup
    console.log('9. Cleaning up...');
    await manager.cleanup();
    console.log('[OK] Cleanup complete\n');

    console.log('=== [OK] All Tests Passed! ===');
    return true;

  } catch (error) {
    console.error('\n[ERROR] Test failed with error:');
    console.error(error);
    return false;
  }
}

// Run the test
console.log('Starting MCP integration test...\n');
testMcpIntegration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
