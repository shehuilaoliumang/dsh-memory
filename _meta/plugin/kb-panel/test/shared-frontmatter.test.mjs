import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, parseFrontmatterData } from '../shared/frontmatter.mjs';
import { WORK_SECTIONS } from '../shared/work-sections.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(here, '..', '..', '..', '..');

test('frontmatter: quoted commas stay in one array item', () => {
  const { data } = parseFrontmatter('---\ntags: ["a,b", c]\n---\nbody\n');
  assert.deepEqual(data.tags, ['a,b', 'c']);
  assert.equal(data.tags.length, 2);
});

test('frontmatter: booleans and numbers are typed, not strings', () => {
  const { data } = parseFrontmatter('---\ndraft: false\nconfidence: 0.9\ncount: 3\n---\n');
  assert.equal(data.draft, false);
  assert.equal(data.confidence, 0.9);
  assert.equal(data.count, 3);
});

test('frontmatter: missing block is distinguishable from empty data', () => {
  const parsed = parseFrontmatter('no frontmatter');
  assert.equal(parsed.data, null);
  assert.deepEqual(parseFrontmatterData('no frontmatter'), {});
  assert.deepEqual(parseFrontmatterData('---\nid: x\n---\n'), { id: 'x' });
});

test('work template headings match WORK_SECTIONS', () => {
  const template = fs.readFileSync(path.join(vault, '_meta', 'templates', 'work.md'), 'utf8');
  const headings = [...template.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, [...WORK_SECTIONS]);
});
