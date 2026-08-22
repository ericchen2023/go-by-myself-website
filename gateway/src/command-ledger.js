import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class CommandLedger {
  /** @param {string} directory */
  constructor(directory) {
    this.directory = directory;
    this.file = join(directory, 'processed-commands.json');
    this.records = new Map();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try {
      const stored = JSON.parse(await readFile(this.file, 'utf8'));
      this.records = new Map(Array.isArray(stored) ? stored : []);
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }

  /** @param {string} commandId */
  get(commandId) {
    return this.records.get(commandId) ?? null;
  }

  /** @param {string} commandId @param {Record<string, unknown>} result */
  async record(commandId, result) {
    this.records.set(commandId, result);
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify([...this.records.entries()], null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }
}

