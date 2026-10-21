/**
 * Public surface of the pure core package.
 *
 * The rest of the product logic (glossary, prompt, validation, bridge client, Claude runner) arrives
 * with the later phase tasks.
 */
export const PACKAGE_NAME = '@eve-cut/core';

export * from './srt/index.js';
export * from './glossary/index.js';
export * from './batch/index.js';
export * from './prompt/index.js';
