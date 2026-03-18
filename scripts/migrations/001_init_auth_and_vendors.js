const { execSync } = require('node:child_process');
require('dotenv').config();

function run(command) {
  execSync(command, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
}

try {
  run('npx prisma migrate deploy');
  if (process.argv.includes('--seed')) {
    run('npx tsx prisma/seed.ts');
  }
  console.log('Prisma migration flow completed successfully');
} catch (error) {
  console.error('Prisma migration flow failed:', error);
  process.exit(1);
}
