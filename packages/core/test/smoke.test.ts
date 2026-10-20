import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index.js';

describe('core package', () => {
  it('exposes the package name', () => {
    expect(PACKAGE_NAME).toBe('@eve-cut/core');
  });
});
