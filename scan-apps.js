const fs = require('fs');
const path = require('path');

function getShortcutsFromDir(dirPath) {
  let results = [];
  if (!fs.existsSync(dirPath)) return results;

  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        results = results.concat(getShortcutsFromDir(fullPath));
      } else if (file.name.endsWith('.lnk') || file.name.endsWith('.exe') || file.name.endsWith('.url')) {
        const name = path.parse(file.name).name;
        if (!/uninstall|read\s*me|help|documentation|setup/i.test(name)) {
          results.push({ name, path: fullPath });
        }
      }
    }
  } catch (e) {
    // Ignore permissions errors
  }
  return results;
}

function scanAllDesktopApps() {
  const targetFolders = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    path.join(process.env.USERPROFILE || '', 'Desktop'),
    'C:\\Users\\Public\\Desktop'
  ];

  let allApps = [];
  const seenNames = new Set();

  targetFolders.forEach(folder => {
    const apps = getShortcutsFromDir(folder);
    apps.forEach(app => {
      const cleanName = app.name.replace(/[\(\)]/g, '').trim();
      if (cleanName && !seenNames.has(cleanName.toLowerCase())) {
        seenNames.add(cleanName.toLowerCase());
        allApps.push({
          name: cleanName,
          path: app.path
        });
      }
    });
  });

  return allApps;
}

const apps = scanAllDesktopApps();
console.log(`Found ${apps.length} desktop apps! Sample:`);
console.log(apps.slice(0, 15));
