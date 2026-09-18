'use strict';

const path = require('path');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'browser-extension-markdown-entry.mjs')],
  outfile: path.join(
    repoRoot,
    'resources',
    'browser-extension',
    'conversation-overlay',
    'modules',
    'sidepanel-markdown.js',
  ),
  bundle: true,
  format: 'esm',
  legalComments: 'none',
  minify: true,
  target: ['chrome125'],
  banner: {
    js: '/*! Bundles markdown-it 14.3.0 (MIT): https://github.com/markdown-it/markdown-it */',
  },
});
