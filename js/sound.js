/**
 * sound.js - Speech Synthesis & Sound System
 * Modeled after https://clangu89.github.io/face-recognition/
 */

const VOICE_PRESETS = {
  'preset:female_polite': {
    label: '👩 เสียงหญิงแท้ (สุภาพ - ค่ะ)',
    gender: 'female',
    particle: 'ค่ะ',
    rate: 1.00,
    pitch: 1.00
  },
  'preset:female_bright': {
    label: '✨ เสียงประชาสัมพันธ์หญิง (สดใส - ค่ะ)',
    gender: 'female',
    particle: 'ค่ะ',
    rate: 1.12,
    pitch: 1.18
  },
  'preset:female_formal': {
    label: '🏢 เสียงหญิงทางการ (สุขุม - ค่ะ)',
    gender: 'female',
    particle: 'ค่ะ',
    rate: 0.95,
    pitch: 0.95
  },
  'preset:male_polite': {
    label: '👨 เสียงชายสุภาพ (ครับ)',
    gender: 'male',
    particle: 'ครับ',
    rate: 1.00,
    pitch: 1.00
  },
  'preset:male_formal': {
    label: '👔 เสียงชายทางการ (ครับ)',
    gender: 'male',
    particle: 'ครับ',
    rate: 0.95,
    pitch: 0.92
  },
  'preset:child_bright': {
    label: '👧 เสียงน้องต้อนรับ (สดใส - ค่ะ)',
    gender: 'female',
    particle: 'ค่ะ',
    rate: 1.20,
    pitch: 1.30
  }
};

const SoundManager = {
  soundEnabled: true,
  voiceSelection: 'preset:female_polite',
  voiceRate: 1.00,
  voicePitch: 1.00,
  voiceParticle: 'ค่ะ',
  thaiVoice: null,
  audioCtx: null,

  init() {
    this.loadSettings();
    this.initAudioContext();
    this.initSpeechSynthesis();
  },

  loadSettings() {
    try {
      const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.soundEnabled !== undefined) this.soundEnabled = parsed.soundEnabled;
        if (parsed.voiceSelection) this.voiceSelection = parsed.voiceSelection;
        if (parsed.voiceRate) this.voiceRate = parseFloat(parsed.voiceRate);
        if (parsed.voicePitch) this.voicePitch = parseFloat(parsed.voicePitch);
        if (parsed.voiceParticle) this.voiceParticle = parsed.voiceParticle;
      }
    } catch (e) {
      console.warn('Load sound settings error:', e);
    }
  },

  saveSettings() {
    try {
      const data = {
        soundEnabled: this.soundEnabled,
        voiceSelection: this.voiceSelection,
        voiceRate: this.voiceRate,
        voicePitch: this.voicePitch,
        voiceParticle: this.voiceParticle
      };
      localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_SETTINGS, JSON.stringify(data));
    } catch (e) {
      console.warn('Save sound settings error:', e);
    }
  },

  initAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !this.audioCtx) {
      this.audioCtx = new AudioContextClass();
    }
  },

  unlockAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  },

  initSpeechSynthesis() {
    if (!('speechSynthesis' in window)) {
      this.updateStatusBadge('Web Speech ไม่รองรับ (ใช้เสียงเตือน)');
      return;
    }

    const refresh = () => {
      this.refreshVoiceList();
      this.updateStatusBadge();
    };

    window.speechSynthesis.onvoiceschanged = refresh;
    refresh();
    setTimeout(refresh, 500);
    setTimeout(refresh, 1500);
  },

  getAvailableVoices() {
    if (!('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices() || [];
  },

  getThaiVoices() {
    const voices = this.getAvailableVoices();
    return voices.filter(v => v.lang && (v.lang.toLowerCase().includes('th') || v.lang.toLowerCase().includes('thai')));
  },

  refreshVoiceList() {
    const voices = this.getAvailableVoices();
    const thVoices = this.getThaiVoices();

    // 1. If explicit device voice picked
    if (this.voiceSelection && this.voiceSelection.startsWith('device:')) {
      const targetId = this.voiceSelection.replace('device:', '');
      const match = voices.find(v => v.voiceURI === targetId || v.name === targetId);
      if (match) {
        this.thaiVoice = match;
        return;
      }
    }

    // 2. If preset picked, match gender if possible
    const preset = VOICE_PRESETS[this.voiceSelection] || VOICE_PRESETS['preset:female_polite'];
    if (thVoices.length > 0) {
      if (preset && preset.gender === 'male') {
        const maleVoice = thVoices.find(v => {
          const n = v.name.toLowerCase();
          return n.includes('male') || n.includes('niwat') || n.includes('pattara') || n.includes('ชาย');
        });
        this.thaiVoice = maleVoice || thVoices[0];
      } else {
        const femaleVoice = thVoices.find(v => {
          const n = v.name.toLowerCase();
          return n.includes('female') || n.includes('premwadee') || n.includes('kanya') || n.includes('หญิง');
        });
        this.thaiVoice = femaleVoice || thVoices[0];
      }
    } else {
      this.thaiVoice = voices.find(v => v.default) || voices[0] || null;
    }
  },

  setVoiceSelection(selectionValue, playPreview = false) {
    this.voiceSelection = selectionValue || 'preset:female_polite';

    if (VOICE_PRESETS[this.voiceSelection]) {
      const p = VOICE_PRESETS[this.voiceSelection];
      this.voiceRate = p.rate;
      this.voicePitch = p.pitch;
      this.voiceParticle = p.particle;
    } else if (this.voiceSelection.startsWith('device:')) {
      const name = this.voiceSelection.toLowerCase();
      if (name.includes('male') || name.includes('niwat') || name.includes('pattara')) {
        this.voiceParticle = 'ครับ';
        this.voicePitch = 1.00;
        this.voiceRate = 1.00;
      } else {
        this.voiceParticle = 'ค่ะ';
        this.voicePitch = 1.00;
        this.voiceRate = 1.00;
      }
    }

    this.refreshVoiceList();
    this.saveSettings();
    this.updateStatusBadge();

    if (playPreview) {
      this.speakText(`ทดสอบเสียงระบบ ยินดีต้อนรับ${this.voiceParticle}`);
    }
  },

  toggleSound(forceState) {
    if (forceState !== undefined) {
      this.soundEnabled = !!forceState;
    } else {
      this.soundEnabled = !this.soundEnabled;
    }
    this.saveSettings();
    this.updateStatusBadge();
    return this.soundEnabled;
  },

  speakText(text) {
    if (!this.soundEnabled || !text) return;
    this.unlockAudioContext();

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any pending speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      utterance.rate = this.voiceRate || 1.0;
      utterance.pitch = this.voicePitch || 1.0;

      if (this.thaiVoice) {
        utterance.voice = this.thaiVoice;
      }

      window.speechSynthesis.speak(utterance);
    } else {
      // Fallback: Google Translate TTS API
      try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=th&client=tw-ob&q=${encodeURIComponent(text)}`;
        const audio = new Audio(url);
        audio.play().catch(e => console.warn('Audio play blocked:', e));
      } catch (e) {
        console.warn('TTS fallback error:', e);
      }
    }
  },

  // --- Sound Effects (Web Audio) ---
  playBeep(frequency = 1200, duration = 0.08, type = 'sine') {
    if (!this.soundEnabled) return;
    try {
      this.initAudioContext();
      this.unlockAudioContext();
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {
      console.warn('Beep error:', e);
    }
  },

  playScannerBeep() {
    this.playBeep(1800, 0.06, 'triangle');
  },

  playErrorTone() {
    this.playBeep(400, 0.2, 'sawtooth');
    setTimeout(() => this.playBeep(300, 0.25, 'sawtooth'), 120);
  },

  playSuccessChime() {
    if (!this.soundEnabled) return;
    try {
      this.initAudioContext();
      this.unlockAudioContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);
        gain.gain.setValueAtTime(0.12, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.18);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.18);
      });
    } catch (e) {}
  },

  // --- POS Specific Speech Announcements ---
  announceTotal(amount) {
    const thaiWords = typeof numberToThai === 'function' ? numberToThai(amount) : `${amount} บาท`;
    this.speakText(`ยอดรวม ${thaiWords} ${this.voiceParticle}`);
  },

  announceReceived(amount) {
    const thaiWords = typeof numberToThai === 'function' ? numberToThai(amount) : `${amount} บาท`;
    this.speakText(`รับเงิน ${thaiWords} ${this.voiceParticle}`);
  },

  announceChange(changeAmount) {
    if (changeAmount > 0) {
      const thaiWords = typeof numberToThai === 'function' ? numberToThai(changeAmount) : `${changeAmount} บาท`;
      this.speakText(`เงินทอน ${thaiWords} ${this.voiceParticle}`);
    } else {
      this.speakText(`รับเงินพอดี ขอบคุณ${this.voiceParticle}`);
    }
  },

  announceItemAdded(name) {
    this.playScannerBeep();
  },

  announceOutOfStock(name) {
    this.playErrorTone();
    this.speakText(`${name || 'สินค้า'} สต๊อกหมด${this.voiceParticle}`);
  },

  announceVoid(receiptNo) {
    this.playErrorTone();
    this.speakText(`ยกเลิกใบเสร็จ เรียบร้อยแล้ว${this.voiceParticle}`);
  },

  updateStatusBadge(customText) {
    const badge = document.getElementById('voiceStatusBadge');
    if (!badge) return;

    if (!this.soundEnabled) {
      badge.innerHTML = '🔇 ปิดเสียง';
      badge.className = 'text-xs px-2.5 py-1 rounded-full bg-slate-200 text-slate-600 font-medium whitespace-nowrap';
      return;
    }

    if (customText) {
      badge.innerHTML = `⚠️ ${customText}`;
      badge.className = 'text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-medium whitespace-nowrap';
      return;
    }

    const voiceName = this.thaiVoice ? this.thaiVoice.name : (VOICE_PRESETS[this.voiceSelection] ? VOICE_PRESETS[this.voiceSelection].label.split(' ')[1] : 'เสียงระบบ');
    badge.innerHTML = `🔊 ${voiceName} (${this.voiceParticle})`;
    badge.className = 'text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium whitespace-nowrap';
  }
};
