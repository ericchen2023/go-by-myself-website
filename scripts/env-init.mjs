import { copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';

try {
  await copyFile('.env.example', '.env.local', constants.COPYFILE_EXCL);
  process.stdout.write('Created .env.local from .env.example. Existing files are never overwritten.\n');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    process.stdout.write('.env.local already exists; left unchanged.\n');
  } else {
    throw error;
  }
}

