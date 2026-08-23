import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const buildCompleteBackupDataSource = appSource.match(
  /function buildCompleteBackupData\(\) \{[\s\S]*?\n\}/,
);

if (!buildCompleteBackupDataSource) {
  throw new Error('Impossibile trovare buildCompleteBackupData in js/app.js');
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
    `${buildCompleteBackupDataSource[0]}; return buildCompleteBackupData();`,
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
