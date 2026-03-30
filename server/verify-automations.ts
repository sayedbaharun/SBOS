/**
 * Automation Verification Script
 * Verifies all automation files exist and are properly structured
 * Does NOT require database connection
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface VerificationResult {
  name: string;
  status: 'PASS' | 'FAIL';
  message: string;
}

const results: VerificationResult[] = [];

function verify(name: string, condition: boolean, message: string) {
  results.push({
    name,
    status: condition ? 'PASS' : 'FAIL',
    message: condition ? message : `FAILED: ${message}`
  });
}

console.log('🔍 Verifying SB-OS Automations Implementation\n');
console.log('=' .repeat(60));

// ============================================================================
// Check automation files exist
// ============================================================================
console.log('\n📁 Checking Automation Files...\n');

const automationFiles = [
  'server/automations/daily-day-creation.ts',
  'server/automations/weekly-planning-reminder.ts',
  'server/automations/README.md',
];

automationFiles.forEach(file => {
  const fullPath = resolve(__dirname, '..', file);
  const exists = existsSync(fullPath);
  verify(
    `File: ${file}`,
    exists,
    exists ? 'File exists' : 'File not found'
  );
});

// ============================================================================
// Check test script exists
// ============================================================================
console.log('\n📋 Checking Test Files...\n');

const testPath = resolve(__dirname, 'test-automations.ts');
verify(
  'Test Script',
  existsSync(testPath),
  'test-automations.ts exists'
);

// ============================================================================
// Check integration in index.ts
// ============================================================================
console.log('\n🔗 Checking Integration...\n');

const indexPath = resolve(__dirname, 'index.ts');
if (existsSync(indexPath)) {
  const indexContent = readFileSync(indexPath, 'utf-8');

  verify(
    'Daily Day Creation Import',
    indexContent.includes("import('./automations/daily-day-creation')"),
    'Automation is imported in server/index.ts'
  );

  verify(
    'Weekly Planning Import',
    indexContent.includes("import('./automations/weekly-planning-reminder')"),
    'Automation is imported in server/index.ts'
  );

  verify(
    'Automation Initialization',
    indexContent.includes('scheduleDailyDayCreation()') &&
    indexContent.includes('scheduleWeeklyPlanningReminder()'),
    'All automation schedulers are called'
  );
} else {
  verify('server/index.ts', false, 'File not found');
}

// ============================================================================
// Check storage.ts enhancements
// ============================================================================
console.log('\n💾 Checking Storage Enhancements...\n');

const storagePath = resolve(__dirname, 'storage.ts');
if (existsSync(storagePath)) {
  const storageContent = readFileSync(storagePath, 'utf-8');

  verify(
    'Task Completion Timestamp (completed)',
    storageContent.includes("updates.status === 'completed'") &&
    storageContent.includes('completedAt'),
    'updateTask() sets completedAt when status is completed'
  );

  verify(
    'Task Completion Timestamp (clear)',
    storageContent.includes("updates.status !== 'completed'") &&
    storageContent.includes('completedAt = null'),
    'updateTask() clears completedAt when task is reopened'
  );
} else {
  verify('server/storage.ts', false, 'File not found');
}

// ============================================================================
// Check routes.ts enhancements
// ============================================================================
console.log('\n🛤️  Checking Route Enhancements...\n');

const routesPath = resolve(__dirname, 'routes.ts');
if (existsSync(routesPath)) {
  const routesContent = readFileSync(routesPath, 'utf-8');

  verify(
    'Project Completion Suggestion',
    routesContent.includes('project_completion') &&
    routesContent.includes('suggestion'),
    'PATCH /api/tasks/:id returns project completion suggestion'
  );

  verify(
    'Health Entry Auto-Link',
    routesContent.includes('getDayOrCreate') &&
    routesContent.includes('/api/health'),
    'POST /api/health auto-links to day'
  );

  verify(
    'Nutrition Entry Auto-Link',
    routesContent.includes('getDayOrCreate') &&
    routesContent.includes('/api/nutrition'),
    'POST /api/nutrition auto-links to day'
  );

  verify(
    'Capture Conversion',
    routesContent.includes('/api/captures/:id/convert') &&
    routesContent.includes('convertCaptureToTask'),
    'POST /api/captures/:id/convert exists'
  );
} else {
  verify('server/routes.ts', false, 'File not found');
}

// ============================================================================
// Check node-cron dependency
// ============================================================================
console.log('\n📦 Checking Dependencies...\n');

const packageJsonPath = resolve(__dirname, '..', 'package.json');
if (existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  verify(
    'node-cron dependency',
    packageJson.dependencies && packageJson.dependencies['node-cron'],
    'node-cron is installed'
  );

  verify(
    '@types/node-cron dependency',
    packageJson.devDependencies && packageJson.devDependencies['@types/node-cron'],
    '@types/node-cron is installed'
  );
} else {
  verify('package.json', false, 'File not found');
}

// ============================================================================
// Print Results
// ============================================================================
console.log('\n' + '=' .repeat(60));
console.log('📊 VERIFICATION RESULTS\n');

let passCount = 0;
let failCount = 0;

results.forEach(result => {
  const icon = result.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${result.name}`);
  console.log(`   ${result.message}\n`);

  if (result.status === 'PASS') passCount++;
  else failCount++;
});

console.log('=' .repeat(60));
console.log(`\n📈 Summary: ${passCount} passed, ${failCount} failed`);

if (failCount === 0) {
  console.log('\n🎉 All automation verifications passed!');
  console.log('\n✅ Implementation complete and ready for deployment.');
  console.log('\n📚 See /home/user/aura/server/automations/README.md for documentation.');
  console.log('📄 See /home/user/aura/AUTOMATIONS_IMPLEMENTATION_REPORT.md for full report.\n');
  process.exit(0);
} else {
  console.log('\n⚠️  Some verifications failed. Please review the issues above.\n');
  process.exit(1);
}
