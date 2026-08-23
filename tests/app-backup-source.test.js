import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

let buildCompleteBackupDataSource = '';

beforeAll(() => {
  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  buildCompleteBackupDataSource = extractFunctionSource(appSource, 'buildCompleteBackupData');
  expect(getExternalDependencies(buildCompleteBackupDataSource)).toEqual([
    'OFFLINE_REGIONI_PREFERITE_KEY',
    'TRUFFLE_FORECAST_FEEDBACK_KEY',
    '_BACKUP_DIR_LABEL_KEY',
    'localStorage',
  ]);
});

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}() {`;
  const startIndex = source.indexOf(signature);
  if (startIndex === -1) {
    throw new Error(`Impossibile trovare ${functionName} in js/app.js`);
  }

  let braceDepth = 0;
  let endIndex = -1;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') braceDepth += 1;
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) {
        endIndex = index + 1;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error(`Impossibile estrarre il corpo di ${functionName} da js/app.js`);
  }

  return source.slice(startIndex, endIndex);
}

function getExternalDependencies(source) {
  const sourceWithoutStrings = source.replace(/'[^']*'|"[^"]*"/g, '');
  return [...new Set(
    sourceWithoutStrings.match(/(?<![.\w$])([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*:)/g) || [],
  )].filter((identifier) => !['function', 'return', 'buildCompleteBackupData'].includes(identifier)).sort();
}

function runBuildCompleteBackupData() {
  const localStorage = {
    getItem: (key) => `value:${key}`,
  };

  return new Function(
    'localStorage',
    'TRUFFLE_FORECAST_FEEDBACK_KEY',
    'OFFLINE_REGIONI_PREFERITE_KEY',
    '_BACKUP_DIR_LABEL_KEY',
    `${buildCompleteBackupDataSource}; return buildCompleteBackupData();`,
  )(
    localStorage,
    'truffle_forecast_feedback',
    'offline_regioni_preferite',
    'backup_dir_label',
  );
}

describe('buildCompleteBackupData', () => {
  it('mantiene la chiave canonica dei luoghi di raccolta nel payload backup', () => {
    const backupData = runBuildCompleteBackupData();

    expect(backupData.luoghiRaccolta).toBe('value:luoghi_raccolta');
  });

  it('non mantiene alias legacy ridondanti per luoghi/aree di raccolta', () => {
    const backupData = runBuildCompleteBackupData();

    expect(backupData).not.toHaveProperty('archivioLuoghiRaccolta');
    expect(backupData).not.toHaveProperty('archivioAreeLuoghiRaccolta');
  });
});
