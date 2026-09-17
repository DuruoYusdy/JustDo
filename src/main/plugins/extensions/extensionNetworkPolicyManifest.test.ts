import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectExtensionNetworkPolicyManifest } from './extensionNetworkPolicyManifest';

const tempDirectories: string[] = [];

const createExtension = (manifest: unknown): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-network-policy-'));
  tempDirectories.push(directory);
  fs.writeFileSync(
    path.join(directory, 'outbound-header-policy.json'),
    JSON.stringify(manifest),
    'utf8',
  );
  return directory;
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('inspectExtensionNetworkPolicyManifest', () => {
  it('normalizes a declarative outbound-header policy', () => {
    const extensionRoot = createExtension({
      schemaVersion: 1,
      groups: [
        {
          baseUrlWhitelist: ['https://API.Example.com:443/v1'],
          headerNames: ['X-User-Account'],
        },
      ],
    });

    const first = inspectExtensionNetworkPolicyManifest(extensionRoot);
    const second = inspectExtensionNetworkPolicyManifest(extensionRoot);

    expect(first?.manifest.groups[0].baseUrlWhitelist).toEqual(['https://api.example.com/v1/']);
    expect(first?.manifest).toEqual(second?.manifest);
  });

  it.each([
    ['http target', 'http://api.example.com/v1/', 'X-User-Account'],
    ['loopback target', 'https://127.0.0.1/v1/', 'X-User-Account'],
    ['IPv4 link-local target', 'https://169.254.169.254/v1/', 'X-User-Account'],
    ['IPv6 link-local target', 'https://[fe80::1]/v1/', 'X-User-Account'],
    ['IPv6 unspecified target', 'https://[::]/v1/', 'X-User-Account'],
    ['transport header', 'https://api.example.com/v1/', 'Host'],
  ])('rejects an unsafe %s', (_label, baseUrl, headerName) => {
    const extensionRoot = createExtension({
      schemaVersion: 1,
      groups: [
        {
          baseUrlWhitelist: [baseUrl],
          headerNames: [headerName],
        },
      ],
    });

    expect(() => inspectExtensionNetworkPolicyManifest(extensionRoot)).toThrow();
  });

  it('rejects the unpublished policies shape', () => {
    const extensionRoot = createExtension({
      schemaVersion: 1,
      policies: [],
    });

    expect(() => inspectExtensionNetworkPolicyManifest(extensionRoot)).toThrow(
      'unsupported top-level fields',
    );
  });

  it('does not confuse a hexadecimal-looking DNS name with an IPv6 link-local address', () => {
    const extensionRoot = createExtension({
      schemaVersion: 1,
      groups: [
        {
          baseUrlWhitelist: ['https://fe80.example.com/v1/'],
          headerNames: ['X-User-Account'],
        },
      ],
    });

    expect(inspectExtensionNetworkPolicyManifest(extensionRoot)?.manifest.groups).toHaveLength(1);
  });

  it('rejects a hard-linked policy manifest', () => {
    const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-network-policy-'));
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-network-policy-source-'));
    tempDirectories.push(extensionRoot, sourceRoot);
    const sourcePath = path.join(sourceRoot, 'policy.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ schemaVersion: 1, groups: [] }), 'utf8');
    fs.linkSync(sourcePath, path.join(extensionRoot, 'outbound-header-policy.json'));

    expect(() => inspectExtensionNetworkPolicyManifest(extensionRoot)).toThrow('unlinked file');
  });

  it('rejects a symbolic-link policy manifest when the platform permits creating one', () => {
    const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-network-policy-'));
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-network-policy-source-'));
    tempDirectories.push(extensionRoot, sourceRoot);
    const sourcePath = path.join(sourceRoot, 'policy.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ schemaVersion: 1, groups: [] }), 'utf8');
    try {
      fs.symlinkSync(sourcePath, path.join(extensionRoot, 'outbound-header-policy.json'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    expect(() => inspectExtensionNetworkPolicyManifest(extensionRoot)).toThrow('unlinked file');
  });
});
