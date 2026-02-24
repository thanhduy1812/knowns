#!/usr/bin/env node
/**
 * MCP Server Basic Tests
 * Tests core MCP functionality: protocol, tools, basic operations
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const TIMEOUT_MS = 30000;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Send JSON-RPC request to MCP server
 */
async function sendMcpRequest(serverProcess, request, description) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for response: ${description}`));
    }, 10000);

    let buffer = '';
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              serverProcess.stdout.removeListener('data', onData);
              resolve(response);
              return;
            }
          } catch { /* continue */ }
        }
      }
    };

    serverProcess.stdout.on('data', onData);
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
  });
}

/**
 * Run a single test
 */
async function runTest(serverProcess, name, request, validator) {
  process.stdout.write(`  Testing ${name}... `);
  try {
    const response = await sendMcpRequest(serverProcess, request, name);

    if (response.error) {
      throw new Error(`MCP Error: ${response.error.message}`);
    }

    if (validator) {
      validator(response);
    }

    console.log('✅');
    testsPassed++;
    return response;
  } catch (error) {
    console.log(`❌ ${error.message}`);
    testsFailed++;
    return null;
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('=== MCP Server Basic Tests ===\n');

  const useBuilt = process.argv.includes('--built');
  const serverCmd = useBuilt
    ? ['node', [join(projectRoot, 'dist/mcp/server.js')]]
    : ['npx', ['tsx', '--import', './scripts/md-loader.mjs', 'src/mcp/server.ts']];

  console.log(`Starting MCP server (${useBuilt ? 'built' : 'dev'} mode)...`);

  const serverProcess = spawn(serverCmd[0], serverCmd[1], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' }
  });

  let stderrOutput = '';
  serverProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    // Test 1: Initialize
    console.log('\n[1] Protocol Initialization');
    await runTest(serverProcess, 'initialize', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-test', version: '1.0.0' }
      }
    }, (response) => {
      if (!response.result?.serverInfo?.name) {
        throw new Error('Missing serverInfo in initialize response');
      }
    });

    // Test 2: List tools
    console.log('\n[2] Tools Discovery');
    const toolsResponse = await runTest(serverProcess, 'tools/list', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }, (response) => {
      if (!Array.isArray(response.result?.tools)) {
        throw new Error('Expected tools array in response');
      }
      if (response.result.tools.length === 0) {
        throw new Error('No tools returned');
      }
    });

    if (toolsResponse) {
      const toolNames = toolsResponse.result.tools.map(t => t.name);
      console.log(`    Found ${toolNames.length} tools: ${toolNames.slice(0, 5).join(', ')}...`);

      const essentialTools = ['detect_projects', 'create_task', 'list_tasks', 'get_doc', 'search'];
      for (const tool of essentialTools) {
        if (!toolNames.includes(tool)) {
          console.log(`    ⚠️  Missing essential tool: ${tool}`);
        }
      }
    }

    // Test 3: Detect projects
    console.log('\n[3] Project Detection');
    await runTest(serverProcess, 'detect_projects', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'detect_projects',
        arguments: {}
      }
    }, (response) => {
      const content = response.result?.content?.[0];
      if (!content || content.type !== 'text') {
        throw new Error('Expected text content in response');
      }
      const result = JSON.parse(content.text);
      if (!Array.isArray(result.projects)) {
        throw new Error('Expected projects array');
      }
    });

    // Test 4: Set project
    console.log('\n[4] Project Setup');
    const testProjectPath = process.env.TEST_PROJECT_PATH || projectRoot;

    await runTest(serverProcess, 'set_project', {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'set_project',
        arguments: { projectRoot: testProjectPath }
      }
    }, (response) => {
      const content = response.result?.content?.[0];
      if (!content) throw new Error('No content in response');
      const result = JSON.parse(content.text);
      if (!result.success) {
        throw new Error(`Failed to set project: ${result.error || 'unknown error'}`);
      }
    });

    await runTest(serverProcess, 'get_current_project', {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'get_current_project',
        arguments: {}
      }
    }, (response) => {
      const content = response.result?.content?.[0];
      if (!content) throw new Error('No content in response');
      const result = JSON.parse(content.text);
      if (!result.projectRoot) throw new Error('No projectRoot in response');
    });

    // Test 5: Task operations
    console.log('\n[5] Task Operations');

    await runTest(serverProcess, 'list_tasks', {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'list_tasks', arguments: {} }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (!Array.isArray(result.tasks)) throw new Error('Expected tasks array');
    });

    const createTaskResponse = await runTest(serverProcess, 'create_task', {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'create_task',
        arguments: {
          title: 'MCP Basic Test Task',
          description: 'Created by MCP basic test',
          priority: 'medium',
          labels: ['test', 'mcp']
        }
      }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (!result.task?.id) throw new Error('No task ID in response');
    });

    if (createTaskResponse) {
      const taskId = JSON.parse(createTaskResponse.result.content[0].text).task.id;

      await runTest(serverProcess, 'get_task', {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'get_task', arguments: { taskId } }
      }, (response) => {
        const result = JSON.parse(response.result.content[0].text);
        if (result.task?.id !== taskId) throw new Error('Task ID mismatch');
      });

      await runTest(serverProcess, 'update_task', {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'update_task',
          arguments: { taskId, status: 'in-progress' }
        }
      }, (response) => {
        const result = JSON.parse(response.result.content[0].text);
        if (!result.success) throw new Error('Update failed');
      });

      // Cleanup
      await runTest(serverProcess, 'update_task (cleanup)', {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'update_task',
          arguments: { taskId, status: 'done' }
        }
      });
    }

    // Test 6: Doc operations
    console.log('\n[6] Documentation Operations');

    await runTest(serverProcess, 'list_docs', {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'list_docs', arguments: {} }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (!Array.isArray(result.docs)) throw new Error('Expected docs array');
    });

    // Test 7: Search
    console.log('\n[7] Search Operations');

    await runTest(serverProcess, 'search', {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'test', type: 'all' }
      }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (!result.tasks || !result.docs) {
        throw new Error('Expected tasks and docs in response');
      }
    });

    // Test 8: Validation
    console.log('\n[8] Validation');

    await runTest(serverProcess, 'validate', {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'validate', arguments: { scope: 'all' } }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (typeof result.valid !== 'boolean') {
        throw new Error('Expected valid boolean in response');
      }
    });

    // Test 9: Board
    console.log('\n[9] Board Operations');

    await runTest(serverProcess, 'get_board', {
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'get_board', arguments: {} }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (!result.board) throw new Error('Expected board in response');
    });

    // Test 10: Templates
    console.log('\n[10] Template Operations');

    await runTest(serverProcess, 'list_templates', {
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: { name: 'list_templates', arguments: {} }
    }, (response) => {
      const result = JSON.parse(response.result.content[0].text);
      if (!Array.isArray(result.templates)) {
        throw new Error('Expected templates array');
      }
    });

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    if (stderrOutput) {
      console.error('\nServer stderr:', stderrOutput);
    }
    testsFailed++;
  }

  // Kill server
  serverProcess.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Cleanup test tasks
  console.log('\n[Cleanup] Removing test data...');
  try {
    const testProjectPath = process.env.TEST_PROJECT_PATH || projectRoot;
    const tasksDir = join(testProjectPath, '.knowns', 'tasks');
    const { readdirSync, unlinkSync, readFileSync, existsSync } = await import('node:fs');

    if (existsSync(tasksDir)) {
      const taskFiles = readdirSync(tasksDir);
      let deletedTasks = 0;

      for (const file of taskFiles) {
        if (file.endsWith('.md')) {
          const filePath = join(tasksDir, file);
          const content = readFileSync(filePath, 'utf-8');

          if (content.includes('MCP Basic Test Task')) {
            unlinkSync(filePath);
            deletedTasks++;
          }
        }
      }
      if (deletedTasks > 0) {
        console.log(`  Deleted ${deletedTasks} test tasks`);
      }
    }
  } catch (error) {
    console.log(`  Cleanup warning: ${error.message}`);
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);

  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All MCP basic tests passed!');
    process.exit(0);
  }
}

const timeoutId = setTimeout(() => {
  console.error('\n❌ Test suite timed out!');
  process.exit(1);
}, TIMEOUT_MS);

main().finally(() => clearTimeout(timeoutId));
