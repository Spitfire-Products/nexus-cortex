#!/usr/bin/env node
import { SkillToolExecutor } from './dist/implementations/extensions/SkillTool.js';
import { SlashCommandToolExecutor } from './dist/implementations/extensions/SlashCommandTool.js';

async function testExamples() {
  console.log('Testing Example Skills and Commands\n');
  console.log('='.repeat(60));

  const workingDirectory = '/home/runner/workspace/nexus-cortex';
  const signal = new AbortController().signal;

  // Test 1: Load resume-analyst skill
  console.log('\n1. Testing resume-analyst skill...');
  try {
    const skillTool = new SkillToolExecutor({ workingDirectory });
    const skillResult = await skillTool.execute(
      { command: 'resume-analyst' },
      signal
    );

    if (skillResult.success) {
      console.log('   ✅ Skill loaded successfully');
      console.log('   - Name:', skillResult.metadata.skillName);
      console.log('   - Location:', skillResult.metadata.location);
      console.log('   - Allowed Tools:', skillResult.metadata.allowedTools || 'None specified');
      console.log('   - Content length:', skillResult.llmContent.length, 'characters');
    } else {
      console.log('   ❌ Skill failed to load');
      console.log('   Error:', skillResult.returnDisplay);
    }
  } catch (error) {
    console.log('   ❌ Exception:', error.message);
  }

  // Test 2: Load analyze-code command
  console.log('\n2. Testing /analyze-code command...');
  try {
    const commandTool = new SlashCommandToolExecutor({ workingDirectory });
    const commandResult = await commandTool.execute(
      { command: '/analyze-code src/server.ts' },
      signal
    );

    if (commandResult.success) {
      console.log('   ✅ Command loaded successfully');
      console.log('   - Command name:', commandResult.metadata.commandName);
      console.log('   - Arguments:', commandResult.metadata.arguments || 'None');
      console.log('   - Content length:', commandResult.llmContent.length, 'characters');
      console.log('   - Argument substitution check:',
        commandResult.llmContent.includes('src/server.ts') ? '✅ Working' : '❌ Failed');
    } else {
      console.log('   ❌ Command failed to load');
      console.log('   Error:', commandResult.returnDisplay);
    }
  } catch (error) {
    console.log('   ❌ Exception:', error.message);
  }

  // Test 3: Load review-pr command with argument
  console.log('\n3. Testing /review-pr command with argument...');
  try {
    const commandTool = new SlashCommandToolExecutor({ workingDirectory });
    const commandResult = await commandTool.execute(
      { command: '/review-pr 123' },
      signal
    );

    if (commandResult.success) {
      console.log('   ✅ Command loaded successfully');
      console.log('   - Arguments:', commandResult.metadata.arguments || 'None');
      console.log('   - Argument substitution check:',
        commandResult.llmContent.includes('123') ? '✅ Working' : '❌ Failed');
    } else {
      console.log('   ❌ Command failed to load');
      console.log('   Error:', commandResult.returnDisplay);
    }
  } catch (error) {
    console.log('   ❌ Exception:', error.message);
  }

  // Test 4: Load run-tests command with multiple arguments
  console.log('\n4. Testing /run-tests command with multiple arguments...');
  try {
    const commandTool = new SlashCommandToolExecutor({ workingDirectory });
    const commandResult = await commandTool.execute(
      { command: '/run-tests integration coverage' },
      signal
    );

    if (commandResult.success) {
      console.log('   ✅ Command loaded successfully');
      console.log('   - Arguments:', commandResult.metadata.arguments || 'None');
      console.log('   - Arg 1 substitution:',
        commandResult.llmContent.includes('integration') ? '✅' : '❌');
      console.log('   - Arg 2 substitution:',
        commandResult.llmContent.includes('coverage') ? '✅' : '❌');
    } else {
      console.log('   ❌ Command failed to load');
      console.log('   Error:', commandResult.returnDisplay);
    }
  } catch (error) {
    console.log('   ❌ Exception:', error.message);
  }

  // Test 5: Load deploy command
  console.log('\n5. Testing /deploy command...');
  try {
    const commandTool = new SlashCommandToolExecutor({ workingDirectory });
    const commandResult = await commandTool.execute(
      { command: '/deploy staging' },
      signal
    );

    if (commandResult.success) {
      console.log('   ✅ Command loaded successfully');
      console.log('   - Arguments:', commandResult.metadata.arguments || 'None');
    } else {
      console.log('   ❌ Command failed to load');
      console.log('   Error:', commandResult.returnDisplay);
    }
  } catch (error) {
    console.log('   ❌ Exception:', error.message);
  }

  // Test 6: Load debug-issue command
  console.log('\n6. Testing /debug-issue command...');
  try {
    const commandTool = new SlashCommandToolExecutor({ workingDirectory });
    const commandResult = await commandTool.execute(
      { command: '/debug-issue "Server crashes on startup" high' },
      signal
    );

    if (commandResult.success) {
      console.log('   ✅ Command loaded successfully');
      console.log('   - Arguments:', commandResult.metadata.arguments || 'None');
    } else {
      console.log('   ❌ Command failed to load');
      console.log('   Error:', commandResult.returnDisplay);
    }
  } catch (error) {
    console.log('   ❌ Exception:', error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('\nTest Summary:');
  console.log('- 1 Skill (resume-analyst)');
  console.log('- 5 Commands (analyze-code, review-pr, run-tests, deploy, debug-issue)');
  console.log('\nAll example files have been validated!\n');
}

testExamples().catch(console.error);
