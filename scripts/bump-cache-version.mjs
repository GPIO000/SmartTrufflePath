import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CACHE_VERSION_PATTERN = /globalThis\.SMARTTRUFFLE_CACHE_VERSION = '([^']+)'/;

export function incrementAlphabeticSuffix(suffix) {
  const chars = suffix.split('');
  let index = chars.length - 1;

  while (index >= 0 && chars[index] === 'z') {
    chars[index] = 'a';
    index -= 1;
  }

  if (index < 0) {
    chars.unshift('a');
    return chars.join('');
  }

  chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1);
  return chars.join('');
}

export function computeNextCacheVersion(currentVersion, now = new Date()) {
  const match = currentVersion.match(/^(\d{4}-\d{2}-\d{2})([a-z]+)$/);
  if (!match) {
    throw new Error(`Formato cache version non valido: ${currentVersion}`);
  }

  const [, currentDate, currentSuffix] = match;
  const today = now.toISOString().slice(0, 10);
  const nextSuffix = currentDate === today ? incrementAlphabeticSuffix(currentSuffix) : 'a';
  return `${today}${nextSuffix}`;
}

export function updateCacheVersionSource(source, now = new Date()) {
  const match = source.match(CACHE_VERSION_PATTERN);
  if (!match) {
    throw new Error('SMARTTRUFFLE_CACHE_VERSION non trovata nel file.');
  }

  const previousVersion = match[1];
  const nextVersion = computeNextCacheVersion(previousVersion, now);

  return {
    previousVersion,
    nextVersion,
    source: source.replace(CACHE_VERSION_PATTERN, `globalThis.SMARTTRUFFLE_CACHE_VERSION = '${nextVersion}'`)
  };
}

export function bumpCacheVersionFile(filePath, now = new Date()) {
  const source = readFileSync(filePath, 'utf8');
  const result = updateCacheVersionSource(source, now);
  if (result.source !== source) {
    writeFileSync(filePath, result.source);
  }
  return result;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cacheVersionPath = resolve(repositoryRoot, 'js/cache-version.js');
  const { previousVersion, nextVersion } = bumpCacheVersionFile(cacheVersionPath);
  console.log(`Cache version aggiornata: ${previousVersion} -> ${nextVersion}`);
}
