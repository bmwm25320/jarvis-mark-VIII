const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = __dirname;

// Determine active Windows Desktop location (handling OneDrive redirection)
let desktopDir = path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop');
if (!fs.existsSync(desktopDir)) {
  desktopDir = path.join(process.env.USERPROFILE || '', 'Desktop');
}

console.log('[Desktop] Active Desktop Directory:', desktopDir);

const shortcutPath = path.join(desktopDir, 'J.A.R.V.I.S. Personal AI.lnk');
const batPath = path.join(desktopDir, 'Launch J.A.R.V.I.S.bat');
const batContent = `@echo off\r\ncd /d "${projectDir}"\r\nnpx electron .\r\n`;

try {
  fs.writeFileSync(batPath, batContent, 'utf8');
  console.log('[Desktop] Batch launcher created successfully at:', batPath);
} catch (e) {
  console.error('Error writing bat launcher:', e);
}

// Create Windows .lnk shortcut with Arc Reactor icon
const iconPath = path.join(projectDir, 'assets', 'icon.png');
const psScript = `
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
$Shortcut.TargetPath = "${batPath.replace(/\\/g, '\\\\')}"
$Shortcut.WorkingDirectory = "${projectDir.replace(/\\/g, '\\\\')}"
$Shortcut.IconLocation = "${iconPath.replace(/\\/g, '\\\\')},0"
$Shortcut.Description = "J.A.R.V.I.S. Mark VII Personal AI Console"
$Shortcut.Save()
`;

try {
  const encodedPs = Buffer.from(psScript, 'utf16le').toString('base64');
  execSync(`powershell -NoProfile -EncodedCommand ${encodedPs}`);
  console.log('[Desktop] LNK Shortcut created successfully at:', shortcutPath);
} catch (err) {
  console.error('Error creating LNK shortcut:', err);
}
