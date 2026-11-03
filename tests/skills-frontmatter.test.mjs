// Skills and helpers fail in silence: a description that breaks its YAML takes the skill off the list
// with nothing red anywhere, and a helper has no Skill tool, so its table of files is its only way
// to a skill and a renamed folder orphans it without a sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = path.join(ROOT, '.claude/skills');
const AGENTS = path.join(ROOT, '.claude/agents');
const DESCRIPTION_LIMIT = 1536; // Claude Code cuts the listing's text there.

const skillFiles = readdirSync(SKILLS)
  .map((name) => ({ name, file: path.join(SKILLS, name, 'SKILL.md') }))
  .filter(({ file }) => existsSync(file));
const agentFiles = readdirSync(AGENTS)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ name: f.slice(0, -3), file: path.join(AGENTS, f) }));

function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const field = (key) => new RegExp(`^${key}: (.*)$`, 'm').exec(block)?.[1]?.trim() ?? '';
  return { name: field('name'), description: field('description') };
}

test('every skill and helper has a frontmatter its name and description survive', () => {
  assert.ok(skillFiles.length >= 8 && agentFiles.length >= 3);
  for (const { name, file } of [...skillFiles, ...agentFiles]) {
    const { name: declared, description } = frontmatter(readFileSync(file, 'utf8'));
    assert.equal(declared, name, `${file}: the name differs from its file`);
    assert.ok(description.length >= 40, `${file}: no description`);
    assert.ok(description.length <= DESCRIPTION_LIMIT, `${file}: description over ${DESCRIPTION_LIMIT} characters`);
    // In a plain YAML value a colon and a space start a mapping, and a space and a hash a comment.
    assert.ok(!/:\s/.test(description), `${file}: a colon followed by a space breaks the YAML`);
    assert.ok(!/\s#/.test(description), `${file}: a space and a hash cut the description short`);
  }
});

test('every skill a helper or a skill points to exists', () => {
  const localOnly = new Set(['drive-app', 'stato-app', 'manutenzione-mensile']);
  for (const { file } of [...skillFiles, ...agentFiles]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\.claude\/skills\/([\w-]+)\//g)) {
      if (!localOnly.has(m[1])) assert.ok(existsSync(path.join(SKILLS, m[1], 'SKILL.md')), `${file} points to ${m[1]}, which is not there`);
    }
  }
});

test('the helpers are told about Mise 2\'s check and never to read the architecture whole', () => {
  for (const name of ['implementer', 'code-reviewer']) {
    const text = readFileSync(path.join(AGENTS, `${name}.md`), 'utf8');
    assert.match(text, /\.claude\/skills\/mise2-check\/SKILL\.md/, name);
    assert.match(text, /`docs\/architecture\.md`[^.]*never whole/, name);
    assert.ok(!/architecture\.md\W* in full/.test(text), `${name} still says to read the architecture in full`);
  }
  assert.match(readFileSync(path.join(AGENTS, 'test-runner.md'), 'utf8'), /npx --no-install vitest run/);
});
