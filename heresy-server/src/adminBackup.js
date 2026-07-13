import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDataDirs() {
  return [...new Set([
    path.resolve(process.cwd(), 'data'),
    path.join(__dirname, '..', 'data')
  ])];
}

function sanitizeLabel(label) {
  return String(label || 'admin-edit')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'admin-edit';
}

function copyDataFiles(sourceDir, backupDir) {
  if (!fs.existsSync(sourceDir)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(sourceDir, entry.name), path.join(backupDir, entry.name));
    copied += 1;
  }
  return copied;
}

export function backupAdminData(label = 'admin-edit') {
  const primaryDataDir = path.resolve(process.cwd(), 'data');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(primaryDataDir, 'admin-backups', `${timestamp}-${sanitizeLabel(label)}`);
  fs.mkdirSync(backupDir, { recursive: true });

  let copied = 0;
  for (const dataDir of getDataDirs()) {
    copied += copyDataFiles(dataDir, backupDir);
  }

  fs.writeFileSync(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify({
      label: sanitizeLabel(label),
      createdAt: Date.now(),
      copiedFiles: copied
    }, null, 2)
  );

  return { backupDir, copiedFiles: copied };
}
