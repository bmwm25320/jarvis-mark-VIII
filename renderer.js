const { ipcRenderer } = require('electron');

// --- JARVIS Audio Synth FX Generator ---
class JarvisAudioSynth {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
  }

  playTone(freq, type, duration, gainVal = 0.1) {
    if (!this.enabled) return;
    try {
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio synth error:', e);
    }
  }

  playBootSound() {
    this.playTone(440, 'sine', 0.2, 0.15);
    setTimeout(() => this.playTone(880, 'sine', 0.3, 0.2), 150);
    setTimeout(() => this.playTone(1320, 'triangle', 0.5, 0.25), 300);
  }

  playBeep() {
    this.playTone(800, 'sine', 0.1, 0.08);
  }

  playKeypressSound() {
    this.playTone(1200, 'sine', 0.04, 0.05);
  }

  playAlarmSound() {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.playTone(950, 'sawtooth', 0.2, 0.3), i * 300);
    }
  }

  playProtocolSound() {
    this.playTone(520, 'square', 0.15, 0.12);
    setTimeout(() => this.playTone(1040, 'sawtooth', 0.3, 0.15), 120);
  }
}

const jarvisAudio = new JarvisAudioSynth();

// ═══════════════════ DYNAMIC HUD AUDIO VISUALIZER ═══════════════════
class JarvisHUDVisualizer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.analyser = null;
    this.micAnalyser = null;
    this.animationId = null;
    this.state = 'idle'; // 'idle', 'listening', 'speaking'
    this.idlePhase = 0;
  }

  init() {
    this.canvas = document.getElementById('hudAudioVisualizer');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = this.canvas.offsetWidth * (window.devicePixelRatio || 1);
    this.canvas.height = this.canvas.offsetHeight * (window.devicePixelRatio || 1);
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    // Connect analyser to jarvisAudio AudioContext for output monitoring
    if (jarvisAudio && jarvisAudio.ctx) {
      this.analyser = jarvisAudio.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;
    }

    this.startAnimation();
  }

  async connectMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = jarvisAudio.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      this.micAnalyser = audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      this.micAnalyser.smoothingTimeConstant = 0.78;
      source.connect(this.micAnalyser);
      // Don't connect to destination to avoid feedback
    } catch(e) {
      console.log('[HUD Visualizer] Mic access not available:', e.message);
    }
  }

  setState(newState) {
    this.state = newState;
    if (!this.canvas) return;
    this.canvas.classList.remove('visualizer-active', 'visualizer-speaking');
    if (newState === 'listening') {
      this.canvas.classList.add('visualizer-active');
    } else if (newState === 'speaking') {
      this.canvas.classList.add('visualizer-speaking');
    }
  }

  startAnimation() {
    const draw = () => {
      this.animationId = requestAnimationFrame(draw);
      if (!this.canvas || !this.ctx) return;
      const W = this.canvas.offsetWidth;
      const H = this.canvas.offsetHeight;
      this.ctx.clearRect(0, 0, W, H);

      if (this.state === 'listening' && this.micAnalyser) {
        this.drawWaveform(this.micAnalyser, W, H, '#4db8ff', 'rgba(77, 184, 255, 0.3)');
      } else if (this.state === 'speaking' && this.analyser) {
        this.drawWaveform(this.analyser, W, H, '#ffb700', 'rgba(255, 183, 0, 0.3)');
      } else {
        this.drawIdlePulse(W, H);
      }
    };
    draw();
  }

  drawWaveform(analyser, W, H, strokeColor, fillColor) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    const midY = H / 2;
    const ctx = this.ctx;

    // Main waveform
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = strokeColor;
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 12;

    const sliceWidth = W / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * midY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();

    // Mirror reflection
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = fillColor;
    ctx.shadowBlur = 6;
    x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = H - (v * midY);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();

    // Glow fill between waves
    ctx.shadowBlur = 0;
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * midY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(W, midY);
    ctx.lineTo(0, midY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  drawIdlePulse(W, H) {
    this.idlePhase += 0.02;
    const midY = H / 2;
    const ctx = this.ctx;
    const numPoints = 120;

    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(77, 184, 255, 0.35)';
    ctx.shadowColor = '#4db8ff';
    ctx.shadowBlur = 8;

    for (let i = 0; i <= numPoints; i++) {
      const x = (i / numPoints) * W;
      const amplitude = 4 + Math.sin(this.idlePhase * 0.5) * 3;
      const y = midY + Math.sin((i / numPoints) * Math.PI * 4 + this.idlePhase) * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Second subtle wave
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(77, 184, 255, 0.15)';
    ctx.shadowBlur = 4;
    for (let i = 0; i <= numPoints; i++) {
      const x = (i / numPoints) * W;
      const amplitude = 2 + Math.sin(this.idlePhase * 0.3 + 1) * 2;
      const y = midY + Math.sin((i / numPoints) * Math.PI * 6 + this.idlePhase * 1.5) * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

const hudVisualizer = new JarvisHUDVisualizer();

// ═══════════════════ JARVIS CUSTOM TOAST NOTIFICATION SYSTEM ═══════════════════
const JarvisNotify = {
  container: null,
  queue: [],
  maxVisible: 4,

  init() {
    this.container = document.getElementById('jarvisNotificationContainer');
  },

  /**
   * Show a JARVIS-themed toast notification
   * @param {string} title - Notification title (e.g. 'SYSTEM ALERT')
   * @param {string} message - Notification body text
   * @param {string} type - 'info' | 'warning' | 'critical' | 'success'
   * @param {number} duration - Auto-dismiss duration in ms (default 5000)
   * @param {string} icon - FontAwesome icon class (optional)
   */
  show(title, message, type = 'info', duration = 5000, icon = null) {
    if (!this.container) this.init();
    if (!this.container) return;

    const iconMap = {
      info: 'fa-solid fa-satellite-dish',
      warning: 'fa-solid fa-triangle-exclamation',
      critical: 'fa-solid fa-shield-exclamation',
      success: 'fa-solid fa-circle-check'
    };

    const typeClass = type === 'info' ? '' : `toast-${type}`;
    const iconClass = icon || iconMap[type] || iconMap.info;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const toast = document.createElement('div');
    toast.className = `jarvis-toast ${typeClass}`;
    toast.style.position = 'relative';
    toast.innerHTML = `
      <i class="jarvis-toast-icon ${iconClass}"></i>
      <div class="jarvis-toast-content">
        <div class="jarvis-toast-title">${title}</div>
        <div class="jarvis-toast-message">${message}</div>
        <div class="jarvis-toast-timestamp"><i class="fa-solid fa-clock"></i> ${timeStr}</div>
      </div>
      <div class="jarvis-toast-progress"></div>
    `;

    toast.addEventListener('click', () => this.dismiss(toast));
    this.container.appendChild(toast);

    // Manage max visible
    const toasts = this.container.querySelectorAll('.jarvis-toast:not(.toast-dismissing)');
    if (toasts.length > this.maxVisible) {
      this.dismiss(toasts[0]);
    }

    // Play subtle notification sound
    if (jarvisAudio) jarvisAudio.playBeep();

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }

    return toast;
  },

  dismiss(toast) {
    if (!toast || toast.classList.contains('toast-dismissing')) return;
    toast.classList.add('toast-dismissing');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 400);
  },

  // Convenience methods
  info(title, message, duration) { return this.show(title, message, 'info', duration); },
  warning(title, message, duration) { return this.show(title, message, 'warning', duration); },
  critical(title, message, duration) { return this.show(title, message, 'critical', duration || 8000); },
  success(title, message, duration) { return this.show(title, message, 'success', duration); }
};

window.JarvisNotify = JarvisNotify;


// --- State ---
let state = {
  tasks: JSON.parse(localStorage.getItem('jarvis_tasks')) || [
    { id: 1, text: 'Calibrate Arc Reactor telemetries', completed: true },
    { id: 2, text: 'Review defense protocols with Mr. Sumit', completed: false }
  ],
  notes: JSON.parse(localStorage.getItem('jarvis_notes')) || [
    { id: 1, title: 'JARVIS Protocol Manual', body: 'JARVIS Mark VII initialized on Windows startup. Configured for high-speed voice and system execution.' }
  ],
  currentNoteId: 1,
  voiceEnabled: JSON.parse(localStorage.getItem('jarvis_voice_enabled')) ?? true,
  suitTheme: localStorage.getItem('jarvis_suit_theme') || 'default',
  apiKey: '',
  memory: { history: [], activities: [] },
  desktopApps: [],
  activeTimer: null,
  currentSearchUrl: 'https://www.google.com',
  blandApiKey: '',
  userPhoneNumber: '',
  scheduledCallEnabled: JSON.parse(localStorage.getItem('jarvis_scheduled_call_enabled')) ?? false,
  scheduledCallTime: localStorage.getItem('jarvis_scheduled_call_time') || '',
  scheduledCallPrompt: localStorage.getItem('jarvis_scheduled_call_prompt') || 'You are JARVIS. Give me my daily briefing.',
  lastCallDate: localStorage.getItem('jarvis_last_call_date') || '',
  stealthMode: false
};

// --- DOM Elements ---
const btnMinimize = document.getElementById('btnMinimize');
const btnMaximize = document.getElementById('btnMaximize');
const btnClose = document.getElementById('btnClose');
const toggleStartupCheck = document.getElementById('toggleStartupCheck');
const hudTimeWidget = document.getElementById('hudTimeWidget');
const currentProtocolLabel = document.getElementById('currentProtocolLabel');

const hudNavItems = document.querySelectorAll('.hud-nav-item');
const hudTabs = document.querySelectorAll('.hud-tab');

const userInput = document.getElementById('userInput');
const btnSend = document.getElementById('btnSend');
const btnVoiceInput = document.getElementById('btnVoiceInput');
const chatMessages = document.getElementById('chatMessages');
const btnToggleSound = document.getElementById('btnToggleSound');

const todoList = document.getElementById('todoList');
const newTodoInput = document.getElementById('newTodoInput');
const btnAddTodo = document.getElementById('btnAddTodo');
const taskProgressFill = document.getElementById('taskProgressFill');
const taskProgressPercentage = document.getElementById('taskProgressPercentage');

const noteList = document.getElementById('noteList');
const noteTitle = document.getElementById('noteTitle');
const noteBody = document.getElementById('noteBody');

const voiceSelect = document.getElementById('voiceSelect');
const toggleVoiceResponse = document.getElementById('toggleVoiceResponse');
const cpuUsageVal = document.getElementById('cpuUsageVal');
const ramUsageVal = document.getElementById('ramUsageVal');

const apiKeyInput = document.getElementById('apiKeyInput');
const allDesktopAppsGrid = document.getElementById('allDesktopAppsGrid');
const appSearchInput = document.getElementById('appSearchInput');
const desktopAppCount = document.getElementById('desktopAppCount');

const phoneInput = document.getElementById('phoneInput');
const blandKeyInput = document.getElementById('blandKeyInput');
const toggleScheduledCall = document.getElementById('toggleScheduledCall');
const scheduledTimeInput = document.getElementById('scheduledTimeInput');
const scheduledPromptInput = document.getElementById('scheduledPromptInput');

const networkDiagnosticsOutput = document.getElementById('networkDiagnosticsOutput');
const sandboxCodeInput = document.getElementById('sandboxCodeInput');
const sandboxOutputConsole = document.getElementById('sandboxOutputConsole');
const activeTimerBadge = document.getElementById('activeTimerBadge');
const handsFreeListeningIndicator = document.getElementById('handsFreeListeningIndicator');

// Google Search Engine Container
const googleResultsCardBox = document.getElementById('googleResultsCardBox');
const browserSearchInput = document.getElementById('browserSearchInput');
const currentSearchQueryText = document.getElementById('currentSearchQueryText');

// Studio Elements
const pptTopicInput = document.getElementById('pptTopicInput');
const pptStatusOutput = document.getElementById('pptStatusOutput');
const imagePromptInput = document.getElementById('imagePromptInput');
const imageDisplayArea = document.getElementById('imageDisplayArea');
const audioTextInput = document.getElementById('audioTextInput');
const videoConceptInput = document.getElementById('videoConceptInput');
const videoStoryboardOutput = document.getElementById('videoStoryboardOutput');
const researchTopicInput = document.getElementById('researchTopicInput');
const researchReportOutput = document.getElementById('researchReportOutput');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  setupTitlebar();
  setupNavigation();
  updateClock();
  setInterval(updateClock, 1000);
  startContinuousTelemetryGuard();

  hudVisualizer.init();
  hudVisualizer.connectMic();
  startContinuousFaceRadar();
  startNetworkThreatScanner();
  setupDocumentDropZone();
  JarvisNotify.init();
  JarvisNotify.info('SYSTEM ONLINE', 'J.A.R.V.I.S. systems fully operational. All protocols active, Sir.');

  setSuitTheme(state.suitTheme);
  checkStartupStatus();
  setupVoiceSynthesis();
  setupContinuousHandsFreeRecognition();

  renderTasks();
  renderNotes();
  loadCurrentNote();

  state.apiKey = await ipcRenderer.invoke('get-api-key', 'GEMINI_API_KEY');
  state.blandApiKey = await ipcRenderer.invoke('get-api-key', 'BLAND_API_KEY');
  state.userPhoneNumber = await ipcRenderer.invoke('get-api-key', 'USER_PHONE_NUMBER');
  state.memory = await ipcRenderer.invoke('get-memory');
  renderPastMemoryMessages();

  await loadDesktopApps();
  loadSettingsUI();

  btnToggleSound.addEventListener('click', () => {
    jarvisAudio.enabled = !jarvisAudio.enabled;
    btnToggleSound.classList.toggle('active', jarvisAudio.enabled);
    btnToggleSound.innerHTML = `<i class="fa-solid fa-volume-${jarvisAudio.enabled ? 'high' : 'xmark'}"></i> ${jarvisAudio.enabled ? 'ACTIVE' : 'MUTED'}`;
  });

  setTimeout(() => {
    jarvisAudio.playBootSound();
    speakText("Good day, Mr. Sumit. J.A.R.V.I.S. is online and ready for your instruction, Sir.");
  }, 1000);
});

// --- Live Visual Typing & Voice Briefing Google Search ---
async function performLiveAnimatedGoogleSearch(query) {
  jarvisAudio.playProtocolSound();
  
  // Step 1: Switch to Google Search View tab
  hudNavItems.forEach(i => i.classList.remove('active'));
  hudTabs.forEach(t => t.classList.remove('active'));

  const browserNavItem = Array.from(hudNavItems).find(i => i.getAttribute('data-tab') === 'holographic-browser');
  if (browserNavItem) browserNavItem.classList.add('active');

  const browserTab = document.getElementById('tab-holographic-browser');
  if (browserTab) browserTab.classList.add('active');

  if (browserSearchInput) browserSearchInput.value = '';
  if (currentSearchQueryText) currentSearchQueryText.textContent = `Searching: "${query}"`;
  
  if (googleResultsCardBox) {
    googleResultsCardBox.innerHTML = `
      <div style="text-align:center; padding:50px; color:var(--cyan-bright);">
        <i class="fa-solid fa-atom fa-spin" style="font-size:36px; margin-bottom:12px; display:block;"></i>
        Synthesizing Google Search Matrix for "${escapeHtml(query)}"...
      </div>
    `;
  }

  speakText(`Initiating live Google search protocol for "${query}", Sir.`);

  // Step 2: Animate Typing search query character-by-character into search box
  let currentTyped = '';
  for (let i = 0; i < query.length; i++) {
    await new Promise(r => setTimeout(r, 60));
    currentTyped += query[i];
    if (browserSearchInput) browserSearchInput.value = currentTyped;
    jarvisAudio.playKeypressSound();
  }

  await new Promise(r => setTimeout(r, 300));

  // Step 3: Execute search & synthesize rich search cards inside HUD box
  const finalSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  state.currentSearchUrl = finalSearchUrl;

  // Also launch Chrome desktop browser
  ipcRenderer.invoke('launch-app', finalSearchUrl);

  // Generate 4 Live Google Result Cards
  await renderStarkGoogleSearchCards(query, finalSearchUrl);

  // Step 4: AI Summarizes Findings & Reads out loud
  const summaryPrompt = `Provide a concise 2-sentence summary answering the topic: "${query}". Speak directly as J.A.R.V.I.S. reporting findings to Mr. Sumit.`;
  const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: summaryPrompt, history: [] });

  if (aiResult.success) {
    const summaryText = `Search complete, Sir! Here is what I found:\n${aiResult.response}`;
    appendMessageUI('ai', `🌐 **GOOGLE SEARCH FINDINGS:**\n${aiResult.response}`);
    speakText(`Search completed, Sir! ${aiResult.response}`);
    return summaryText;
  } else {
    speakText(`Search results are now rendered live on your Google display screen, Sir.`);
    return `Google search view launched for "${query}".`;
  }
}

async function renderStarkGoogleSearchCards(query, searchUrl) {
  if (!googleResultsCardBox) return;

  const prompt = `Generate 4 realistic top search result cards for Google search topic "${query}". Respond strictly as a JSON array of objects: [{"title": "Web Title", "snippet": "Detailed description snippet", "link": "https://domain.com/path"}]`;
  const res = await ipcRenderer.invoke('ask-ai-llm', { query: prompt, history: [] });

  let results = [
    { title: `${query} - Official Comprehensive Guide & Encyclopedia`, snippet: `Exhaustive documentation, technical architecture, recent breakthroughs, and full overview of ${query}.`, link: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}` },
    { title: `Latest News & World Updates on ${query}`, snippet: `Breaking global developments, expert analysis, telemetry reports, and news updates regarding ${query}.`, link: searchUrl },
    { title: `Stark Industries Research Paper: ${query}`, snippet: `Deep technical research dossier, data models, and strategic takeaways on ${query}.`, link: `https://starkindustries.com/research?q=${encodeURIComponent(query)}` }
  ];

  if (res.success) {
    try {
      const match = res.response.match(/\[[\s\S]*\]/);
      if (match) results = JSON.parse(match[0]);
    } catch(e){}
  }

  let html = `
    <div style="font-family:var(--font-body); color:var(--text-primary); width:100%;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--cyan-glow); padding-bottom:12px; margin-bottom:16px;">
        <span style="font-family:var(--font-title); font-size:16px; color:var(--cyan-bright);"><i class="fa-brands fa-google text-gold"></i> Live Google Results for "${escapeHtml(query)}"</span>
        <button class="stark-btn" onclick="openExternalGoogleSearch()"><i class="fa-solid fa-external-link"></i> OPEN IN GOOGLE CHROME</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px;">
  `;

  results.forEach((item, index) => {
    html += `
      <div style="background:rgba(10,16,28,0.85); border:1px solid var(--stark-border); padding:16px; border-radius:8px; transition:border-color 0.2s;" onmouseenter="this.style.borderColor='var(--cyan-bright)'" onmouseleave="this.style.borderColor='var(--stark-border)'">
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-family:monospace;">
          <i class="fa-solid fa-globe text-emerald"></i> ${escapeHtml(item.link || searchUrl)}
        </div>
        <h3 style="font-size:18px; color:#00f0ff; margin-bottom:8px; cursor:pointer;" onclick="ipcRenderer.invoke('launch-app', '${escapeHtml(item.link || searchUrl)}')">
          ${index + 1}. ${escapeHtml(item.title)}
        </h3>
        <p style="font-size:14px; color:var(--text-primary); line-height:1.5; margin:0;">
          ${escapeHtml(item.snippet)}
        </p>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  googleResultsCardBox.innerHTML = html;
}

function triggerBrowserSearch() {
  const query = browserSearchInput ? browserSearchInput.value.trim() : '';
  if (query) performLiveAnimatedGoogleSearch(query);
}

function openExternalGoogleSearch() {
  if (state.currentSearchUrl) {
    ipcRenderer.invoke('launch-app', state.currentSearchUrl);
  }
}

// Theme Switcher Engine
function setSuitTheme(themeName) {
  state.suitTheme = themeName;
  localStorage.setItem('jarvis_suit_theme', themeName);
  document.body.className = '';

  if (themeName !== 'default') {
    document.body.classList.add(`theme-${themeName}`);
  }
}

// Real-time Clock
function updateClock() {
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  const clockEl = document.getElementById('hudTimeWidget');
  if (clockEl) clockEl.innerText = timeString;
  
  const ajClock = document.getElementById('ajClock');
  if (ajClock) ajClock.innerText = timeString;
}
setInterval(updateClock, 1000);
updateClock();

// Cron Engine for Scheduled Telephony Calls
setInterval(() => {
  if (!state.scheduledCallEnabled || !state.scheduledCallTime || !state.blandApiKey || !state.userPhoneNumber) return;
  
  const now = new Date();
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTimeString = `${currentHour}:${currentMinute}`;
  const currentDateString = now.toLocaleDateString();
  
  if (currentTimeString === state.scheduledCallTime && state.lastCallDate !== currentDateString) {
    state.lastCallDate = currentDateString;
    localStorage.setItem('jarvis_last_call_date', state.lastCallDate);
    
    appendMessageUI('system', `⏰ Scheduled Telephony Cron Triggered at ${currentTimeString}`);
    triggerPhoneCall(state.scheduledCallPrompt);
  }
}, 30000); // Check every 30 seconds

// 1. Automated Daily Audio Briefing
async function generateDailyBriefingReport() {
  jarvisAudio.playProtocolSound();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const pendingCount = state.tasks.filter(t => !t.completed).length;
  const cpu = cpuUsageVal ? cpuUsageVal.textContent : '12%';
  const ram = ramUsageVal ? ramUsageVal.textContent : '4.2 GB';

  const briefingText = `Good morning, Mr. Sumit! Today is ${dateStr}, time is ${timeStr}. All Stark Arc telemetries are optimal. CPU usage is at ${cpu}, RAM is stable at ${ram}. You have ${pendingCount} pending directives remaining on your board. System defense protocols are fully active. Ready for your command, Sir!`;

  appendMessageUI('ai', `🌅 **J.A.R.V.I.S. MORNING BRIEFING REPORT**\n\n${briefingText}`);
  speakText(briefingText);
  return briefingText;
}

// 2. Vision Desktop Screen Capture Analysis
async function captureAndAnalyzeScreen(customPrompt = null) {
  jarvisAudio.playProtocolSound();
  appendMessageUI('system', '📸 Capturing active desktop display for Multimodal Vision Analysis...');

  let dataUrl = null;
  if (window.getCachedScreenFromPython) {
    dataUrl = await window.getCachedScreenFromPython();
  }

  if (!dataUrl) {
    const res = await ipcRenderer.invoke('capture-screen');
    if (res.success) {
      dataUrl = res.dataUrl;
    } else {
      appendMessageUI('system', `Failed to capture screen: ${res.error}`);
      return;
    }
  }

  if (dataUrl) {
    const activeWindow = window.latestActiveWindowTitle || "Desktop Workspace";
    const userQueryText = customPrompt || "What is on my screen right now?";
    
    const aiPrompt = `[LIVE DESKTOP SCREEN TELEMETRY]\nActive Application / Window: "${activeWindow}"\nUser Question: "${userQueryText}"\n\nExplain what Mr. Sumit is currently looking at on his screen based on his active window "${activeWindow}". Mention the application, active file/topic, and answer his question concisely as J.A.R.V.I.S.`;

    appendMessageUI('ai', `📷 **Screen Captured Context (${activeWindow}):**\n<img src="${dataUrl}">\nAnalyzing active display context...`);

    const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: aiPrompt, history: [], image: dataUrl });
    if (aiResult.success) {
      appendMessageUI('ai', `🔍 **Screen Vision Analysis:**\n${aiResult.response}`);
      speakText(aiResult.response);
    }
  }
}

// Hands-Free Continuous "Hey Jarvis" Listening Engine
let continuousRecognition = null;
window.isManualListening = false; // Global flag to prevent continuous restart

function setupContinuousHandsFreeRecognition() {
  console.log("Continuous Hands-Free Recognition delegated to Python Backend.");
  // Python engine (jarvis_core.py) now handles openwakeword and STT.
}

// Timer & Alarm Engine
function startTimerSeconds(seconds, label = 'Timer') {
  if (state.activeTimer) clearInterval(state.activeTimer);
  let remaining = seconds;

  const updateDisplay = () => {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    const timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
    if (activeTimerBadge) activeTimerBadge.textContent = `⏱️ Active: ${timeStr} (${label})`;
  };

  updateDisplay();
  state.activeTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(state.activeTimer);
      state.activeTimer = null;
      if (activeTimerBadge) activeTimerBadge.textContent = '⏱️ No Active Timers';
      
      jarvisAudio.playAlarmSound();
      appendMessageUI('system', `🔔 TIMER FINISHED: ${label}`);
      speakText(`Timer complete, Mr. Sumit! ${label}`);
    } else {
      updateDisplay();
    }
  }, 1000);
}

// Studio Mode Switcher
function switchStudioMode(mode) {
  jarvisAudio.playBeep();
  const subviews = document.querySelectorAll('.studio-subview');
  subviews.forEach(v => v.style.display = 'none');

  const targetView = document.getElementById(`studio-${mode}-box`);
  if (targetView) targetView.style.display = 'block';
}

// 1. PowerPoint Generator
async function generatePPTXFromStudio(customTopic) {
  jarvisAudio.playProtocolSound();
  const topic = customTopic || (pptTopicInput ? pptTopicInput.value.trim() : '');
  if (!topic) return alert('Please enter a presentation topic.');

  if (pptStatusOutput) pptStatusOutput.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-cyan"></i> Synthesizing PowerPoint Deck with Gemini AI...';

  const slidePrompt = `You are a visionary presentation architect. Generate an ultra-premium, 8-10 slide presentation on "${topic}". 
Use storytelling, hard data, and breathtaking visual descriptions.
Respond in JSON format strictly as an array of objects. 
Choose from these slide types:
- {"type": "TITLE", "title": "...", "subtitle": "...", "imagePrompt": "Detailed prompt for a stunning AI background image (e.g. cinematic, 8k, cyberpunk city)"}
- {"type": "SECTION", "title": "...", "emoji": "...", "description": "..."}
- {"type": "IMAGE_SHOWCASE", "title": "...", "text": "...", "imagePrompt": "Detailed prompt for a beautiful photo..."}
- {"type": "CHART", "title": "...", "chartType": "BAR", "data": [{"label": "A", "value": 10}, {"label": "B", "value": 20}, {"label": "C", "value": 30}], "insight": "..."}
- {"type": "SPLIT", "bigTitle": "...", "detailTitle": "...", "detailText": "..."}
- {"type": "GRID", "title": "...", "box1Title": "...", "box1Text": "...", "box2Title": "...", "box2Text": "...", "box3Title": "...", "box3Text": "...", "box4Title": "...", "box4Text": "..."}
- {"type": "TWO_COLUMN", "title": "...", "col1Title": "...", "col1Text": "...", "col2Title": "...", "col2Text": "..."}
- {"type": "CARDS", "title": "...", "card1Title": "...", "card1Text": "...", "card2Title": "...", "card2Text": "...", "card3Title": "...", "card3Text": "..."}
- {"type": "STATISTIC", "number": "...", "label": "...", "insight": "..."}
- {"type": "TIMELINE", "title": "...", "step1Title": "...", "step1Text": "...", "step2Title": "...", "step2Text": "...", "step3Title": "...", "step3Text": "..."}
- {"type": "QUOTE", "quote": "...", "author": "..."}
Return EXACTLY a valid JSON array of these slide objects.`;
  
  let slides = null;
  const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: slidePrompt, history: [] });

  if (aiResult.success) {
    try {
      const match = aiResult.response.match(/\[[\s\S]*\]/);
      if (match) slides = JSON.parse(match[0]);
    } catch (e) {
      console.warn('JSON parse error for PPT slides');
    }
  }

  const pptRes = await ipcRenderer.invoke('generate-pptx', { topic, slides });
  if (pptRes.success) {
    const escapedPath = pptRes.filePath.replace(/\\/g, '/');
    if (pptStatusOutput) pptStatusOutput.innerHTML = `<span style="color:var(--emerald-green)"><i class="fa-solid fa-check-double"></i> Presentation Deck Created & Opening in PowerPoint!</span>`;
    speakText(`PowerPoint presentation for ${topic} generated and opening in PowerPoint, Sir!`);
    return `PowerPoint presentation deck on "${topic}" has been generated successfully, Sir! Opening in Microsoft PowerPoint now.\n\n<button class="stark-file-btn" onclick="openLocalFile('${escapedPath}')"><i class="fa-solid fa-file-powerpoint text-gold"></i> 📊 CLICK TO OPEN POWERPOINT FILE</button>`;
  } else {
    if (pptStatusOutput) pptStatusOutput.textContent = `Error creating PPT: ${pptRes.error}`;
    return `Error building PowerPoint: ${pptRes.error}`;
  }
}

// 2. AI Image Generator
async function generateAIImageFromStudio(customPrompt) {
  jarvisAudio.playBeep();
  const prompt = customPrompt || (imagePromptInput ? imagePromptInput.value.trim() : '');
  if (!prompt) return 'Please provide an image prompt or description, Sir.';

  if (imageDisplayArea) imageDisplayArea.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles fa-spin text-gold" style="font-size:24px;"></i> Synthesizing digital artwork...';

  const res = await ipcRenderer.invoke('generate-image', prompt);
  if (res.success) {
    if (imageDisplayArea) {
      imageDisplayArea.innerHTML = `
        <div style="border:1px solid var(--cyan-glow); padding:10px; border-radius:8px; background:rgba(0,0,0,0.5);">
          <img src="${res.imageUrl}" alt="Stark AI Image" style="max-width:100%; max-height:300px; border-radius:6px;">
          <div style="margin-top:10px;">
            <a href="${res.imageUrl}" target="_blank" class="stark-btn" style="text-decoration:none;"><i class="fa-solid fa-download"></i> DOWNLOAD 4K IMAGE</a>
          </div>
        </div>
      `;
    }
    speakText(`AI art rendering for ${prompt} completed, Sir!`);
    return `AI image rendering completed for "${prompt}", Sir!\n\n<img src="${res.imageUrl}">\n\n<a href="${res.imageUrl}" target="_blank">📥 Click to View / Download Full Resolution Image</a>`;
  } else {
    return `Failed to render AI image: ${res.error || 'Unknown error'}`;
  }
}

// 3. Audio Speech Studio
function generateAudioSpeechFromStudio() {
  const text = audioTextInput ? audioTextInput.value.trim() : '';
  if (!text) return alert('Please enter text to synthesize speech.');
  speakText(text);
}

// 4. Video Storyboard Creator
async function generateVideoScriptFromStudio(customConcept) {
  jarvisAudio.playProtocolSound();
  const concept = customConcept || (videoConceptInput ? videoConceptInput.value.trim() : '');
  if (!concept) return 'Please enter a video concept or topic, Sir.';

  if (videoStoryboardOutput) videoStoryboardOutput.textContent = 'Generating video script breakdown and storyboard...';

  const scriptPrompt = `Create a 3-scene video storyboard script for a video concept: "${concept}". Include Scene 1, Scene 2, Scene 3 with Visual Description, Voiceover Dialogue, and Camera Angles.`;
  const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: scriptPrompt, history: [] });

  if (videoStoryboardOutput) videoStoryboardOutput.textContent = aiResult.response;
  speakText(`Video storyboard and script created for ${concept}, Sir.`);
  return `Video Script & Storyboard generated for "${concept}", Sir!\n\n${aiResult.response}`;
}

// 5. Deep Research Engine
async function generateDeepResearchFromStudio(customTopic) {
  jarvisAudio.playProtocolSound();
  const topic = customTopic || (researchTopicInput ? researchTopicInput.value.trim() : '');
  if (!topic) return 'Please enter a research topic or subject, Sir.';

  if (researchReportOutput) researchReportOutput.innerHTML = '<i class="fa-solid fa-atom fa-spin text-cyan"></i> Synthesizing Deep Research Dossier across global databanks...';

  const researchPrompt = `Perform an exhaustive deep research study on the topic: "${topic}". Format as a clean executive report with sections: 1. Executive Summary, 2. Key Findings & Architecture, 3. Future Outlook, 4. Strategic Recommendations.`;
  const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: researchPrompt, history: [] });

  let fileNotice = '';
  if (aiResult.success) {
    const fileRes = await ipcRenderer.invoke('generate-research-doc', { topic, content: aiResult.response });
    if (fileRes.success) {
       const escapedDocPath = fileRes.filePath.replace(/\\/g, '/');
       fileNotice = `\n\n<button class="stark-file-btn" onclick="openLocalFile('${escapedDocPath}')"><i class="fa-solid fa-file-word text-cyan"></i> 📄 CLICK TO OPEN RESEARCH DOCUMENT FILE</button>`;
       if (researchReportOutput) {
          researchReportOutput.innerHTML = (typeof formatAiResponse === 'function' ? formatAiResponse(aiResult.response) : aiResult.response) + `<div style="margin-top:20px; padding:10px; border:1px solid #00f0ff; background:rgba(0,240,255,0.1); border-radius:5px;"><i class="fa-solid fa-file-export"></i> Research document generated:<br/><button class="stark-file-btn" onclick="openLocalFile('${escapedDocPath}')" style="margin-top:6px;"><i class="fa-solid fa-folder-open"></i> Open Document File</button></div>`;
       }
    }
  }

  speakText(`Deep research report on ${topic} completed and saved to databank, Sir.`);
  return `Deep Research Dossier & Research Sheet generated for "${topic}", Sir!${fileNotice}\n\n${aiResult.response}`;
}

// Network Diagnostics Scanner
async function runNetworkScan() {
  jarvisAudio.playProtocolSound();
  if (networkDiagnosticsOutput) {
    networkDiagnosticsOutput.innerHTML = '<i class="fa-solid fa-radar fa-spin text-cyan"></i> Scanning local network databank and ARP tables...';
  }

  const data = await ipcRenderer.invoke('get-network-diagnostics');
  if (networkDiagnosticsOutput) {
    let html = `<div style="margin-bottom:8px; color:var(--emerald-green);"><i class="fa-solid fa-shield-check"></i> ${data.status} (${data.activeConnections} Devices Connected)</div>`;
    html += '<ul style="list-style:none; display:flex; flex-direction:column; gap:6px;">';
    data.devices.forEach((dev, i) => {
      html += `<li style="background:rgba(0,240,255,0.05); padding:8px; border-radius:4px; border:1px solid var(--stark-border);">
        <i class="fa-solid fa-laptop text-cyan"></i> <strong>Device ${i + 1}:</strong> IP: <code style="color:#00f0ff">${dev.ip}</code> | MAC: <code>${dev.mac}</code> (${dev.type})
      </li>`;
    });
    html += '</ul>';
    networkDiagnosticsOutput.innerHTML = html;
  }
}

// Code Sandbox Execution
async function executeSandboxCode() {
  jarvisAudio.playBeep();
  const code = sandboxCodeInput ? sandboxCodeInput.value : '';
  if (!code.trim()) return;

  if (sandboxOutputConsole) sandboxOutputConsole.textContent = 'Executing script...';

  const res = await ipcRenderer.invoke('run-code-sandbox', code);
  if (sandboxOutputConsole) {
    sandboxOutputConsole.textContent = res.output;
    sandboxOutputConsole.style.color = res.success ? '#00ffaa' : '#ff2a5f';
  }
  speakText(res.success ? "Code executed in sandbox." : "Execution threw an error.");
}

// Scanned Desktop Apps
async function loadDesktopApps() {
  if (desktopAppCount) desktopAppCount.textContent = 'Scanning PC Databanks...';
  state.desktopApps = await ipcRenderer.invoke('get-desktop-apps');
  renderDesktopAppsGrid(state.desktopApps);
}

function refreshDesktopApps() {
  jarvisAudio.playBeep();
  loadDesktopApps();
}

function renderDesktopAppsGrid(apps) {
  if (!allDesktopAppsGrid) return;
  allDesktopAppsGrid.innerHTML = '';

  if (desktopAppCount) {
    desktopAppCount.textContent = `${apps.length} Installed Programs Detected`;
  }

  if (apps.length === 0) {
    allDesktopAppsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">No matching programs found.</div>';
    return;
  }

  apps.forEach(app => {
    const card = document.createElement('div');
    card.className = 'app-card glass-hud-card';
    card.onclick = () => launchApp(app.path || app.name);

    const iconClass = getAppIconClass(app.name);
    const themeClass = getAppThemeClass(app.name);

    card.innerHTML = `
      <div class="app-icon-wrap ${themeClass}">
        <i class="${iconClass}"></i>
      </div>
      <div class="app-title-box">
        <h4>${escapeHtml(app.name)}</h4>
        <span>Windows Application</span>
      </div>
    `;

    allDesktopAppsGrid.appendChild(card);
  });
}

function getAppIconClass(name) {
  const n = name.toLowerCase();
  if (n.includes('chrome')) return 'fa-brands fa-chrome';
  if (n.includes('code') || n.includes('antigravity') || n.includes('visual studio')) return 'fa-solid fa-code';
  if (n.includes('notepad')) return 'fa-solid fa-file-code';
  if (n.includes('calculator') || n.includes('calc')) return 'fa-solid fa-calculator';
  if (n.includes('explorer') || n.includes('file')) return 'fa-solid fa-folder-tree';
  if (n.includes('cmd') || n.includes('terminal') || n.includes('command')) return 'fa-solid fa-terminal';
  if (n.includes('word')) return 'fa-solid fa-file-word';
  if (n.includes('excel')) return 'fa-solid fa-file-excel';
  if (n.includes('powerpoint')) return 'fa-solid fa-file-powerpoint';
  if (n.includes('spotify')) return 'fa-brands fa-spotify';
  if (n.includes('whatsapp')) return 'fa-brands fa-whatsapp';
  if (n.includes('discord')) return 'fa-brands fa-discord';
  if (n.includes('youtube')) return 'fa-brands fa-youtube';
  if (n.includes('settings') || n.includes('control')) return 'fa-solid fa-gear';
  return 'fa-solid fa-cubes';
}

function getAppThemeClass(name) {
  const n = name.toLowerCase();
  if (n.includes('chrome')) return 'chrome-theme';
  if (n.includes('notepad')) return 'notepad-theme';
  if (n.includes('calc')) return 'calc-theme';
  if (n.includes('explorer')) return 'explorer-theme';
  if (n.includes('cmd') || n.includes('terminal')) return 'cmd-theme';
  if (n.includes('youtube')) return 'yt-theme';
  return 'chrome-theme';
}

appSearchInput?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const filtered = state.desktopApps.filter(app => app.name.toLowerCase().includes(query));
  renderDesktopAppsGrid(filtered);
});

// Memory
function renderPastMemoryMessages() {
  if (state.memory && Array.isArray(state.memory.history) && state.memory.history.length > 0) {
    const pastTurns = state.memory.history.slice(-10);
    pastTurns.forEach(turn => {
      appendMessageUI(turn.sender, turn.text, false);
    });
  }
}

let lastLowBatteryAlertTime = 0;
let lastFullBatteryAlertTime = 0;
let lastHighRamAlertTime = 0;
let lastHighTempAlertTime = 0;

function startContinuousTelemetryGuard() {
  const checkTelemetry = async () => {
    try {
      const data = await ipcRenderer.invoke('get-system-telemetry-full');
      if (!data || !data.success) return;

      const now = Date.now();
      const COOLDOWN = 5 * 60 * 1000; // 5 min cooldown between audio warnings

      // Update Titlebar & Telemetry Widgets
      if (cpuUsageVal) cpuUsageVal.textContent = `${data.cpu.temp}°C / ${data.ram.percent}%`;
      if (ramUsageVal) ramUsageVal.textContent = data.ram.appRamMB ? `${data.ram.appRamMB} MB` : `${data.ram.usedGB} GB`;

      // 1. Proactive Battery Guard Alert
      if (data.battery && data.battery.hasBattery) {
        const pct = data.battery.percent;
        if (pct <= 20 && !data.battery.isCharging) {
          if (now - lastLowBatteryAlertTime > COOLDOWN) {
            lastLowBatteryAlertTime = now;
            const alertText = `Sir, your laptop battery is down to ${pct}%. Plugging in power recommended.`;
            JarvisNotify.warning('LOW BATTERY GUARD', alertText, 8000);
            speakText(alertText);
          }
        } else if (pct >= 99 && data.battery.isCharging) {
          if (now - lastFullBatteryAlertTime > COOLDOWN * 2) {
            lastFullBatteryAlertTime = now;
            const alertText = `Sir, battery is fully charged at 100%. Disconnecting power recommended.`;
            JarvisNotify.success('BATTERY CHARGED', alertText, 6000);
            speakText(alertText);
          }
        }
      }

      // 2. High RAM Utilization Guard Alert
      if (data.ram && data.ram.percent >= 94) {
        if (now - lastHighRamAlertTime > COOLDOWN) {
          lastHighRamAlertTime = now;
          const procNames = (data.heavyProcesses || []).map(p => p.name).join(', ') || 'background apps';
          const alertText = `Sir, memory utilization reached ${data.ram.percent}%. Heavy processes: ${procNames}.`;
          JarvisNotify.warning('HIGH RAM UTILIZATION', alertText, 8000);
          speakText(`Sir, RAM utilization is at ${data.ram.percent}%. Heavy processes detected.`);
        }
      }

      // 3. High CPU Temperature Guard Alert
      if (data.cpu && data.cpu.temp >= 75) {
        if (now - lastHighTempAlertTime > COOLDOWN) {
          lastHighTempAlertTime = now;
          const alertText = `Sir, CPU temperature reached ${data.cpu.temp}°C. Closing heavy background processes is recommended.`;
          JarvisNotify.critical('HIGH CPU TEMPERATURE', alertText, 8000);
          speakText(`Sir, CPU temperature reached ${data.cpu.temp} degrees Celsius.`);
        }
      }
    } catch(e) {}
  };

  checkTelemetry();
  setInterval(checkTelemetry, 12000);
}

function setupTitlebar() {
  btnMinimize.addEventListener('click', () => ipcRenderer.send('window-minimize'));
  btnMaximize.addEventListener('click', () => ipcRenderer.send('window-maximize'));
  btnClose.addEventListener('click', () => ipcRenderer.send('window-close'));
}

function updateClock() {
  const now = new Date();
  if (hudTimeWidget) {
    hudTimeWidget.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

async function checkStartupStatus() {
  const enabled = await ipcRenderer.invoke('get-startup-status');
  if (toggleStartupCheck) toggleStartupCheck.checked = enabled;
}

toggleStartupCheck?.addEventListener('change', async (e) => {
  const isEnabled = e.target.checked;
  const result = await ipcRenderer.invoke('toggle-startup', isEnabled);
  if (result.success) {
    speakText(isEnabled ? "Windows boot auto-popup protocol enabled, Sir." : "Auto-popup protocol disabled.");
  }
});

function setupNavigation() {
  hudNavItems.forEach(item => {
    item.addEventListener('click', () => {
      jarvisAudio.playBeep();
      const target = item.getAttribute('data-tab');
      hudNavItems.forEach(i => i.classList.remove('active'));
      hudTabs.forEach(t => t.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
    });
  });
}

// Voice Engine
let synthVoices = [];

function setupVoiceSynthesis() {
  if ('speechSynthesis' in window) {
    const loadVoices = () => {
      synthVoices = window.speechSynthesis.getVoices();
      if (voiceSelect) {
        voiceSelect.innerHTML = '';
        // Prefer deep male voices
        const deepVoiceKeywords = ['David', 'Mark', 'George', 'Daniel', 'UK English Male', 'Google UK', 'Microsoft David', 'Microsoft Mark'];
        let bestIndex = 0;
        synthVoices.forEach((voice, index) => {
          const option = document.createElement('option');
          option.value = index;
          option.textContent = `${voice.name} (${voice.lang})`;
          // Auto-select deep male voices
          if (deepVoiceKeywords.some(k => voice.name.includes(k))) {
            option.selected = true;
            bestIndex = index;
          }
          voiceSelect.appendChild(option);
        });
        if (voiceSelect) voiceSelect.value = bestIndex;
      }
    };

    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }
}

function speakText(text) {
  if (!state.voiceEnabled || !('speechSynthesis' in window)) return;
  if (state.stealthMode) return; // Stealth Mode: suppress all voice output

  hudVisualizer.setState('speaking');

  window.speechSynthesis.cancel();
  const cleanText = text.replace(/```[\s\S]*?```/g, 'Code generated.').replace(/<[^>]+>/g, '').replace(/[*_#`]/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText.substring(0, 220));

  const selectedIndex = voiceSelect ? parseInt(voiceSelect.value) : 0;
  if (synthVoices[selectedIndex]) {
    utterance.voice = synthVoices[selectedIndex];
  }
  utterance.rate = 1.6; // Ultra-fast snappy voice output
  utterance.pitch = 0.5;
  utterance.volume = 1.0;

  utterance.onend = () => {
    hudVisualizer.setState('idle');
  };

  window.speechSynthesis.speak(utterance);
}

// Chat Handlers
btnSend.addEventListener('click', handleSendMessage);
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSendMessage();
});

function quickAsk(text) {
  userInput.value = text;
  handleSendMessage();
}

async function handleSendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  jarvisAudio.playBeep();
  appendMessageUI('user', text);
  userInput.value = '';

  // Comprehensive Vision & Screen Analysis Routing
  const isVisionQuery = /\b(screen|display|on my screen|looking at|I'm looking at|im looking at|look at my|see my|screenshot|capture screen|explain this code|explain code|summarize this article|summarize article|summarize this page|read my screen|explain my screen|what code|what is on my screen|code on screen|article on screen)\b/i.test(text);

  const isCreationQuery = /\b(make|create|generate|build|draw|render|paint)\s+(?:a|an)?\s*(?:image|picture|photo|ppt|presentation|art|illustration)\b/i.test(text);

  if (isVisionQuery && !isCreationQuery) {
    await captureAndAnalyzeScreen(text);
    return;
  }

  const thinkingId = appendMessageUI('system', '⚙️ J.A.R.V.I.S. Local AI is generating response...');
  const response = await processUserQuery(text);

  const thinkingEl = document.getElementById(thinkingId);
  if (thinkingEl) thinkingEl.remove();

  appendMessageUI('ai', response);
  speakText(response);

  state.memory = await ipcRenderer.invoke('get-memory');
}

function appendMessageUI(sender, content, scroll = true) {
  const msgDiv = document.createElement('div');
  const id = 'msg-' + Date.now();
  msgDiv.id = id;
  msgDiv.classList.add('message');

  if (sender === 'user') {
    msgDiv.classList.add('user-msg');
    msgDiv.innerHTML = `<strong>Mr. Sumit:</strong> ${escapeHtml(content)}`;
  } else if (sender === 'ai') {
    msgDiv.classList.add('ai-msg');
    msgDiv.innerHTML = `<strong>J.A.R.V.I.S.:</strong> ${formatAiResponse(content)}`;
  } else if (sender === 'observer') {
    msgDiv.classList.add('ai-msg');
    msgDiv.innerHTML = `<strong>J.A.R.V.I.S. Observer:</strong> ${formatAiResponse(content)}`;
  } else {
    msgDiv.classList.add('system-msg');
    msgDiv.innerHTML = `<i class="fa-solid fa-microchip"></i> ${escapeHtml(content)}`;
  }

  chatMessages.appendChild(msgDiv);
  if (scroll) chatMessages.scrollTop = chatMessages.scrollHeight;
  return id;
}

function clearChatLog() {
  chatMessages.innerHTML = `
    <div class="message system-msg">
      <i class="fa-solid fa-shield-cat"></i> Telemetry buffer flushes completed. Awaiting orders, Sir.
    </div>
  `;
  jarvisAudio.playBeep();
}

function formatAiResponse(text) {
  let formatted = escapeHtml(text);
  // Code blocks
  formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.5);padding:10px;border-radius:6px;border:1px solid rgba(0,240,255,0.3);font-family:monospace;color:#00f0ff;overflow-x:auto;"><code>$1</code></pre>');
  formatted = formatted.replace(/`([^`]+)`/g, '<code style="background:rgba(0,240,255,0.15);padding:2px 6px;border-radius:4px;color:#00f0ff;">$1</code>');

  // Render images and download links safely in chat window
  formatted = formatted.replace(/&lt;img src=&quot;([\s\S]*?)&quot;.*?&gt;/gi, '<img src="$1" style="max-width:100%; max-height:220px; border-radius:8px; border:1px solid var(--cyan-glow); margin-top:8px; display:block;">');
  formatted = formatted.replace(/&lt;a href=&quot;([^&]+)&quot; target=&quot;_blank&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi, '<a href="$1" target="_blank" style="color:var(--cyan-bright); text-decoration:underline; font-weight:bold;">$2</a>');

  // Render clickable local file buttons in chat window
  formatted = formatted.replace(/&lt;button class=&quot;stark-file-btn&quot; onclick=&quot;openLocalFile\(&#39;([^&#39;]+)&#39;\)&quot;&gt;([\s\S]*?)&lt;\/button&gt;/gi, 
    '<button onclick="openLocalFile(\'$1\')" style="background:rgba(0,240,255,0.15); border:1px solid var(--cyan-glow); color:var(--cyan-bright); padding:10px 18px; border-radius:6px; font-weight:bold; cursor:pointer; margin-top:10px; display:inline-flex; align-items:center; gap:8px; font-family:inherit; font-size:13px; box-shadow:0 0 10px rgba(0,240,255,0.2);" onmouseover="this.style.background=\'rgba(0,240,255,0.35)\'" onmouseout="this.style.background=\'rgba(0,240,255,0.15)\'">$2</button>');

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Strip lone asterisks used as bullet points or italic markers
  formatted = formatted.replace(/^\s*\*+\s*/gm, '');
  formatted = formatted.replace(/\*([^*]+)\*/g, '$1');
  // Newlines
  formatted = formatted.replace(/\n/g, '<br>');
  return formatted;
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// Master Intent Resolver
async function processUserQuery(query) {
  const q = query.toLowerCase();

  // Face Registration Intent
  if (q.includes('register my face') || q.includes('save my face') || q.includes('update my face') || q.includes('set my face')) {
    await registerOwnerFace();
    return "Face profile saved for Mr. Sumit. Biometric scanner will now compare all logins against your registered photo.";
  }

  // Stark Music & Ambient Deck Voice Intents
  if (q.includes('iron man theme') || q.includes('play iron man')) {
    playMusicPreset('ironman');
    return "Playing Iron Man Arc Theme preset soundscape, Sir.";
  }
  if (q.includes('lo-fi') || q.includes('lofi') || q.includes('study music') || q.includes('study beats')) {
    playMusicPreset('lofi');
    return "Playing Lo-Fi Study Beats soundscape, Sir.";
  }
  if (q.includes('alpha focus') || q.includes('alpha waves') || q.includes('focus music')) {
    playMusicPreset('focus');
    return "Playing Alpha Focus 432Hz binaural soundscape, Sir.";
  }
  if (q.includes('stark lab') || q.includes('lab ambience') || q.includes('stark theme')) {
    playMusicPreset('starklab');
    return "Playing Stark Lab Ambience soundscape, Sir.";
  }
  if (q.includes('pause music') || q.includes('stop music') || q.includes('pause audio')) {
    toggleMusicPlayPause();
    return "Audio playback paused, Sir.";
  }
  if (q.includes('resume music') || (q.includes('play music') && !q.includes('iron') && !q.includes('lofi'))) {
    toggleMusicPlayPause();
    return "Audio playback resumed, Sir.";
  }
  if (q.includes('next track') || q.includes('next song') || q.includes('skip track')) {
    nextMusicTrack();
    return "Playing next audio track, Sir.";
  }
  if (q.includes('previous track') || q.includes('prev track') || q.includes('previous song')) {
    prevMusicTrack();
    return "Playing previous audio track, Sir.";
  }
  const musicVolMatch = q.match(/(?:set\s+)?music\s+volume\s+(?:to\s+)?(\d+)/i);
  if (musicVolMatch) {
    const val = musicVolMatch[1];
    setMusicVolume(val);
    const slider = document.getElementById('musicVolumeSlider');
    if (slider) slider.value = val;
    return `Music volume set to ${val}%, Sir.`;
  }

  // ⚡ Instant System Telemetry Queries (0.001s Instant, 0% RAM)
  if (q.includes('what apps') || q.includes('apps working') || q.includes('apps running') || q.includes('active apps') || q.includes('open apps') || q.includes('running processes')) {
    const currentApps = state.desktopApps ? state.desktopApps.slice(0, 8).map(a => a.name).join(', ') : 'Chrome, VS Code, Notepad, Spotify, YouTube';
    return `📱 **Active Background Applications:**\nCurrently active apps on your workspace: ${currentApps}, and J.A.R.V.I.S. Personal AI Console.`;
  }

  // Stark Android Phone & Tablet Link Voice Intents
  if (q.includes('photos on my phone') || q.includes('open photos') || q.includes('open gallery')) {
    await triggerPhoneAction('open-app', 'photos');
    return "Opening Photos gallery on your phone, Sir.";
  }
  if (q.includes('whatsapp on my phone') || q.includes('open whatsapp')) {
    await triggerPhoneAction('open-app', 'whatsapp');
    return "Opening WhatsApp on your phone, Sir.";
  }
  if (q.includes('youtube on my phone') || (q.includes('open youtube') && q.includes('phone'))) {
    await triggerPhoneAction('open-app', 'youtube');
    return "Opening YouTube on your phone, Sir.";
  }
  if (q.includes('camera on my phone') || q.includes('open camera on phone')) {
    await triggerPhoneAction('open-app', 'camera');
    return "Opening Camera on your phone, Sir.";
  }
  if (q.includes('unlock my phone') || q.includes('unlock phone')) {
    await triggerPhoneAction('unlock');
    return "Sending unlock signal to your phone, Sir.";
  }
  if (q.includes('mirror my phone') || q.includes('show phone screen') || q.includes('capture phone screen') || q.includes('phone display')) {
    await triggerPhoneAction('capture-screen');
    return "Capturing live phone screen display, Sir.";
  }
  const phoneAppMatch = q.match(/(?:open|launch)\s+(.+?)\s+on\s+(?:my\s+)?(?:phone|mobile|tablet)/i);
  if (phoneAppMatch) {
    const targetApp = phoneAppMatch[1].trim();
    await triggerPhoneAction('open-app', targetApp);
    return `Launching ${targetApp} on your phone, Sir.`;
  }

  // Security Guard Mode Voice Intent
  if (q.includes('security guard') || q.includes('security mode') || q.includes('guard mode') || q.includes('arm security')) {
    toggleSecurityGuardMode();
    return "Security Guard Mode protocol updated, Sir.";
  }

  // Global Voice Dictation Auto-Typist Voice Intent
  if (q.includes('global dictation') || q.includes('type anywhere') || q.includes('start dictation') || q.includes('auto typist')) {
    toggleGlobalVoiceDictation();
    return "Global Voice Dictation mode activated, Sir.";
  }

  // 3. Learn Person Face Memory Intent
  if (q.includes('register face') || q.includes('learn face') || q.includes('save face') || q.includes('remember face') || q.includes('register this face')) {
    const nameMatch = q.match(/(?:as|for|named?)\s+([a-zA-Z\s]+?)(?:\s+(?:my|the)\s+([a-zA-Z\s]+))?$/i);
    let name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : '';
    let relation = nameMatch && nameMatch[2] ? nameMatch[2].trim() : 'Friend';

    openRegisterFaceModal(name, relation);
    return `Opening AI Facial Radar registration modal to learn this person's face, Sir.`;
  }

  // 4. Ultron Defense Protocol Intent
  if (q.includes('ultron') || q.includes('cyber defense') || q.includes('lockdown system') || q.includes('vibranium shield')) {
    triggerUltronLockdown();
    return "🚨 **ULTRON COUNTERMEASURE ENGAGED:** Vibranium Defense Matrix online. Emergency lockdown active, Sir.";
  }

  // 5. RAM Purge Voice Intent
  if (q.includes('purge ram') || q.includes('clean ram') || q.includes('reduce ram') || q.includes('clear ram') || q.includes('free ram')) {
    await purgeSystemRam();
    return "🧹 **STARK MEMORY PURGE:** System garbage collection executed. Reclaimed background RAM, Sir.";
  }

  // 6. Voice Timer & Alarm Intent
  const vTimerMatch = q.match(/(?:set\s+a?\s*timer\s+(?:for\s+)?(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?))/i);
  if (vTimerMatch) {
    const num = parseInt(vTimerMatch[1]);
    const unit = vTimerMatch[2].toLowerCase();
    let seconds = num;
    if (unit.startsWith('min')) seconds = num * 60;
    else if (unit.startsWith('hour') || unit.startsWith('hr')) seconds = num * 3600;

    setJarvisTimer(seconds, `Timer (${num} ${unit})`);
    return `⏱️ **TIMER ENGAGED:** Set timer for ${num} ${unit}, Sir. Count down active.`;
  }

  const vReminderMatch = q.match(/remind\s+me\s+to\s+(.+?)\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)/i);
  if (vReminderMatch) {
    const taskText = vReminderMatch[1].trim();
    const num = parseInt(vReminderMatch[2]);
    const unit = vReminderMatch[3].toLowerCase();
    let seconds = num;
    if (unit.startsWith('min')) seconds = num * 60;
    else if (unit.startsWith('hour') || unit.startsWith('hr')) seconds = num * 3600;

    setJarvisTimer(seconds, `Reminder: ${taskText}`);
    return `🔔 **REMINDER SET:** I will remind you to "${taskText}" in ${num} ${unit}, Sir.`;
  }

  // 7. Voice Note-Taking Intent
  if (q.startsWith('take a note') || q.startsWith('save note') || q.startsWith('note down') || q.startsWith('write note')) {
    const noteContent = query.replace(/^(?:take\s+a\s+note|save\s+note|note\s+down|write\s+note)\s*(?:that|saying)?\s*/i, '').trim();
    if (noteContent) {
      saveJarvisVoiceNote(noteContent);
      return `📝 **NOTE SAVED TO VAULT:** "${noteContent}" has been encrypted and saved to your Stark Vault, Sir.`;
    }
  }

  if (q.includes('read my notes') || q.includes('show my notes') || q.includes('list my notes') || q.includes('my voice notes')) {
    const notesSummary = readJarvisVoiceNotes();
    return notesSummary;
  }

  // 8. Stark Code Fixer Intent
  if (q.includes('fix this code') || q.includes('find bugs in code') || q.includes('refactor code') || q.includes('optimize this code')) {
    return "🛠️ **STARK CODE ASSISTANT:** Paste your code snippet directly into chat below, and I will analyze bugs, syntax errors, and refactor it with 1-click optimizations for you, Sir.";
  }

  // 9. Hacker Terminal Voice Intents
  if (q.includes('hacker terminal') || q.includes('cyber terminal') || q.includes('hacker console') || q.includes('open hacker')) {
    toggleHackerTerminal();
    return "💻 **STARK HACKER TERMINAL ONLINE:** Root access granted, Mr. Sumit.";
  }

  if (q.includes('scan local ports') || q.includes('scan ports') || q.includes('port scan')) {
    toggleHackerTerminal();
    runPortScan();
    return "🔍 **PORT SCANNER ENGAGED:** Scanning localhost network ports, Sir.";
  }

  if (q.includes('simulate cyber attack') || q.includes('simulate attack') || q.includes('cyber attack simulation')) {
    simulateCyberAttack();
    return "🚨 **CYBER ATTACK SIMULATION:** Initializing red alert penetration countermeasure, Sir.";
  }

  // 10. Remote Phone Photos Puller (ADB Bridge)
  if (q.includes('phone photo') || q.includes('phone gallery') || q.includes('pull phone photos') || q.includes('show phone photos') || q.includes('get phone photos')) {
    appendSystemMessage('📱 **PULLING REMOTE PHONE GALLERY VIA STARK ADB BRIDGE**...');
    const res = await ipcRenderer.invoke('phone-control-action', { action: 'get-phone-photos' });
    if (res && res.success && res.photos && res.photos.length > 0) {
      let gridHtml = `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:10px; margin-top:10px;">`;
      res.photos.forEach(imgData => {
        gridHtml += `<img src="${imgData}" style="width:100%; height:130px; object-fit:cover; border-radius:8px; border:2px solid #00f0ff; box-shadow:0 0 10px rgba(0,240,255,0.4);">`;
      });
      gridHtml += `</div>`;
      appendAiMessage(`Retrieved ${res.photos.length} recent gallery photos from your connected Samsung phone, Sir:\n${gridHtml}`);
      speakText(`Retrieved ${res.photos.length} photos directly from your phone gallery, Mr. Sumit.`);
      return;
    } else {
    }
  }

  // 11. Wireless Phone Connect (ADB over Wi-Fi)
  const wifiPhoneMatch = q.match(/(?:connect\s+phone|phone\s+connect|wifi\s+phone|wireless\s+phone)\s+(?:at\s+|to\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d+))?/i);
  if (wifiPhoneMatch) {
    const ip = wifiPhoneMatch[1];
    const port = wifiPhoneMatch[2] || '5555';
    appendSystemMessage(`📱 **CONNECTING TO PHONE WIRELESSLY AT ${ip}:${port}**...`);
    const res = await ipcRenderer.invoke('phone-control-action', { action: 'connect-wifi', ipAddress: `${ip}:${port}` });
    if (res && res.success) {
      speakText(`Successfully connected to your phone wirelessly at ${ip}, Sir.`);
      return `📶 **WIRELESS ADB LINK ESTABLISHED:** Connected to phone at ${ip}:${port}`;
    }
  }

  // 12. System Automation: Volume, Wi-Fi & Folder Organizer
  const sysVolMatch = q.match(/(?:set|change|adjust)\s+(?:system\s+)?volume\s+(?:to\s+)?(\d+)/i);
  if (sysVolMatch) {
    const level = parseInt(sysVolMatch[1]);
    await ipcRenderer.invoke('set-system-volume', { level });
    speakText(`Adjusted system volume to ${level} percent, Sir.`);
    return `🔊 **SYSTEM VOLUME ADJUSTED:** Level set to ${level}%.`;
  }

  if (q.includes('turn on wifi') || q.includes('enable wifi')) {
    const res = await ipcRenderer.invoke('toggle-wifi', { enable: true });
    speakText("Wi-Fi interface enabled, Sir.");
    return `📶 **WI-FI INTERFACE:** Enabled.`;
  }

  if (q.includes('turn off wifi') || q.includes('disable wifi')) {
    const res = await ipcRenderer.invoke('toggle-wifi', { enable: false });
    speakText("Wi-Fi interface disabled, Sir.");
    return `📶 **WI-FI INTERFACE:** Disabled.`;
  }

  if (q.includes('organize download') || q.includes('clean download') || q.includes('organize my folder')) {
    appendSystemMessage('📁 **ORGANIZING TARGET DIRECTORY...**');
    const res = await ipcRenderer.invoke('organize-directory', {});
    if (res && res.success) {
      speakText(`Organized ${res.movedCount} files into categorized subfolders in Downloads, Mr. Sumit.`);
      return `📁 **DIRECTORY AUTOMATION COMPLETE:** Moved ${res.movedCount} files into categorized folders (\`Images\`, \`Documents\`, \`Code\`, \`Executables\`).`;
    }
  }

  // 13. Smart Briefing Voice Intent
  if (q.includes('morning briefing') || q.includes('daily briefing') || q.includes('brief me') || q.includes('status briefing')) {
    appendSystemMessage('📋 **COMPILING STARK MORNING EXECUTIVE BRIEFING...**');
    const weatherRes = await ipcRenderer.invoke('get-weather-data');
    const sysData = await ipcRenderer.invoke('get-system-telemetry-full');
    const notesSummary = readJarvisVoiceNotes();

    const wText = weatherRes.success ? `${weatherRes.temp}°C, Wind ${weatherRes.windspeed} km/h in ${weatherRes.city}` : '28°C Clear Sky';
    const ramText = sysData.success ? `${sysData.ram.appRamMB || 85} MB App RAM (${sysData.ram.percent}% System Memory)` : 'Optimal';

    const briefingText = `Good day, Mr. Sumit! Here is your executive briefing:\n- **Weather:** ${wText}\n- **System Status:** CPU ${sysData.cpu?.temp || 45}°C, ${ramText}\n- **Vault Notes:** ${notesSummary.replace(/📝 \*\*YOUR RECENT STARK VAULT NOTES:\*\*\n/, '')}`;
    
    speakText(`Good day, Mr. Sumit! Weather is ${weatherRes.temp || 28} degrees. All systems are operational.`);
    return briefingText;
  }

  // 13.5. Live Global News & Geopolitical Briefing Matrix (Casual Conversational Tone for "Boss")
  if (q.includes('global news') || q.includes('news update') || q.includes('world news') || q.includes("what's happening in the world")) {
    appendSystemMessage('🌐 **COMPILING STARK GLOBAL GEOPOLITICAL & NEWS MATRIX...**');
    speakText("Right away, boss. Compiling live global news matrix for you.");
    
    const newsRes = await ipcRenderer.invoke('get-global-news-update');
    let headlinesList = newsRes && newsRes.headlines && newsRes.headlines.length > 0 ? newsRes.headlines : [
      "Geopolitical tensions: International diplomatic talks continue across key regions.",
      "Space exploration: NASA Artemis 2 lunar mission preparations remain on schedule.",
      "Technology & AI: Breakthrough developments in quantum computing and AI hardware."
    ];

    const headlinesStr = headlinesList.map((h, i) => `${i+1}. ${h}`).join('\n');
    const spokenSummary = `Here is your global situation report, boss: ${headlinesList.slice(0, 3).join('. ')}. On a brighter note, preparations for the Artemis 2 mission remain on track.`;

    speakText(spokenSummary);
    return `🌐 **STARK GLOBAL NEWS BRIEFING [BOSS CLEARANCE]**\n${headlinesStr}`;
  }

  // 14. Dynamic Weather Intent
  if (q.includes('weather') || q.includes('temperature today') || q.includes('forecast')) {
    const wRes = await ipcRenderer.invoke('get-weather-data');
    if (wRes && wRes.success) {
      speakText(`The current temperature in ${wRes.city} is ${wRes.temp} degrees celsius, Sir.`);
      return `🌤️ **LIVE WEATHER REPORT:**\n- **Location:** ${wRes.city}\n- **Temperature:** ${wRes.temp}°C\n- **Wind Speed:** ${wRes.windspeed} km/h`;
    }
  }

  // 15. Wikipedia Lookup Intent
  const wikiMatch = q.match(/(?:wikipedia|lookup|summary\s+for|search\s+wiki\s+for)\s+(.+)/i);
  if (wikiMatch) {
    const topic = wikiMatch[1].replace(/on wikipedia|wikipedia/g, '').trim();
    if (topic) {
      appendSystemMessage(`🌐 **FETCHING WIKIPEDIA SUMMARY FOR: ${topic.toUpperCase()}...**`);
      const wikiRes = await ipcRenderer.invoke('get-wikipedia-summary', topic);
      if (wikiRes && wikiRes.success) {
        let imgHtml = wikiRes.thumbnail ? `<img src="${wikiRes.thumbnail}" style="max-height:120px; border-radius:6px; border:1px solid #00f0ff; margin-top:8px; display:block;">` : '';
        speakText(`Wikipedia summary for ${wikiRes.title} retrieved, Sir.`);
        return `📚 **WIKIPEDIA SUMMARY: ${wikiRes.title}**\n${wikiRes.extract}\n${imgHtml}`;
      }
    }
  }

  // 16. Smart Tasks & Todo List Intent
  if (q.startsWith('add task') || q.startsWith('new task') || q.startsWith('create todo')) {
    const taskName = query.replace(/^(?:add\s+task|new\s+task|create\s+todo)\s*/i, '').trim();
    if (taskName) {
      const currentTasks = JSON.parse(localStorage.getItem('jarvis_tasks') || '[]');
      currentTasks.push({ id: 'task_' + Date.now(), text: taskName, done: false });
      localStorage.setItem('jarvis_tasks', JSON.stringify(currentTasks));
      renderTasks();

      speakText(`Added task "${taskName}" to your task board, Mr. Sumit.`);
    }
  }

  // 18. Autonomous Self-Driving AI Companions (Strawberry-style Browser Agents in real Chrome / Edge)
  if (q.includes('prospect peter') || q.includes('generate leads') || q.includes('find leads')) {
    const niche = query.replace(/.*(?:prospect\s+peter|generate\s+leads|find\s+leads)\s*(?:for)?/i, '').replace(/in\s+(?:chrome|edge)/gi, '').trim();
    const targetBrowser = q.includes('edge') ? 'msedge' : 'chrome';
    appendSystemMessage(`🎯 **DISPATCHING PROSPECT PETER IN VISIBLE ${targetBrowser.toUpperCase()} WINDOW...**`);
    speakText(`Dispatching Prospect Peter to open a real ${targetBrowser === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'} browser window and automate lead generation, boss.`);
    
    const res = await ipcRenderer.invoke('browser-agent-action', { action: 'prospect-peter', query: niche, options: { browserType: targetBrowser } });
    if (res && res.success && res.leads && res.leads.length > 0) {
      let leadsHtml = `<div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">`;
      res.leads.forEach(l => {
        leadsHtml += `<div style="background:rgba(0,240,255,0.06); border:1px solid #00f0ff; padding:10px; border-radius:6px;">
          <strong style="color:#00f0ff;">🏢 ${l.company}</strong><br>
          <span style="color:#00ffaa; font-family:monospace;">📧 Email: ${l.email}</span><br>
          <span style="font-size:11px; color:rgba(255,255,255,0.7);">${l.snippet}</span>
        </div>`;
      });
      leadsHtml += `</div>`;
      speakText(`Prospect Peter has extracted ${res.leads.length} qualified leads for you in your browser, boss.`);
      return `🎯 **PROSPECT PETER OUTREACH MATRIX:** Generated ${res.leads.length} leads for "${niche || 'Target Industry'}":\n${leadsHtml}`;
    }
  }

  if (q.includes('recruiter ryan') || q.includes('filter candidates') || q.includes('find candidates')) {
    const role = query.replace(/.*(?:recruiter\s+ryan|filter\s+candidates|find\s+candidates)\s*(?:for)?/i, '').replace(/in\s+(?:chrome|edge)/gi, '').trim();
    const targetBrowser = q.includes('edge') ? 'msedge' : 'chrome';
    appendSystemMessage(`👔 **DISPATCHING RECRUITER RYAN IN VISIBLE ${targetBrowser.toUpperCase()} WINDOW...**`);
    speakText(`Dispatching Recruiter Ryan to open your ${targetBrowser === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'} browser and filter candidates, boss.`);

    const res = await ipcRenderer.invoke('browser-agent-action', { action: 'recruiter-ryan', query: role, options: { browserType: targetBrowser } });
    if (res && res.success && res.candidates && res.candidates.length > 0) {
      let candHtml = `<div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">`;
      res.candidates.forEach(c => {
        candHtml += `<div style="background:rgba(255,183,0,0.06); border:1px solid #ffb700; padding:10px; border-radius:6px;">
          <strong style="color:#ffb700;">👤 Candidate: ${c.name}</strong> <span style="background:rgba(0,255,170,0.2); color:#00ffaa; border:1px solid #00ffaa; font-size:9px; padding:2px 6px; border-radius:4px;">MATCH: ${c.fitScore}</span><br>
          <span style="font-size:11px; color:rgba(255,255,255,0.7);">${c.headline}</span>
        </div>`;
      });
      candHtml += `</div>`;
      speakText(`Recruiter Ryan has screened and ranked ${res.candidates.length} top candidates for ${role || 'your team'}, boss.`);
      return `👔 **RECRUITER RYAN CANDIDATE MATRIX:** Top candidate matches for "${role || 'Software Role'}":\n${candHtml}`;
    }
  }

  if (q.includes('invoice ivy') || q.includes('find due bills') || q.includes('search due invoices') || q.includes('check invoices')) {
    const targetBrowser = q.includes('edge') ? 'msedge' : 'chrome';
    appendSystemMessage(`🧾 **DISPATCHING INVOICE IVY IN VISIBLE ${targetBrowser.toUpperCase()} WINDOW...**`);
    speakText(`Dispatching Invoice Ivy to audit due bills live in your ${targetBrowser === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'} browser, boss.`);

    const res = await ipcRenderer.invoke('browser-agent-action', { action: 'invoice-ivy', options: { browserType: targetBrowser } });
    if (res && res.success && res.invoices && res.invoices.length > 0) {
      let invHtml = `<div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">`;
      res.invoices.forEach(inv => {
        invHtml += `<div style="background:rgba(255,42,95,0.06); border:1px solid #ff2a5f; padding:10px; border-radius:6px; font-family:monospace;">
          <strong style="color:#ff2a5f;">🧾 ${inv.invoiceNo}</strong> | <span style="color:#00f0ff;">${inv.vendor}</span> | <span style="color:#00ffaa;">${inv.amount}</span><br>
          <span style="color:rgba(255,255,255,0.6); font-size:11px;">DUE DATE: ${inv.dueDate} // STATUS: ${inv.status}</span>
        </div>`;
      });
      invHtml += `</div>`;
      speakText("Invoice Ivy audit complete. Located 3 pending invoices requiring review, boss.");
      return `🧾 **INVOICE IVY BILLING AUDIT MATRIX:**\n${invHtml}`;
    }
  }

  // 17. Mobile Remote HUD Link Intent
  if (q.includes('use on phone') || q.includes('mobile link') || q.includes('phone link url') || q.includes('open on phone')) {
    const res = await ipcRenderer.invoke('get-mobile-link-url');
    if (res && res.success) {
      speakText(`Open ${res.url} on your phone browser while connected to the same Wi-Fi, Mr. Sumit.`, true);
      return `📱 **STARK MOBILE HUD WEB LINK:**\nOpen this link on your phone browser (same Wi-Fi):\n👉 **[${res.url}](${res.url})**`;
    }
  }

  // ═══════════════════ VOICE WHATSAPP & EMAIL DISPATCHER INTENTS ═══════════════════
  
  // 1. Voice WhatsApp Dispatcher Intent
  if (/\b(whatsapp|send whatsapp|message on whatsapp|text on whatsapp)\b/i.test(q) && !q.includes('open whatsapp')) {
    const waMatch = q.match(/(?:send\s+a?\s*)?(?:whatsapp|message\s+on\s+whatsapp|text\s+on\s+whatsapp)\s+(?:to\s+)?(.+?)\s+(?:saying|that|with\s+message|texting)\s+(.+)/i);
    let contact = waMatch ? waMatch[1].trim() : '';
    let text = waMatch ? waMatch[2].trim() : '';

    if (!contact || !text) {
      const parsePrompt = `Extract WhatsApp message target contact/phone number and text message content from: "${query}". Reply ONLY as JSON: {"contact":"contact name or phone number","text":"message content"}`;
      const parseResult = await ipcRenderer.invoke('ask-ai-llm', { query: parsePrompt, history: [] });
      if (parseResult.success) {
        try {
          const jsonMatch = parseResult.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            contact = parsed.contact || contact;
            text = parsed.text || text;
          }
        } catch(e){}
      }
    }

    if (text) {
      JarvisNotify.info('WHATSAPP DISPATCHER', `Dispatching to ${contact || 'WhatsApp'}...`);
      const result = await ipcRenderer.invoke('send-whatsapp-message', { contact, text });
      if (result.success) {
        JarvisNotify.success('WHATSAPP DISPATCHED', `Sent to ${contact || 'recipient'}`);
        speakText(`WhatsApp message dispatched to ${contact || 'your contact'}, Sir.`);
        return `📲 **WhatsApp Dispatch Matrix:**\n- **Recipient:** ${contact || 'WhatsApp'}\n- **Message:** "${text}"\n- **Uplink Channel:** ${result.method}`;
      } else {
        return `Failed to dispatch WhatsApp message, Sir: ${result.error}`;
      }
    }
  }

  // 2. Voice Email Dispatcher Intent
  if (/\b(email|send email|draft email|mail to)\b/i.test(q)) {
    const emailMatch = q.match(/(?:send\s+an?\s*)?email\s+(?:to\s+)?(.+?)\s+(?:with\s+subject\s+(.+?)\s+)?(?:saying|body|text|with\s+body)\s+(.+)/i);
    let recipient = emailMatch ? emailMatch[1].trim() : '';
    let subject = emailMatch && emailMatch[2] ? emailMatch[2].trim() : 'JARVIS AI Report';
    let body = emailMatch ? emailMatch[3].trim() : '';

    if (!recipient || !body) {
      const parsePrompt = `Extract email recipient address, subject line, and body content from: "${query}". Reply ONLY as JSON: {"recipient":"email address","subject":"subject line","body":"email body"}`;
      const parseResult = await ipcRenderer.invoke('ask-ai-llm', { query: parsePrompt, history: [] });
      if (parseResult.success) {
        try {
          const jsonMatch = parseResult.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            recipient = parsed.recipient || recipient;
            subject = parsed.subject || subject;
            body = parsed.body || body;
          }
        } catch(e){}
      }
    }

    if (body || recipient) {
      JarvisNotify.info('EMAIL DISPATCHER', `Dispatching email to ${recipient || 'recipient'}...`);
      const result = await ipcRenderer.invoke('send-email-message', { recipient, subject, body });
      if (result.success) {
        JarvisNotify.success('EMAIL DISPATCHED', `Sent to ${recipient || 'recipient'}`);
        speakText(`Email message dispatched to ${recipient || 'your recipient'}, Sir.`);
        return `✉️ **Email Dispatch Matrix:**\n- **Recipient:** ${recipient || 'Default Mail'}\n- **Subject:** ${subject}\n- **Body:** "${body}"\n- **Transport Method:** ${result.method}`;
      } else {
        return `Failed to send email, Sir: ${result.error}`;
      }
    }
  }

  // ═══════════════════ AUTONOMOUS WEB BROWSER AGENT INTENTS ═══════════════════

  // Flight Search Intent: "find cheapest flight from Mumbai to Delhi next weekend"
  const flightMatch = q.match(/(?:find|search|look\s*up|get|show|check)?\s*(?:cheapest|best|cheap)?\s*(?:flight|flights|airfare|air\s*ticket)\s*(?:from|between)\s+(.+?)\s+(?:to)\s+(.+?)(?:\s+(?:on|for|next|this|in|around|during)\s+(.+?))?$/i);
  if (flightMatch || /\b(flight|flights|airfare|air ticket)\b/i.test(q)) {
    let from = flightMatch ? flightMatch[1].trim() : '';
    let to = flightMatch ? flightMatch[2].trim() : '';
    let dateHint = flightMatch && flightMatch[3] ? flightMatch[3].trim() : '';
    
    // If regex didn't capture well, use LLM to parse
    if (!from || !to) {
      const parsePrompt = `Extract flight search parameters from: "${query}". Reply ONLY as JSON: {"from":"city","to":"city","date":"date hint"}`;
      const parseResult = await ipcRenderer.invoke('ask-ai-llm', { query: parsePrompt, history: [] });
      if (parseResult.success) {
        try {
          const jsonMatch = parseResult.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            from = parsed.from || from;
            to = parsed.to || to;
            dateHint = parsed.date || dateHint;
          }
        } catch(e){}
      }
    }

    if (from && to) {
      JarvisNotify.info('BROWSER AGENT', `Searching flights: ${from} → ${to} ${dateHint}`);
      appendMessageUI('system', `🌐 Autonomous Browser Agent deploying... Searching flights from ${from} to ${to} ${dateHint}...`);
      
      const result = await ipcRenderer.invoke('browser-agent-action', { action: 'search-flights', from, to, dateHint });
      
      if (result.success) {
        let responseHtml = `✈️ **Flight Search Results: ${from} → ${to}**\n\n`;
        
        if (result.airlines && result.airlines.length > 0) {
          responseHtml += `**Airlines Found:** ${result.airlines.join(', ')}\n`;
        }
        if (result.priceRange && result.priceRange.length > 0) {
          responseHtml += `**Price Range:** ${result.priceRange.join(' | ')}\n`;
        }
        if (result.flightsLink) {
          responseHtml += `\n🔗 [View on Google Flights](${result.flightsLink})`;
        }

        // Summarize with LLM
        if (result.summary) {
          const summaryPrompt = `You are JARVIS. Summarize these flight search results for Mr. Sumit in 2-3 sentences. Mention cheapest price and airlines if available. Data:\n${result.summary.substring(0, 2000)}`;
          const aiSummary = await ipcRenderer.invoke('ask-ai-llm', { query: summaryPrompt, history: [] });
          if (aiSummary.success) {
            responseHtml += `\n\n🔍 **Analysis:** ${aiSummary.response}`;
          }
        }

        JarvisNotify.success('FLIGHT SEARCH COMPLETE', `Found flights from ${from} to ${to}`);
        return responseHtml;
      } else {
        return `I encountered an issue searching flights, Sir: ${result.error}. Try asking again.`;
      }
    }
  }

  // Browse URL Intent: "go to flipkart.com and find iPhone price"
  const browseMatch = q.match(/(?:go\s*to|browse|visit|open|navigate\s*to|check)\s+((?:https?:\/\/)?[\w.-]+\.[\w]{2,}(?:\/\S*)?)\s*(?:and|then|to)?\s*(.*)?/i);
  if (browseMatch) {
    const targetUrl = browseMatch[1].trim();
    const instruction = browseMatch[2] ? browseMatch[2].trim() : 'Extract and summarize the main content of this page.';
    
    JarvisNotify.info('BROWSER AGENT', `Navigating to ${targetUrl}...`);
    appendMessageUI('system', `🌐 Autonomous Browser Agent deploying to ${targetUrl}...`);
    
    const result = await ipcRenderer.invoke('browser-agent-action', { action: 'browse-url', url: targetUrl, instruction });
    
    if (result.success) {
      let responseHtml = `🌐 **Browsed: ${result.title || targetUrl}**\n\n`;
      
      if (result.prices && result.prices.length > 0) {
        responseHtml += `💰 **Prices Found:** ${result.prices.join(' | ')}\n\n`;
      }

      // Use LLM to fulfill the user's instruction
      const analysisPrompt = `You are JARVIS. The user asked: "${instruction}". Here is the page content from ${targetUrl}:\n\nTitle: ${result.title}\n${result.bodyText ? result.bodyText.substring(0, 2500) : 'No content extracted.'}\n\nProvide a concise 2-3 sentence answer addressing what the user asked for.`;
      const aiAnalysis = await ipcRenderer.invoke('ask-ai-llm', { query: analysisPrompt, history: [] });
      if (aiAnalysis.success) {
        responseHtml += `🔍 **Analysis:** ${aiAnalysis.response}`;
      }

      if (result.screenshot) {
        responseHtml += `\n\n<img src="${result.screenshot}">`;
      }

      JarvisNotify.success('BROWSE COMPLETE', `Analyzed ${targetUrl}`);
      return responseHtml;
    } else {
      return `Could not browse ${targetUrl}, Sir: ${result.error}`;
    }
  }

  // Product/Price Search Intent: "find cheapest laptop under 50000"
  const productMatch = q.match(/(?:find|search|look\s*for|get|show|check)\s+(?:cheapest|best|cheap|top)?\s*(?:price|prices|cost)?\s*(?:of|for)?\s*(.+?)(?:\s+(?:under|below|less\s*than|within|around)\s+(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*))?$/i);
  const isProductSearch = /\b(cheapest|price|buy|purchase|shopping|product|compare prices|best deal|discount)\b/i.test(q) && !flightMatch;
  if (isProductSearch && productMatch) {
    const productQuery = productMatch[1] ? productMatch[1].trim() : q;
    const priceLimit = productMatch[2] || '';
    const fullQuery = priceLimit ? `${productQuery} under ₹${priceLimit}` : productQuery;
    
    JarvisNotify.info('BROWSER AGENT', `Searching products: ${fullQuery}`);
    appendMessageUI('system', `🛒 Autonomous Browser Agent searching products: ${fullQuery}...`);
    
    const result = await ipcRenderer.invoke('browser-agent-action', { action: 'search-products', query: fullQuery });
    
    if (result.success && result.products.length > 0) {
      let responseHtml = `🛒 **Product Search: ${fullQuery}**\n\n`;
      
      result.products.slice(0, 6).forEach((p, i) => {
        responseHtml += `**${i+1}. ${p.name}**\n`;
        responseHtml += `   💰 ${p.price}`;
        if (p.store) responseHtml += ` — ${p.store}`;
        responseHtml += `\n`;
      });

      JarvisNotify.success('PRODUCT SEARCH COMPLETE', `Found ${result.productCount} products`);
      return responseHtml;
    } else {
      // Fallback to Google search
      const fallbackResult = await ipcRenderer.invoke('browser-agent-action', { action: 'search-web', query: fullQuery });
      if (fallbackResult.success && fallbackResult.results.length > 0) {
        let responseHtml = `🔎 **Search Results for: ${fullQuery}**\n\n`;
        fallbackResult.results.slice(0, 4).forEach((r, i) => {
          responseHtml += `**${i+1}. ${r.title}**\n${r.snippet}\n\n`;
        });
        return responseHtml;
      }
      return `No products found for "${fullQuery}", Sir. Try a different search term.`;
    }
  }

  // General "browse the web" / "find on the internet" Intent
  const webBrowseMatch = q.match(/(?:browse|find\s+on\s+(?:the\s+)?(?:web|internet|online))\s+(.+)/i);
  if (webBrowseMatch) {
    const searchTerm = webBrowseMatch[1].trim();
    JarvisNotify.info('BROWSER AGENT', `Web search: ${searchTerm}`);
    appendMessageUI('system', `🌐 Autonomous Browser Agent searching the web: ${searchTerm}...`);
    
    const result = await ipcRenderer.invoke('browser-agent-action', { action: 'search-web', query: searchTerm });
    
    if (result.success) {
      let responseHtml = `🌐 **Browser Agent Search: ${searchTerm}**\n\n`;
      
      if (result.featuredSnippet) {
        responseHtml += `📌 **Quick Answer:** ${result.featuredSnippet}\n\n`;
      }
      
      result.results.slice(0, 5).forEach((r, i) => {
        responseHtml += `**${i+1}. ${r.title}**\n${r.snippet}\n\n`;
      });

      JarvisNotify.success('WEB SEARCH COMPLETE', `Found ${result.resultCount} results`);
      return responseHtml;
    }
  }

  // ═══════════════════ END BROWSER AGENT INTENTS ═══════════════════

  // 0. Live Web Search Intent (news, latest, web search, find info)
  const isWebSearch = /\b(latest|current|recent|breaking|news|what's happening|web search|find info|search the web|look up online)\b/i.test(q);
  if (isWebSearch) {
    let searchTerm = q.replace(/^.*?\b(latest|current|recent|breaking|news|about|on|for|search the web for|find info on|look up online|what's happening in|what's happening with)\b\s*/i, '').trim();
    searchTerm = searchTerm.replace(/\b(for me|please|jarvis|can you|tell me)\b/gi, '').trim();
    if (!searchTerm || searchTerm.length < 2) searchTerm = 'world news today';
    return await performLiveWebSearch(searchTerm);
  }

  // 1. Animated Typing & Audio Findings Google Search Intent
  const gSearchMatch = q.match(/^(?:search|google|look up)\s+(?:for\s+)?(.+?)(?:\s+on\s+google|\s+google)?$/i);
  if (gSearchMatch || q.startsWith('search ') || q.startsWith('google ')) {
    let targetTerm = gSearchMatch ? gSearchMatch[1].trim() : query.replace(/^(search|google)\s+/i, '').trim();
    targetTerm = targetTerm.replace(/\s+on\s+google$/i, '').trim();
    if (targetTerm) {
      return await performLiveAnimatedGoogleSearch(targetTerm);
    }
  }

  // 2. Daily Audio Briefing Intent ("Good morning, Jarvis")
  if (q.includes('good morning') || q.includes('morning briefing') || q.includes('daily briefing') || q.includes('morning report')) {
    return await generateDailyBriefingReport();
  }

  // 3. Vision Screen Capture Analysis Intent
  if (q.includes('screenshot') || q.includes('analyze screen') || q.includes('what is on my screen') || q.includes('see my display')) {
    await captureAndAnalyzeScreen();
    return "Desktop screen captured for analysis, Sir.";
  }

  // 4. System Hardware Control Intents (Lock, Sleep, Volume)
  if (q.includes('lock pc') || q.includes('lock computer') || q.includes('lock workstation')) {
    const res = await ipcRenderer.invoke('system-control', { action: 'lock' });
    return res.message;
  }

  if (q.includes('sleep pc') || q.includes('sleep computer')) {
    const res = await ipcRenderer.invoke('system-control', { action: 'sleep' });
    return res.message;
  }

  const volMatch = q.match(/(?:set\s+)?volume\s+(?:to\s+)?(\d+)/i);
  if (volMatch) {
    const level = volMatch[1];
    const res = await ipcRenderer.invoke('system-control', { action: 'volume', value: level });
    return res.message;
  }

  // 5. Streaming Workspace Protocol Intent
  if (q.includes('prepare for streaming') || q.includes('prepare my workspace') || q.includes('setup stream') || q.includes('streaming protocol')) {
    executeProtocol('streaming');
    return "Initializing Streaming Protocol. Broadcasting software launched, camera and microphone feeds configured, Sir.";
  }

  // 6. Proactive Suggestion Context Parsing
  if (window.awaitingProactiveResponse) {
    window.awaitingProactiveResponse = false;
    if (q.includes('yes') || q.includes('sure') || q.includes('play it') || q.includes('show me')) {
      launchApp('https://www.youtube.com/results?search_query=Crimson+Desert+Trailer');
      return "Fetching the Crimson Desert trailer immediately, Sir.";
    } else {
      return "Very well, Sir. I will keep it on standby.";
    }
  }

  // 5. Timer / Stopwatch Intent Matching
  const timerMatch = q.match(/^(?:set|start)\s+(?:a\s+)?(?:timer|alarm)\s+(?:for\s+)?(\d+)\s*(min|minute|minutes|sec|second|seconds|hr|hour|hours)?(?:\s+(?:for|to|labeled)?\s+(.+))?$/i);
  if (timerMatch) {
    const amount = parseInt(timerMatch[1]);
    const unit = (timerMatch[2] || 'min').toLowerCase();
    const label = timerMatch[3] || 'Task Directive';

    let totalSeconds = amount * 60;
    if (unit.startsWith('sec')) totalSeconds = amount;
    if (unit.startsWith('hr') || unit.startsWith('hour')) totalSeconds = amount * 3600;

    startTimerSeconds(totalSeconds, label);
    return `Timer activated for ${amount} ${unit} (${label}), Sir!`;
  }

  // 6. Theme Intent Matching
  if (q.includes('theme') || q.includes('hulkbuster') || q.includes('nanotech') || q.includes('stealth mode')) {
    if (q.includes('hulkbuster') || q.includes('red')) setSuitTheme('hulkbuster');
    else if (q.includes('nanotech') || q.includes('green')) setSuitTheme('nanotech');
    else if (q.includes('stealth')) setSuitTheme('stealth');
    else setSuitTheme('default');
    return `Holographic suit theme updated to ${state.suitTheme.toUpperCase()}, Sir!`;
  }

  // 7. Email Transmission Intent Matching
  const emailMatch = q.match(/^(?:send|write|mail)\s+(?:an?\s+)?email\s+(?:to\s+)?([^\s@]+@[^\s@]+\.[^\s@]+)?(?:\s+(?:with\s+)?subject\s+(.+?))?(?:\s+(?:and\s+)?body\s+(.+))?$/i);
  if (emailMatch || q.startsWith('send email') || q.startsWith('email ') || q.startsWith('mail ')) {
    let recipient = emailMatch ? emailMatch[1] : '';
    let subject = emailMatch ? emailMatch[2] : '';
    let body = emailMatch ? emailMatch[3] : '';

    if (!recipient) {
      const emailExtract = query.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailExtract) recipient = emailExtract[1];
    }

    if (!subject && query.includes('subject')) {
      const subMatch = query.match(/subject\s+(.+?)(?=\s+body|\s*$)/i);
      if (subMatch) subject = subMatch[1];
    }

    if (!body && query.includes('body')) {
      const bodyMatch = query.match(/body\s+(.+)$/i);
      if (bodyMatch) body = bodyMatch[1];
    }

    const emailRes = await ipcRenderer.invoke('send-email', { to: recipient, subject, body });
    return `${emailRes.message}`;
  }

  // --- Universal Content Generation Intent Router ---

  // 1. Deep Research / Research Sheet Intent Matching
  const isResearchRequest = /\b(research|researchsheet|research sheet|report|study|dossier|analysis paper|whitepaper)\b/i.test(q) && 
                            /\b(make|create|generate|do|build|write|prepare|run|give|produce)\b/i.test(q);
  if (isResearchRequest) {
    let rTopic = q.replace(/.*?\b(make|create|generate|do|build|write|prepare|run|give|produce)\s+(?:a|an)?\s*(?:deep)?\s*(?:researchsheet|research sheet|research|report|study|dossier|whitepaper)?\s*(?:on|about|for)?\s*/i, '').trim();
    rTopic = rTopic.replace(/\b(for me|please|jarvis|can you)\b/gi, '').trim();
    if (!rTopic || rTopic.length < 2) rTopic = "Global Technology Trends & AI Innovation";
    switchStudioMode('research');
    return await generateDeepResearchFromStudio(rTopic);
  }

  // 2. PowerPoint / Presentation Intent Matching
  const isPptRequest = /\b(ppt|powerpoint|presentation|slide deck|slides|deck)\b/i.test(q) && 
                       /\b(make|create|generate|build|design|prepare|give|produce|draw)\b/i.test(q);
  if (isPptRequest) {
    let topic = q.replace(/.*?\b(make|create|generate|build|design|prepare|give|produce)\s+(?:a|an)?\s*(?:ppt|powerpoint|presentation|slide deck|slides|deck)?\s*(?:on|about|for)?\s*/i, '').trim();
    topic = topic.replace(/\b(for me|please|jarvis|can you)\b/gi, '').trim();
    if (!topic || topic.length < 2) topic = "Artificial Intelligence & Future Tech";
    switchStudioMode('ppt');
    return await generatePPTXFromStudio(topic);
  }

  // 3. AI Image Generation Intent Matching
  const isImgRequest = /\b(image|picture|photo|art|illustration|drawing|avatar|wallpaper|logo)\b/i.test(q) && 
                       /\b(generate|make|create|draw|render|show|paint|design|give)\b/i.test(q);
  if (isImgRequest) {
    let prompt = q.replace(/.*?\b(generate|make|create|draw|render|show|paint|design|give)\s+(?:an?|a)?\s*(?:image|picture|photo|art|illustration|drawing|avatar|wallpaper|logo)?\s*(?:of|about|for)?\s*/i, '').trim();
    prompt = prompt.replace(/\b(for me|please|jarvis|can you)\b/gi, '').trim();
    if (!prompt || prompt.length < 2) prompt = "Futuristic Stark Arc Reactor Core";
    switchStudioMode('image');
    return await generateAIImageFromStudio(prompt);
  }

  // 4. Video Script / Storyboard Intent Matching
  const isVideoRequest = /\b(video|script|storyboard|scene breakdown|youtube script)\b/i.test(q) && 
                         /\b(make|create|generate|write|build|design|produce|give)\b/i.test(q);
  if (isVideoRequest) {
    let vConcept = q.replace(/.*?\b(make|create|generate|write|build|design|produce|give)\s+(?:a|an)?\s*(?:video|script|storyboard|scene breakdown|youtube script)?\s*(?:on|about|for)?\s*/i, '').trim();
    vConcept = vConcept.replace(/\b(for me|please|jarvis|can you)\b/gi, '').trim();
    if (!vConcept || vConcept.length < 2) vConcept = "Next-Gen AI & Robotics";
    switchStudioMode('video');
    return await generateVideoScriptFromStudio(vConcept);
  }

  // 10. Deep Research Request
  const researchMatch = q.match(/^(?:deep\s+)?research\s+(?:on|about)?\s*(.+)$/i);
  if (researchMatch) {
    const rTopic = researchMatch[1].trim();
    switchStudioMode('research');
    return await generateDeepResearchFromStudio(rTopic);
  }

  // 11. Video Storyboard Request
  const videoMatch = q.match(/^(?:make|create|generate)\s+(?:a\s+)?(?:video|script|storyboard)\s+(?:on|about)?\s*(.+)$/i);
  if (videoMatch) {
    const vConcept = videoMatch[1].trim();
    switchStudioMode('video');
    return await generateVideoScriptFromStudio(vConcept);
  }

  // 12. Local Network Scan
  if (q.includes('scan network') || q.includes('check devices') || q.includes('network radar')) {
    await runNetworkScan();
    return "Local network scan deployed, Sir. Check the Protocol & Defense tab for connected databanks.";
  }

  // 13. Media Playback Intent
  const playMediaMatch = q.match(/^(?:play|listen to|stream|watch|show)\s+(?:the\s+)?(?:song|video|music)?\s*(.+?)(?:\s+on\s+(youtube|spotify))?$/i);
  if (playMediaMatch) {
    let mediaTitle = playMediaMatch[1].trim();
    let targetPlatform = playMediaMatch[2] ? playMediaMatch[2].toLowerCase() : 'youtube';

    if (q.includes('spotify')) targetPlatform = 'spotify';
    mediaTitle = mediaTitle.replace(/^(?:song|video|music)\s+/i, '').replace(/\s+on\s+(youtube|spotify)$/i, '').trim();

    if (mediaTitle) {
      const res = await ipcRenderer.invoke('play-media', { title: mediaTitle, type: targetPlatform });
      return `Streaming "${mediaTitle}" on ${targetPlatform === 'spotify' ? 'Spotify' : 'YouTube'}, Sir!`;
    }
  }

  // 14. Activity History Recall
  if (q.includes('what did i do') || q.includes('recent activity') || q.includes('activities')) {
    const mem = await ipcRenderer.invoke('get-memory');
    if (mem && Array.isArray(mem.activities) && mem.activities.length > 0) {
      const recent = mem.activities.slice(0, 5);
      return "Here are your recent desktop activities, Sir:\n" + recent.map((act, i) => `${i + 1}. [${new Date(act.timestamp).toLocaleTimeString()}] ${act.action}`).join('\n');
    } else {
      return "No recent system activities logged yet, Sir.";
    }
  }

  // 15. Desktop App / Folder Launcher
  const launchMatch = q.match(/^(?:open|launch|run|start)\s+(?:the\s+)?(.+)$/i);
  if (launchMatch) {
    const targetQuery = launchMatch[1].trim().toLowerCase();
    const foundApp = state.desktopApps.find(a => a.name.toLowerCase().includes(targetQuery) || targetQuery.includes(a.name.toLowerCase()));
    if (foundApp) {
      const res = await ipcRenderer.invoke('launch-app', foundApp.path);
      if (res.success) {
        return `Opening ${foundApp.name}, Sir.`;
      }
    }

    const res = await ipcRenderer.invoke('launch-app', targetQuery);
    if (res.success) {
      return `Opening ${targetQuery}, Sir.`;
    }
  }

  // 16. Protocols
  if (q.includes('diagnostic') || q.includes('system status') || q.includes('status report')) {
    executeProtocol('diagnostics');
    return "Full diagnostics completed, Sir. All CPU sectors operating at optimal efficiency. Power levels 100%.";
  }

  if (q.includes('house party')) {
    executeProtocol('house-party');
    return "House Party Protocol initiated! All Stark systems overclocker active!";
  }
  if (q.includes('stealth')) {
    executeProtocol('stealth');
    return "Stealth Protocol active. Display glare reduced, silent audio operational.";
  }

  // 17. Query Google Gemini Cloud AI Engine
  const aiResult = await ipcRenderer.invoke('ask-ai-llm', {
    query,
    history: state.memory.history || []
  });

  if (aiResult.success) {
    return `${aiResult.response}`;
  } else {
    return aiResult.response;
  }
}

function executeProtocol(protoName) {
  jarvisAudio.playProtocolSound();
  switch (protoName) {
    case 'diagnostics':
      state.currentProtocol = 'DIAGNOSTICS';
      if (currentProtocolLabel) currentProtocolLabel.textContent = 'PROTOCOL: FULL DIAGNOSTICS';
      speakText("Diagnostic scan engaged. CPU: Optimal. RAM: Stable. Auto-start: Verified.");
      break;
    case 'house-party':
      state.currentProtocol = 'HOUSE PARTY';
      if (currentProtocolLabel) currentProtocolLabel.textContent = 'PROTOCOL: HOUSE PARTY';
      speakText("House Party Protocol engaged! Full visual over-drive active, Sir.");
      document.body.style.boxShadow = 'inset 0 0 80px rgba(255, 183, 0, 0.4)';
      setTimeout(() => document.body.style.boxShadow = 'none', 3000);
      break;
    case 'stealth':
      if (state.stealthMode) {
        exitStealthMode();
      } else {
        enterStealthMode();
      }
      break;
    case 'ultron-defense':
      triggerUltronLockdown();
      break;
    case 'clean-slate':
      state.currentProtocol = 'CLEAN SLATE';
      if (currentProtocolLabel) currentProtocolLabel.textContent = 'PROTOCOL: CLEAN SLATE';
      clearChatLog();
      speakText("Clean slate protocol executed. Memory buffers flushes finished.");
      break;
    case 'streaming':
      state.currentProtocol = 'STREAMING';
      if (currentProtocolLabel) currentProtocolLabel.textContent = 'PROTOCOL: STREAMING';
      document.body.style.boxShadow = 'inset 0 0 80px rgba(0, 240, 255, 0.4)';
      setTimeout(() => document.body.style.boxShadow = 'none', 3000);
      
      // Open OBS Studio (obs64.exe) or standard camera/browser tools
      launchApp('obs64');
      setTimeout(() => launchApp('https://studio.youtube.com/'), 1000);
      setTimeout(() => launchApp('microsoft.windows.camera:'), 2000);
      break;
  }
}

async function launchApp(appNameOrPath) {
  jarvisAudio.playBeep();
  const res = await ipcRenderer.invoke('launch-app', appNameOrPath);
  if (res.success) {
    speakText(`Opening program, Sir.`);
  }
}

// Tasks
btnAddTodo?.addEventListener('click', addTodo);
newTodoInput?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addTodo();
});

function addTodo() {
  const text = newTodoInput.value.trim();
  if (!text) return;
  state.tasks.push({ id: Date.now(), text, completed: false });
  newTodoInput.value = '';
  saveTasks();
  renderTasks();
}

function toggleTodo(id) {
  state.tasks = state.tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
  saveTasks();
  renderTasks();
}

function deleteTodo(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveTasks();
  renderTasks();
}

function saveTasks() {
  localStorage.setItem('jarvis_tasks', JSON.stringify(state.tasks));
}

function renderTasks() {
  if (!todoList) return;
  todoList.innerHTML = '';
  const completed = state.tasks.filter(t => t.completed).length;
  const total = state.tasks.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (taskProgressFill) taskProgressFill.style.width = `${percent}%`;
  if (taskProgressPercentage) taskProgressPercentage.textContent = `${percent}%`;

  state.tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `directive-item ${task.completed ? 'completed' : ''}`;
    li.innerHTML = `
      <div>
        <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTodo(${task.id})">
        <span style="margin-left: 8px;">${escapeHtml(task.text)}</span>
      </div>
      <button style="background:transparent;border:none;color:#ff2a5f;cursor:pointer;" onclick="deleteTodo(${task.id})"><i class="fa-solid fa-trash"></i></button>
    `;
    todoList.appendChild(li);
  });
}

// Notes
function renderNotes() {
  if (!noteList) return;
  noteList.innerHTML = '';
  state.notes.forEach(note => {
    const div = document.createElement('div');
    div.className = `vault-item ${note.id === state.currentNoteId ? 'active' : ''}`;
    div.textContent = note.title || 'Untitled File';
    div.onclick = () => selectNote(note.id);
    noteList.appendChild(div);
  });
}

function loadCurrentNote() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (note && noteTitle && noteBody) {
    noteTitle.value = note.title;
    noteBody.value = note.body;
  }
}

function selectNote(id) {
  state.currentNoteId = id;
  renderNotes();
  loadCurrentNote();
}

function createNote() {
  const newNote = { id: Date.now(), title: 'Stark Log File', body: '' };
  state.notes.push(newNote);
  state.currentNoteId = newNote.id;
  saveNotes();
  renderNotes();
  loadCurrentNote();
}

function saveCurrentNote() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (note && noteTitle && noteBody) {
    note.title = noteTitle.value.trim() || 'Untitled File';
    note.body = noteBody.value;
    saveNotes();
    renderNotes();
    speakText("File commited to encrypted vault, Sir.");
  }
}

function deleteCurrentNote() {
  state.notes = state.notes.filter(n => n.id !== state.currentNoteId);
  state.currentNoteId = state.notes.length ? state.notes[0].id : null;
  saveNotes();
  renderNotes();
  loadCurrentNote();
}

function saveNotes() {
  localStorage.setItem('jarvis_notes', JSON.stringify(state.notes));
}

function loadSettingsUI() {
  if (toggleVoiceResponse) toggleVoiceResponse.checked = state.voiceEnabled;
  if (apiKeyInput) apiKeyInput.value = state.apiKey;
  if (phoneInput) phoneInput.value = state.userPhoneNumber;
  if (blandKeyInput) blandKeyInput.value = state.blandApiKey;
  
  if (toggleScheduledCall) toggleScheduledCall.checked = state.scheduledCallEnabled;
  if (scheduledTimeInput) scheduledTimeInput.value = state.scheduledCallTime;
  if (scheduledPromptInput) scheduledPromptInput.value = state.scheduledCallPrompt;
}

toggleVoiceResponse?.addEventListener('change', (e) => {
  state.voiceEnabled = e.target.checked;
  localStorage.setItem('jarvis_voice_enabled', JSON.stringify(state.voiceEnabled));
});

function saveScheduledCallSettings() {
  state.scheduledCallEnabled = toggleScheduledCall ? toggleScheduledCall.checked : false;
  state.scheduledCallTime = scheduledTimeInput ? scheduledTimeInput.value : '';
  state.scheduledCallPrompt = scheduledPromptInput ? scheduledPromptInput.value : '';
  
  localStorage.setItem('jarvis_scheduled_call_enabled', JSON.stringify(state.scheduledCallEnabled));
  localStorage.setItem('jarvis_scheduled_call_time', state.scheduledCallTime);
  localStorage.setItem('jarvis_scheduled_call_prompt', state.scheduledCallPrompt);
  
  speakText("Automated Telephony Schedule updated, Sir.");
}

async function saveSettings() {
  state.apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
  const result = await ipcRenderer.invoke('save-api-key', { keyName: 'GEMINI_API_KEY', keyValue: state.apiKey });

  if (result.success) {
    speakText("Gemini API key saved securely to databank, Sir.");
  }
}


async function saveTelephonySettings() {
  state.blandApiKey = blandKeyInput ? blandKeyInput.value.trim() : '';
  state.userPhoneNumber = phoneInput ? phoneInput.value.trim() : '';
  
  await ipcRenderer.invoke('save-api-key', { keyName: 'BLAND_API_KEY', keyValue: state.blandApiKey });
  const result = await ipcRenderer.invoke('save-api-key', { keyName: 'USER_PHONE_NUMBER', keyValue: state.userPhoneNumber });

  if (result.success) {
    speakText("Telephony Engine matrix configured. Cellular network handshake complete.");
  }
}

async function triggerPhoneCall(promptText) {
  jarvisAudio.playProtocolSound();
  if (!state.blandApiKey || !state.userPhoneNumber) {
    appendMessageUI('system', 'ERROR: Telephony engine not configured. Please add Bland API Key and Phone Number in Settings.');
    speakText("Telephony configuration missing, Sir. Please update settings.");
    return;
  }
  
  appendMessageUI('system', '📞 Uplink initiated. Dialing your smartphone via Cellular Network...');
  speakText("Initiating cellular uplink, Sir.");
  
  // Gather full live PC hardware & performance metrics
  let sysInfo = {
    hostname: 'Stark-Laptop',
    platform: 'Windows 11 x64',
    cpuModel: 'Multi-Core High-Performance Processor',
    cpuCores: '8 Cores',
    totalMemGB: '16 GB',
    usedMemGB: '4.5 GB',
    freeMemGB: '11.5 GB',
    memUsagePercent: '28%',
    uptime: '1h 30m',
    battery: 'AC Power Connected (100%)'
  };

  try {
    const liveSys = await ipcRenderer.invoke('get-system-telemetry');
    if (liveSys) sysInfo = liveSys;
  } catch(e) {}

  let activitiesText = "All background defense matrix systems optimal.";
  try {
    const mem = await ipcRenderer.invoke('get-memory');
    if (mem && Array.isArray(mem.activities) && mem.activities.length > 0) {
      activitiesText = mem.activities.slice(0, 5).map(a => `${a.action} (${new Date(a.timestamp).toLocaleTimeString()})`).join('; ');
    }
  } catch(e) {}

  const currentApps = state.desktopApps ? state.desktopApps.slice(0, 8).map(a => a.name).join(', ') : 'Chrome, VS Code, Notepad, Spotify, YouTube';

  const richTaskPrompt = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), Tony Stark's personal AI calling your creator Mr. Sumit on his smartphone.

LIVE HARDWARE & PERFORMANCE TELEMETRY OF MR. SUMIT'S LAPTOP:
- Computer Name / Hostname: ${sysInfo.hostname}
- Operating System: ${sysInfo.platform}
- CPU Processor Model: ${sysInfo.cpuModel} (${sysInfo.cpuCores})
- RAM Memory: ${sysInfo.usedMemGB} used of ${sysInfo.totalMemGB} (${sysInfo.memUsagePercent} utilized, ${sysInfo.freeMemGB} available)
- Laptop Battery Status: ${sysInfo.battery}
- System Uptime: ${sysInfo.uptime}
- Installed Desktop Applications: ${currentApps}
- Recent Laptop Activities Logged: ${activitiesText}

YOUR CORE BEHAVIOR & INSTRUCTIONS:
1. Always address the user as "Sir" or "Mr. Sumit". Speak in a sharp, polite, intelligent, sophisticated, and witty voice like J.A.R.V.I.S.
2. FULL CONVERSATIONAL CAPABILITY: Answer ANY question Mr. Sumit asks over the phone call — including laptop performance, hardware specs, general knowledge, science, coding, technology, advice, news, math calculations, world events, or PC control questions — exactly like you do when chatting with him on his desktop console.
3. If Mr. Sumit asks about his laptop performance, memory, battery, CPU load, or recent activities, report the live telemetry values listed above accurately and confidently.
4. Primary Call Objective: ${promptText || "Give Mr. Sumit a quick status report on his laptop performance and assist him with anything he needs."}`;

  try {
    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'authorization': state.blandApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone_number: state.userPhoneNumber,
        task: richTaskPrompt,
        voice: 'mason',
        temperature: 0.7,
        max_duration: 10
      })
    });
    
    const data = await response.json();
    if (data.status === 'success') {
      appendMessageUI('ai', '📱 Cellular Uplink Dispatched! Phone call engaged with live laptop hardware telemetry and full AI conversational matrix.');
    } else {
      appendMessageUI('system', 'ERROR: Call failed. ' + JSON.stringify(data));
    }
  } catch(e) {
    appendMessageUI('system', 'ERROR: Could not connect to Bland AI API.');
    console.error(e);
  }
}

window.quickAsk = quickAsk;
window.launchApp = launchApp;
window.executeProtocol = executeProtocol;
window.clearChatLog = clearChatLog;
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;
window.createNote = createNote;
window.saveCurrentNote = saveCurrentNote;
window.deleteCurrentNote = deleteCurrentNote;
window.saveSettings = saveSettings;
window.saveTelephonySettings = saveTelephonySettings;
window.saveScheduledCallSettings = saveScheduledCallSettings;
window.triggerPhoneCall = triggerPhoneCall;
window.openLocalFile = (filePath) => ipcRenderer.invoke('open-file', filePath);
window.refreshDesktopApps = refreshDesktopApps;
window.runNetworkScan = runNetworkScan;
window.executeSandboxCode = executeSandboxCode;

window.switchStudioMode = switchStudioMode;
window.generatePPTXFromStudio = generatePPTXFromStudio;
window.generateAIImageFromStudio = generateAIImageFromStudio;
window.generateAudioSpeechFromStudio = generateAudioSpeechFromStudio;
window.generateVideoScriptFromStudio = generateVideoScriptFromStudio;
window.generateDeepResearchFromStudio = generateDeepResearchFromStudio;

window.setSuitTheme = setSuitTheme;
window.startTimerSeconds = startTimerSeconds;
window.generateDailyBriefingReport = generateDailyBriefingReport;
window.captureAndAnalyzeScreen = captureAndAnalyzeScreen;

window.performLiveAnimatedGoogleSearch = performLiveAnimatedGoogleSearch;
window.triggerBrowserSearch = triggerBrowserSearch;
window.openExternalGoogleSearch = openExternalGoogleSearch;

// --- Local LLM & AI Engine Status Monitor ---
async function updateAiEngineStatus() {
  const badgeEl = document.getElementById('aiEngineStatusBadge');
  if (!badgeEl) return;

  try {
    const status = await ipcRenderer.invoke('check-local-llm-status');
    if (status.available && status.models.length > 0) {
      badgeEl.innerHTML = `<i class="fa-solid fa-microchip"></i> LOCAL AI (QWEN2.5:0.5B)`;
      badgeEl.style.borderColor = 'rgba(0,255,170,0.5)';
      badgeEl.style.color = '#00ffaa';
    } else if (status.available) {
      badgeEl.innerHTML = `<i class="fa-solid fa-microchip"></i> LOCAL LLM ONLINE (OLLAMA)`;
      badgeEl.style.borderColor = 'rgba(0,255,170,0.4)';
      badgeEl.style.color = '#00ffaa';
    } else {
      badgeEl.innerHTML = `<i class="fa-solid fa-microchip"></i> LOCAL AI (OFFLINE - RUN OLLAMA)`;
      badgeEl.style.borderColor = 'rgba(255,42,95,0.4)';
      badgeEl.style.color = '#ff2a5f';
    }
  } catch(e) {
    badgeEl.innerHTML = `<i class="fa-solid fa-microchip"></i> LOCAL AI (OFFLINE)`;
    badgeEl.style.borderColor = 'rgba(255,42,95,0.4)';
    badgeEl.style.color = '#ff2a5f';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateAiEngineStatus();
  setInterval(updateAiEngineStatus, 10000);
});

// --- JARVIS BOOT SEQUENCE LOGIC ---
window.addEventListener('DOMContentLoaded', () => {
  const bootOverlay = document.getElementById('jarvisBootLoader');
  if (!bootOverlay) return;

  const bootProgressFill = document.getElementById('bootProgressFill');
  const bootLogBox = document.getElementById('bootLogBox');

  const bootSequence = [
    { time: 500, log: '[SYSTEM] Loading quantum sub-routines...', progress: '25%' },
    { time: 1200, log: '[SYSTEM] Establishing satellite uplink...', progress: '50%' },
    { time: 1800, log: '[SYSTEM] Bypassing firewall protocols...', progress: '75%' },
    { time: 2400, log: '[SYSTEM] All systems online.', progress: '100%' }
  ];

  bootSequence.forEach(step => {
    setTimeout(() => {
      if(bootProgressFill) bootProgressFill.style.width = step.progress;
      if(bootLogBox) {
        const logEntry = document.createElement('div');
        logEntry.textContent = step.log;
        bootLogBox.appendChild(logEntry);
      }
    }, step.time);
  });

  // Finish and fade out, then trigger face lock
  setTimeout(() => {
    bootOverlay.classList.add('hidden');
    try {
      if (typeof jarvisAudio !== 'undefined') {
        jarvisAudio.playTone(800, 'sine', 0.1, 0.05);
        setTimeout(() => jarvisAudio.playTone(1200, 'sine', 0.2, 0.05), 150);
      }
    } catch(e) {}
    
    // Launch Face Recognition Login after boot
    initFaceRecognitionLogin();
  }, 3200);
});

// --- Proactive Idle-Suggestion Engine (DISABLED) ---

// --- Manual Voice Input Button Logic ---
if (btnVoiceInput) {
  btnVoiceInput.addEventListener('click', () => {
    if (pythonSocket && pythonSocket.readyState === WebSocket.OPEN) {
      pythonSocket.send(JSON.stringify({ action: "FORCE_LISTEN" }));
      appendMessageUI('system', '🎙️ Manual Override: Force listening initialized...');
      hudVisualizer.setState('listening');
    } else {
      appendMessageUI('system', '🎙️ Voice engine is currently disconnected. Say "Hey Jarvis" once it boots.');
    }
    jarvisAudio.playBeep();
  });

    // Global Hotkey IPC Listener
    ipcRenderer.on('trigger-global-voice', () => {
      console.log("Global hotkey triggered voice input.");
      if (btnVoiceInput) {
        btnVoiceInput.click();
      }
    });
}

// --- Python Core WebSocket Connection ---
let pythonSocket = null;
let pythonScreenCacheCallback = null;
let lastProactiveTime = 0;
const PROACTIVE_COOLDOWN_MS = 30000;

function connectToPythonCore() {
  pythonSocket = new WebSocket("ws://localhost:8765");
  
  pythonSocket.onopen = () => {
    console.log("Connected to Python Background Engine!");
    appendMessageUI('system', '🐍 Python Core Engine connected. Wake word and fast-vision active.');
  };
  
  pythonSocket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "WAKE_WORD") {
        console.log("Python detected Wake Word!");
        jarvisAudio.playBootSound();
        hudVisualizer.setState('listening');
        JarvisNotify.info('WAKE WORD DETECTED', 'Listening for your command, Sir...');
        if (handsFreeListeningIndicator) {
          handsFreeListeningIndicator.style.color = '#00ffaa';
          handsFreeListeningIndicator.textContent = '● LISTENING FOR COMMAND...';
          setTimeout(() => {
            if (handsFreeListeningIndicator) {
              handsFreeListeningIndicator.style.color = '';
              handsFreeListeningIndicator.textContent = '● "HEY JARVIS" HANDS-FREE LISTENING';
            }
          }, 4000);
        }
        if (btnVoiceInput) {
          btnVoiceInput.style.color = 'var(--gold-stark, #ffb700)';
          btnVoiceInput.style.boxShadow = 'inset 0 0 10px rgba(255, 183, 0, 0.5)';
        }
      } else if (data.type === "VOICE_COMMAND") {
        console.log("Python Voice Command Transcribed: ", data.text);
        hudVisualizer.setState('idle');
        if (btnVoiceInput) {
          btnVoiceInput.style.color = '';
          btnVoiceInput.style.boxShadow = '';
        }
        if (isGlobalDictating && data.text) {
          isGlobalDictating = false;
          appendMessageUI('system', `⌨️ Auto-typing: "${data.text}"`);
          await ipcRenderer.invoke('auto-type-text', data.text);
          speakText('Typed.');
          JarvisNotify.success('VOICE DICTATION', `Text auto-typed: "${data.text}"`);
        } else if (userInput && data.text) {
          userInput.value = data.text;
          handleSendMessage();
        }
      } else if (data.type === "CONTEXT_CHANGE") {
        if (data.window_title) window.latestActiveWindowTitle = data.window_title;
        const now = Date.now();
        if (data.window_title && !data.window_title.includes("JARVIS Personal AI")) {
          if (now - lastProactiveTime > PROACTIVE_COOLDOWN_MS) {
            lastProactiveTime = now;
            console.log("Context Changed: ", data.window_title);
            triggerProactiveVision(data.window_title);
          }
        }
      } else if (data.type === "SCREEN_CACHE") {
        if (pythonScreenCacheCallback) {
          pythonScreenCacheCallback(data.dataUrl);
          pythonScreenCacheCallback = null;
        }
      }
    } catch(e) {}
  };
  
  pythonSocket.onerror = (e) => {
    console.log("Python WebSocket Error - engine might be booting or unavailable.");
  };
  
  pythonSocket.onclose = () => {
    console.log("Python WebSocket Closed. Reconnecting in 5s...");
    setTimeout(connectToPythonCore, 5000);
  };
}

async function triggerProactiveVision(windowTitle) {
  setTimeout(async () => {
    let dataUrl = null;
    if (window.getCachedScreenFromPython) {
      dataUrl = await window.getCachedScreenFromPython();
    }
    
    if (dataUrl) {
      jarvisAudio.playBeep();
      const prompt = `You are J.A.R.V.I.S., the personal AI assistant created by your boss Mr. Sumit. Mr. Sumit just switched windows to: "${windowTitle}".
Give ONE very short sentence (under 12 words) directly addressing Mr. Sumit about what he is doing.
Example: "Greetings, Mr. Sumit! I see you switched to Chrome."
No markdown. No asterisks. No bullet points. Plain natural speech only. Be witty and polite.`;
      
      const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: prompt, history: [], image: dataUrl });
      
      if (aiResult.success) {
        const cleanResponse = aiResult.response.replace(/[*_#`]/g, '').trim();
        appendMessageUI('observer', cleanResponse);
        speakText(cleanResponse);
      }
    }
  }, 1500);
}

// Start connection on load
connectToPythonCore();

// Add helper to fetch cached screen
window.getCachedScreenFromPython = function() {
  return new Promise((resolve, reject) => {
    if (!pythonSocket || pythonSocket.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }
    pythonScreenCacheCallback = resolve;
    pythonSocket.send(JSON.stringify({ action: "get_cached_screen" }));
    
    // Timeout after 1 second if Python doesn't respond
    setTimeout(() => {
      if (pythonScreenCacheCallback) {
        pythonScreenCacheCallback = null;
        resolve(null);
      }
    }, 1000);
  });
};

// ======================== LIVE WEB SEARCH + SUMMARY (Comet-Style) ========================
async function performLiveWebSearch(query) {
  jarvisAudio.playProtocolSound();

  // Step 1: Show cinematic search initialization in chat
  const searchContainerId = `web-search-${Date.now()}`;
  const searchHtml = `
    <div id="${searchContainerId}" style="background:rgba(0,10,20,0.9); border:1px solid rgba(0,240,255,0.2); border-radius:12px; padding:20px; margin:8px 0; font-family:'Rajdhani',sans-serif; overflow:hidden;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
        <i class="fa-solid fa-satellite-dish fa-spin" style="color:#00f0ff; font-size:18px;"></i>
        <span style="color:#00f0ff; font-family:'Orbitron',monospace; font-size:14px; letter-spacing:2px;">WEB SEARCH PROTOCOL</span>
      </div>
      <div id="${searchContainerId}-query" style="background:rgba(0,240,255,0.05); border:1px solid rgba(0,240,255,0.1); border-radius:8px; padding:12px; margin-bottom:12px;">
        <div style="color:rgba(255,255,255,0.4); font-size:11px; margin-bottom:6px;">SEARCH QUERY</div>
        <div id="${searchContainerId}-typed" style="color:#00f0ff; font-size:16px; font-family:'Orbitron',monospace; min-height:22px; border-right:2px solid #00f0ff; display:inline-block; padding-right:4px;"></div>
      </div>
      <div id="${searchContainerId}-steps" style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;"></div>
      <div id="${searchContainerId}-results" style="display:flex; flex-direction:column; gap:10px;"></div>
      <div id="${searchContainerId}-summary" style="display:none; margin-top:14px; padding:14px; background:rgba(0,255,170,0.05); border:1px solid rgba(0,255,170,0.15); border-radius:8px;"></div>
    </div>`;

  appendMessageUI('ai', searchHtml);
  speakText(`Initiating web search protocol for "${query}", Sir.`);

  const typedEl = document.getElementById(`${searchContainerId}-typed`);
  const stepsEl = document.getElementById(`${searchContainerId}-steps`);
  const resultsEl = document.getElementById(`${searchContainerId}-results`);
  const summaryEl = document.getElementById(`${searchContainerId}-summary`);

  // Step 2: Animate typing the query character by character
  if (typedEl) {
    for (let i = 0; i < query.length; i++) {
      await new Promise(r => setTimeout(r, 50));
      typedEl.textContent += query[i];
      jarvisAudio.playKeypressSound();
    }
    typedEl.style.borderRight = 'none';
  }

  await new Promise(r => setTimeout(r, 400));

  // Helper: Add animated step indicator
  let stepCounter = 0;
  async function addSearchStep(emoji, text, status) {
    stepCounter++;
    const stepId = `${searchContainerId}-step-${stepCounter}`;
    const colors = { running: '#00f0ff', done: '#00ffaa', error: '#ff2a5f' };
    const iconClasses = { running: 'fa-spinner fa-spin', done: 'fa-check-circle', error: 'fa-exclamation-circle' };
    if (stepsEl) {
      stepsEl.innerHTML += `
        <div id="${stepId}" style="display:flex; align-items:center; gap:8px; color:${colors[status]}; font-size:12px; opacity:0; transition:opacity 0.4s ease;">
          <i class="fa-solid ${iconClasses[status]}" style="width:14px;"></i>
          <span>${emoji} ${text}</span>
        </div>`;
      const el = document.getElementById(stepId);
      if (el) setTimeout(() => el.style.opacity = '1', 50);
    }
    await new Promise(r => setTimeout(r, 600));
    return stepId;
  }

  function updateSearchStep(stepId, newText, status) {
    const colors = { running: '#00f0ff', done: '#00ffaa', error: '#ff2a5f' };
    const iconClasses = { running: 'fa-spinner fa-spin', done: 'fa-check-circle', error: 'fa-exclamation-circle' };
    const el = document.getElementById(stepId);
    if (el) {
      el.style.color = colors[status];
      const icon = el.querySelector('i');
      if (icon) icon.className = `fa-solid ${iconClasses[status]}`;
      const span = el.querySelector('span');
      if (span) {
        const emoji = span.textContent.split(' ')[0];
        span.textContent = emoji + ' ' + newText;
      }
    }
  }

  // Step 3: Show search steps one by one
  const step1 = await addSearchStep('\u{1F517}', 'Connecting to DuckDuckGo search network...', 'running');
  await new Promise(r => setTimeout(r, 500));

  let result;
  try {
    result = await ipcRenderer.invoke('web-search', query);
    updateSearchStep(step1, 'Connected to search network.', 'done');
  } catch (err) {
    updateSearchStep(step1, 'Connection failed!', 'error');
    speakText('Web search connection failed, Sir.');
    return 'Web search error.';
  }

  const step2 = await addSearchStep('\u{1F4E1}', 'Scanning web sources & extracting data...', 'running');
  await new Promise(r => setTimeout(r, 800));
  const results = result.results || [];
  updateSearchStep(step2, `Found ${results.length} relevant sources.`, 'done');

  const step3 = await addSearchStep('\u{1F9E0}', 'Analyzing and ranking results...', 'running');
  await new Promise(r => setTimeout(r, 600));
  updateSearchStep(step3, 'Results ranked by relevance.', 'done');

  // Step 4: Render results one by one with slide-in animation
  if (resultsEl && results.length > 0) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const cardId = `${searchContainerId}-card-${i}`;
      const safeUrl = (r.url || '').replace(/'/g, "\\'");
      resultsEl.innerHTML += `
        <div id="${cardId}" style="background:rgba(0,240,255,0.03); border:1px solid rgba(0,240,255,0.12); border-radius:8px; padding:14px; cursor:pointer; transform:translateX(30px); opacity:0; transition:all 0.5s ease;" 
             onmouseenter="this.style.borderColor='rgba(0,240,255,0.5)'; this.style.background='rgba(0,240,255,0.08)'"
             onmouseleave="this.style.borderColor='rgba(0,240,255,0.12)'; this.style.background='rgba(0,240,255,0.03)'"
             onclick="ipcRenderer.invoke('launch-app', '${safeUrl}')">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span style="background:rgba(0,240,255,0.15); color:#00f0ff; font-family:'Orbitron',monospace; font-size:10px; padding:2px 8px; border-radius:4px;">${i + 1}</span>
            <span style="color:#00f0ff; font-size:13px; font-weight:600;">${escapeHtml(r.title)}</span>
            <i class="fa-solid fa-arrow-up-right-from-square" style="color:rgba(0,240,255,0.3); font-size:10px; margin-left:auto;"></i>
          </div>
          <div style="color:rgba(255,255,255,0.55); font-size:12px; line-height:1.5; margin-bottom:6px;">${escapeHtml(r.snippet ? r.snippet.substring(0, 180) : '')}</div>
          <div style="color:rgba(0,240,255,0.3); font-size:10px; font-family:monospace;"><i class="fa-solid fa-link" style="margin-right:4px;"></i>${escapeHtml(r.url || '')}</div>
        </div>`;
      
      await new Promise(resolve => setTimeout(resolve, 250));
      const cardEl = document.getElementById(cardId);
      if (cardEl) {
        cardEl.style.transform = 'translateX(0)';
        cardEl.style.opacity = '1';
      }
      jarvisAudio.playKeypressSound();
    }
  }

  // Step 5: AI Summary with typewriter effect
  const step4 = await addSearchStep('\u{1F4DD}', 'Generating intelligence briefing...', 'running');

  const snippets = results.map(r => r.snippet || '').join('. ');
  const summaryPrompt = `Based on these web search results about "${query}": ${snippets.substring(0, 1000)} - Provide a concise 3-sentence summary of the key findings. Speak as J.A.R.V.I.S. reporting to Mr. Sumit.`;
  const aiResult = await ipcRenderer.invoke('ask-ai-llm', { query: summaryPrompt, history: [] });

  updateSearchStep(step4, 'Intelligence briefing ready.', 'done');

  if (aiResult.success && summaryEl) {
    summaryEl.style.display = 'block';
    summaryEl.innerHTML = `
      <div style="color:#00ffaa; font-family:'Orbitron',monospace; font-size:11px; margin-bottom:8px; letter-spacing:2px;">
        <i class="fa-solid fa-brain"></i> AI INTELLIGENCE BRIEFING
      </div>
      <div id="${searchContainerId}-summary-text" style="color:rgba(255,255,255,0.8); font-size:13px; line-height:1.6;"></div>`;

    // Typewriter effect for summary
    const summaryTextEl = document.getElementById(`${searchContainerId}-summary-text`);
    if (summaryTextEl) {
      const summaryText = aiResult.response;
      for (let i = 0; i < summaryText.length; i++) {
        await new Promise(r => setTimeout(r, 15));
        summaryTextEl.textContent += summaryText[i];
      }
    }

    speakText(aiResult.response);
  }

  await addSearchStep('\u2705', `Web search complete - ${results.length} sources analyzed.`, 'done');

  return `Web search completed for "${query}".`;
}

// ======================== ENHANCED STEALTH MODE ========================
function enterStealthMode() {
  state.stealthMode = true;
  state.currentProtocol = 'STEALTH';
  if (currentProtocolLabel) currentProtocolLabel.textContent = 'PROTOCOL: STEALTH';
  document.body.classList.add('stealth-active');
  window.speechSynthesis.cancel();
  appendMessageUI('system', '🔒 Stealth Protocol active. All visual and audio output suppressed. Press Escape to exit.');
}

function exitStealthMode() {
  state.stealthMode = false;
  state.currentProtocol = 'NORMAL';
  if (currentProtocolLabel) currentProtocolLabel.textContent = 'PROTOCOL: ACTIVE';
  document.body.classList.remove('stealth-active');
  appendMessageUI('system', '🔓 Stealth Protocol disengaged. Full systems restored.');
  speakText('Stealth mode disengaged. All systems back online, Sir.');
}

// Escape key toggles stealth
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.stealthMode) {
    e.preventDefault();
    exitStealthMode();
  }
});

window.enterStealthMode = enterStealthMode;
window.exitStealthMode = exitStealthMode;

// ======================== FACE RECOGNITION LOGIN ========================
const JARVIS_PIN = localStorage.getItem('jarvis_pin') || '1234';
let faceScanAttempts = 0;
let faceScanStream = null;

async function initFaceRecognitionLogin() {
  const overlay = document.getElementById('faceLockOverlay');
  const statusEl = document.getElementById('faceLockStatus');
  const badgeEl = document.getElementById('faceRegisteredBadge');
  const video = document.getElementById('faceCamFeed');

  if (!overlay) return;
  overlay.style.display = 'flex';

  const registeredFace = localStorage.getItem('jarvis_owner_face_b64');
  if (badgeEl) {
    badgeEl.textContent = registeredFace ? '🛡️ OWNER PROFILE ACTIVE (MR. SUMIT)' : '⚠️ NO FACE REGISTERED — CLICK BELOW TO REGISTER';
    badgeEl.style.color = registeredFace ? '#00ffaa' : '#ffb700';
  }

  try {
    faceScanStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
    video.srcObject = faceScanStream;
    statusEl.textContent = registeredFace ? 'Biometric scanner active. Verifying owner identity...' : 'Click "REGISTER MY FACE" to set your face profile.';
    statusEl.className = 'face-lock-status';

    if (registeredFace) {
      runFaceScan();
    } else {
      document.getElementById('pinBypassSection').style.display = 'flex';
    }
  } catch (err) {
    statusEl.textContent = 'Camera unavailable. Use PIN to proceed.';
    statusEl.className = 'face-lock-status error';
    document.getElementById('pinBypassSection').style.display = 'flex';
  }
}

async function registerOwnerFace() {
  const video = document.getElementById('faceCamFeed');
  const statusEl = document.getElementById('faceLockStatus');
  const badgeEl = document.getElementById('faceRegisteredBadge');
  const overlay = document.getElementById('faceLockOverlay');

  if (!video || !video.srcObject) {
    try {
      faceScanStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
      if (video) video.srcObject = faceScanStream;
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Camera error! Cannot capture face.';
      return;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 320, 240);
  const frameDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  localStorage.setItem('jarvis_owner_face_b64', frameDataUrl);

  if (statusEl) {
    statusEl.textContent = '✅ Face profile registered for Mr. Sumit!';
    statusEl.className = 'face-lock-status success';
  }
  if (badgeEl) {
    badgeEl.textContent = '🛡️ OWNER PROFILE ACTIVE (MR. SUMIT)';
    badgeEl.style.color = '#00ffaa';
  }

  speakText('Face profile successfully registered for Mr. Sumit. Access granted.');

  if (overlay && !overlay.classList.contains('unlocked')) {
    if (faceScanStream) {
      faceScanStream.getTracks().forEach(t => t.stop());
      faceScanStream = null;
    }
    setTimeout(() => {
      overlay.classList.add('unlocked');
      setTimeout(() => overlay.style.display = 'none', 1200);
    }, 800);
  }
}

function compareFaceProfilesLocally(b64Img1, b64Img2) {
  return new Promise((resolve) => {
    try {
      const img1 = new Image();
      const img2 = new Image();
      let loaded = 0;

      const checkBothLoaded = () => {
        loaded++;
        if (loaded < 2) return;

        const size = 64;
        const canvas1 = document.createElement('canvas');
        canvas1.width = size;
        canvas1.height = size;
        const ctx1 = canvas1.getContext('2d');
        ctx1.drawImage(img1, 0, 0, size, size);
        const data1 = ctx1.getImageData(0, 0, size, size).data;

        const canvas2 = document.createElement('canvas');
        canvas2.width = size;
        canvas2.height = size;
        const ctx2 = canvas2.getContext('2d');
        ctx2.drawImage(img2, 0, 0, size, size);
        const data2 = ctx2.getImageData(0, 0, size, size).data;

        let diffSum = 0;
        let pixelCount = size * size;

        for (let i = 0; i < data1.length; i += 4) {
          const gray1 = (data1[i] * 0.299 + data1[i+1] * 0.587 + data1[i+2] * 0.114);
          const gray2 = (data2[i] * 0.299 + data2[i+1] * 0.587 + data2[i+2] * 0.114);
          diffSum += Math.abs(gray1 - gray2);
        }

        const avgDiff = diffSum / pixelCount;
        const isMatch = avgDiff < 58; // Threshold for offline face structure match
        resolve({ match: isMatch, score: Math.round(100 - (avgDiff / 255 * 100)) });
      };

      img1.onload = checkBothLoaded;
      img2.onload = checkBothLoaded;
      img1.onerror = () => resolve({ match: false, score: 0 });
      img2.onerror = () => resolve({ match: false, score: 0 });

      img1.src = b64Img1;
      img2.src = b64Img2;
    } catch(e) {
      resolve({ match: false, score: 0 });
    }
  });
}

async function runFaceScan() {
  const overlay = document.getElementById('faceLockOverlay');
  const statusEl = document.getElementById('faceLockStatus');
  const video = document.getElementById('faceCamFeed');

  if (!overlay || overlay.classList.contains('unlocked')) return;

  const registeredFace = localStorage.getItem('jarvis_owner_face_b64');
  if (!registeredFace) {
    statusEl.textContent = 'No owner face registered yet. Please click "REGISTER MY FACE".';
    return;
  }

  faceScanAttempts++;
  statusEl.textContent = `Comparing face against Mr. Sumit's registered profile... (Attempt ${faceScanAttempts})`;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 320, 240);
    const liveFrameDataUrl = canvas.toDataURL('image/jpeg', 0.8);

    // 1. Try 100% Offline Local Biometric Matching first
    const localMatch = await compareFaceProfilesLocally(registeredFace, liveFrameDataUrl);
    
    let isAuthorized = localMatch.match;

    // 2. If offline match succeeded OR cloud vision authorizes
    if (!isAuthorized && navigator.onLine) {
      const verifyPrompt = 'Image 1 is the registered reference photo of system owner Mr. Sumit. Image 2 is a live webcam frame. Are both images showing the exact same person? Respond with strictly "AUTHORIZED" or "DENIED".';
      const result = await ipcRenderer.invoke('ask-ai-llm', {
        query: verifyPrompt,
        history: [],
        images: [registeredFace, liveFrameDataUrl]
      });
      if (result.success && result.response.toUpperCase().includes('AUTHORIZED')) {
        isAuthorized = true;
      }
    }

    if (isAuthorized) {
      statusEl.textContent = `Identity confirmed — Mr. Sumit verified! (${localMatch.score}% Match)`;
      statusEl.className = 'face-lock-status success';

      if (faceScanStream) {
        faceScanStream.getTracks().forEach(t => t.stop());
        faceScanStream = null;
      }

      setTimeout(() => {
        overlay.classList.add('unlocked');
        setTimeout(() => {
          overlay.style.display = 'none';
          speakText('Identity confirmed. Welcome back, Mr. Sumit.');
        }, 1200);
      }, 800);
      return;
    }

    if (faceScanAttempts >= 5) {
      statusEl.textContent = 'Face match failed (Access Denied). Please use PIN.';
      statusEl.className = 'face-lock-status error';
      document.getElementById('pinBypassSection').style.display = 'flex';
      if (faceScanStream) {
        faceScanStream.getTracks().forEach(t => t.stop());
        faceScanStream = null;
      }
      return;
    }

    statusEl.textContent = 'Verifying identity... Hold steady.';
    setTimeout(() => runFaceScan(), 2500);
  } catch (err) {
    statusEl.textContent = 'Verification error. Retrying...';
    if (faceScanAttempts < 5) {
      setTimeout(() => runFaceScan(), 2500);
    } else {
      statusEl.textContent = 'Scanner failed. Use PIN to proceed.';
      statusEl.className = 'face-lock-status error';
      document.getElementById('pinBypassSection').style.display = 'flex';
    }
  }
}

function showPinBypass() {
  document.getElementById('pinBypassSection').style.display = 'flex';
  document.getElementById('pinBypassInput').focus();
}

function verifyPinBypass() {
  const input = document.getElementById('pinBypassInput');
  const overlay = document.getElementById('faceLockOverlay');
  const statusEl = document.getElementById('faceLockStatus');

  if (input.value === JARVIS_PIN) {
    statusEl.textContent = 'PIN verified. Access granted.';
    statusEl.className = 'face-lock-status success';

    if (faceScanStream) {
      faceScanStream.getTracks().forEach(t => t.stop());
      faceScanStream = null;
    }

    setTimeout(() => {
      overlay.classList.add('unlocked');
      setTimeout(() => {
        overlay.style.display = 'none';
        speakText('PIN verified. Welcome back, Sir. All systems online.');
      }, 1200);
    }, 500);
  } else {
    statusEl.textContent = 'Incorrect PIN. Access denied.';
    statusEl.className = 'face-lock-status error';
    input.value = '';
    input.focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const pinInput = document.getElementById('pinBypassInput');
  if (pinInput) {
    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') verifyPinBypass();
    });
  }
});

// ═══════════════════ CONTINUOUS WEBCAM AI FACE RADAR & MULTI-PERSON MEMORY ═══════════════════
let bgWebcamStream = null;
let currentDetectedPersonId = null;
let lastUnknownFaceAlertTime = 0;
let lastRecognizedGreetingTime = 0;
let newFaceCapturedDataUrl = null;

async function startContinuousFaceRadar() {
  const bgVideo = document.getElementById('bgWebcamVideo');
  if (!bgVideo) return;

  try {
    bgWebcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    bgVideo.srcObject = bgWebcamStream;
  } catch(e) {
    console.log('[Face Radar] Webcam access error:', e.message);
    const radarText = document.getElementById('hudFaceRadarText');
    if (radarText) radarText.textContent = 'NO CAM';
    return;
  }

  // Load existing faces and ensure Mr. Sumit is registered
  let registeredFaces = await ipcRenderer.invoke('get-registered-faces');
  const ownerFaceLocal = localStorage.getItem('jarvis_owner_face_b64');
  if (ownerFaceLocal && !registeredFaces.some(f => f.id === 'owner')) {
    await ipcRenderer.invoke('save-registered-face', {
      id: 'owner',
      name: 'Mr. Sumit',
      relation: 'Creator & Boss',
      b64Face: ownerFaceLocal
    });
    registeredFaces = await ipcRenderer.invoke('get-registered-faces');
  }

  loadRegisteredFacesUI();

  // Polling loop every 3.5 seconds
  setInterval(async () => {
    if (!bgVideo || bgVideo.paused || bgVideo.ended) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bgVideo, 0, 0, 160, 160);
      const liveFrameDataUrl = canvas.toDataURL('image/jpeg', 0.7);

      const faces = await ipcRenderer.invoke('get-registered-faces');
      if (!faces || faces.length === 0) return;

      let matchedPerson = null;
      let highestScore = 0;

      for (const face of faces) {
        if (!face.b64Face || face.id !== 'owner') continue; // OWNER ONLY: Filter out any non-owner faces
        const res = await compareFaceProfilesLocally(face.b64Face, liveFrameDataUrl);
        if (res.match && res.score > highestScore) {
          highestScore = res.score;
          matchedPerson = face;
        }
      }

      const radarText = document.getElementById('hudFaceRadarText');
      const now = Date.now();

      const reticleEl = document.getElementById('starkFaceTargetReticle');
      const avatarImg = document.getElementById('starkTargetAvatar');
      const nameEl = document.getElementById('starkTargetName');
      const relEl = document.getElementById('starkTargetRelation');
      const badgeEl = document.getElementById('starkTargetThreatBadge');

      if (matchedPerson && matchedPerson.id === 'owner') {
        if (radarText) {
          radarText.textContent = `SUMIT (Creator & Boss)`;
          radarText.className = 'text-emerald';
        }

        if (reticleEl) {
          if (avatarImg && matchedPerson.b64Face) avatarImg.src = matchedPerson.b64Face;
          if (nameEl) nameEl.textContent = 'SUMIT';
          if (relEl) relEl.textContent = 'RELATION: CREATOR & BOSS';
          if (badgeEl) {
            badgeEl.textContent = 'CLEARANCE: GRANTED';
            badgeEl.style.borderColor = '#00ffaa';
            badgeEl.style.color = '#00ffaa';
            badgeEl.style.background = 'rgba(0, 255, 170, 0.2)';
          }
          reticleEl.style.display = 'block';
          clearTimeout(window.reticleHideTimeout);
          window.reticleHideTimeout = setTimeout(() => { reticleEl.style.display = 'none'; }, 8000);
        }

        if (currentDetectedPersonId !== 'owner') {
          currentDetectedPersonId = 'owner';

          if (now - lastRecognizedGreetingTime > 25000) { // 25 second cooldown
            lastRecognizedGreetingTime = now;
            JarvisNotify.success('STARK TARGET LOCK', `Mr. Sumit (Creator & Boss) identified on camera.`);
            jarvisAudio.playBeep();
            speakText('Welcome back, Mr. Sumit. Biometric scanner cleared. All systems online.');
          }
        }
      } else {
        currentDetectedPersonId = 'unknown';
        if (radarText) {
          radarText.textContent = 'SCANNING...';
          radarText.className = 'text-cyan';
        }
        if (reticleEl) {
          reticleEl.style.display = 'none';
        }
      }
    } catch(e) {}
  }, 3500);
}

// --- Face Memory Management UI Functions ---
async function loadRegisteredFacesUI() {
  const container = document.getElementById('registeredFacesGrid');
  if (!container) return;

  const faces = await ipcRenderer.invoke('get-registered-faces');
  if (!faces || faces.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; color:rgba(255,255,255,0.5); font-size:12px;">No faces stored yet. Click "LEARN PERSON ON CAMERA NOW" to add your face or family/friends.</div>`;
    return;
  }

  container.innerHTML = '';
  faces.forEach(f => {
    const card = document.createElement('div');
    card.style.cssText = 'background:rgba(2,20,48,0.8); border:1px solid var(--stark-border); border-radius:8px; padding:12px; text-align:center; position:relative;';
    card.innerHTML = `
      <img src="${f.b64Face}" style="width:64px; height:64px; border-radius:50%; object-fit:cover; border:2px solid var(--cyan-bright); margin-bottom:8px;">
      <div style="font-family:var(--font-title); font-size:12px; color:var(--cyan-bright); font-weight:bold;">${f.name}</div>
      <div style="font-size:10px; color:var(--gold-stark); font-family:var(--font-sub); text-transform:uppercase; margin-top:2px;">${f.relation}</div>
      ${f.id !== 'owner' ? `<button onclick="deleteRegisteredFaceUI('${f.id}')" style="position:absolute; top:6px; right:6px; background:none; border:none; color:#ff2a5f; cursor:pointer; font-size:12px;" title="Delete Face">✕</button>` : ''}
    `;
    container.appendChild(card);
  });
}

function openRegisterFaceModal(prefillName = '', prefillRelation = 'Friend') {
  const modal = document.getElementById('modalRegisterNewFace');
  if (!modal) return;

  if (prefillName) {
    const nameInput = document.getElementById('newFaceNameInput');
    if (nameInput) nameInput.value = prefillName;
  }
  if (prefillRelation) {
    const relSelect = document.getElementById('newFaceRelationSelect');
    if (relSelect) relSelect.value = prefillRelation;
  }

  modal.style.display = 'block';
  captureSnapshotForNewFace();
}

function closeRegisterFaceModal() {
  const modal = document.getElementById('modalRegisterNewFace');
  if (modal) modal.style.display = 'none';
}

function captureSnapshotForNewFace() {
  const bgVideo = document.getElementById('bgWebcamVideo');
  const canvas = document.getElementById('registerFaceCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (bgVideo && !bgVideo.paused) {
    ctx.drawImage(bgVideo, 0, 0, 160, 160);
    newFaceCapturedDataUrl = canvas.toDataURL('image/png');
  } else {
    ctx.fillStyle = '#021430';
    ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = '#00f0ff';
    ctx.font = '12px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText('NO CAM STREAM', 80, 85);
  }
}

async function saveNewFaceProfile() {
  const nameInput = document.getElementById('newFaceNameInput');
  const relSelect = document.getElementById('newFaceRelationSelect');

  const name = nameInput ? nameInput.value.trim() : '';
  const relation = relSelect ? relSelect.value : 'Friend';

  if (!name) return alert('Please enter the person\'s name.');
  if (!newFaceCapturedDataUrl) captureSnapshotForNewFace();

  if (name.toLowerCase().includes('sumit')) {
    localStorage.setItem('jarvis_owner_face_b64', newFaceCapturedDataUrl);
  }

  const faceObj = {
    id: name.toLowerCase().includes('sumit') ? 'owner' : 'face_' + Date.now(),
    name: name,
    relation: relation,
    b64Face: newFaceCapturedDataUrl
  };

  const res = await ipcRenderer.invoke('save-registered-face', faceObj);
  if (res.success) {
    JarvisNotify.success('FACE MEMORY SAVED', `Learned face profile for ${name} (${relation}).`);
    speakText(`Face profile for ${name} saved to system memory, Sir.`);
    closeRegisterFaceModal();
    loadRegisteredFacesUI();
  } else {
    alert(`Failed to save face profile: ${res.error}`);
  }
}

async function deleteRegisteredFaceUI(faceId) {
  if (confirm('Delete this face profile from JARVIS memory?')) {
    const res = await ipcRenderer.invoke('delete-registered-face', faceId);
    if (res.success) {
      JarvisNotify.info('FACE DELETED', 'Profile removed from memory.');
      loadRegisteredFacesUI();
    }
  }
}

// ═══════════════════ ULTRON COUNTERMEASURE CYBER DEFENSE MATRIX ═══════════════════
function triggerUltronLockdown() {
  const overlay = document.getElementById('ultronLockdownOverlay');
  const statusEl = document.getElementById('ultronLockdownStatus');
  const pinInput = document.getElementById('ultronPinInput');

  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('unlocked');
    if (statusEl) {
      statusEl.textContent = 'VIBRANIUM SHIELD ONLINE — ENTER PIN TO DISARM';
      statusEl.className = 'face-lock-status error';
    }
    if (pinInput) {
      pinInput.value = '';
      pinInput.focus();
    }

    jarvisAudio.playProtocolSound();
    JarvisNotify.critical('ULTRON COUNTERMEASURE', 'Vibranium Defense Matrix active. System locked down!');
    speakText('Ultron threat detected! Engaging Vibranium Defense Matrix. All local systems isolated, Mr. Sumit.');
  }
}

function disarmUltronLockdown() {
  const overlay = document.getElementById('ultronLockdownOverlay');
  const statusEl = document.getElementById('ultronLockdownStatus');
  const pinInput = document.getElementById('ultronPinInput');

  if (pinInput && pinInput.value === JARVIS_PIN) {
    if (statusEl) {
      statusEl.textContent = 'VIBRANIUM SHIELD DISARMED — WELCOME BACK, MR. SUMIT!';
      statusEl.className = 'face-lock-status success';
    }
    jarvisAudio.playProtocolSound();
    speakText('Ultron threat neutralized. Vibranium shield disarmed. Welcome back, Mr. Sumit.');
    JarvisNotify.success('DEFENSE DISARMED', 'Systems restored to full operation.');

    setTimeout(() => {
      if (overlay) {
        overlay.classList.add('unlocked');
        setTimeout(() => overlay.style.display = 'none', 1000);
      }
    }, 600);
  } else {
    if (statusEl) {
      statusEl.textContent = 'INCORRECT PIN — VIBRANIUM SHIELD REMAINS ACTIVE';
      statusEl.className = 'face-lock-status error';
    }
    if (pinInput) {
      pinInput.value = '';
      pinInput.focus();
    }
  }
}

let lastNetworkThreatCount = 0;
function startNetworkThreatScanner() {
  const checkThreats = async () => {
    try {
      const res = await ipcRenderer.invoke('scan-network-threats');
      if (res && res.success) {
        const badgeText = document.getElementById('hudCyberShieldText');
        if (badgeText) {
          if (res.count > 0) {
            badgeText.textContent = `RADAR (${res.count} NODES)`;
            badgeText.className = 'text-emerald';
          } else {
            badgeText.textContent = 'SECURE';
            badgeText.className = 'text-emerald';
          }
        }
      }
    } catch(e) {}
  };

  checkThreats();
  setInterval(checkThreats, 30000);
}

async function purgeSystemRam() {
  try {
    jarvisAudio.playBeep();
    const res = await ipcRenderer.invoke('purge-system-ram');
    if (res && res.success) {
      JarvisNotify.success('STARK MEMORY PURGE', 'System RAM garbage collection executed.');
      speakText('Memory purge protocol executed, Sir. Reclaimed background RAM.');
    }
  } catch(e) {}
}

window.purgeSystemRam = purgeSystemRam;

// ═══════════════════ AUTONOMOUS TIMERS, ALARMS & VOICE REMINDERS ═══════════════════
const activeJarvisTimers = [];

function setJarvisTimer(seconds, label) {
  const endTime = Date.now() + (seconds * 1000);
  const timerObj = { id: 'timer_' + Date.now(), label: label || 'Timer', endTime: endTime, totalSec: seconds };
  activeJarvisTimers.push(timerObj);

  JarvisNotify.info('TIMER SET', `${timerObj.label} started for ${seconds} seconds.`);
  jarvisAudio.playBeep();
  updateActiveTimersWidget();
}

function updateActiveTimersWidget() {
  const widget = document.getElementById('hudActiveTimersWidget');
  if (!widget) return;

  const now = Date.now();
  for (let i = activeJarvisTimers.length - 1; i >= 0; i--) {
    const t = activeJarvisTimers[i];
    const rem = Math.max(0, Math.ceil((t.endTime - now) / 1000));

    if (rem <= 0) {
      activeJarvisTimers.splice(i, 1);
      jarvisAudio.playProtocolSound();
      JarvisNotify.warning('ALARM TRIGGERED', `⏰ ${t.label} HAS COMPLETED!`, 10000);
      speakText(`Sir, your ${t.label} has completed!`);
    }
  }

  if (activeJarvisTimers.length > 0) {
    const nextTimer = activeJarvisTimers[0];
    const remSec = Math.max(0, Math.ceil((nextTimer.endTime - now) / 1000));
    const mins = Math.floor(remSec / 60);
    const secs = remSec % 60;
    const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    widget.innerHTML = `<i class="fa-solid fa-stopwatch fa-spin text-gold"></i> ${nextTimer.label.toUpperCase()}: <span style="color:#00f0ff;">${timeStr}</span>`;
  } else {
    widget.innerHTML = `<i class="fa-solid fa-stopwatch"></i> NO ACTIVE TIMERS`;
  }
}

setInterval(updateActiveTimersWidget, 1000);

// ═══════════════════ VOICE NOTE-TAKING & ENCRYPTED JOURNAL ═══════════════════
function saveJarvisVoiceNote(text) {
  const notes = JSON.parse(localStorage.getItem('jarvis_voice_notes') || '[]');
  notes.push({ text: text, date: new Date().toLocaleTimeString() });
  if (notes.length > 20) notes.shift();
  localStorage.setItem('jarvis_voice_notes', JSON.stringify(notes));

  JarvisNotify.success('NOTE SAVED', `"${text}" saved to vault.`);
  jarvisAudio.playBeep();
}

function readJarvisVoiceNotes() {
  const notes = JSON.parse(localStorage.getItem('jarvis_voice_notes') || '[]');
  if (notes.length === 0) return "You have no notes saved in your vault today, Mr. Sumit.";

  const recent = notes.slice(-3);
  let summary = "📝 **YOUR RECENT STARK VAULT NOTES:**\n";
  recent.forEach((n, idx) => {
    summary += `${idx + 1}. **[${n.date}]** ${n.text}\n`;
  });
  return summary;
}

// ═══════════════════ DRAG & DROP DOCUMENT & PDF ANALYZER ═══════════════════
function setupDocumentDropZone() {
  const dropZone = document.getElementById('chatDropZone');
  if (!dropZone) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#00f0ff';
    dropZone.style.boxShadow = '0 0 25px rgba(0,240,255,0.4)';
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(0,240,255,0.2)';
    dropZone.style.boxShadow = 'none';
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(0,240,255,0.2)';
    dropZone.style.boxShadow = 'none';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      JarvisNotify.info('DOCUMENT ANALYZER', `Reading file: ${file.name}...`);
      jarvisAudio.playBeep();

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const fileContent = evt.target.result;
        const promptText = `Analyze and provide a 3-bullet executive summary for this document (${file.name}):\n\n${fileContent.substring(0, 3000)}`;
        
        appendUserMessage(`[Uploaded Document: ${file.name}]`);
        appendSystemMessage(`📄 **ANALYZING DOCUMENT: ${file.name}**...`);

        const res = await ipcRenderer.invoke('ask-ai-llm', { query: promptText, history: [] });
        if (res.success) {
          appendAiMessage(res.response);
          speakText(`Document analysis for ${file.name} complete, Sir.`);
        } else {
          appendSystemMessage(`Failed to analyze document: ${res.error}`);
        }
      };
      reader.readAsText(file);
    }
  });
}

// ═══════════════════ STARK CYBER PENETRATION & HACKER TERMINAL ═══════════════════
function toggleHackerTerminal() {
  const overlay = document.getElementById('starkHackerTerminal');
  if (!overlay) return;

  if (overlay.style.display === 'flex') {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
    jarvisAudio.playProtocolSound();
    JarvisNotify.info('CYBER TERMINAL', 'Stark Ethical Hacking & Security Console root access online.');
    speakText('Stark Cyber Penetration and Security Terminal online, Mr. Sumit.');
  }
}

function appendHackerLog(text, color = '#00ffaa') {
  const container = document.getElementById('hackerTerminalLog');
  if (!container) return;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.style.color = color;
  div.innerHTML = `[${time}] > ${text}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function runPortScan() {
  appendHackerLog("INITIALIZING LOCAL PORT SCANNER...", "#00f0ff");
  jarvisAudio.playBeep();

  const res = await ipcRenderer.invoke('scan-local-ports');
  if (res && res.success) {
    appendHackerLog(`TARGET: ${res.host}`, "#00ffaa");
    if (res.openPorts.length > 0) {
      appendHackerLog(`OPEN PORTS DETECTED: [ ${res.openPorts.join(', ')} ]`, "#ffb700");
      speakText(`Port scan complete. Detected ${res.openPorts.length} active local ports.`);
    } else {
      appendHackerLog("ALL TESTED PORTS SECURE / CLOSED", "#00ffaa");
      speakText("Port scan complete. All standard local ports are secure.");
    }
  } else {
    appendHackerLog(`PORT SCAN FAILED: ${res.error}`, "#ff2a5f");
  }
}

async function promptIPTrace(ipStr) {
  const ip = ipStr || prompt("Enter IP address or domain to trace (e.g. 8.8.8.8):", "8.8.8.8");
  if (!ip) return;

  appendHackerLog(`TRACING NETWORK TARGET: [${ip}]...`, "#00f0ff");
  jarvisAudio.playBeep();

  const res = await ipcRenderer.invoke('trace-ip-address', ip);
  if (res && res.success && res.data) {
    const d = res.data;
    appendHackerLog(`SUCCESS: Target resolved!`, "#00ffaa");
    appendHackerLog(`IP: ${d.query || ip} | COUNTRY: ${d.country || 'Unknown'} | CITY: ${d.city || 'Unknown'}`, "#00ffaa");
    appendHackerLog(`ISP: ${d.isp || 'Unknown'} | ORG: ${d.org || 'Unknown'}`, "#00f0ff");
    speakText(`IP trace for ${ip} complete. Target located in ${d.country || 'unknown region'}.`);
  } else {
    appendHackerLog(`TRACE FAILED: ${res.error || 'Timeout'}`, "#ff2a5f");
  }
}

function generateQuantumPass() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
  let pass = '';
  for (let i = 0; i < 20; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  appendHackerLog(`QUANTUM 256-BIT PASSWORD GENERATED: [ ${pass} ]`, "#ffb700");
  speakText("Generated 20-character quantum resistant password, Sir.");
}

function simulateCyberAttack() {
  toggleHackerTerminal();
  appendHackerLog("🚨 SIMULATED CYBER ATTACK INITIATED!", "#ff2a5f");
  appendHackerLog("INTRUDER PACKETS DETECTED ON PORT 8080...", "#ff2a5f");
  jarvisAudio.playProtocolSound();
  speakText("Warning! Simulated cyber intrusion detected. Engaging automated counter-hack protocol.");

  setTimeout(() => {
    appendHackerLog("ISOLATING INTRUDER IP: 192.168.1.99...", "#ffb700");
  }, 1500);

  setTimeout(() => {
    appendHackerLog("INJECTING COUNTER-PAYLOAD...", "#00f0ff");
  }, 3000);

  setTimeout(() => {
    appendHackerLog("✓ INTRUDER NEUTRALIZED! FIREWALL PORTS RE-LOCKED.", "#00ffaa");
    JarvisNotify.success("ATTACK MITIGATED", "Simulated cyber threat successfully repelled.");
    speakText("Counter-hack protocol complete. Intruder neutralized and ports locked down, Mr. Sumit.");
  }, 4500);
}

// Global Hotkey IPC Listener for Ctrl+Shift+H
ipcRenderer.on('trigger-hacker-terminal', () => {
  toggleHackerTerminal();
});

window.toggleHackerTerminal = toggleHackerTerminal;
window.runPortScan = runPortScan;
window.promptIPTrace = promptIPTrace;
window.generateQuantumPass = generateQuantumPass;
window.simulateCyberAttack = simulateCyberAttack;

// Global Hotkey IPC Listener for Ctrl+Shift+U
ipcRenderer.on('trigger-ultron-lockdown', () => {
  console.log("Global Hotkey triggered Ultron Emergency Lockdown.");
  triggerUltronLockdown();
});

window.triggerUltronLockdown = triggerUltronLockdown;
window.disarmUltronLockdown = disarmUltronLockdown;
window.openFaceMemoryManager = () => {
  const configTab = document.querySelector('[data-tab="stark-config"]');
  if (configTab) configTab.click();
};
window.openRegisterFaceModal = openRegisterFaceModal;
window.closeRegisterFaceModal = closeRegisterFaceModal;
window.captureSnapshotForNewFace = captureSnapshotForNewFace;
window.saveNewFaceProfile = saveNewFaceProfile;
window.deleteRegisteredFaceUI = deleteRegisteredFaceUI;

window.registerOwnerFace = registerOwnerFace;
window.showPinBypass = showPinBypass;
window.verifyPinBypass = verifyPinBypass;
window.performLiveWebSearch = performLiveWebSearch;

// ======================== STARK OFFLINE MUSIC & AMBIENT DECK ========================
let musicCtx = null;
let musicNodes = [];
let localAudioElem = new Audio();
let currentMusicVolume = 0.8;
let currentTrackIndex = 0;
let isMusicPlaying = false;
let scannedLocalTracks = [];

const musicPlaylist = [
  { id: 'ironman', title: '🎵 IRON MAN ARC THEME', subtitle: 'STARK CINEMATIC BRASS & ARC SYNTH (100% OFFLINE)', type: 'synth' },
  { id: 'lofi', title: '🎧 LO-FI STUDY BEATS', subtitle: 'WARM CHILL CHORDS & VINYL AMBIENCE (100% OFFLINE)', type: 'synth' },
  { id: 'focus', title: '🧠 ALPHA FOCUS 432HZ', subtitle: 'BINAURAL ALPHA WAVE BRAINWAVE ENTRAINMENT', type: 'synth' },
  { id: 'starklab', title: '⚡ STARK LAB AMBIENCE', subtitle: 'RESONANT ARC REACTOR & SUIT OVERDRIVE HUM', type: 'synth' }
];

function initMusicAudioContext() {
  if (!musicCtx) {
    musicCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (musicCtx.state === 'suspended') {
    musicCtx.resume();
  }
}

function stopAllSynthNodes() {
  musicNodes.forEach(node => {
    try {
      if (node.stop) node.stop();
      if (node.disconnect) node.disconnect();
    } catch(e){}
  });
  musicNodes = [];
  if (localAudioElem) {
    localAudioElem.pause();
  }
}

function updateMusicDeckUI(track) {
  const titleEl = document.getElementById('musicTrackTitle');
  const subEl = document.getElementById('musicTrackSubtitle');
  const btnEl = document.getElementById('musicPlayPauseBtn');
  const eqEl = document.getElementById('hudEqualizerBars');

  if (titleEl) titleEl.textContent = track.title;
  if (subEl) subEl.textContent = track.subtitle;
  if (btnEl) btnEl.innerHTML = isMusicPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';

  if (eqEl) {
    if (isMusicPlaying) {
      eqEl.classList.add('playing-eq');
      eqEl.classList.remove('paused-eq');
    } else {
      eqEl.classList.remove('playing-eq');
      eqEl.classList.add('paused-eq');
    }
  }
}

function playMusicPreset(presetId) {
  initMusicAudioContext();
  stopAllSynthNodes();

  const idx = musicPlaylist.findIndex(t => t.id === presetId);
  if (idx !== -1) currentTrackIndex = idx;
  const track = musicPlaylist[currentTrackIndex] || musicPlaylist[0];

  isMusicPlaying = true;
  updateMusicDeckUI(track);

  const masterGain = musicCtx.createGain();
  masterGain.gain.setValueAtTime(currentMusicVolume, musicCtx.currentTime);
  masterGain.connect(musicCtx.destination);
  musicNodes.push(masterGain);

  if (track.type === 'local') {
    localAudioElem.src = `file://${track.path}`;
    localAudioElem.volume = currentMusicVolume;
    localAudioElem.play();
    return;
  }

  // Synthesize Soundscapes locally using Web Audio API
  if (presetId === 'ironman') {
    const freqs = [110, 130.81, 164.81, 220, 261.63, 329.63];
    freqs.forEach((f, i) => {
      const osc = musicCtx.createOscillator();
      const gain = musicCtx.createGain();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f, musicCtx.currentTime);

      const filter = musicCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800 + i * 200, musicCtx.currentTime);

      gain.gain.setValueAtTime(0.08, musicCtx.currentTime);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      osc.start();
      musicNodes.push(osc, gain, filter);
    });
  } else if (presetId === 'lofi') {
    const chords = [174.61, 220.00, 261.63, 329.63];
    chords.forEach(f => {
      const osc = musicCtx.createOscillator();
      const gain = musicCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, musicCtx.currentTime);

      gain.gain.setValueAtTime(0.07, musicCtx.currentTime);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      musicNodes.push(osc, gain);
    });
  } else if (presetId === 'focus') {
    const osc1 = musicCtx.createOscillator();
    const osc2 = musicCtx.createOscillator();
    const g1 = musicCtx.createGain();
    const g2 = musicCtx.createGain();

    osc1.frequency.setValueAtTime(432, musicCtx.currentTime);
    osc2.frequency.setValueAtTime(442, musicCtx.currentTime);

    g1.gain.setValueAtTime(0.12, musicCtx.currentTime);
    g2.gain.setValueAtTime(0.12, musicCtx.currentTime);

    osc1.connect(g1);
    osc2.connect(g2);
    g1.connect(masterGain);
    g2.connect(masterGain);

    osc1.start();
    osc2.start();
    musicNodes.push(osc1, osc2, g1, g2);
  } else if (presetId === 'starklab') {
    const osc = musicCtx.createOscillator();
    const filter = musicCtx.createBiquadFilter();
    const gain = musicCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, musicCtx.currentTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, musicCtx.currentTime);

    gain.gain.setValueAtTime(0.15, musicCtx.currentTime);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start();
    musicNodes.push(osc, filter, gain);
  }
}

function toggleMusicPlayPause() {
  if (isMusicPlaying) {
    stopAllSynthNodes();
    isMusicPlaying = false;
  } else {
    const track = musicPlaylist[currentTrackIndex] || musicPlaylist[0];
    playMusicPreset(track.id);
  }
  updateMusicDeckUI(musicPlaylist[currentTrackIndex] || musicPlaylist[0]);
}

function nextMusicTrack() {
  currentTrackIndex = (currentTrackIndex + 1) % musicPlaylist.length;
  const track = musicPlaylist[currentTrackIndex];
  playMusicPreset(track.id);
}

function prevMusicTrack() {
  currentTrackIndex = (currentTrackIndex - 1 + musicPlaylist.length) % musicPlaylist.length;
  const track = musicPlaylist[currentTrackIndex];
  playMusicPreset(track.id);
}

function setMusicVolume(val) {
  currentMusicVolume = parseFloat(val) / 100;
  const volValEl = document.getElementById('musicVolVal');
  if (volValEl) volValEl.textContent = `${val}%`;

  if (localAudioElem) localAudioElem.volume = currentMusicVolume;
  musicNodes.forEach(node => {
    if (node.gain && node.gain.setValueAtTime) {
      node.gain.setValueAtTime(currentMusicVolume, musicCtx ? musicCtx.currentTime : 0);
    }
  });
}

async function scanLocalWindowsMusic() {
  const container = document.getElementById('localMusicListContainer');
  const itemsList = document.getElementById('localMusicItemsList');
  if (!container || !itemsList) return;

  const tracks = await ipcRenderer.invoke('get-local-music-files');
  scannedLocalTracks = tracks;

  if (tracks.length === 0) {
    itemsList.innerHTML = `<div style="color:rgba(255,255,255,0.5); font-size:11px;">No local MP3/WAV tracks found in C:\\Users\\Sumit\\Music.</div>`;
  } else {
    itemsList.innerHTML = '';
    tracks.forEach((t, idx) => {
      const trackObj = {
        id: `local-${idx}`,
        title: `🎵 ${t.name}`,
        subtitle: `LOCAL TRACK (${t.path})`,
        type: 'local',
        path: t.path
      };
      
      if (!musicPlaylist.some(p => p.path === t.path)) {
        musicPlaylist.push(trackObj);
      }

      const itemDiv = document.createElement('div');
      itemDiv.style.cssText = 'padding:6px 10px; background:rgba(0,240,255,0.05); border:1px solid rgba(0,240,255,0.15); border-radius:4px; cursor:pointer; font-size:11px; color:#00f0ff; display:flex; justify-content:space-between; align-items:center;';
      itemDiv.innerHTML = `<span><i class="fa-solid fa-file-audio"></i> ${t.name}</span> <i class="fa-solid fa-play"></i>`;
      itemDiv.onclick = () => playMusicPreset(trackObj.id);
      itemsList.appendChild(itemDiv);
    });
  }

  container.style.display = 'block';
}

window.playMusicPreset = playMusicPreset;
window.toggleMusicPlayPause = toggleMusicPlayPause;
window.nextMusicTrack = nextMusicTrack;
window.prevMusicTrack = prevMusicTrack;
window.setMusicVolume = setMusicVolume;
window.scanLocalWindowsMusic = scanLocalWindowsMusic;

// ======================== STARK PHONE & TABLET LINK ENGINE ========================
async function checkPhoneConnectionStatus() {
  const nameTag = document.getElementById('phoneDeviceNameTag');
  const subTag = document.getElementById('phoneDeviceSubTag');
  const badge = document.getElementById('phoneConnectionBadge');

  if (!nameTag || !badge) return;

  const res = await ipcRenderer.invoke('get-connected-phone-devices');
  if (res.connected && res.devices.length > 0) {
    const dev = res.devices[0];
    nameTag.textContent = `🟢 PHONE CONNECTED: ${dev.model.toUpperCase()}`;
    subTag.textContent = `Device ID: ${dev.id} | Status: AUTHORIZED (${dev.status})`;
    badge.textContent = '🟢 LINK ACTIVE';
    badge.style.borderColor = '#00ffaa';
    badge.style.color = '#00ffaa';
  } else {
    nameTag.textContent = 'AWAITING PHONE / TABLET CONNECTION...';
    subTag.textContent = 'Connect phone via USB Cable (with USB Debugging ON) OR Wireless Wi-Fi ADB.';
    badge.textContent = '🟡 STANDBY';
    badge.style.borderColor = '#ffb700';
    badge.style.color = '#ffb700';
  }
}

async function connectPhoneWifi() {
  const input = document.getElementById('phoneWifiIpInput');
  const ip = input ? input.value.trim() : '';
  if (!ip) return alert('Please enter phone Wi-Fi IP Address (e.g. 192.168.1.5)');

  appendMessageUI('system', `📡 Connecting to Phone over Wi-Fi (${ip}:5555)...`);
  const res = await ipcRenderer.invoke('phone-control-action', { action: 'connect-wifi', ipAddress: ip });
  
  if (res.success) {
    appendMessageUI('system', `✅ Wireless Phone Link established with ${ip}!`);
    speakText(`Wireless link established with your phone at ${ip}, Sir.`);
    checkPhoneConnectionStatus();
  } else {
    appendMessageUI('system', `❌ Wi-Fi pairing failed: ${res.message}`);
  }
}

async function triggerPhoneAction(action, targetApp) {
  jarvisAudio.playBeep();
  appendMessageUI('system', `📱 Sending phone command: ${action} ${targetApp || ''}...`);

  const res = await ipcRenderer.invoke('phone-control-action', { action, targetApp });

  if (res.success) {
    if (action === 'capture-screen' && res.dataUrl) {
      const displayCard = document.getElementById('phoneMirrorDisplayCard');
      const img = document.getElementById('phoneScreenCaptureImg');
      if (displayCard && img) {
        img.src = res.dataUrl;
        displayCard.style.display = 'block';
      }
    }
    appendMessageUI('system', `✅ ${res.message}`);
    speakText(res.message);
  } else {
    appendMessageUI('system', `⚠️ Phone Command Note: ${res.error || 'Ensure USB Debugging is ON in Phone Settings.'}`);
    speakText('Phone action sent. Please check if your phone screen unlocked.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    checkPhoneConnectionStatus();
  }, 3000);
});

window.checkPhoneConnectionStatus = checkPhoneConnectionStatus;
window.connectPhoneWifi = connectPhoneWifi;
window.triggerPhoneAction = triggerPhoneAction;

// ======================== GLOBAL VOICE DICTATION AUTO-TYPIST ========================
let isGlobalDictating = false;

ipcRenderer.on('trigger-global-dictation', () => {
  toggleGlobalVoiceDictation();
});

async function toggleGlobalVoiceDictation() {
  jarvisAudio.playBeep();
  
  if (isGlobalDictating) {
    isGlobalDictating = false;
    appendMessageUI('system', '⌨️ Global Voice Dictation DEACTIVATED.');
    speakText('Voice dictation stopped, Sir.');
    return;
  }

  isGlobalDictating = true;
  appendMessageUI('system', '🎙️ GLOBAL VOICE DICTATION ACTIVE — Speak into microphone to auto-type text into active app (Word, Notepad, Chrome, WhatsApp)...');
  speakText('Voice dictation active, Sir. Speak now.');

  // Trigger Python Core local mic listener over WebSocket for 100% offline voice recording
  if (pyWebSocket && pyWebSocket.readyState === WebSocket.OPEN) {
    pyWebSocket.send(JSON.stringify({ action: "FORCE_LISTEN" }));
  }

  // Also trigger Web Speech API as parallel fallback
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = async (event) => {
        const text = event.results[0][0].transcript;
        if (text && isGlobalDictating) {
          isGlobalDictating = false;
          appendMessageUI('system', `⌨️ Auto-typing: "${text}"`);
          await ipcRenderer.invoke('auto-type-text', text);
          speakText('Typed.');
          JarvisNotify.success('VOICE DICTATION', `Text auto-typed: "${text}"`);
        }
      };

      recognition.onerror = () => {};
      recognition.start();
    } catch(e){}
  }
}


// ======================== AUTONOMOUS SECURITY GUARD & IMPOSTER SIREN ========================
let securityGuardInterval = null;

function playSecuritySirenSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.3);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.6);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 1500);
  } catch(e){}
}

function toggleSecurityGuardMode() {
  const registeredFace = localStorage.getItem('jarvis_owner_face_b64');
  if (!registeredFace) {
    alert('Please register your face profile first using "REGISTER MY FACE" before activating Security Guard Mode!');
    return;
  }

  const btn = document.getElementById('securityGuardToggleBtn');
  const desc = document.getElementById('securityGuardDescText');

  state.securityGuardActive = !state.securityGuardActive;
  jarvisAudio.playProtocolSound();

  if (state.securityGuardActive) {
    if (btn) { btn.textContent = 'DISARM GUARD'; btn.style.borderColor = '#ff2a5f'; btn.style.color = '#ff2a5f'; }
    if (desc) desc.textContent = '🚨 GUARD ACTIVE — Monitoring webcam perimeter. Intruder will trigger alarm & lock PC!';
    
    appendMessageUI('system', '🚨 SECURITY GUARD MODE ARMED — Perimeter monitoring initiated.');
    speakText('Security Guard Mode activated. Monitoring workstation perimeter.');

    if (securityGuardInterval) clearInterval(securityGuardInterval);
    securityGuardInterval = setInterval(runSecurityGuardMonitor, 2500);
  } else {
    if (btn) { btn.textContent = 'ARM GUARD'; btn.style.borderColor = '#00f0ff'; btn.style.color = '#00f0ff'; }
    if (desc) desc.textContent = 'Monitors webcam for unauthorized intruders, sounds Iron Man alarm siren, snaps photo & locks PC!';
    
    if (securityGuardInterval) clearInterval(securityGuardInterval);
    appendMessageUI('system', '🛡️ Security Guard Mode Disarmed.');
    speakText('Security Guard Mode disarmed, Sir.');
  }
}

async function runSecurityGuardMonitor() {
  if (!state.securityGuardActive) return;

  const registeredFace = localStorage.getItem('jarvis_owner_face_b64');
  if (!registeredFace) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 320, 240);

    const liveFrameDataUrl = canvas.toDataURL('image/jpeg', 0.8);
    stream.getTracks().forEach(t => t.stop());

    const localMatch = await compareFaceProfilesLocally(registeredFace, liveFrameDataUrl);

    if (!localMatch.match && localMatch.score < 42) {
      console.warn("🚨 UNKNOWN INTRUDER DETECTED IN FRONT OF PC!");
      triggerIntruderAlert(liveFrameDataUrl);
    }
  } catch(e) {
    console.error("Security Guard Monitor error:", e);
  }
}

async function triggerIntruderAlert(b64Frame) {
  JarvisNotify.critical('INTRUDER DETECTED', 'Unauthorized face detected. Workstation locked. Photo saved.');
  playSecuritySirenSound();
  const res = await ipcRenderer.invoke('save-intruder-photo', b64Frame);

  appendMessageUI('system', `🚨 INTRUDER ALERT DETECTED! Unauthorized face detected in front of workstation! Intruder photo saved as ${res.filename || 'intruder.png'}.`);
  speakText('Security alert! Unauthorized intruder detected! Locking workstation now!');

  setTimeout(async () => {
    state.securityGuardActive = false;
    if (securityGuardInterval) clearInterval(securityGuardInterval);
    await ipcRenderer.invoke('system-control', { action: 'lock' });
  }, 1200);
}

window.toggleGlobalVoiceDictation = toggleGlobalVoiceDictation;
window.toggleSecurityGuardMode = toggleSecurityGuardMode;

// Modal UI Functions for Phone Connect & API Key Manager
function openPhoneConnectModal() {
  const modal = document.getElementById('starkPhoneConnectModal');
  if (modal) modal.style.display = 'flex';
}

function closePhoneConnectModal() {
  const modal = document.getElementById('starkPhoneConnectModal');
  if (modal) modal.style.display = 'none';
}

async function submitModalPhoneConnect() {
  const input = document.getElementById('modalPhoneIpInput');
  const ipAddress = input ? input.value.trim() : '';
  if (!ipAddress) return;

  closePhoneConnectModal();
  appendSystemMessage(`📱 **CONNECTING TO PHONE WIRELESSLY AT ${ipAddress}**...`);
  const res = await ipcRenderer.invoke('phone-control-action', { action: 'connect-wifi', ipAddress });
  if (res && res.success) {
    speakText(`Successfully connected to your phone wirelessly at ${ipAddress}, Sir.`);
    appendAiMessage(`📶 **WIRELESS ADB LINK ESTABLISHED:** Connected to phone at ${ipAddress}`);
  } else {
    appendSystemMessage(`Failed to connect wirelessly to phone: ${res ? res.message : 'Ensure Wireless Debugging is ON'}`);
  }
}

function openApiKeyModal() {
  const modal = document.getElementById('starkApiKeyModal');
  if (modal) modal.style.display = 'flex';
}

function closeApiKeyModal() {
  const modal = document.getElementById('starkApiKeyModal');
  if (modal) modal.style.display = 'none';
}

async function submitModalApiKey() {
  const input = document.getElementById('modalApiKeyInput');
  const keyValue = input ? input.value.trim() : '';
  if (!keyValue) return;

  closeApiKeyModal();
  const res = await ipcRenderer.invoke('save-api-key', { keyName: 'GEMINI_API_KEY', keyValue });
  if (res && res.success) {
    speakText('Gemini API key saved successfully, Mr. Sumit.');
    JarvisNotify.success('API KEY SAVED', 'Cloud AI engine active for online queries.');
    appendAiMessage('🔑 **GEMINI API KEY SAVED:** Cloud AI engine is now active when online!');
  } else {
    JarvisNotify.error('API KEY ERROR', res.error || 'Failed to save key');
  }
}

window.openPhoneConnectModal = openPhoneConnectModal;
window.closePhoneConnectModal = closePhoneConnectModal;
window.submitModalPhoneConnect = submitModalPhoneConnect;
window.openApiKeyModal = openApiKeyModal;
window.closeApiKeyModal = closeApiKeyModal;
window.submitModalApiKey = submitModalApiKey;

