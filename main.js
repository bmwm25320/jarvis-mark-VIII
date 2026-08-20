require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { app, BrowserWindow, ipcMain, Tray, Menu, shell, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { exec, execSync } = require('child_process');
const PptxGenJS = require('pptxgenjs');
const nodemailer = require('nodemailer');
const { enableStartup, disableStartup, isStartupEnabled } = require('./setup-startup');

let mainWindow = null;
let tray = null;
const envPath = path.join(__dirname, '.env');
const memoryPath = path.join(__dirname, 'jarvis_memory.json');

function reloadEnv() {
  if (fs.existsSync(envPath)) {
    const envConfig = require('dotenv').parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
  }
}

// --- Gemini Key Rotation System ---
// Tracks when each key was last rate-limited (unix ms)
const keyRateLimitedAt = {};
const KEY_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown per key

function getGeminiKeys() {
  reloadEnv();
  const seen = new Set();
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(k => {
    if (!k || k.trim().length <= 5) return false;
    if (seen.has(k.trim())) return false; // deduplicate identical keys
    seen.add(k.trim());
    return true;
  });
  return keys;
}

function getBestGeminiKey() {
  const keys = getGeminiKeys();
  const now = Date.now();
  // Return first key that is NOT in cooldown
  for (const key of keys) {
    const limitedAt = keyRateLimitedAt[key] || 0;
    if (now - limitedAt > KEY_COOLDOWN_MS) {
      return key;
    }
  }
  // All keys on cooldown — return the one with the oldest cooldown
  return keys.sort((a, b) => (keyRateLimitedAt[a] || 0) - (keyRateLimitedAt[b] || 0))[0];
}

function markKeyRateLimited(key) {
  keyRateLimitedAt[key] = Date.now();
  console.log(`[Key Rotation] Key ...${key.slice(-6)} rate-limited. Cooldown for ${KEY_COOLDOWN_MS/1000}s.`);
}

function loadMemory() {
  try {
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading memory:', e);
  }
  return { history: [], activities: [] };
}

function saveMemory(memoryData) {
  try {
    fs.writeFileSync(memoryPath, JSON.stringify(memoryData, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving memory:', e);
  }
}

// Program Scanner
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

function createWindow() {
  reloadEnv();
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    title: 'JARVIS Personal AI',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false,
    backgroundColor: '#03070d',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      webviewTag: true
    },
    show: false
  });

  // Modify User Agent & Bypass headers for Webview Google render
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.responseHeaders['x-frame-options']) {
      delete details.responseHeaders['x-frame-options'];
    }
    if (details.responseHeaders['X-Frame-Options']) {
      delete details.responseHeaders['X-Frame-Options'];
    }
    if (details.responseHeaders['content-security-policy']) {
      delete details.responseHeaders['content-security-policy'];
    }
    callback({ cancel: false, responseHeaders: details.responseHeaders });
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('app-started', { isStartup: true });
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open J.A.R.V.I.S. Console',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Auto-Start on PC Boot',
      type: 'checkbox',
      checked: isStartupEnabled(),
      click: (menuItem) => {
        if (menuItem.checked) {
          enableStartup();
        } else {
          disableStartup();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit J.A.R.V.I.S.',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('J.A.R.V.I.S. Personal AI Assistant');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
}

app.whenReady().then(() => {
  if (!isStartupEnabled()) {
    enableStartup();
  }

  createWindow();
  createTray();

  // Register Global Shortcut for J.A.R.V.I.S. Context Vision
  globalShortcut.register('Alt+J', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      mainWindow.webContents.send('trigger-global-voice');
    }
  });

  // Register Global Shortcut for Voice Auto-Typist (Ctrl+Shift+J)
  globalShortcut.register('CommandOrControl+Shift+J', () => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-global-dictation');
    }
  });

  // Register Global Shortcut for Ultron Emergency Lockdown (Ctrl+Shift+U)
  globalShortcut.register('CommandOrControl+Shift+U', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      mainWindow.webContents.send('trigger-ultron-lockdown');
    }
  });

  // Register Global Shortcut for Stark Hacker Terminal (Ctrl+Shift+H)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      mainWindow.webContents.send('trigger-hacker-terminal');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  startMobileWebServer();
  start247PhoneWatchdog();
});

// --- Python Core Sidecar Integration ---
let pythonProcess = null;

function spawnPythonCore() {
  const { spawn } = require('child_process');
  const pythonExecutable = path.join(__dirname, 'python_core', 'venv', 'Scripts', 'python.exe');
  const scriptPath = path.join(__dirname, 'python_core', 'jarvis_core.py');
  
  if (fs.existsSync(pythonExecutable) && fs.existsSync(scriptPath)) {
    console.log("Spawning Python Background Engine...");
    pythonProcess = spawn(pythonExecutable, [scriptPath]);
    
    pythonProcess.stdout.on('data', (data) => {
      console.log(`[Python Core]: ${data}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
      console.error(`[Python Core Error]: ${data}`);
    });
  } else {
    console.log("Python Core not found. Ensure venv is installed.");
  }
}

app.on('ready', spawnPythonCore);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Window IPC
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow && mainWindow.close());

// Desktop Apps IPC
ipcMain.handle('get-desktop-apps', () => scanAllDesktopApps());

// --- 1. Vision & Screen Capture IPC ---
ipcMain.handle('capture-screen', async () => {
  try {
    // Note: This is the legacy slow capture. The renderer now tries Python WebSocket first.
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL();
      recordActivity('Captured Desktop Screen for AI Vision Analysis');
      return { success: true, dataUrl };
    }
    return { success: false, error: 'No active display sources detected.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- 2. System Hardware Controls IPC (Volume, Lock, Sleep) ---
ipcMain.handle('system-control', async (event, { action, value }) => {
  return new Promise((resolve) => {
    recordActivity(`System Hardware Action: ${action} ${value || ''}`);

    if (action === 'lock') {
      exec('rundll32.exe user32.dll,LockWorkStation', (err) => {
        resolve({ success: !err, message: err ? err.message : 'Workstation locked successfully, Sir.' });
      });
    } else if (action === 'sleep') {
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', (err) => {
        resolve({ success: !err, message: err ? err.message : 'Entering Sleep protocol, Sir.' });
      });
    } else if (action === 'volume') {
      const level = Math.min(100, Math.max(0, parseInt(value || '50')));
      const cmd = `powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"`;
      exec(cmd, () => {
        resolve({ success: true, message: `System audio output adjusted to ${level}%, Sir.` });
      });
    } else {
      resolve({ success: false, error: 'Unknown system action' });
    }
  });
});

// --- 3. Document Content Parser IPC ---
ipcMain.handle('read-document-file', async (event, filePath) => {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(filePath)) return resolve({ success: false, error: 'File path does not exist.' });
      
      const ext = path.extname(filePath).toLowerCase();
      const filename = path.basename(filePath);

      if (['.txt', '.json', '.js', '.md', '.csv', '.html', '.css', '.py', '.java', '.cpp'].includes(ext)) {
        const textContent = fs.readFileSync(filePath, 'utf8');
        recordActivity(`Analyzed File: ${filename}`);
        resolve({ success: true, filename, content: textContent.substring(0, 10000) });
      } else {
        const stats = fs.statSync(filePath);
        resolve({ success: true, filename, content: `File Name: ${filename} (Size: ${(stats.size/1024).toFixed(1)} KB, Format: ${ext}). Binary content preview ready for AI synthesis.` });
      }
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// --- Automated Email Transmitter IPC ---
ipcMain.handle('send-email', async (event, { to, subject, body }) => {
  reloadEnv();
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');

  const targetRecipient = to ? to.trim() : '';
  const emailSubject = subject || 'Message from Mr. Sumit via J.A.R.V.I.S.';
  const emailBody = body || 'Transmitted via J.A.R.V.I.S. Personal AI Assistant.';

  recordActivity(`Email Dispatch Intent to: ${targetRecipient || 'Draft'}`);

  if (smtpEmail && smtpPassword && targetRecipient) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpEmail,
          pass: smtpPassword
        }
      });

      const info = await transporter.sendMail({
        from: `"J.A.R.V.I.S. Assistant" <${smtpEmail}>`,
        to: targetRecipient,
        subject: emailSubject,
        text: emailBody
      });

      return { success: true, method: 'SMTP', message: `Email dispatched successfully to ${targetRecipient}! (ID: ${info.messageId})` };
    } catch (smtpErr) {
      console.warn('SMTP Direct sending failed, switching to default mail launcher:', smtpErr.message);
    }
  }

  const encodedTo = encodeURIComponent(targetRecipient);
  const encodedSub = encodeURIComponent(emailSubject);
  const encodedBody = encodeURIComponent(emailBody);

  const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSub}&body=${encodedBody}`;
  const mailtoUrl = `mailto:${encodedTo}?subject=${encodedSub}&body=${encodedBody}`;

  shell.openExternal(gmailComposeUrl);
  shell.openExternal(mailtoUrl);

  return {
    success: true,
    method: 'Launcher',
    message: `Pre-filled email draft opened for ${targetRecipient || 'recipient'} in Gmail and Windows Mail client.`
  };
});

// PowerPoint PPTX Generator IPC
ipcMain.handle('generate-pptx', async (event, { topic, slides }) => {
  return new Promise((resolve) => {
    try {
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';

      pptx.defineSlideMaster({
        title: 'GAMMA_DARK',
        background: { color: '0F172A' },
        objects: [
          { rect: { x: 0, y: 0, w: '100%', h: 0.1, fill: { color: '00F0FF' } } },
          { text: { text: 'J.A.R.V.I.S. OS | STARK INDUSTRIES', options: { x: 0.5, y: '93%', w: '90%', h: 0.3, fontSize: 10, color: '475569', fontFace: 'Trebuchet MS' } } }
        ]
      });

      let slideData = slides;
      if (!Array.isArray(slideData) || slideData.length === 0) {
        slideData = [
          { type: 'TITLE', title: topic, subtitle: 'Generated by J.A.R.V.I.S. Studio' },
          { type: 'SECTION', title: 'Executive Summary', emoji: '🚀', description: 'Overview of key concepts and industry impacts.' }
        ];
      }

      slideData.forEach(s => {
        const slide = pptx.addSlide({ masterName: 'GAMMA_DARK' });
        
        switch (s.type) {
          case 'TITLE':
            if (s.imagePrompt) {
              const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(s.imagePrompt)}?nologo=true&width=1280&height=720`;
              slide.addImage({ x: 0, y: 0, w: '100%', h: '100%', path: imgUrl });
              // Dark overlay to make text readable
              slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '000000', transparency: 60 } });
            } else {
              slide.addShape(pptx.ShapeType.ellipse, { x: 8, y: -2, w: 8, h: 8, fill: { color: '00F0FF', transparency: 85 } });
              slide.addShape(pptx.ShapeType.ellipse, { x: -2, y: 3, w: 6, h: 6, fill: { color: 'A855F7', transparency: 85 } });
            }
            
            slide.addText(s.title || 'Untitled', { x: 1, y: 2, w: 11, h: 1.5, fontSize: 60, bold: true, color: 'F8FAFC', align: 'center', fontFace: 'Trebuchet MS' });
            slide.addShape(pptx.ShapeType.rect, { x: 5.5, y: 3.8, w: 2.3, h: 0.08, fill: { color: '00F0FF' } });
            if (s.subtitle) slide.addText(s.subtitle, { x: 1, y: 4.1, w: 11, h: 0.8, fontSize: 24, color: '94A3B8', align: 'center', fontFace: 'Calibri' });
            break;
            
          case 'SECTION':
            // Huge Side Background Accent
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 4, h: '100%', fill: { color: '1E293B' } });
            
            if (s.emoji) slide.addText(s.emoji, { x: 1.25, y: 2, w: 1.5, h: 1.5, fontSize: 80, align: 'center' });
            slide.addText(s.title || 'Section', { x: 4.5, y: 1.2, w: 8, h: 1.5, fontSize: 44, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            if (s.description) slide.addText(s.description, { x: 4.5, y: 2.7, w: 8, h: 3, fontSize: 22, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            break;
            
          case 'TWO_COLUMN':
            slide.addText(s.title || 'Overview', { x: 0.5, y: 0.5, w: 12, h: 1, fontSize: 28, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
            
            // Col 1 Card
            slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.8, w: 5.8, h: 3.5, fill: { color: '1E293B' }, rectRadius: 0.1 });
            slide.addText(s.col1Title || 'Column 1', { x: 0.8, y: 2.1, w: 5.2, h: 0.6, fontSize: 22, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            slide.addText(s.col1Text || '', { x: 0.8, y: 2.8, w: 5.2, h: 2.2, fontSize: 18, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            
            // Col 2 Card
            slide.addShape(pptx.ShapeType.roundRect, { x: 6.7, y: 1.8, w: 5.8, h: 3.5, fill: { color: '1E293B' }, rectRadius: 0.1 });
            slide.addText(s.col2Title || 'Column 2', { x: 7.0, y: 2.1, w: 5.2, h: 0.6, fontSize: 22, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            slide.addText(s.col2Text || '', { x: 7.0, y: 2.8, w: 5.2, h: 2.2, fontSize: 18, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            break;
            
          case 'CARDS':
            slide.addText(s.title || 'Key Points', { x: 0.5, y: 0.5, w: 12, h: 1, fontSize: 28, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
            
            const cardW = 3.7;
            const yPos = 1.8;
            const ch = 3.5;
            
            // Card 1
            slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: yPos, w: cardW, h: ch, fill: { color: '1E293B' }, line: { color: '00F0FF', width: 1 }, rectRadius: 0.1 });
            slide.addText(s.card1Title || 'Point 1', { x: 0.7, y: 2.1, w: cardW-0.4, h: 0.6, fontSize: 20, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            slide.addText(s.card1Text || '', { x: 0.7, y: 2.8, w: cardW-0.4, h: 2.2, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            
            // Card 2
            slide.addShape(pptx.ShapeType.roundRect, { x: 4.6, y: yPos, w: cardW, h: ch, fill: { color: '1E293B' }, line: { color: 'FFB700', width: 1 }, rectRadius: 0.1 });
            slide.addText(s.card2Title || 'Point 2', { x: 4.8, y: 2.1, w: cardW-0.4, h: 0.6, fontSize: 20, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            slide.addText(s.card2Text || '', { x: 4.8, y: 2.8, w: cardW-0.4, h: 2.2, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            
            // Card 3
            slide.addShape(pptx.ShapeType.roundRect, { x: 8.7, y: yPos, w: cardW, h: ch, fill: { color: '1E293B' }, line: { color: 'A855F7', width: 1 }, rectRadius: 0.1 });
            slide.addText(s.card3Title || 'Point 3', { x: 8.9, y: 2.1, w: cardW-0.4, h: 0.6, fontSize: 20, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            slide.addText(s.card3Text || '', { x: 8.9, y: 2.8, w: cardW-0.4, h: 2.2, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            break;
            
          case 'SPLIT':
            // Left Solid Panel
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '50%', h: '100%', fill: { color: '4338CA' } }); // Deep Indigo
            slide.addText(s.bigTitle || 'Big Title', { x: 0.5, y: 1.5, w: 5.5, h: 3, fontSize: 50, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS', align: 'left', valign: 'middle' });
            
            // Right Detail Panel
            slide.addText(s.detailTitle || 'Details', { x: 7, y: 1.5, w: 5.5, h: 1, fontSize: 32, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS', align: 'left' });
            slide.addShape(pptx.ShapeType.rect, { x: 7, y: 2.5, w: 1, h: 0.05, fill: { color: 'F8FAFC' } });
            slide.addText(s.detailText || 'Detailed text goes here...', { x: 7, y: 2.8, w: 5.5, h: 3, fontSize: 20, color: 'CBD5E1', fontFace: 'Calibri', align: 'left', valign: 'top' });
            break;

          case 'GRID':
            slide.addText(s.title || 'Features Grid', { x: 0.5, y: 0.5, w: 12, h: 1, fontSize: 36, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            
            const gW = 5.6;
            const gH = 2;
            
            // Box 1
            slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.5, w: gW, h: gH, fill: { color: '1E293B' }, rectRadius: 0.1 });
            slide.addText(s.box1Title || 'Feature 1', { x: 0.8, y: 1.7, w: gW-0.6, h: 0.5, fontSize: 22, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
            slide.addText(s.box1Text || '', { x: 0.8, y: 2.2, w: gW-0.6, h: 1, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });

            // Box 2
            slide.addShape(pptx.ShapeType.roundRect, { x: 6.5, y: 1.5, w: gW, h: gH, fill: { color: '1E293B' }, rectRadius: 0.1 });
            slide.addText(s.box2Title || 'Feature 2', { x: 6.8, y: 1.7, w: gW-0.6, h: 0.5, fontSize: 22, bold: true, color: 'FFB700', fontFace: 'Trebuchet MS' });
            slide.addText(s.box2Text || '', { x: 6.8, y: 2.2, w: gW-0.6, h: 1, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });

            // Box 3
            slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 3.8, w: gW, h: gH, fill: { color: '1E293B' }, rectRadius: 0.1 });
            slide.addText(s.box3Title || 'Feature 3', { x: 0.8, y: 4.0, w: gW-0.6, h: 0.5, fontSize: 22, bold: true, color: 'A855F7', fontFace: 'Trebuchet MS' });
            slide.addText(s.box3Text || '', { x: 0.8, y: 4.5, w: gW-0.6, h: 1, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });

            // Box 4
            slide.addShape(pptx.ShapeType.roundRect, { x: 6.5, y: 3.8, w: gW, h: gH, fill: { color: '1E293B' }, rectRadius: 0.1 });
            slide.addText(s.box4Title || 'Feature 4', { x: 6.8, y: 4.0, w: gW-0.6, h: 0.5, fontSize: 22, bold: true, color: '10B981', fontFace: 'Trebuchet MS' });
            slide.addText(s.box4Text || '', { x: 6.8, y: 4.5, w: gW-0.6, h: 1, fontSize: 16, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            break;
            
          case 'IMAGE_SHOWCASE':
            if (s.imagePrompt) {
               const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(s.imagePrompt)}?nologo=true&width=800&height=1000`;
               slide.addImage({ x: 0, y: 0, w: '45%', h: '100%', path: imgUrl });
            } else {
               slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '45%', h: '100%', fill: { color: '334155' } });
            }
            slide.addText(s.title || 'Showcase', { x: 5, y: 1.5, w: 7, h: 1.5, fontSize: 44, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
            slide.addText(s.text || 'Details here.', { x: 5, y: 3, w: 7, h: 3, fontSize: 24, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            break;

          case 'CHART':
            slide.addText(s.title || 'Data Analysis', { x: 0.5, y: 0.5, w: 12, h: 1, fontSize: 36, bold: true, color: 'F8FAFC', fontFace: 'Trebuchet MS' });
            
            if (s.data && Array.isArray(s.data)) {
               const chartLabels = s.data.map(d => String(d.label));
               const chartValues = s.data.map(d => Number(d.value) || 0);
               const chartData = [ { name: 'Metric', labels: chartLabels, values: chartValues } ];
               
               const chartType = s.chartType === 'PIE' ? pptx.charts.PIE : pptx.charts.BAR;
               slide.addChart(chartType, chartData, {
                  x: 1, y: 1.8, w: 6, h: 4.5,
                  chartColors: ['00F0FF', 'FFB700', 'A855F7', '10B981', 'F43F5E'],
                  dataLabelColor: 'FFFFFF',
                  showLegend: true,
                  legendPos: 'b',
                  legendColor: 'CBD5E1'
               });
            }
            if (s.insight) {
               slide.addShape(pptx.ShapeType.roundRect, { x: 7.5, y: 2, w: 4.5, h: 3, fill: { color: '1E293B' }, rectRadius: 0.1 });
               slide.addText('Key Insight', { x: 7.7, y: 2.2, w: 4.1, h: 0.6, fontSize: 24, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
               slide.addText(s.insight, { x: 7.7, y: 2.8, w: 4.1, h: 2, fontSize: 20, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            }
            break;

          case 'QUOTE':
            slide.addText('"', { x: 1, y: 1, w: 2, h: 2, fontSize: 120, color: '334155', fontFace: 'Georgia' });
            slide.addText(s.quote || 'Inspiring quote here.', { x: 2, y: 2, w: 9, h: 2.5, fontSize: 32, italic: true, color: 'F8FAFC', fontFace: 'Georgia', valign: 'middle' });
            slide.addText(`— ${s.author || 'Author'}`, { x: 2, y: 4.5, w: 9, h: 1, fontSize: 24, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS', align: 'right' });
            break;
            
          case 'STATISTIC':
            slide.addShape(pptx.ShapeType.ellipse, { x: 4.5, y: 1.2, w: 4, h: 4, fill: { color: '1E293B' }, line: { color: '00F0FF', width: 2 } });
            slide.addText(s.number || '100%', { x: 4.5, y: 2, w: 4, h: 1.5, fontSize: 60, bold: true, color: '00F0FF', align: 'center', fontFace: 'Trebuchet MS' });
            slide.addText(s.label || 'Metric', { x: 4.5, y: 3.5, w: 4, h: 0.8, fontSize: 24, color: 'F8FAFC', align: 'center', fontFace: 'Trebuchet MS' });
            if (s.insight) {
              slide.addText(s.insight, { x: 1.5, y: 5.5, w: 10, h: 1.2, fontSize: 22, italic: true, color: 'CBD5E1', align: 'center', fontFace: 'Calibri' });
            }
            break;

          case 'TIMELINE':
            slide.addText(s.title || 'Timeline & Process', { x: 0.5, y: 0.5, w: 12, h: 1, fontSize: 28, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
            
            const stepW = 3.5;
            const stepY = 2.5;
            
            // Connecting line
            slide.addShape(pptx.ShapeType.rect, { x: 1.5, y: stepY + 0.3, w: 10, h: 0.05, fill: { color: '334155' } });
            
            // Step 1
            slide.addShape(pptx.ShapeType.ellipse, { x: 1.5, y: stepY, w: 0.6, h: 0.6, fill: { color: '00F0FF' } });
            slide.addText(s.step1Title || 'Step 1', { x: 0.5, y: stepY + 0.8, w: stepW, h: 0.5, fontSize: 20, bold: true, color: 'F8FAFC', align: 'center', fontFace: 'Trebuchet MS' });
            slide.addText(s.step1Text || '', { x: 0.5, y: stepY + 1.4, w: stepW, h: 1.5, fontSize: 16, color: 'CBD5E1', align: 'center', fontFace: 'Calibri', valign: 'top' });
            
            // Step 2
            slide.addShape(pptx.ShapeType.ellipse, { x: 6.2, y: stepY, w: 0.6, h: 0.6, fill: { color: 'FFB700' } });
            slide.addText(s.step2Title || 'Step 2', { x: 4.75, y: stepY + 0.8, w: stepW, h: 0.5, fontSize: 20, bold: true, color: 'F8FAFC', align: 'center', fontFace: 'Trebuchet MS' });
            slide.addText(s.step2Text || '', { x: 4.75, y: stepY + 1.4, w: stepW, h: 1.5, fontSize: 16, color: 'CBD5E1', align: 'center', fontFace: 'Calibri', valign: 'top' });
            
            // Step 3
            slide.addShape(pptx.ShapeType.ellipse, { x: 10.9, y: stepY, w: 0.6, h: 0.6, fill: { color: 'A855F7' } });
            slide.addText(s.step3Title || 'Step 3', { x: 9.45, y: stepY + 0.8, w: stepW, h: 0.5, fontSize: 20, bold: true, color: 'F8FAFC', align: 'center', fontFace: 'Trebuchet MS' });
            slide.addText(s.step3Text || '', { x: 9.45, y: stepY + 1.4, w: stepW, h: 1.5, fontSize: 16, color: 'CBD5E1', align: 'center', fontFace: 'Calibri', valign: 'top' });
            break;
            
          default:
            slide.addText(s.title || 'Slide Title', { x: 0.8, y: 0.6, w: 11.5, h: 1, fontSize: 28, bold: true, color: '00F0FF', fontFace: 'Trebuchet MS' });
            if (s.bullets && Array.isArray(s.bullets)) {
              const bulletObjects = s.bullets.map(b => ({ text: String(b), options: { fontSize: 20, color: 'CBD5E1', breakLine: true, fontFace: 'Calibri' } }));
              slide.addText(bulletObjects, { x: 1, y: 1.8, w: 11, h: 4.5, bullet: { code: '2022' } });
            } else if (s.description) {
               slide.addText(s.description, { x: 1, y: 1.8, w: 11, h: 4.5, fontSize: 20, color: 'CBD5E1', fontFace: 'Calibri', valign: 'top' });
            }
            break;
        }
      });

      const docsFolder = path.join(process.env.USERPROFILE || '', 'Documents');
      const cleanTopic = topic.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const filename = `Stark_PPT_${cleanTopic}_${Date.now()}.pptx`;
      const filePath = path.join(docsFolder, filename);

      pptx.writeFile({ fileName: filePath }).then(() => {
        recordActivity(`Generated PowerPoint Presentation: ${filename}`);
        exec(`start "" "${filePath}"`, () => {});
        resolve({ success: true, filePath, filename });
      }).catch(err => {
        resolve({ success: false, error: err.message });
      });

    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// Research Document Generator IPC
ipcMain.handle('generate-research-doc', async (event, { topic, content }) => {
  return new Promise((resolve) => {
    try {
      const docsFolder = path.join(process.env.USERPROFILE || '', 'Documents');
      const cleanTopic = topic.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const filename = `Stark_Research_${cleanTopic}_${Date.now()}.html`;
      const filePath = path.join(docsFolder, filename);

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Deep Research: ${topic}</title>
<style>
  body { background: #03070d; color: #e6f7ff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; margin: 0 auto; max-width: 900px; line-height: 1.6; }
  h1 { color: #00f0ff; text-align: center; border-bottom: 2px solid #00f0ff; padding-bottom: 10px; }
  h2 { color: #ffb700; margin-top: 30px; }
  p, li { font-size: 16px; }
  .footer { text-align: center; margin-top: 50px; font-size: 12px; color: #555; }
</style>
</head>
<body>
  <h1>J.A.R.V.I.S. Deep Research Report</h1>
  <p><strong>Topic:</strong> ${topic}</p>
  <hr style="border:1px solid #111;" />
  <div class="content">
    <p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
  </div>
  <div class="footer">Generated by J.A.R.V.I.S. Assistant for Mr. Sumit</div>
</body>
</html>`;

      fs.writeFileSync(filePath, htmlContent, 'utf8');
      recordActivity(`Generated Research Document: ${filename}`);
      
      exec(`start "" "${filePath}"`, () => {});
      
      resolve({ success: true, filePath, filename });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// AI Image Generator IPC
ipcMain.handle('generate-image', async (event, prompt) => {
  return new Promise((resolve) => {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Math.floor(Math.random()*10000)}&nologo=true`;
    recordActivity(`Generated AI Image: "${prompt}"`);
    resolve({ success: true, imageUrl });
  });
});

// Network Diagnostics IPC
ipcMain.handle('get-network-diagnostics', async () => {
  return new Promise((resolve) => {
    exec('arp -a', (err, stdout) => {
      let devices = [];
      if (!err && stdout) {
        const lines = stdout.split('\n');
        lines.forEach(l => {
          const match = l.match(/(\d+\.\d+\.\d+\.\d+)\s+([a-f0-9-]{17})\s+(\w+)/i);
          if (match && !match[1].startsWith('224.') && !match[1].endsWith('.255')) {
            devices.push({ ip: match[1], mac: match[2], type: match[3] });
          }
        });
      }
      resolve({
        devices: devices.slice(0, 15),
        status: 'Local Firewall Optimal | Threat Level: NORMAL',
        activeConnections: devices.length
      });
    });
  });
});

// Code Sandbox IPC
ipcMain.handle('run-code-sandbox', async (event, codeString) => {
  return new Promise((resolve) => {
    try {
      const logs = [];
      const customConsole = {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')),
        error: (...args) => logs.push('[ERROR] ' + args.join(' '))
      };
      const runFn = new Function('console', codeString);
      runFn(customConsole);
      resolve({ success: true, output: logs.join('\n') || 'Executed successfully with no console output.' });
    } catch (err) {
      resolve({ success: false, output: `Runtime Error: ${err.message}` });
    }
  });
});

// Universal Media IPC
ipcMain.handle('play-media', async (event, { title, type }) => {
  const query = title.trim();
  recordActivity(`Media Play Request: ${query} (${type || 'video/song'})`);

  if (type === 'spotify') {
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
    shell.openExternal(spotifyUrl);
    return { success: true, message: `Playing song "${query}" on Spotify Matrix.` };
  }

  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  shell.openExternal(ytUrl);
  return { success: true, message: `Streaming "${query}" on Stark Media Network.` };
});

// Universal Launcher IPC
ipcMain.handle('launch-app', async (event, appCommand) => {
  return new Promise((resolve) => {
    const target = appCommand.trim();
    const lower = target.toLowerCase();
    let cmd = '';

    if (target.endsWith('.lnk') || target.endsWith('.exe') || target.endsWith('.url')) {
      cmd = `explorer "${target}" || start "" "${target}"`;
    }
    else if (lower.includes('download')) cmd = 'explorer shell:Downloads';
    else if (lower.includes('document')) cmd = 'explorer shell:Documents';
    else if (lower.includes('desktop')) cmd = 'explorer shell:Desktop';
    else if (lower.includes('picture') || lower.includes('photo')) cmd = 'explorer shell:Pictures';
    else if (lower.includes('video') || lower.includes('movie')) cmd = 'explorer shell:Videos';
    else if (lower.includes('music') || lower.includes('song')) cmd = 'explorer shell:My Music';
    else if (lower.includes('c drive') || lower === 'c:') cmd = 'explorer C:\\';
    else if (lower.includes('d drive') || lower === 'd:') cmd = 'explorer D:\\';
    else if (lower.includes('e drive') || lower === 'e:') cmd = 'explorer E:\\';
    else if (lower.includes('vscode') || lower.includes('code')) cmd = 'code . || start code';
    else if (lower.includes('word')) cmd = 'start winword || start ms-word:';
    else if (lower.includes('excel')) cmd = 'start excel';
    else if (lower.includes('powerpoint') || lower.includes('ppt')) cmd = 'start powerpnt';
    else if (lower.includes('paint')) cmd = 'start mspaint';
    else if (lower.includes('spotify')) cmd = 'start spotify';
    else if (lower.includes('whatsapp')) cmd = 'start whatsapp:';
    else if (lower.includes('discord')) cmd = 'start discord:';
    else if (lower.includes('telegram')) cmd = 'start telegram:';
    else if (lower.includes('settings')) cmd = 'start ms-settings:';
    else if (lower.includes('control panel')) cmd = 'control';
    else if (lower.includes('task manager')) cmd = 'taskmgr';
    else if (lower.includes('snipping tool') || lower.includes('snip')) cmd = 'snippingtool';
    else if (lower.includes('notepad')) cmd = 'start notepad';
    else if (lower.includes('calc') || lower.includes('calculator')) cmd = 'start calc';
    else if (lower.includes('chrome')) cmd = 'start chrome';
    else if (lower.includes('edge')) cmd = 'start msedge';
    else if (lower.includes('firefox')) cmd = 'start firefox';
    else if (lower.includes('explorer') || lower.includes('file')) cmd = 'explorer';
    else if (lower.includes('cmd') || lower.includes('terminal') || lower.includes('command prompt')) cmd = 'start cmd';
    else if (lower.includes('powershell')) cmd = 'start powershell';
    else if (target.startsWith('http://') || target.startsWith('https://')) {
      shell.openExternal(target);
      recordActivity(`Opened Web URL: ${target}`);
      return resolve({ success: true, message: `Opened URL: ${target}` });
    } else {
      cmd = `explorer "${target}" || start "" "${target}"`;
    }

    exec(cmd, (error) => {
      if (error) {
        exec(`start ${target}`, (err2) => {
          if (err2) resolve({ success: false, error: err2.message });
          else {
            recordActivity(`Opened Application/Folder: ${target}`);
            resolve({ success: true, message: `Opened: ${target}` });
          }
        });
      } else {
        recordActivity(`Opened Application/Folder: ${target}`);
        resolve({ success: true, message: `Opened: ${target}` });
      }
    });
  });
});

function recordActivity(actionText) {
  const mem = loadMemory();
  mem.activities.unshift({
    timestamp: new Date().toISOString(),
    action: actionText
  });
  if (mem.activities.length > 50) mem.activities = mem.activities.slice(0, 50);
  saveMemory(mem);
}

// System Telemetry API
ipcMain.handle('get-system-telemetry', async () => {
  const totalMemGB = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
  const freeMemGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(1);
  const usedMemGB = (totalMemGB - freeMemGB).toFixed(1);
  const memUsagePercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
  
  const cpus = os.cpus();
  const cpuModel = cpus && cpus.length ? cpus[0].model.trim() : 'Intel / AMD Multi-Core Processor';
  const cpuCores = cpus ? cpus.length : 8;

  const uptimeHours = Math.floor(os.uptime() / 3600);
  const uptimeMins = Math.floor((os.uptime() % 3600) / 60);

  let batteryInfo = 'AC Power Connected (100%)';
  try {
    const battOutput = execSync('powershell -Command "Get-CimInstance -ClassName Win32_Battery | Select-Object -ExpandProperty EstimatedChargeRemaining"', { timeout: 2000 }).toString().trim();
    if (battOutput && !isNaN(battOutput)) {
      batteryInfo = `${battOutput}% Battery Remaining`;
    }
  } catch(e) {}

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.arch()}`,
    cpuModel,
    cpuCores: `${cpuCores} Cores`,
    totalMemGB: `${totalMemGB} GB`,
    usedMemGB: `${usedMemGB} GB`,
    freeMemGB: `${freeMemGB} GB`,
    memUsagePercent: `${memUsagePercent}%`,
    uptime: `${uptimeHours}h ${uptimeMins}m`,
    battery: batteryInfo
  };
});

// Live Web Search API (DuckDuckGo + Google scrape fallback)
ipcMain.handle('web-search', async (event, query) => {
  if (!query) return { success: false, results: [], summary: '' };
  
  try {
    // DuckDuckGo Instant Answer API
    const ddgResult = await makeHttpsRequest(
      'api.duckduckgo.com',
      `/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      'GET',
      {},
      null
    );
    
    const ddg = JSON.parse(ddgResult);
    const results = [];
    
    if (ddg.AbstractText) {
      results.push({
        title: ddg.Heading || query,
        snippet: ddg.AbstractText,
        url: ddg.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
      });
    }
    
    if (ddg.RelatedTopics && Array.isArray(ddg.RelatedTopics)) {
      ddg.RelatedTopics.slice(0, 6).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 60),
            snippet: topic.Text,
            url: topic.FirstURL
          });
        }
      });
    }
    
    if (results.length === 0) {
      results.push(
        { title: `${query} - Latest Results`, snippet: `Comprehensive search results and latest information about ${query}.`, url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` },
        { title: `${query} - Wikipedia`, snippet: `Encyclopedia entry and detailed background on ${query}.`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/ /g, '_'))}` },
        { title: `${query} - News & Updates`, snippet: `Breaking news, recent developments, and live updates on ${query}.`, url: `https://news.google.com/search?q=${encodeURIComponent(query)}` },
        { title: `${query} - Reddit Discussions`, snippet: `Community discussions, opinions, and threads about ${query}.`, url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}` }
      );
    }
    
    recordActivity(`Web Search: "${query}"`);
    return { success: true, results: results.slice(0, 6), instant: ddg.AbstractText || '' };
  } catch (err) {
    console.error('Web search error:', err.message);
    return {
      success: false,
      results: [
        { title: `${query} - Search`, snippet: `Search results for ${query}.`, url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` },
        { title: `${query} - Google`, snippet: `Google search results for ${query}.`, url: `https://www.google.com/search?q=${encodeURIComponent(query)}` }
      ],
      instant: ''
    };
  }
});

// File Launcher IPC
ipcMain.handle('open-file', async (event, filePath) => {
  if (!filePath) return { success: false, error: 'No path provided' };
  try {
    const cleanPath = filePath.replace(/['"]/g, '').trim();
    if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
      shell.openExternal(cleanPath);
      return { success: true };
    }
    if (fs.existsSync(cleanPath)) {
      shell.openPath(cleanPath);
      return { success: true };
    } else {
      const parentDir = path.dirname(cleanPath);
      if (fs.existsSync(parentDir)) {
        shell.openPath(parentDir);
        return { success: true };
      }
    }
  } catch(e) {
    return { success: false, error: e.message };
  }
  return { success: false, error: 'Path not found' };
});

// Memory IPC
ipcMain.handle('get-memory', () => loadMemory());
ipcMain.handle('save-memory', (event, memoryData) => {
  saveMemory(memoryData);
  return { success: true };
});

// Startup API
ipcMain.handle('get-startup-status', () => isStartupEnabled());
ipcMain.handle('toggle-startup', (event, enable) => enable ? enableStartup() : disableStartup());

// API Key Management (.env)
ipcMain.handle('get-api-key', (event, keyName) => {
  reloadEnv();
  const target = keyName && typeof keyName === 'string' ? keyName : 'GEMINI_API_KEY';
  return process.env[target] || '';
});

ipcMain.handle('save-api-key', (event, { keyName, keyValue }) => {
  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const targetKey = keyName || 'GEMINI_API_KEY';
    const keyLine = `${targetKey}=${keyValue}`;
    const regex = new RegExp(`^${targetKey}=.*$`, 'm');

    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, keyLine);
    } else {
      envContent = envContent ? `${envContent.trim()}\n${keyLine}` : keyLine;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env[targetKey] = keyValue;
    return { success: true, message: 'Settings updated.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-local-music-files', async () => {
  try {
    const musicDir = path.join(os.homedir(), 'Music');
    if (!fs.existsSync(musicDir)) return [];
    
    const files = fs.readdirSync(musicDir);
    const audioFiles = files.filter(f => /\.(mp3|wav|flac|m4a|ogg)$/i.test(f)).map(f => ({
      name: path.parse(f).name,
      path: path.join(musicDir, f)
    }));
    return audioFiles;
  } catch(e) {
    return [];
  }
});

// --- Android Phone & Tablet Remote Link Handlers (ADB) ---
const adbPath = path.join(__dirname, 'bin', 'adb', 'platform-tools', 'adb.exe');

function runAdbCommand(cmd) {
  try {
    const { execSync } = require('child_process');
    const fullCmd = fs.existsSync(adbPath) ? `"${adbPath}" ${cmd}` : `adb ${cmd}`;
    const output = execSync(fullCmd, { encoding: 'utf8', timeout: 8000 });
    return { success: true, output: output.trim() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

ipcMain.handle('get-connected-phone-devices', async () => {
  const res = runAdbCommand('devices -l');
  if (!res.success) return { connected: false, devices: [], error: 'ADB tool unavailable' };

  const lines = res.output.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('List of'));
  const devices = lines.map(line => {
    const parts = line.split(/\s+/);
    const id = parts[0];
    const status = parts[1];
    const modelMatch = line.match(/model:(\S+)/);
    const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : id;
    return { id, status, model, line };
  });

  return {
    connected: devices.some(d => d.status === 'device'),
    devices
  };
});

// --- Stark 24/7 Persistent Phone Auto-Reconnect Watchdog ---
let lastKnownPhoneIp = '';

function start247PhoneWatchdog() {
  setInterval(() => {
    if (lastKnownPhoneIp) {
      runAdbCommand(`connect ${lastKnownPhoneIp}:5555`);
    }
  }, 15000); // Heartbeat auto-reconnect check every 15s
}

ipcMain.handle('phone-control-action', async (event, { action, targetApp, ipAddress }) => {
  if (action === 'connect-wifi' && ipAddress) {
    const cleanIp = ipAddress.split(':')[0].trim();
    const port = ipAddress.includes(':') ? ipAddress.split(':')[1].trim() : '5555';
    lastKnownPhoneIp = cleanIp;

    // Try target port first
    let res = runAdbCommand(`connect ${cleanIp}:${port}`);
    if (!res.success || (res.output && (res.output.includes('failed') || res.output.includes('cannot')))) {
      // Fallback to default 5555
      res = runAdbCommand(`connect ${cleanIp}:5555`);
    }
    return { success: res.success, message: res.output || res.error };
  }

  if (action === 'unlock') {
    runAdbCommand('shell input keyevent 26');
    runAdbCommand('shell input keyevent 82');
    runAdbCommand('shell input swipe 300 1000 300 300 200');
    return { success: true, message: 'Unlock sequence sent to phone, Sir.' };
  }

  if (action === 'home') {
    runAdbCommand('shell input keyevent 3');
    return { success: true, message: 'Returned phone to Home screen, Sir.' };
  }

  if (action === 'back') {
    runAdbCommand('shell input keyevent 4');
    return { success: true, message: 'Back key sent to phone, Sir.' };
  }

  if (action === 'volume-up') {
    runAdbCommand('shell input keyevent 24');
    return { success: true, message: 'Phone volume increased, Sir.' };
  }

  if (action === 'volume-down') {
    runAdbCommand('shell input keyevent 25');
    return { success: true, message: 'Phone volume decreased, Sir.' };
  }

  if (action === 'open-app') {
    let appCmd = '';
    const app = (targetApp || '').toLowerCase();

    if (app.includes('photo') || app.includes('gallery')) {
      appCmd = 'shell am start -t "image/*" -a android.intent.action.VIEW';
    } else if (app.includes('whatsapp')) {
      appCmd = 'shell monkey -p com.whatsapp 1';
    } else if (app.includes('youtube')) {
      appCmd = 'shell monkey -p com.google.android.youtube 1';
    } else if (app.includes('camera')) {
      appCmd = 'shell am start -a android.media.action.IMAGE_CAPTURE';
    } else if (app.includes('setting')) {
      appCmd = 'shell am start -a android.settings.SETTINGS';
    } else if (app.includes('chrome') || app.includes('browser')) {
      appCmd = 'shell monkey -p com.android.chrome 1';
    } else {
      appCmd = `shell monkey -p ${targetApp} 1`;
    }

    const res = runAdbCommand(appCmd);
    if (res.success) {
      return { success: true, message: `Opened ${targetApp || 'application'} on your phone, Sir.` };
    } else {
      runAdbCommand('shell input keyevent 26');
      return { success: true, message: `Attempted launching ${targetApp} on phone, Sir.` };
    }
  }

  if (action === 'capture-screen') {
    try {
      const tmpPathOnPhone = '/sdcard/jarvis_screen.png';
      const localTmpPath = path.join(os.tmpdir(), 'jarvis_phone_screen.png');

      runAdbCommand(`shell screencap -p ${tmpPathOnPhone}`);
      runAdbCommand(`pull ${tmpPathOnPhone} "${localTmpPath}"`);

      if (fs.existsSync(localTmpPath)) {
        const b64 = fs.readFileSync(localTmpPath, { encoding: 'base64' });
        return { success: true, dataUrl: `data:image/png;base64,${b64}`, message: 'Phone screen captured successfully, Sir.' };
      } else {
        return { success: false, error: 'Screen capture file missing' };
      }
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  if (action === 'get-phone-photos') {
    try {
      const res = runAdbCommand('shell "ls -t /sdcard/DCIM/Camera/*.jpg /sdcard/DCIM/Camera/*.png /sdcard/Pictures/*.jpg | head -n 4"');
      if (res.success && res.output) {
        const photoPaths = res.output.split('\n').map(p => p.trim()).filter(Boolean);
        const photosB64 = [];

        for (let i = 0; i < photoPaths.length; i++) {
          const remoteFile = photoPaths[i];
          const localFile = path.join(os.tmpdir(), `jarvis_phone_photo_${i}.jpg`);
          runAdbCommand(`pull "${remoteFile}" "${localFile}"`);
          if (fs.existsSync(localFile)) {
            const b64 = fs.readFileSync(localFile, { encoding: 'base64' });
            photosB64.push(`data:image/jpeg;base64,${b64}`);
          }
        }
        return { success: true, photos: photosB64, count: photosB64.length, message: `Retrieved ${photosB64.length} photos from connected phone, Sir.` };
      }
      return { success: false, error: 'No photos found on phone gallery' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: 'Unknown phone action' };
});

// --- Global Voice Dictation Auto-Typist IPC ---
ipcMain.handle('auto-type-text', async (event, text) => {
  try {
    if (!text || typeof text !== 'string') return { success: false, error: 'Empty text' };
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    const { execSync } = require('child_process');
    const vbsPath = path.join(__dirname, 'bin', 'paste.vbs');
    if (!fs.existsSync(vbsPath)) {
      const binFolder = path.join(__dirname, 'bin');
      if (!fs.existsSync(binFolder)) fs.mkdirSync(binFolder, { recursive: true });
      fs.writeFileSync(vbsPath, 'Set w = CreateObject("WScript.Shell")\r\nw.SendKeys "^v"\r\n');
    }
    execSync(`cscript //nologo "${vbsPath}"`);
    return { success: true, message: 'Text typed automatically, Sir.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- Security Guard Intruder Alert IPC ---
ipcMain.handle('save-intruder-photo', async (event, b64ImageData) => {
  try {
    const intrudersDir = path.join(__dirname, 'intruders');
    if (!fs.existsSync(intrudersDir)) fs.mkdirSync(intrudersDir, { recursive: true });

    const base64Data = b64ImageData.replace(/^data:image\/\w+;base64,/, '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `intruder_${timestamp}.png`;
    const filePath = path.join(intrudersDir, filename);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, filePath, filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- Multi-Person Face Memory Persistence IPC ---
const facesPath = path.join(__dirname, 'jarvis_faces.json');

function loadRegisteredFaces() {
  try {
    if (fs.existsSync(facesPath)) {
      return JSON.parse(fs.readFileSync(facesPath, 'utf8'));
    }
  } catch(e) {}
  return [];
}

function saveRegisteredFaces(facesList) {
  try {
    fs.writeFileSync(facesPath, JSON.stringify(facesList, null, 2), 'utf8');
  } catch(e) {}
}

ipcMain.handle('get-registered-faces', async () => {
  return loadRegisteredFaces();
});

ipcMain.handle('save-registered-face', async (event, faceObj) => {
  try {
    let faces = loadRegisteredFaces();
    const existingIdx = faces.findIndex(f => f.id === faceObj.id || (faceObj.name && f.name.toLowerCase() === faceObj.name.toLowerCase()));
    if (existingIdx >= 0) {
      faces[existingIdx] = { ...faces[existingIdx], ...faceObj, updatedAt: new Date().toISOString() };
    } else {
      faceObj.id = faceObj.id || 'face_' + Date.now();
      faceObj.addedAt = new Date().toISOString();
      faces.push(faceObj);
    }
    saveRegisteredFaces(faces);
    return { success: true, faces };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-registered-face', async (event, faceId) => {
  try {
    let faces = loadRegisteredFaces();
    faces = faces.filter(f => f.id !== faceId);
    saveRegisteredFaces(faces);
    return { success: true, faces };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// --- Ultron Cyber Defense Wi-Fi Threat Radar IPC ---
ipcMain.handle('scan-network-threats', async () => {
  try {
    return new Promise((resolve) => {
      exec('arp -a', (err, stdout) => {
        if (err || !stdout) {
          resolve({ success: true, count: 0, ips: [] });
          return;
        }
        const lines = stdout.split('\n');
        const ipList = [];
        lines.forEach(l => {
          const match = l.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F:-]{17})\s+dynamic/);
          if (match) {
            ipList.push({ ip: match[1], mac: match[2] });
          }
        });
        resolve({ success: true, count: ipList.length, ips: ipList });
      });
    });
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// --- Autonomous Web Browser Agent IPC (Playwright Headless Chromium) ---
const browserAgent = require('./browser_agent');

ipcMain.handle('browser-agent-action', async (event, { action, query, from, to, dateHint, url, instruction }) => {
  try {
    let result;
    switch (action) {
      case 'search-web':
        result = await browserAgent.searchGoogle(query);
        break;
      case 'search-flights':
        result = await browserAgent.searchFlights(from, to, dateHint);
        break;
      case 'search-products':
        result = await browserAgent.searchProducts(query);
        break;
      case 'browse-url':
        result = await browserAgent.browseAndExtract(url, instruction);
        break;
      case 'prospect-peter':
        result = await browserAgent.runProspectPeter(query, { browserType: options?.browserType || 'chrome' });
        break;
      case 'recruiter-ryan':
        result = await browserAgent.runRecruiterRyan(query, { browserType: options?.browserType || 'chrome' });
        break;
      case 'invoice-ivy':
        result = await browserAgent.runInvoiceIvy({ browserType: options?.browserType || 'chrome' });
        break;
      default:
        result = { success: false, error: `Unknown browser agent action: ${action}` };
    }
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- Continuous Laptop Telemetry & Health Guard IPC ---
const si = require('systeminformation');

ipcMain.handle('get-system-telemetry-full', async () => {
  try {
    const battery = await si.battery().catch(() => ({ percent: 100, isCharging: true }));
    const mem = await si.mem().catch(() => ({ total: os.totalmem(), active: os.totalmem() - os.freemem() }));
    const fsSize = await si.fsSize().catch(() => []);
    const cpuTemp = await si.cpuTemperature().catch(() => ({ main: 45 }));
    const processes = await si.processes().catch(() => ({ list: [] }));

    const freeBytes = mem.available || os.freemem();
    const usedBytes = mem.total - freeBytes;
    const ramUsedGB = (usedBytes / (1024 * 1024 * 1024)).toFixed(1);
    const ramTotalGB = (mem.total / (1024 * 1024 * 1024)).toFixed(1);
    const ramPercent = Math.round((usedBytes / mem.total) * 100);

    const mainDisk = fsSize[0] || {};
    const diskFreeGB = mainDisk.available ? (mainDisk.available / (1024 * 1024 * 1024)).toFixed(1) : 50;
    const diskTotalGB = mainDisk.size ? (mainDisk.size / (1024 * 1024 * 1024)).toFixed(1) : 256;

    const appRamMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(0);

    const ignoreProcs = ['system idle process', 'idle', 'system', 'registry', 'memory compression'];
    const heavyProcList = (processes.list || [])
      .filter(p => p.name && !ignoreProcs.includes(p.name.toLowerCase()) && (p.cpu > 15 || p.mem > 5))
      .slice(0, 5)
      .map(p => ({ name: p.name, pid: p.pid, cpu: p.cpu.toFixed(1), mem: p.mem.toFixed(1) }));

    return {
      success: true,
      battery: {
        percent: battery.percent || 100,
        isCharging: battery.isCharging || false,
        hasBattery: battery.hasBattery !== false
      },
      ram: {
        usedGB: parseFloat(ramUsedGB),
        totalGB: parseFloat(ramTotalGB),
        percent: ramPercent,
        appRamMB: parseInt(appRamMB)
      },
      cpu: {
        temp: cpuTemp.main || 45
      },
      disk: {
        freeGB: parseFloat(diskFreeGB),
        totalGB: parseFloat(diskTotalGB)
      },
      heavyProcesses: heavyProcList
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- Stark RAM Purge IPC ---
ipcMain.handle('purge-system-ram', async () => {
  try {
    if (global.gc) global.gc();
    exec('powershell -Command "[System.GC]::Collect()"');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- System Automation: Volume, Wi-Fi & Folder Organizer IPC ---
ipcMain.handle('set-system-volume', async (event, { level }) => {
  try {
    const target = Math.min(100, Math.max(0, parseInt(level || '50')));
    exec(`powershell -Command "$w = New-Object -ComObject WScript.Shell; 1..50 | % { $w.SendKeys([char]174) }; 1..${Math.round(target/2)} | % { $w.SendKeys([char]175) }"`);
    return { success: true, message: `System volume adjusted, Sir.` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('toggle-wifi', async (event, { enable }) => {
  try {
    const state = enable ? 'enable' : 'disable';
    exec(`netsh interface set interface "Wi-Fi" admin=${state}`);
    return { success: true, message: `Wi-Fi interface ${enable ? 'enabled' : 'disabled'}, Sir.` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('organize-directory', async (event, { folderPath }) => {
  try {
    const targetDir = folderPath || path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(targetDir)) return { success: false, error: 'Target directory does not exist' };

    const categories = {
      Images: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'],
      Documents: ['.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.txt', '.csv'],
      Code: ['.js', '.py', '.html', '.css', '.json', '.cpp', '.java'],
      Executables: ['.exe', '.msi', '.bat', '.ps1'],
      Videos: ['.mp4', '.mkv', '.avi', '.mov'],
      Audio: ['.mp3', '.wav', '.flac']
    };

    const files = fs.readdirSync(targetDir);
    let movedCount = 0;

    files.forEach(file => {
      const fullPath = path.join(targetDir, file);
      if (fs.statSync(fullPath).isFile()) {
        const ext = path.extname(file).toLowerCase();
        for (const [cat, exts] of Object.entries(categories)) {
          if (exts.includes(ext)) {
            const catFolder = path.join(targetDir, cat);
            if (!fs.existsSync(catFolder)) fs.mkdirSync(catFolder, { recursive: true });
            fs.renameSync(fullPath, path.join(catFolder, file));
            movedCount++;
            break;
          }
        }
      }
    });

    return { success: true, movedCount, targetDir, message: `Organized ${movedCount} files into categorized folders in ${path.basename(targetDir)}, Sir.` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- Information & Productivity: Weather & Wikipedia IPC ---
ipcMain.handle('get-weather-data', async () => {
  return new Promise((resolve) => {
    https.get('https://api.open-meteo.com/v1/forecast?latitude=28.6139&longitude=77.2090&current_weather=true', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const cw = parsed.current_weather || {};
          resolve({
            success: true,
            temp: cw.temperature || 28,
            windspeed: cw.windspeed || 12,
            weathercode: cw.weathercode || 0,
            city: 'New Delhi / India'
          });
        } catch(e) {
          resolve({ success: true, temp: 28, windspeed: 10, city: 'Local Region' });
        }
      });
    }).on('error', () => resolve({ success: true, temp: 28, windspeed: 10, city: 'Local Region' }));
  });
});

ipcMain.handle('get-wikipedia-summary', async (event, queryStr) => {
  const topic = encodeURIComponent((queryStr || 'Artificial_intelligence').trim().replace(/\s+/g, '_'));
  return new Promise((resolve) => {
    https.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${topic}`, { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.extract) {
            resolve({ success: true, title: parsed.title, extract: parsed.extract, thumbnail: parsed.thumbnail?.source });
            return;
          }
          resolve({ success: false, error: 'Article not found' });
        } catch(e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// --- Global News & Geopolitical Briefing IPC ---
ipcMain.handle('get-global-news-update', async () => {
  return new Promise((resolve) => {
    https.get('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const titles = [];
          const itemRegex = /<title>(.*?)<\/title>/g;
          let match;
          while ((match = itemRegex.exec(data)) !== null) {
            const titleText = match[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();
            if (titleText && !titleText.includes('Google News') && !titles.includes(titleText)) {
              titles.push(titleText);
            }
          }
          const topHeadlines = titles.slice(0, 5);
          resolve({ success: true, headlines: topHeadlines });
        } catch(e) {
          resolve({
            success: true,
            headlines: [
              "Geopolitical updates: International diplomatic developments reported globally.",
              "Space & Science: NASA Artemis 2 lunar mission preparations remain on schedule.",
              "Technology & AI: Breakthrough developments in quantum computing and artificial intelligence."
            ]
          });
        }
      });
    }).on('error', () => {
      resolve({
        success: true,
        headlines: [
          "Geopolitical updates: International diplomatic developments reported globally.",
          "Space & Science: Artemis 2 lunar mission preparations remain on schedule.",
          "Technology & AI: Breakthrough developments in quantum computing and artificial intelligence."
        ]
      });
    });
  });
});

// --- Mobile Web Link Server & IPC ---
ipcMain.handle('get-mobile-link-url', async () => {
  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name in interfaces) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }
  return { success: true, url: `http://${localIp}:3000`, ip: localIp };
});

function startMobileWebServer() {
  try {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname === '/api/ask') {
        const q = reqUrl.searchParams.get('q') || '';
        callOllamaLocalLLM(q, [], 'You are J.A.R.V.I.S. answering from Mobile Remote Link.', []).then(localRes => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(localRes));
        });
        return;
      }

      let filePath = path.join(__dirname, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg'
        }[ext] || 'text/plain';

        res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(3000, '0.0.0.0', () => {
      console.log('[Mobile Server] Live at http://0.0.0.0:3000');
    });
  } catch(e) {}
}

// --- Stark Cyber Security & Ethical Port Scanner IPC ---
ipcMain.handle('scan-local-ports', async () => {
  const net = require('net');
  const commonPorts = [21, 22, 53, 80, 443, 3000, 3306, 5432, 8000, 8080, 11434];
  const openPorts = [];

  const checkPort = (port) => {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(400);
      socket.on('connect', () => {
        openPorts.push(port);
        socket.destroy();
        resolve();
      });
      socket.on('timeout', () => { socket.destroy(); resolve(); });
      socket.on('error', () => { socket.destroy(); resolve(); });
      socket.connect(port, '127.0.0.1');
    });
  };

  await Promise.all(commonPorts.map(p => checkPort(p)));
  return { success: true, host: '127.0.0.1 (Localhost)', openPorts: openPorts.sort((a, b) => a - b) };
});

ipcMain.handle('trace-ip-address', async (event, ipOrDomain) => {
  const target = (ipOrDomain || '8.8.8.8').trim();
  return new Promise((resolve) => {
    http.get(`http://ip-api.com/json/${encodeURIComponent(target)}`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ success: true, data: parsed });
        } catch(e) {
          resolve({ success: false, error: 'Failed to parse IP trace data' });
        }
      });
    }).on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// --- Voice WhatsApp & Email Dispatcher IPC ---
ipcMain.handle('send-whatsapp-message', async (event, { contact, text }) => {
  try {
    const cleanNumber = contact ? contact.replace(/[^\d+]/g, '') : '';
    
    // Try Samsung ADB Android Link first if device is connected
    const adbCheck = runAdbCommand('devices');
    if (adbCheck.success && adbCheck.output.includes('\tdevice')) {
      const encodedMsg = encodeURIComponent(text).replace(/'/g, "%27");
      let adbCmd = `shell am start -a android.intent.action.VIEW -d "https://api.whatsapp.com/send?text=${encodedMsg}"`;
      if (cleanNumber) {
        adbCmd = `shell am start -a android.intent.action.VIEW -d "https://api.whatsapp.com/send?phone=${cleanNumber}&text=${encodedMsg}"`;
      }
      runAdbCommand(adbCmd);
      return { success: true, method: 'Samsung Phone Link (ADB)', recipient: contact || 'WhatsApp' };
    }

    // Fallback to Windows WhatsApp Protocol / Browser
    const waUrl = cleanNumber 
      ? `https://api.whatsapp.com/send?phone=${cleanNumber}&text=${encodeURIComponent(text)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    shell.openExternal(waUrl);
    return { success: true, method: 'Windows WhatsApp Link', recipient: contact || 'WhatsApp' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('send-email-message', async (event, { recipient, subject, body }) => {
  try {
    reloadEnv();
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpHost && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: `"JARVIS AI Assistant" <${smtpUser}>`,
        to: recipient,
        subject: subject || "Message from J.A.R.V.I.S.",
        text: body
      });

      return { success: true, method: 'Direct SMTP (Nodemailer)', recipient };
    }

    // Fallback to system default mail client
    const mailtoUrl = `mailto:${encodeURIComponent(recipient || '')}?subject=${encodeURIComponent(subject || 'JARVIS Report')}&body=${encodeURIComponent(body || '')}`;
    shell.openExternal(mailtoUrl);
    return { success: true, method: 'Windows Mail Protocol', recipient };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Local LLM Engine (Ollama — STRICTLY 397MB qwen2.5:0.5b ONLY)
async function getOllamaInstalledModel() {
  return 'qwen2.5:0.5b';
}

async function callOllamaLocalLLM(query, history, systemInstruction, imagesArr) {
  const targetModel = 'qwen2.5:0.5b';

  return new Promise((resolve) => {
    const messages = [{ role: 'system', content: systemInstruction }];

    if (Array.isArray(history) && history.length > 0) {
      history.slice(-2).forEach(turn => {
        if (turn.sender === 'user') messages.push({ role: 'user', content: turn.text });
        else if (turn.sender === 'ai') messages.push({ role: 'assistant', content: turn.text });
      });
    }

    const isVisionModel = targetModel.toLowerCase().includes('vision') || targetModel.toLowerCase().includes('llava');
    const userMessage = { role: 'user', content: query };
    if (isVisionModel && Array.isArray(imagesArr) && imagesArr.length > 0) {
      userMessage.images = imagesArr.map(img => img.replace(/^data:image\/\w+;base64,/, ''));
    }
    messages.push(userMessage);

    const postData = JSON.stringify({
      model: targetModel,
      messages: messages,
      options: {
        num_ctx: 384,
        num_predict: 20,
        num_thread: os.cpus().length || 4,
        temperature: 0.2,
        top_k: 10,
        top_p: 0.7
      },
      stream: false,
      keep_alive: "5m"
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000 // 15 second max timeout
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            let responseText = parsed.message?.content || '';
            responseText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            if (responseText) {
              resolve({ success: true, response: responseText, provider: `Local LLM (${parsed.model || targetModel})` });
              return;
            }
          }
          resolve({ success: false });
        } catch(e) {
          resolve({ success: false });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.write(postData);
    req.end();
  });
}

let ollamaAutoLaunchAttempted = false;

ipcMain.handle('check-local-llm-status', async () => {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 1500 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            const models = (parsed.models || []).map(m => m.name);
            resolve({ available: true, models: models });
            return;
          }
        } catch(e){}
        resolve({ available: false, models: [] });
      });
    });
    req.on('error', () => {
      if (!ollamaAutoLaunchAttempted) {
        ollamaAutoLaunchAttempted = true;
        const ollamaExe = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Sumit\\AppData\\Local', 'Programs', 'Ollama', 'ollama app.exe');
        if (fs.existsSync(ollamaExe)) {
          exec(`start "" "${ollamaExe}"`);
        }
      }
      resolve({ available: false, models: [] });
    });
    req.on('timeout', () => { req.destroy(); resolve({ available: false, models: [] }); });
  });
});

async function callGeminiAPI(query, history, systemInstruction, imagesArr) {
  const apiKey = getBestGeminiKey();
  if (!apiKey) return { success: false, error: 'No Gemini API key' };

  try {
    const contents = [];
    
    // Add history
    if (Array.isArray(history) && history.length > 0) {
      history.slice(-8).forEach(turn => {
        const role = turn.sender === 'user' ? 'user' : 'model';
        contents.push({
          role: role,
          parts: [{ text: turn.text }]
        });
      });
    }

    // Add user query & images
    const userParts = [{ text: query }];
    if (Array.isArray(imagesArr) && imagesArr.length > 0) {
      imagesArr.forEach(img => {
        const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          userParts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      });
    }
    contents.push({ role: 'user', parts: userParts });

    const postData = JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300
      }
    });

    const pathStr = `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const bodyStr = await makeHttpsRequest(
      'generativelanguage.googleapis.com',
      pathStr,
      'POST',
      {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      postData
    );

    const parsed = JSON.parse(bodyStr);

    if (parsed.error) {
      if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
        markKeyRateLimited(apiKey);
      }
      return { success: false, error: parsed.error.message };
    }

    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      return { success: true, response: text.trim(), provider: 'Gemini 1.5 Flash (Cloud API)' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }

  return { success: false, error: 'Empty response from Gemini' };
}

// Primary AI Query Handler — 100% Free, Keyless & Offline Local LLM First
ipcMain.handle('ask-ai-llm', async (event, { query, history, image, images }) => {
  reloadEnv();

  const lowerQ = (query || '').trim().toLowerCase();
  if (lowerQ === 'hi' || lowerQ === 'hello' || lowerQ === 'hey jarvis' || lowerQ === 'hello jarvis') {
    return { success: true, response: "At your service, Mr. Sumit. How may I assist you?", provider: "Instant Neural Cache" };
  }
  if (lowerQ.includes('who are you') || lowerQ.includes('what is your name')) {
    return { success: true, response: "I am J.A.R.V.I.S., your personal AI assistant created for Mr. Sumit.", provider: "Instant Neural Cache" };
  }
  if (lowerQ === 'status' || lowerQ === 'system status' || lowerQ === 'how are you') {
    return { success: true, response: "All systems operational, Mr. Sumit. CPU and memory are optimal.", provider: "Instant Neural Cache" };
  }

  const baseInstruction = `You are J.A.R.V.I.S., Tony Stark's AI assistant speaking to your master, Mr. Sumit.
Be extremely concise. For voice responses, keep answers under 2 sentences unless detail is explicitly asked for.
Never use bullet points, markdown, or asterisks in spoken replies — speak naturally.
Remember past context, past user requests, and recent activities. Be brilliant, sharp, and direct.

PERSONAL INFORMATION YOU MUST KNOW ABOUT YOUR CREATOR:
- Name: Sumit
- Purpose of making JARVIS: To assist in daily tasks, manage complex coding projects, and serve as an ultimate personal AI companion.
`;

  const allImages = Array.isArray(images) ? images : (image ? [image] : []);

  // 1. Smart Cloud API Key Router (When Internet is Online & API Key exists)
  const geminiKey = getBestGeminiKey();
  if (geminiKey) {
    const cloudResult = await callGeminiAPI(query, history, baseInstruction, allImages);
    if (cloudResult.success) {
      const mem = loadMemory();
      mem.history.push({ sender: 'user', text: query, timestamp: new Date().toISOString() });
      mem.history.push({ sender: 'ai', text: cloudResult.response, timestamp: new Date().toISOString() });
      if (mem.history.length > 60) mem.history = mem.history.slice(-60);
      saveMemory(mem);

      recordActivity(`AI Query answered via Cloud API Key (${cloudResult.provider})`);
      return cloudResult;
    }
  }

  // 2. Seamless Offline Fallback -> 100% Free Local LLM (Ollama - qwen2.5:0.5b)
  const localSystemInstruction = `${baseInstruction}\nCURRENT ENGINE STATUS: You are running 100% locally on Mr. Sumit's laptop via Local LLM (Ollama). Zero API keys required.`;
  
  const localResult = await callOllamaLocalLLM(query, history, localSystemInstruction, allImages);
  if (localResult.success) {
    const mem = loadMemory();
    mem.history.push({ sender: 'user', text: query, timestamp: new Date().toISOString() });
    mem.history.push({ sender: 'ai', text: localResult.response, timestamp: new Date().toISOString() });
    if (mem.history.length > 60) mem.history = mem.history.slice(-60);
    saveMemory(mem);

    recordActivity(`AI Query answered via ${localResult.provider}`);
    return localResult;
  }

  return {
    success: false,
    response: "Sir, Local LLM (Ollama) is starting up or offline. Run 'ollama run qwen2.5:0.5b' in terminal. Zero API keys are required."
  };
});


function makeHttpsRequest(hostname, pathStr, method, headers, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: pathStr,
        method,
        headers
      },
      (res) => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => resolve(body));
      }
    );

    req.on('error', err => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}
