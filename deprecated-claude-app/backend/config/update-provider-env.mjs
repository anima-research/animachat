#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  constants,
  chmod,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const credentialNames = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];
const credentialPatterns = [
  /^sk-ant-[A-Za-z0-9_./+=:-]+$/,
  /^sk-or-[A-Za-z0-9_./+=:-]+$/,
  /^[A-Za-z0-9_./+=:-]+$/,
  /^[A-Za-z0-9_./+=:-]+$/,
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseCredentials(input) {
  const values = input.endsWith('\n')
    ? input.slice(0, -1).split('\n')
    : input.split('\n');

  if (values.length !== credentialNames.length) {
    throw new Error('Expected exactly four newline-delimited credentials');
  }

  values.forEach((value, index) => {
    if (
      value.length < 8
      || value.length > 4096
      || !credentialPatterns[index].test(value)
    ) {
      throw new Error(`Invalid ${credentialNames[index]} value`);
    }
  });
  return values;
}

function updateEnvironment(existing, values) {
  const replacements = new Map(
    credentialNames.map((name, index) => [name, `${name}=${values[index]}`]),
  );
  const seen = new Set();
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  const updated = [];

  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    const name = match?.[1];
    if (!name || !replacements.has(name)) {
      updated.push(line);
      continue;
    }
    if (!seen.has(name)) {
      updated.push(replacements.get(name));
      seen.add(name);
    }
  }

  for (const name of credentialNames) {
    if (!seen.has(name)) {
      updated.push(replacements.get(name));
    }
  }

  while (updated.length > 0 && updated.at(-1) === '') {
    updated.pop();
  }
  return `${updated.join('\n')}\n`;
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('usage: update-provider-env.mjs <environment-file>');
  }

  const target = resolve(process.argv[2]);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });

  let existing = '';
  let existingHandle;
  try {
    existingHandle = await open(
      target,
      constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0)
        | (constants.O_NONBLOCK ?? 0),
    );
    const targetStat = await existingHandle.stat();
    if (!targetStat.isFile()) {
      throw new Error('Environment target must be a regular file');
    }
    existing = await existingHandle.readFile({ encoding: 'utf8' });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  } finally {
    await existingHandle?.close();
  }

  const credentials = parseCredentials(await readStdin());
  const content = updateEnvironment(existing, credentials);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  let handle;

  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await handle?.close();
    await rm(temporary, { force: true });
    throw error;
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'Credential update failed');
});
