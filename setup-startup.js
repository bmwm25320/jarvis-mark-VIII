const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appName = 'NovaPersonalAI';
const startupFolderPath = path.join(
  process.env.APPDATA || '',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);

const shortcutPath = path.join(startupFolderPath, `${appName}.lnk`);
const projectDir = __dirname;

function enableStartup() {
  try {
    if (!fs.existsSync(startupFolderPath)) {
      fs.mkdirSync(startupFolderPath, { recursive: true });
    }

    // Determine target execution path
    // If packaged electron app or dev mode using node/electron
    const nodeExe = process.execPath; // Path to electron executable when running in electron
    const mainScript = path.join(projectDir, 'main.js');

    // Create Windows shortcut via PowerShell script
    const psScript = `
      $WScriptShell = New-Object -ComObject WScript.Shell
      $Shortcut = $WScriptShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
      $Shortcut.TargetPath = "${nodeExe.replace(/\\/g, '\\\\')}"
      $Shortcut.Arguments = "${mainScript.replace(/\\/g, '\\\\')}"
      $Shortcut.WorkingDirectory = "${projectDir.replace(/\\/g, '\\\\')}"
      $Shortcut.WindowStyle = 1
      $Shortcut.Description = "Nova Personal AI Assistant Startup Popup"
      $Shortcut.Save()
    `;

    const encodedPs = Buffer.from(psScript, 'utf16le').toString('base64');
    execSync(`powershell -NoProfile -EncodedCommand ${encodedPs}`);

    console.log(`[Startup] Enabled successfully! Shortcut created at: ${shortcutPath}`);
    return { success: true, message: 'Startup enabled successfully', path: shortcutPath };
  } catch (error) {
    console.error('[Startup] Failed to enable startup:', error);
    return { success: false, error: error.message };
  }
}

function disableStartup() {
  try {
    if (fs.existsSync(shortcutPath)) {
      fs.unlinkSync(shortcutPath);
      console.log(`[Startup] Disabled successfully! Removed shortcut at: ${shortcutPath}`);
    }
    return { success: true, message: 'Startup disabled successfully' };
  } catch (error) {
    console.error('[Startup] Failed to disable startup:', error);
    return { success: false, error: error.message };
  }
}

function isStartupEnabled() {
  return fs.existsSync(shortcutPath);
}

// CLI execution handling
const command = process.argv[2];
if (command === 'enable') {
  enableStartup();
} else if (command === 'disable') {
  disableStartup();
} else if (command === 'check') {
  console.log(`Startup status: ${isStartupEnabled() ? 'ENABLED' : 'DISABLED'}`);
}

module.exports = {
  enableStartup,
  disableStartup,
  isStartupEnabled,
  shortcutPath
};
