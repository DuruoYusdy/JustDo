import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { stageAudioAttachment } from './localAudioAttachment';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
it('copies external audio into the workspace and reuses files already inside it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-stage-'));
  roots.push(root);
  const workspace = path.join(root, '项目 space');
  await fs.mkdir(workspace);
  const source = path.join(root, '录音.mp3');
  await fs.writeFile(source, 'audio');
  const staged = await stageAudioAttachment(source, workspace);
  expect(path.relative(workspace, staged).startsWith('..')).toBe(false);
  expect(await fs.readFile(staged, 'utf8')).toBe('audio');
  expect(await stageAudioAttachment(staged, workspace)).toBe(staged);
  expect(await fs.readFile(source, 'utf8')).toBe('audio');
  await expect(stageAudioAttachment(path.join(root, 'list.m3u8'), workspace)).rejects.toThrow();
});
