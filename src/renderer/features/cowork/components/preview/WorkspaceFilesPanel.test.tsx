// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import WorkspaceFilesPanel from './WorkspaceFilesPanel';

const listWorkspaceDirectory = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { shell: { listWorkspaceDirectory } },
  });
});

afterEach(cleanup);

test('loads folders lazily and opens a selected file', async () => {
  listWorkspaceDirectory.mockImplementation(async (_sessionId: string, relativePath = '') => ({
    success: true,
    truncated: false,
    entries:
      relativePath === ''
        ? [
            {
              filePath: 'C:/workspace/src',
              kind: 'directory',
              name: 'src',
              relativePath: 'src',
            },
            {
              filePath: 'C:/workspace/README.md',
              kind: 'file',
              name: 'README.md',
              relativePath: 'README.md',
            },
          ]
        : [
            {
              filePath: 'C:/workspace/src/main.ts',
              kind: 'file',
              name: 'main.ts',
              relativePath: 'src/main.ts',
            },
          ],
  }));
  const onOpenFile = vi.fn();

  render(<WorkspaceFilesPanel sessionId="session-1" onOpenFile={onOpenFile} />);

  expect(await screen.findByText('README.md')).not.toBeNull();
  expect(document.querySelector('[data-file-icon-kind="markdown"]')).not.toBeNull();
  expect(screen.getByRole('textbox')).toBe(document.activeElement);
  expect(listWorkspaceDirectory).toHaveBeenCalledWith('session-1', '');
  fireEvent.click(screen.getByText('src'));
  expect(await screen.findByText('main.ts')).not.toBeNull();
  expect(listWorkspaceDirectory).toHaveBeenCalledWith('session-1', 'src');
  fireEvent.click(screen.getByText('main.ts'));
  expect(onOpenFile).toHaveBeenCalledWith('C:/workspace/src/main.ts');
});

test('renders distinct colored icons for common workspace file types', async () => {
  listWorkspaceDirectory.mockResolvedValue({
    success: true,
    truncated: false,
    entries: [
      {
        filePath: '/workspace/.gitignore',
        kind: 'file',
        name: '.gitignore',
        relativePath: '.gitignore',
      },
      {
        filePath: '/workspace/package.json',
        kind: 'file',
        name: 'package.json',
        relativePath: 'package.json',
      },
      {
        filePath: '/workspace/main.ts',
        kind: 'file',
        name: 'main.ts',
        relativePath: 'main.ts',
      },
    ],
  });

  render(<WorkspaceFilesPanel sessionId="session-1" onOpenFile={vi.fn()} />);
  await screen.findByText('package.json');

  const gitIcon = document.querySelector<HTMLElement>('[data-file-icon-kind="git"]');
  const jsonIcon = document.querySelector<HTMLElement>('[data-file-icon-kind="json"]');
  const typescriptIcon = document.querySelector<HTMLElement>('[data-file-icon-kind="typescript"]');

  expect(gitIcon?.style.color).toBe('rgb(240, 80, 50)');
  expect(jsonIcon?.style.color).toBe('rgb(232, 121, 36)');
  expect(typescriptIcon?.style.color).toBe('rgb(49, 120, 198)');
});

test('filters the visible tree without creating a tab', async () => {
  listWorkspaceDirectory.mockResolvedValue({
    success: true,
    truncated: false,
    entries: [
      {
        filePath: '/workspace/package.json',
        kind: 'file',
        name: 'package.json',
        relativePath: 'package.json',
      },
      {
        filePath: '/workspace/README.md',
        kind: 'file',
        name: 'README.md',
        relativePath: 'README.md',
      },
    ],
  });

  render(<WorkspaceFilesPanel sessionId="session-1" onOpenFile={vi.fn()} />);
  await screen.findByText('package.json');
  screen.getByRole('treeitem', { name: 'package.json' }).focus();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'read' } });

  await waitFor(() => expect(screen.queryByText('package.json')).toBeNull());
  expect(screen.getByRole('treeitem', { name: 'README.md' }).tabIndex).toBe(0);
});

test('ignores stale directory results after switching sessions', async () => {
  let resolveOldRequest: ((value: unknown) => void) | undefined;
  listWorkspaceDirectory.mockImplementation((sessionId: string) => {
    if (sessionId === 'old-session') {
      return new Promise(resolve => {
        resolveOldRequest = resolve;
      });
    }
    return Promise.resolve({
      success: true,
      truncated: false,
      entries: [
        {
          filePath: '/new/new-file.md',
          kind: 'file',
          name: 'new-file.md',
          relativePath: 'new-file.md',
        },
      ],
    });
  });

  const { rerender } = render(<WorkspaceFilesPanel sessionId="old-session" onOpenFile={vi.fn()} />);
  rerender(<WorkspaceFilesPanel sessionId="new-session" onOpenFile={vi.fn()} />);
  expect(await screen.findByText('new-file.md')).not.toBeNull();

  resolveOldRequest?.({
    success: true,
    truncated: false,
    entries: [
      {
        filePath: '/old/old-file.md',
        kind: 'file',
        name: 'old-file.md',
        relativePath: 'old-file.md',
      },
    ],
  });

  await waitFor(() => expect(screen.queryByText('old-file.md')).toBeNull());
  expect(screen.getByText('new-file.md')).not.toBeNull();
});

test('keeps matching descendants connected to their parent and supports tree keyboard navigation', async () => {
  listWorkspaceDirectory.mockImplementation(async (_sessionId: string, relativePath = '') => ({
    success: true,
    truncated: false,
    entries:
      relativePath === ''
        ? [
            {
              filePath: '/workspace/src',
              kind: 'directory',
              name: 'src',
              relativePath: 'src',
            },
          ]
        : [
            {
              filePath: '/workspace/src/main.ts',
              kind: 'file',
              name: 'main.ts',
              relativePath: 'src/main.ts',
            },
          ],
  }));

  render(
    <WorkspaceFilesPanel
      activeFilePath="/workspace/src/main.ts"
      sessionId="session-1"
      onOpenFile={vi.fn()}
    />,
  );
  const filter = screen.getByRole('textbox');
  await screen.findByText('src');
  fireEvent.keyDown(filter, { key: 'ArrowDown' });
  const directory = screen.getByRole('treeitem', { name: 'src' });
  expect(directory).toBe(document.activeElement);
  fireEvent.keyDown(directory, { key: 'ArrowRight' });
  const file = await screen.findByRole('treeitem', { name: 'main.ts' });
  fireEvent.change(filter, { target: { value: 'main' } });

  expect(screen.getByText('src')).not.toBeNull();
  expect(file.getAttribute('aria-selected')).toBe('true');
});
