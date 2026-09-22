import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';
import { ZipFile } from 'yazl';

import { extractZipSafely } from './safeZipExtractor';

type ZipEntry = {
  name: string;
  content: string;
  mode?: number;
};

const temporaryDirectories: string[] = [];

const makeTempDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-safe-zip-test-'));
  temporaryDirectories.push(directory);
  return directory;
};

const writeZip = async (archivePath: string, entries: ZipEntry[]): Promise<void> => {
  const zipFile = new ZipFile();
  for (const entry of entries) {
    zipFile.addBuffer(Buffer.from(entry.content), entry.name, {
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
    });
  }
  await new Promise<void>((resolve, reject) => {
    zipFile.outputStream
      .pipe(fs.createWriteStream(archivePath))
      .once('close', resolve)
      .once('error', reject);
    zipFile.end();
  });
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('extracts regular files and directories', async () => {
  const root = makeTempDirectory();
  const archivePath = path.join(root, 'regular.zip');
  const destination = path.join(root, 'output');
  await writeZip(archivePath, [
    { name: 'package/manifest.json', content: '{"name":"demo"}' },
    { name: 'package/src/index.js', content: 'export default true;\n' },
  ]);

  await extractZipSafely(archivePath, destination);

  expect(fs.readFileSync(path.join(destination, 'package', 'manifest.json'), 'utf8')).toBe(
    '{"name":"demo"}',
  );
  expect(fs.readFileSync(path.join(destination, 'package', 'src', 'index.js'), 'utf8')).toBe(
    'export default true;\n',
  );
});

test('rejects a symlink entry before it can write outside the extraction directory', async () => {
  const root = makeTempDirectory();
  const archivePath = path.join(root, 'symlink-escape.zip');
  const destination = path.join(root, 'output');
  const victimPath = path.join(root, 'victim.txt');
  fs.writeFileSync(victimPath, 'safe');
  await writeZip(archivePath, [
    { name: 'escape', content: '../victim.txt', mode: 0o120777 },
    { name: 'escape', content: 'overwritten' },
  ]);

  await expect(extractZipSafely(archivePath, destination)).rejects.toThrow(
    'cannot contain symbolic links',
  );

  expect(fs.readFileSync(victimPath, 'utf8')).toBe('safe');
  expect(fs.readdirSync(destination)).toEqual([]);
});

test('rejects duplicate regular-file entries instead of overwriting extracted files', async () => {
  const root = makeTempDirectory();
  const archivePath = path.join(root, 'duplicate.zip');
  const destination = path.join(root, 'output');
  await writeZip(archivePath, [
    { name: 'duplicate.txt', content: 'first' },
    { name: 'duplicate.txt', content: 'second' },
  ]);

  await expect(extractZipSafely(archivePath, destination)).rejects.toThrow('duplicate entry');
  expect(fs.readFileSync(path.join(destination, 'duplicate.txt'), 'utf8')).toBe('first');
});

test('rejects Windows path aliases that could escape or overwrite another entry', async () => {
  const root = makeTempDirectory();
  const archivePath = path.join(root, 'unsafe-name.zip');
  const destination = path.join(root, 'output');
  await writeZip(archivePath, [{ name: 'package/file.txt:stream', content: 'unsafe' }]);

  await expect(extractZipSafely(archivePath, destination)).rejects.toThrow('Unsafe ZIP entry path');
});
