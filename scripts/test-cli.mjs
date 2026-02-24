#!/usr/bin/env node
/**
 * CLI Basic Tests
 * Tests core CLI functionality: init, task CRUD, doc CRUD, search
 */

import { spawn, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const TIMEOUT_MS = 120000; // 2 minutes
let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

// Test project directory
const testProjectDir = process.env.TEST_PROJECT_PATH || join(projectRoot, 'test-project-cli');

/**
 * Run CLI command and return output
 */
function runCli(args, options = {}) {
  const cliPath = join(projectRoot, 'dist/index.js');
  const cmd = `node "${cliPath}" ${args}`;

  try {
    const output = execSync(cmd, {
      cwd: options.cwd || testProjectDir,
      encoding: 'utf-8',
      timeout: options.timeout || 30000,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: output.trim(), code: 0 };
  } catch (error) {
    return {
      success: false,
      output: error.stdout?.toString()?.trim() || '',
      error: error.stderr?.toString()?.trim() || error.message,
      code: error.status || 1
    };
  }
}

/**
 * Run test with logging
 */
async function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('✅');
    testsPassed++;
    return true;
  } catch (error) {
    console.log(`❌ ${error.message}`);
    testsFailed++;
    failedTests.push(name);
    return false;
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('=== CLI Basic Tests ===\n');

  // Check if built
  const cliPath = join(projectRoot, 'dist/index.js');
  if (!existsSync(cliPath)) {
    console.error('❌ dist/index.js not found. Run `npm run build` first.');
    process.exit(1);
  }

  // Setup test project directory
  console.log('[Setup] Creating test project directory...');
  if (existsSync(testProjectDir)) {
    rmSync(testProjectDir, { recursive: true, force: true });
  }
  mkdirSync(testProjectDir, { recursive: true });

  // Initialize git (required for knowns init)
  execSync('git init', { cwd: testProjectDir, stdio: 'pipe' });
  console.log(`  Test directory: ${testProjectDir}\n`);

  try {
    // =========================================================
    // SECTION 1: CLI Basics
    // =========================================================
    console.log('[1] CLI Basics');

    await test('--version', async () => {
      const result = runCli('--version');
      if (!result.success) throw new Error(result.error);
      if (!result.output.match(/\d+\.\d+\.\d+/)) {
        throw new Error(`Invalid version: ${result.output}`);
      }
    });

    await test('--help', async () => {
      const result = runCli('--help');
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('knowns')) {
        throw new Error('Help output missing expected content');
      }
    });

    // =========================================================
    // SECTION 2: Project Initialization
    // =========================================================
    console.log('\n[2] Project Initialization');

    await test('knowns init', async () => {
      const result = runCli('init test-cli-project --no-wizard');
      if (!result.success) throw new Error(result.error);
      if (!existsSync(join(testProjectDir, '.knowns'))) {
        throw new Error('.knowns folder not created');
      }
      if (!existsSync(join(testProjectDir, '.knowns/config.json'))) {
        throw new Error('config.json not created');
      }
    });

    // =========================================================
    // SECTION 3: Task Operations
    // =========================================================
    console.log('\n[3] Task Operations');

    let task1Id, task2Id;

    await test('task create (basic)', async () => {
      const result = runCli('task create "CLI Test Task 1" -d "Description 1" --priority high');
      if (!result.success) throw new Error(result.error);
      const match = result.output.match(/task-([a-z0-9]+)/i);
      if (!match) throw new Error('No task ID in output');
      task1Id = match[0];
      console.log(`\n    → Created: ${task1Id}`);
    });

    await test('task create (with AC & labels)', async () => {
      const result = runCli('task create "CLI Test Task 2" -d "Description 2" --ac "Criterion 1" --ac "Criterion 2" -l "test,cli"');
      if (!result.success) throw new Error(result.error);
      const match = result.output.match(/task-([a-z0-9]+)/i);
      if (!match) throw new Error('No task ID in output');
      task2Id = match[0];
      console.log(`\n    → Created: ${task2Id}`);
    });

    await test('task create (subtask)', async () => {
      const parentRawId = task1Id.replace('task-', '');
      const result = runCli(`task create "Subtask of Task 1" -d "This is a subtask" --parent "${parentRawId}"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task list', async () => {
      const result = runCli('task list --plain');
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('CLI Test Task 1')) {
        throw new Error('Task 1 not found in list');
      }
    });

    await test('task list --tree', async () => {
      const result = runCli('task list --tree --plain');
      if (!result.success) throw new Error(result.error);
    });

    await test('task view', async () => {
      const result = runCli(`task "${task1Id}" --plain`);
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('CLI Test Task 1')) {
        throw new Error('Task title not in output');
      }
    });

    await test('task edit (status)', async () => {
      const result = runCli(`task edit "${task1Id}" -s in-progress`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task edit (assignee)', async () => {
      const result = runCli(`task edit "${task1Id}" -a "@me"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task edit (add AC)', async () => {
      const result = runCli(`task edit "${task1Id}" --ac "New criterion"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task edit (check AC)', async () => {
      const result = runCli(`task edit "${task1Id}" --check-ac 1`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task edit (plan)', async () => {
      const result = runCli(`task edit "${task1Id}" --plan "1. Step one\\n2. Step two"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task edit (append notes)', async () => {
      const result = runCli(`task edit "${task1Id}" --append-notes "Progress update"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task list --status', async () => {
      const result = runCli('task list --status in-progress --plain');
      if (!result.success) throw new Error(result.error);
      // Output format: "In Progress:\n  [HIGH] task-xxx - Title"
      if (!result.output.includes('In Progress') || !result.output.includes('CLI Test Task 1')) {
        throw new Error('Task not found with status filter');
      }
    });

    // =========================================================
    // SECTION 4: Doc Operations
    // =========================================================
    console.log('\n[4] Doc Operations');

    await test('doc create (root)', async () => {
      const result = runCli('doc create "README" -d "Project README" -t "core"');
      if (!result.success) throw new Error(result.error);
    });

    await test('doc create (with folder)', async () => {
      const result = runCli('doc create "Architecture" -d "System architecture" -t "core" -f "guides"');
      if (!result.success) throw new Error(result.error);
    });

    await test('doc list', async () => {
      const result = runCli('doc list --plain');
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('README') && !result.output.includes('readme')) {
        throw new Error('README not found in list');
      }
    });

    await test('doc list --tag', async () => {
      const result = runCli('doc list --tag core --plain');
      if (!result.success) throw new Error(result.error);
    });

    await test('doc view', async () => {
      const result = runCli('doc "readme" --plain');
      if (!result.success) throw new Error(result.error);
    });

    await test('doc edit (content)', async () => {
      const result = runCli('doc edit "readme" -c "# Test Project\\n\\nThis is a test."');
      if (!result.success) throw new Error(result.error);
    });

    await test('doc edit (append)', async () => {
      const result = runCli('doc edit "readme" -a "\\n\\n## More Content\\n\\nAppended section."');
      if (!result.success) throw new Error(result.error);
    });

    // =========================================================
    // SECTION 5: Search
    // =========================================================
    console.log('\n[5] Search Operations');

    await test('search (all)', async () => {
      const result = runCli('search "test" --plain');
      if (!result.success) throw new Error(result.error);
    });

    await test('search --type task (find tasks)', async () => {
      const result = runCli('search "CLI Test" --type task --plain');
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('Tasks:')) {
        throw new Error('Expected to find at least 1 task');
      }
    });

    await test('search --type doc (find docs)', async () => {
      const result = runCli('search "README" --type doc --plain');
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('Docs:')) {
        throw new Error('Expected to find at least 1 doc');
      }
    });

    // =========================================================
    // SECTION 6: Time Tracking
    // =========================================================
    console.log('\n[6] Time Tracking');

    await test('time start', async () => {
      const result = runCli(`time start "${task1Id}"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('time status', async () => {
      const result = runCli('time status');
      if (!result.success) throw new Error(result.error);
    });

    await test('time stop', async () => {
      const result = runCli('time stop');
      if (!result.success) throw new Error(result.error);
    });

    await test('time add', async () => {
      const result = runCli(`time add "${task1Id}" 30m -n "Manual entry"`);
      if (!result.success) throw new Error(result.error);
    });

    await test('time report', async () => {
      const result = runCli('time report');
      if (!result.success) throw new Error(result.error);
    });

    // =========================================================
    // SECTION 7: Config
    // =========================================================
    console.log('\n[7] Config Operations');

    await test('config list', async () => {
      const result = runCli('config list');
      if (!result.success) throw new Error(result.error);
    });

    await test('config set', async () => {
      const result = runCli('config set defaultPriority high');
      if (!result.success) throw new Error(result.error);
    });

    await test('config get', async () => {
      const result = runCli('config get defaultPriority --plain');
      if (!result.success) throw new Error(result.error);
      if (!result.output.includes('high')) {
        throw new Error('Config value not set correctly');
      }
    });

    // =========================================================
    // SECTION 8: Template
    // =========================================================
    console.log('\n[8] Template Operations');

    await test('template list', async () => {
      const result = runCli('template list');
      // May return empty, that's OK
      if (!result.success && !result.output.includes('No templates')) {
        throw new Error(result.error);
      }
    });

    await test('template create', async () => {
      const result = runCli('template create test-template -d "Test template"');
      if (!result.success) throw new Error(result.error);
    });

    await test('template view', async () => {
      const result = runCli('template view test-template');
      if (!result.success) throw new Error(result.error);
    });

    // =========================================================
    // SECTION 9: Validate
    // =========================================================
    console.log('\n[9] Validation');

    await test('validate', async () => {
      const result = runCli('validate');
      // May have warnings, but should not fail completely
      if (result.code > 1) throw new Error(result.error);
    });

    // =========================================================
    // SECTION 10: Board
    // =========================================================
    console.log('\n[10] Board');

    await test('board', async () => {
      const result = runCli('board');
      if (!result.success) throw new Error(result.error);
    });

    // =========================================================
    // SECTION 11: Task Completion Flow
    // =========================================================
    console.log('\n[11] Task Completion Flow');

    await test('task edit (notes)', async () => {
      const result = runCli(`task edit "${task1Id}" --notes "## Summary\\nCompleted test task."`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task edit (done)', async () => {
      const result = runCli(`task edit "${task1Id}" -s done`);
      if (!result.success) throw new Error(result.error);
    });

    await test('task list --status done', async () => {
      const result = runCli('task list --status done --plain');
      if (!result.success) throw new Error(result.error);
      // Output format: "Done:\n  [HIGH] task-xxx - Title"
      if (!result.output.includes('Done') || !result.output.includes('CLI Test Task 1')) {
        throw new Error('Completed task not found');
      }
    });

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    testsFailed++;
  }

  // =========================================================
  // CLEANUP
  // =========================================================
  console.log('\n[Cleanup] Removing test project...');
  try {
    rmSync(testProjectDir, { recursive: true, force: true });
    console.log('  Deleted test project directory');
  } catch (error) {
    console.log(`  Cleanup warning: ${error.message}`);
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  if (failedTests.length > 0) {
    console.log('\nFailed tests:');
    for (const name of failedTests) {
      console.log(`  - ${name}`);
    }
  }

  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All CLI basic tests passed!');
    process.exit(0);
  }
}

const timeoutId = setTimeout(() => {
  console.error('\n❌ Test suite timed out!');
  process.exit(1);
}, TIMEOUT_MS);

main().finally(() => clearTimeout(timeoutId));
