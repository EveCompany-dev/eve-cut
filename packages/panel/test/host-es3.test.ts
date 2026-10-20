import { readdirSync, readFileSync } from 'node:fs';

import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

const HOST_DIR = new URL('../host/', import.meta.url);

// Premiere's ExtendScript engine only understands ES3: a `let`, an arrow function or a trailing
// comma in a host file breaks every evalScript call, and that only shows up inside Premiere.
describe('ExtendScript host files', () => {
  const files = readdirSync(HOST_DIR).filter((name) => name.endsWith('.jsx') || name.endsWith('.js'));

  it.each(files)('%s is valid ES3', (name) => {
    const source = readFileSync(new URL(name, HOST_DIR), 'utf8');

    expect(() => parse(source, { ecmaVersion: 3, allowReserved: false })).not.toThrow();
  });
});
