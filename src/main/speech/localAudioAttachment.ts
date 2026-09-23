import fs from 'node:fs/promises';
import path from 'node:path';

import { isLocalAudioAttachment } from '../../shared/speech/localAsr';

export async function stageAudioAttachment(source: string, workspace: string): Promise<string> {
  if (!path.isAbsolute(source) || !path.isAbsolute(workspace) || !isLocalAudioAttachment(source)) {
    throw new Error('A local audio file and an absolute workspace path are required.');
  }
  const root = await fs.realpath(workspace);
  const input = await fs.realpath(source);
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024 * 1024) {
    throw new Error('Audio must be a non-empty file no larger than 256 MiB.');
  }
  const relative = path.relative(root, input);
  if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    return input;
  // Use a random direct child: no pre-existing attachment-directory symlink can redirect the copy.
  const staging = await fs.mkdtemp(path.join(root, '.justdo-audio-'));
  const target = path.join(staging, path.basename(source));
  try {
    await fs.copyFile(input, target);
    if ((await fs.stat(target)).size > 256 * 1024 * 1024) throw new Error('Audio exceeds 256 MiB.');
    return target;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}
