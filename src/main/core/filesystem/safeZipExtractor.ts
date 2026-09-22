import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_ARCHIVE_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const REGULAR_FILE_TYPE = 0o100000;
const SYMBOLIC_LINK_TYPE = 0o120000;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const openZip = (archivePath: string): Promise<ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error) {
          reject(error);
        } else if (!zipFile) {
          reject(new Error('ZIP archive could not be opened.'));
        } else {
          resolve(zipFile);
        }
      },
    );
  });

const openEntryStream = (zipFile: ZipFile, entry: Entry): Promise<Readable> =>
  new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
      } else if (!stream) {
        reject(new Error(`ZIP entry could not be read: ${entry.fileName}`));
      } else {
        resolve(stream);
      }
    });
  });

const normalizeEntrySegments = (entryName: string): string[] => {
  if (
    !entryName ||
    entryName.includes('\0') ||
    entryName.includes('\\') ||
    entryName.startsWith('/') ||
    entryName.startsWith('//') ||
    /^[a-z]:/i.test(entryName)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }

  const segments = entryName.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  for (const segment of segments) {
    if (
      segment === '.' ||
      segment === '..' ||
      segment.includes(':') ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      WINDOWS_RESERVED_NAME_PATTERN.test(segment)
    ) {
      throw new Error(`Unsafe ZIP entry path: ${entryName}`);
    }
  }
  return segments;
};

const ensureSafeDirectory = async (rootDirectory: string, segments: string[]): Promise<string> => {
  let currentDirectory = rootDirectory;
  for (const segment of segments) {
    currentDirectory = path.join(currentDirectory, segment);
    try {
      await fs.promises.mkdir(currentDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stats = await fs.promises.lstat(currentDirectory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Unsafe ZIP directory entry: ${segments.join('/')}`);
    }
  }
  return currentDirectory;
};

const extractEntry = async (
  zipFile: ZipFile,
  entry: Entry,
  rootDirectory: string,
  seenPaths: Set<string>,
): Promise<void> => {
  if (entry.fileName.startsWith('__MACOSX/')) return;

  const segments = normalizeEntrySegments(entry.fileName);
  const destinationPath = path.resolve(rootDirectory, ...segments);
  const relativePath = path.relative(rootDirectory, destinationPath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`ZIP entry escapes the extraction directory: ${entry.fileName}`);
  }

  const pathKey = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath;
  if (seenPaths.has(pathKey)) {
    throw new Error(`ZIP archive contains a duplicate entry: ${entry.fileName}`);
  }
  seenPaths.add(pathKey);

  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = mode & FILE_TYPE_MASK;
  const isDirectory = fileType === DIRECTORY_TYPE || entry.fileName.endsWith('/');
  if (fileType === SYMBOLIC_LINK_TYPE) {
    throw new Error(`ZIP archives cannot contain symbolic links: ${entry.fileName}`);
  }
  if (fileType !== 0 && fileType !== DIRECTORY_TYPE && fileType !== REGULAR_FILE_TYPE) {
    throw new Error(`ZIP archive contains an unsupported entry type: ${entry.fileName}`);
  }

  if (isDirectory) {
    await ensureSafeDirectory(rootDirectory, segments);
    return;
  }

  if (entry.uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
    throw new Error(`ZIP entry is too large: ${entry.fileName}`);
  }

  await ensureSafeDirectory(rootDirectory, segments.slice(0, -1));
  const readStream = await openEntryStream(zipFile, entry);
  const writeStream = fs.createWriteStream(destinationPath, {
    flags: 'wx',
    mode: mode ? mode & 0o777 : 0o644,
  });
  try {
    await pipeline(readStream, writeStream);
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true });
    throw error;
  }
};

export const extractZipSafely = async (
  archivePath: string,
  destinationDirectory: string,
): Promise<void> => {
  if (!path.isAbsolute(destinationDirectory)) {
    throw new Error('ZIP extraction directory must be absolute.');
  }
  await fs.promises.mkdir(destinationDirectory, { recursive: true });
  const rootDirectory = await fs.promises.realpath(destinationDirectory);
  const zipFile = await openZip(archivePath);
  const seenPaths = new Set<string>();
  let entryCount = 0;
  let totalUncompressedBytes = 0;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.once('error', fail);
    zipFile.once('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zipFile.on('entry', entry => {
      entryCount += 1;
      totalUncompressedBytes += entry.uncompressedSize;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        fail(new Error(`ZIP archive contains more than ${MAX_ARCHIVE_ENTRIES} entries.`));
        return;
      }
      if (
        !Number.isSafeInteger(totalUncompressedBytes) ||
        totalUncompressedBytes > MAX_ARCHIVE_TOTAL_BYTES
      ) {
        fail(new Error('ZIP archive expands beyond the allowed size.'));
        return;
      }

      void extractEntry(zipFile, entry, rootDirectory, seenPaths).then(() => {
        if (!settled) zipFile.readEntry();
      }, fail);
    });
    zipFile.readEntry();
  });
};
