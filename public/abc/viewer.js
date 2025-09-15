/* Lightweight ABC viewer with header toggles and single tablature layer.
 * Depends on abcjs-basic-min.js being loaded first.
 */
(function(global) {
  const Viewer = {
    state: {
      vt: 0,
      headerVisibility: {
        title: true,
        notes: true,
        composer: true,
        book: true,
        source: true,
        subtitle: true,
        lyrics: true,
        tempo: true,
        rhythm: true,
        key: true,
        meter: true,
        length: true
      },
      layer: 'none', // none|guitar|mandolin|ukulele|baritone
      stripChordsForTabs: false,
      inputId: null,
      paperId: null,
      fullAbc: '',
      tunes: [],
      selectedX: null,
      // audio state
      audioContext: null,
      synth: null,
      isPlaying: false,
      lastVisualObj: null,
      currentTempo: null,
      currentTempoUnit: null, // e.g., '1/4' if Q:1/4=120 was present
      selectedIndex: -1,
      theme: { bg: '#ffffff', fg: '#000000' },
      playFinishTimer: null,
      timer: null,
      highlighted: [],
      enableHighlight: false,
      synthControl: null,
      synthUiEl: null,
      finishTimeout: null
    },

    instruments: {
      guitar: { instrument: 'guitar', tuning: ["E,","A,","D","G","B","e"], label: 'Guitar' },
      mandolin: { instrument: 'violin', tuning: ["G,","D","A","e"], label: 'Mandolin' },
      ukulele: { instrument: 'violin', tuning: ["G,","C","E","A"], label: 'Ukulele' },
      baritone: { instrument: 'violin', tuning: ["D,","G,","B,","E"], label: 'Baritone' }
    },

    init: function(inputId, paperId) {
      this.state.inputId = inputId;
      this.state.paperId = paperId;
      // Wire controls if present
      const q = (id) => document.getElementById(id);

      const bindCheck = (id, key, group) => {
        const el = q(id);
        if (!el) return;
        el.checked = !!this.state[group][key];
        el.addEventListener('change', () => {
          this.state[group][key] = !!el.checked;
          this.render();
        });
      };

      // Header visibility
      bindCheck('hv-title', 'title', 'headerVisibility');
      bindCheck('hv-notes', 'notes', 'headerVisibility');
      bindCheck('hv-composer', 'composer', 'headerVisibility');
      bindCheck('hv-book', 'book', 'headerVisibility');
      bindCheck('hv-source', 'source', 'headerVisibility');
      bindCheck('hv-subtitle', 'subtitle', 'headerVisibility');
      bindCheck('hv-lyrics', 'lyrics', 'headerVisibility');
      bindCheck('hv-tempo', 'tempo', 'headerVisibility');
      bindCheck('hv-rhythm', 'rhythm', 'headerVisibility');
      // Element headers
      bindCheck('hv-key', 'key', 'headerVisibility');
      bindCheck('hv-meter', 'meter', 'headerVisibility');
      bindCheck('hv-length', 'length', 'headerVisibility');

      const transposeInfo = q('transposeInfo');
      const down = q('transposeDown');
      const up = q('transposeUp');
      const renderBtn = q('renderBtn');
      if (down) down.addEventListener('click', () => { this.state.vt--; if (transposeInfo) transposeInfo.textContent = this.state.vt + ' st'; this.render(); });
      if (up) up.addEventListener('click', () => { this.state.vt++; if (transposeInfo) transposeInfo.textContent = this.state.vt + ' st'; this.render(); });
      if (renderBtn) renderBtn.addEventListener('click', () => this.render());

      const layerSel = q('layerSelect');
      if (layerSel) {
        layerSel.addEventListener('change', () => { this.state.layer = layerSel.value; this.render(); });
      }
      const strip = q('stripChords');
      if (strip) strip.addEventListener('change', () => { this.state.stripChordsForTabs = !!strip.checked; this.render(); });

      // Tune selection (only on collection pages)
      const input = q(this.state.inputId);
      if (input) {
        this.state.fullAbc = input.value || '';
        this.buildTuneIndex();
        const tuneSel = q('tuneSelect');
        if (tuneSel) {
          this.populateTuneSelect(tuneSel);
          tuneSel.addEventListener('change', () => {
            const x = tuneSel.value;
            this.selectTuneByX(x);
          });
        }
        const prevBtn = q('prevTune');
        const nextBtn = q('nextTune');
        if (prevBtn) prevBtn.addEventListener('click', () => this.stepTune(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => this.stepTune(1));
        const showFull = q('showFull');
        if (showFull) showFull.addEventListener('click', () => {
          input.value = this.state.fullAbc;
          this.state.selectedX = null;
          this.state.selectedIndex = -1;
          this.render();
        });
      }

      // Playback buttons
      // Play/Stop controls (support either a toggle or separate buttons)
      const playToggle = q('playToggle');
      if (playToggle) {
        playToggle.addEventListener('click', () => {
          if (this.state.isPlaying) this.stop(); else this.play();
        });
        this.updatePlayButton();
      } else {
        const playBtn = q('playBtn');
        const stopBtn = q('stopBtn');
        if (playBtn) playBtn.addEventListener('click', () => this.play());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stop());
      }

      // Tempo slider
      const tempoSlider = q('tempoSlider');
      const tempoLabel = q('tempoLabel');
      if (tempoSlider) {
        // Initialize from current ABC or default 120
        const parsedTempo = this.parseTempoFromAbc(input ? input.value : '');
        const bpmFromAbc = (parsedTempo && parsedTempo.bpm) || 120;
        this.state.currentTempo = bpmFromAbc;
        this.state.currentTempoUnit = (parsedTempo && parsedTempo.unit) || null;
        tempoSlider.value = String(bpmFromAbc);
        if (tempoLabel) tempoLabel.textContent = bpmFromAbc + ' BPM';
        const onTempoChange = async () => {
          const bpm = parseInt(tempoSlider.value, 10) || 120;
          this.state.currentTempo = bpm;
          if (tempoLabel) tempoLabel.textContent = bpm + ' BPM';
          // Update ABC Q: header in the editor to reflect tempo and re-render
          if (input) {
            input.value = this.setAbcTempo(input.value, bpm, this.state.currentTempoUnit);
            this.render();
          }
          // If currently playing, restart playback at the new tempo
          if (this.state.isPlaying) {
            try {
              await this.restartPlayback();
            } catch (_) {}
          }
        };
        tempoSlider.addEventListener('input', onTempoChange);
        tempoSlider.addEventListener('change', onTempoChange);
      }

      // Auto re-render on ABC text edits (debounced)
      if (input) {
        const schedule = () => {
          if (this.state._renderTimer) clearTimeout(this.state._renderTimer);
          this.state._renderTimer = setTimeout(() => {
            try {
              // Clean up excessive blank lines live to prevent parse issues
              input.value = this.normalizeAbc(input.value || '');
              this.render();
            } catch(_) {}
          }, 200);
        };
        input.addEventListener('input', schedule);
        input.addEventListener('change', schedule);
      }

      // Export controls
      const exportTuneBtn = q('exportTuneAbc');
      if (exportTuneBtn) exportTuneBtn.addEventListener('click', () => this.exportAbcCurrent());
      const exportFullBtn = q('exportFullAbc');
      if (exportFullBtn) exportFullBtn.addEventListener('click', () => this.exportAbcFull());
      const exportPngBtn = q('exportPng');
      if (exportPngBtn) exportPngBtn.addEventListener('click', () => this.exportPng());
      const exportMidiBtn = q('exportMidi');
      if (exportMidiBtn) exportMidiBtn.addEventListener('click', () => this.exportMidi());

      // Inject responsive SVG styles for this paper
      try {
        let resp = document.getElementById('abc-responsive-style');
        if (!resp) {
          resp = document.createElement('style');
          resp.id = 'abc-responsive-style';
          document.head.appendChild(resp);
        }
        const pid = `#${paperId}`;
        resp.textContent = `${pid} svg{max-width:100% !important;width:100% !important;height:auto !important;display:block;}`;
      } catch(_) {}

      // Auto-render initially
      this.render();

      // Recompute on window resize and when the paper content size changes
      try {
        const paperEl = document.getElementById(this.state.paperId);
        if (paperEl) {
          const ro = new ResizeObserver(() => {
            try { this.ensureResponsiveSvgs(); } catch(_) {}
            try { this.updatePaperHeight(); } catch(_) {}
          });
          ro.observe(paperEl);
          // Keep a reference to avoid GC in some browsers
          this._resizeObserver = ro;
        }
      } catch(_) {}

      try {
        window.addEventListener('resize', () => {
          try { this.ensureResponsiveSvgs(); } catch(_) {}
          try { this.updatePaperHeight(); } catch(_) {}
        });
      } catch(_) {}

      // Initialize theme color pickers if present
      const bgPicker = q('paperBgColor');
      const fgPicker = q('inkColor');
      const hlToggle = q('highlightNotes');
      if (bgPicker) bgPicker.value = this.state.theme.bg;
      if (fgPicker) fgPicker.value = this.state.theme.fg;
      if (hlToggle) hlToggle.checked = !!this.state.enableHighlight;
      const onTheme = () => {
        const bg = (bgPicker && bgPicker.value) || this.state.theme.bg;
        const fg = (fgPicker && fgPicker.value) || this.state.theme.fg;
        this.setThemeColors(bg, fg);
      };
      if (bgPicker) bgPicker.addEventListener('input', onTheme);
      if (fgPicker) fgPicker.addEventListener('input', onTheme);
      if (hlToggle) hlToggle.addEventListener('change', async () => {
        this.state.enableHighlight = !!hlToggle.checked;
        if (!this.state.enableHighlight) {
          // Turn off any active highlight immediately
          if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
          this.clearHighlight();
        } else if (this.state.isPlaying) {
          // Re-sync by restarting playback for clean cursor alignment
          try { await this.restartPlayback(); } catch(_) {}
        }
      });
      // Apply defaults on load
      this.setThemeColors(this.state.theme.bg, this.state.theme.fg);
      // Prepare hidden synth UI container for cursor control if needed
      try {
        let el = document.getElementById('abcjs-audio-hidden');
        if (!el) {
          el = document.createElement('div');
          el.id = 'abcjs-audio-hidden';
          // Keep in DOM but off-screen so SynthController can attach cleanly
          el.style.position = 'absolute';
          el.style.left = '-10000px';
          el.style.top = '-10000px';
          el.style.width = '0';
          el.style.height = '0';
          document.body.appendChild(el);
        }
        this.state.synthUiEl = el;
      } catch(_) {}
    },

    // Extract tunes by X: header
    buildTuneIndex: function() {
      const text = this.state.fullAbc || '';
      const lines = text.split(/\r?\n/);
      const tunes = [];
      let current = null;
      const pushCurrent = () => { if (current) { current.abc = current.lines.join('\n'); tunes.push(current); } };
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const mX = line.match(/^X:\s*(\d+)/);
        if (mX) {
          pushCurrent();
          current = { x: mX[1], title: 'Untitled', lines: [ line ] };
          continue;
        }
        if (!current) continue;
        if (/^T:\s*(.+)/.test(line) && current.title === 'Untitled') {
          const mT = line.match(/^T:\s*(.+)/);
          if (mT) current.title = mT[1].trim();
        }
        current.lines.push(line);
      }
      pushCurrent();
      this.state.tunes = tunes;
      return tunes;
    },

    populateTuneSelect: function(selectEl) {
      const tunes = this.state.tunes || [];
      selectEl.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = 'Select a tune';
      selectEl.appendChild(ph);
      tunes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = String(t.x);
        opt.textContent = `${t.title}`;
        selectEl.appendChild(opt);
      });
    },

    selectTuneByX: function(x) {
      const input = document.getElementById(this.state.inputId);
      if (!input) return;
      if (!x) { input.value = this.state.fullAbc; this.state.selectedX = null; this.state.selectedIndex = -1; this.stop(); this.render(); return; }
      const idx = (this.state.tunes || []).findIndex(t => String(t.x) === String(x));
      if (idx >= 0) {
        const hit = this.state.tunes[idx];
        this.state.selectedX = hit.x;
        this.state.selectedIndex = idx;
        input.value = hit.abc;
        // Update tempo slider from selected tune
        const tempoSlider = document.getElementById('tempoSlider');
        const tempoLabel = document.getElementById('tempoLabel');
        const parsedTempo = this.parseTempoFromAbc(hit.abc);
        const bpmFromAbc = (parsedTempo && parsedTempo.bpm) || this.state.currentTempo || 120;
        const unitFromAbc = (parsedTempo && parsedTempo.unit) || null;
        this.state.currentTempo = bpmFromAbc;
        this.state.currentTempoUnit = unitFromAbc;
        if (tempoSlider) tempoSlider.value = String(bpmFromAbc);
        if (tempoLabel) tempoLabel.textContent = bpmFromAbc + ' BPM';
        // Ensure ABC has Q header to match slider value for clarity, preserving explicit unit if present
        input.value = this.setAbcTempo(input.value, bpmFromAbc, unitFromAbc);
        this.stop();
        this.render();
      }
    },

    stepTune: function(delta) {
      const sel = document.getElementById('tuneSelect');
      if (!sel) return;
      const tunes = this.state.tunes || [];
      if (!tunes.length) return;
      let idx = this.state.selectedIndex;
      if (idx < 0) idx = 0;
      idx += delta;
      if (idx < 0) idx = 0;
      if (idx >= tunes.length) idx = tunes.length - 1;
      const x = tunes[idx]?.x;
      if (x != null) {
        sel.value = String(x);
        this.selectTuneByX(x);
      }
    },

    parseTempoFromAbc: function(abc) {
      if (!abc) return null;
      const lines = abc.split(/\r?\n/);
      for (const line of lines) {
        if (!/^Q:\s*/.test(line)) continue;
        // Match forms like Q:1/4=120, Q:C=120, Q:120, or Q: Allegro=120
        // 1) explicit unit with equals
        let m = line.match(/^Q:\s*([^=\s]+)\s*=\s*(\d+)/);
        if (m) {
          const unit = m[1];
          const bpm = parseInt(m[2], 10);
          return { bpm, unit };
        }
        // 2) unitless numeric bpm
        m = line.match(/^Q:\s*(\d+)/);
        if (m) {
          const bpm = parseInt(m[1], 10);
          return { bpm, unit: null };
        }
        // 3) text then =number, keep no unit
        m = line.match(/=(\d+)/);
        if (m) {
          const bpm = parseInt(m[1], 10);
          return { bpm, unit: null };
        }
      }
      return null;
    },

    setAbcTempo: function(abc, bpm, unit) {
      if (!abc) return '';
      // Remove existing Q: lines including trailing newline
      let text = abc.replace(/^[ \t]*Q:\s*.*(?:\r?\n)?/gm, '');
      // Insert Q: after first K: line if present, else prepend
      const kMatch = text.match(/^(K:[^\n\r]*)/m);
      if (kMatch) {
        const kLine = kMatch[0];
        text = text.replace(kLine, kLine + `\nQ:${unit ? `${unit}=` : ''}${bpm}`);
      } else {
        text = `Q:${unit ? `${unit}=` : ''}${bpm}\n` + text;
      }
      // Normalize spacing and remove any leftover blank after K:
      text = text.replace(/^[ \t]+$/gm, '')
                 .replace(/(?:\r?\n)[ \t]*(?:\r?\n)+/g, '\n\n')
                 .replace(/^(K:[^\n\r]*)(?:\r?\n)[ \t]*(?:\r?\n)/m, '$1\n');
      return text;
    },

    // Playback API
    ensureAudioContext: async function() {
      if (this.state.audioContext) return this.state.audioContext;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('WebAudio not supported');
      this.state.audioContext = new Ctx();
      await this.state.audioContext.resume();
      return this.state.audioContext;
    },

    ensureSynth: async function(visualObj) {
      const ac = await this.ensureAudioContext();
      if (this.state.synth) {
        try { this.state.synth.stop(); } catch(_) {}
        this.state.synth = null;
      }
      const synth = new ABCJS.synth.CreateSynth();
      // Local soundfont path relative to site root (keep as originally working in your deploy)
      const soundFont = function(filename) {
        return 'abcjs/soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/' + filename;
      };
      await synth.init({
        visualObj,
        audioContext: ac,
        options: { soundFont, program: 0, midiTranspose: (this.state.vt || 0), gain: 0.7 }
      });
      await synth.prime();
      this.state.synth = synth;
      return synth;
    },

    play: async function() {
      try {
        if (!window.ABCJS?.synth) throw new Error('abcjs synth not available');
        // Re-render to get current visual object in sync
        const vObj = this.render(true);
        if (!vObj) throw new Error('render failed');
        // If highlight is enabled and SynthController exists, use it to drive both audio and cursor
        // Disabled for now to ensure stable playback path; use TimingCallbacks instead
        if (false && this.state.enableHighlight && ABCJS?.synth?.SynthController) {
          // Clean up any existing controller
          try { this.state.synthControl?.pause && this.state.synthControl.pause(); } catch(_) {}
          try { this.state.synthControl?.stop && this.state.synthControl.stop(); } catch(_) {}
          // Build cursor control callbacks
          const cursorControl = {
            onStart: () => { this.clearHighlight(); },
            onEvent: (ev) => {
              if (!ev) { this.clearHighlight(); return; }
              this.clearHighlight();
              if (ev.elements) {
                try {
                  ev.elements.forEach(set => set.forEach(el => {
                    if (!el) return;
                    // Save previous styles
                    if (el.dataset) {
                      el.dataset.prevFill = el.getAttribute('fill') ?? '__unset__';
                      el.dataset.prevStroke = el.getAttribute('stroke') ?? '__unset__';
                    }
                    el.classList && el.classList.add('abc-current-note');
                    el.setAttribute('fill', '#f59e0b');
                    el.setAttribute('stroke', '#f59e0b');
                    this.state.highlighted.push(el);
                    // Also color children inside the element (paths, etc.)
                    try {
                      el.querySelectorAll && el.querySelectorAll('path,polygon,polyline,use,ellipse,circle,rect').forEach(ch => {
                        if (ch.dataset) {
                          ch.dataset.prevFill = ch.getAttribute('fill') ?? '__unset__';
                          ch.dataset.prevStroke = ch.getAttribute('stroke') ?? '__unset__';
                        }
                        ch.classList && ch.classList.add('abc-current-note');
                        ch.setAttribute('fill', '#f59e0b');
                        ch.setAttribute('stroke', '#f59e0b');
                        this.state.highlighted.push(ch);
                      });
                    } catch (_) {}
                  }));
                } catch(_) {}
              }
            },
            onFinished: () => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              this.clearHighlight();
            },
            // You can tweak these for smoother cursor
            beatSubdivisions: 2,
            lineEndAnticipation: 0
          };
          // Create/load controller
          const sc = new ABCJS.synth.SynthController();
          sc.load(this.state.synthUiEl, cursorControl, { displayPlay: false, displayProgress: false });
          this.state.synthControl = sc;
          // Configure options (use our soundfont mapping)
          // userAction must be true when called from a click handler to satisfy autoplay policies
          await sc.setTune(vObj, true, { midiTranspose: (this.state.vt||0), program: 0, soundFontUrl: 'https://paulrosen.github.io/abcjs/audio/soundfont/acoustic_grand_piano-mp3/' });
          // Clear previous timeouts
          if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
          if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          // Start via controller (handles highlight + audio)
          const startP = sc.play();
          this.state.isPlaying = true;
          this.updatePlayButton();
          if (startP && typeof startP.then === 'function') {
            startP.then(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              this.clearHighlight();
            }).catch(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              this.clearHighlight();
            });
          }
          // Also set watchdog by duration if available
          try {
            const d = Number(sc.synth && sc.synth.duration);
            if (d && isFinite(d) && d > 0) {
              this.state.finishTimeout = setTimeout(() => {
                this.state.isPlaying = false;
                this.updatePlayButton();
                this.clearHighlight();
                this.state.finishTimeout = null;
              }, Math.ceil(d * 1000) + 250);
            }
          } catch(_) {}
        } else {
          // Default path: our CreateSynth, optional TimingCallbacks
          await this.ensureSynth(vObj);
          if (this.state.enableHighlight) {
            const timer = this.installTiming(vObj);
            if (timer && timer.start) timer.start(0);
          } else {
            if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
            this.clearHighlight();
          }
          // Clear any previous finish polling/timeouts
          if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
          if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          const startResult = this.state.synth.start();
          this.state.isPlaying = true;
          this.updatePlayButton();
          // Duration-based watchdog to ensure UI resets even if callbacks fail
          try {
            const d = Number(this.state.synth && this.state.synth.duration);
            if (d && isFinite(d) && d > 0) {
              this.state.finishTimeout = setTimeout(() => {
                this.state.isPlaying = false;
                this.updatePlayButton();
                if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
                this.clearHighlight();
                this.state.finishTimeout = null;
              }, Math.ceil(d * 1000) + 250);
            }
          } catch(_) {}
          // Handle playback finish to toggle Stop -> Play automatically
          if (startResult && typeof startResult.then === 'function') {
            startResult.then(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
              this.clearHighlight();
              if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
            }).catch(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
              this.clearHighlight();
              if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
            });
          } else {
            // Fallback: poll isRunning if no promise
            const poll = () => {
              try {
                if (!this.state.synth || !this.state.synth.isRunning) {
                  this.state.isPlaying = false;
                  this.updatePlayButton();
                  this.state.playFinishTimer = null;
                  if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
                  this.clearHighlight();
                  if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
                  return;
                }
              } catch(_) {}
              this.state.playFinishTimer = setTimeout(poll, 500);
            };
            this.state.playFinishTimer = setTimeout(poll, 500);
          }
        }
      } catch (e) {
        console.error('Play failed:', e);
        alert('Playback failed. Ensure soundfonts exist under /abcjs/soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/.');
      }
    },

    stop: function() {
      try { if (this.state.synth) this.state.synth.stop(); } catch(_) {}
      try { if (this.state.synthControl) this.state.synthControl.stop(); } catch(_) {}
      if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
      if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
      this.clearHighlight();
      if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
      this.state.isPlaying = false;
      this.updatePlayButton();
    },

    restartPlayback: async function() {
      try {
        const vObj = this.render(true);
        // If highlight is enabled and SynthController exists, prefer it for restart
        if (false && this.state.enableHighlight && ABCJS?.synth?.SynthController) {
          try { this.state.synthControl?.pause && this.state.synthControl.pause(); } catch(_) {}
          try { this.state.synthControl?.stop && this.state.synthControl.stop(); } catch(_) {}
          const cursorControl = {
            onStart: () => { this.clearHighlight(); },
            onEvent: (ev) => {
              if (!ev) { this.clearHighlight(); return; }
              this.clearHighlight();
              if (ev.elements) {
                try {
                  ev.elements.forEach(set => set.forEach(el => {
                    if (!el) return;
                    if (el.dataset) {
                      el.dataset.prevFill = el.getAttribute('fill') ?? '__unset__';
                      el.dataset.prevStroke = el.getAttribute('stroke') ?? '__unset__';
                    }
                    el.classList && el.classList.add('abc-current-note');
                    el.setAttribute('fill', '#f59e0b');
                    el.setAttribute('stroke', '#f59e0b');
                    this.state.highlighted.push(el);
                  }));
                } catch(_) {}
              }
            },
            onFinished: () => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              this.clearHighlight();
            },
            beatSubdivisions: 2,
            lineEndAnticipation: 0
          };
          const sc = new ABCJS.synth.SynthController();
          sc.load(this.state.synthUiEl, cursorControl, { displayPlay: false, displayProgress: false });
          this.state.synthControl = sc;
          await sc.setTune(vObj, true, { midiTranspose: (this.state.vt||0), program: 0, soundFontUrl: 'https://paulrosen.github.io/abcjs/audio/soundfont/acoustic_grand_piano-mp3/' });
          if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
          if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          const p = sc.play();
          this.state.isPlaying = true;
          this.updatePlayButton();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              this.clearHighlight();
            }).catch(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              this.clearHighlight();
            });
          }
          try {
            const d = Number(sc.synth && sc.synth.duration);
            if (d && isFinite(d) && d > 0) {
              this.state.finishTimeout = setTimeout(() => {
                this.state.isPlaying = false;
                this.updatePlayButton();
                this.clearHighlight();
                this.state.finishTimeout = null;
              }, Math.ceil(d * 1000) + 250);
            }
          } catch(_) {}
        } else {
          // Default restart path
          await this.ensureSynth(vObj);
          if (this.state.enableHighlight) {
            const timer = this.installTiming(vObj);
            if (timer && timer.start) timer.start(0);
          } else {
            if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
            this.clearHighlight();
          }
          if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
          if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          const startResult = this.state.synth.start();
          this.state.isPlaying = true;
          this.updatePlayButton();
          try {
            const d = Number(this.state.synth && this.state.synth.duration);
            if (d && isFinite(d) && d > 0) {
              this.state.finishTimeout = setTimeout(() => {
                this.state.isPlaying = false;
                this.updatePlayButton();
                if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
                this.clearHighlight();
                this.state.finishTimeout = null;
              }, Math.ceil(d * 1000) + 250);
            }
          } catch(_) {}
          if (startResult && typeof startResult.then === 'function') {
            startResult.then(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
              this.clearHighlight();
              if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
            }).catch(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
              this.clearHighlight();
              if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
            });
          } else {
            const poll = () => {
              try {
                if (!this.state.synth || !this.state.synth.isRunning) {
                  this.state.isPlaying = false;
                  this.updatePlayButton();
                  this.state.playFinishTimer = null;
                  if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
                  this.clearHighlight();
                  if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
                  return;
                }
              } catch(_) {}
              this.state.playFinishTimer = setTimeout(poll, 500);
            };
            this.state.playFinishTimer = setTimeout(poll, 500);
          }
        }
      } catch (e) {
        console.error('Restart playback failed:', e);
      }
    },

    updatePlayButton: function() {
      const btn = document.getElementById('playToggle');
      if (!btn) return;
      if (this.state.isPlaying) {
        btn.textContent = 'Stop';
        btn.classList.remove('bg-green-600', 'hover:bg-green-500');
        btn.classList.add('bg-red-600');
      } else {
        btn.textContent = 'Play';
        btn.classList.remove('bg-red-600');
        btn.classList.add('bg-green-600', 'hover:bg-green-500');
      }
    },

    // Theme API
    setThemeColors: function(background, foreground) {
      try {
        this.state.theme = { bg: background || '#ffffff', fg: foreground || '#000000' };
        // Paper background color
        const paper = document.getElementById(this.state.paperId);
        if (paper) paper.style.backgroundColor = this.state.theme.bg;
        // Inject/update a style element for svg colors
        let styleEl = document.getElementById('abc-theme-style');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'abc-theme-style';
          document.head.appendChild(styleEl);
        }
        const fg = this.state.theme.fg;
        // Broadly cover all common ABCJS drawing primitives and classes
        const pid = `#${this.state.paperId}`;
        styleEl.textContent = [
          `${pid} svg{ color:${fg} !important; }`,
          `${pid} svg text{fill:${fg} !important;}`,
          `${pid} svg .abcjs-chord, ${pid} svg .abcjs-annotation, ${pid} svg .abcjs-voice-name, ${pid} svg .abcjs-tempo {fill:${fg} !important;}`,
          `${pid} svg path, ${pid} svg line, ${pid} svg rect, ${pid} svg circle, ${pid} svg ellipse {stroke:${fg} !important;}`,
          `${pid} svg polygon, ${pid} svg polyline {stroke:${fg} !important; fill:${fg} !important;}`,
          `${pid} svg path {fill:${fg} !important;}`,
          `${pid} svg use {stroke:${fg} !important; fill:${fg} !important;}`,
          // Ensure musical glyphs render with desired ink color
          `${pid} svg .abcjs-note, ${pid} svg .abcjs-notehead, ${pid} svg .abcjs-rest, ${pid} svg .abcjs-beam-elem, ${pid} svg .abcjs-slur, ${pid} svg .abcjs-tie, ${pid} svg .abcjs-accidental, ${pid} svg .abcjs-keysig, ${pid} svg .abcjs-timesig, ${pid} svg .abcjs-clef, ${pid} svg .abcjs-bar, ${pid} svg .abcjs-staff, ${pid} svg .abcjs-ledger {stroke:${fg} !important; fill:${fg} !important;}`
        ].join("\n");

        // Also set inline on the current SVG to defeat any cached styles
        this.applyThemeInline();
      } catch (e) { console.warn('setThemeColors failed', e); }
    },

    applyThemeInline: function() {
      try {
        const fg = this.state.theme.fg || '#000000';
        const svg = document.querySelector('#' + this.state.paperId + ' svg');
        if (!svg) return;
        svg.style.color = fg;
        // Text-like elements
        svg.querySelectorAll('text, .abcjs-chord, .abcjs-annotation, .abcjs-voice-name, .abcjs-tempo').forEach(t => t.setAttribute('fill', fg));
        // Stroke primitives
        svg.querySelectorAll('path,line,rect,circle,ellipse,polygon,polyline,use').forEach(el => el.setAttribute('stroke', fg));
        svg.querySelectorAll('path,polygon,polyline,use').forEach(el => el.setAttribute('fill', fg));
        // Musical glyph classes that may need fill as well
        svg.querySelectorAll('.abcjs-note, .abcjs-notehead, .abcjs-rest, .abcjs-beam-elem, .abcjs-slur, .abcjs-tie, .abcjs-accidental, .abcjs-keysig, .abcjs-timesig, .abcjs-clef, .abcjs-bar, .abcjs-staff, .abcjs-ledger')
          .forEach(el => { el.setAttribute('stroke', fg); el.setAttribute('fill', fg); });
      } catch (e) { /* no-op */ }
    },

    normalizeAbc: function(abc) {
      if (!abc) return '';
      let t = abc;
      t = t.replace(/;\s*\|\|/g, ':||');
      return t;
    },

    filterHeaders: function(abc) {
      const v = this.state.headerVisibility;
      const lines = abc.split('\n');
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const t = l.trimStart();
        if (t.startsWith('T:') && v.title === false) continue;
        if (t.startsWith('C:') && v.composer === false) continue;
        if (t.startsWith('N:') && v.notes === false) continue;
        if (t.startsWith('B:') && v.book === false) continue;
        if (t.startsWith('S:') && v.source === false) continue;
        if (t.startsWith('A:') && v.subtitle === false) continue;
        if ((t.startsWith('w:') || t.startsWith('W:')) && v.lyrics === false) continue;
        // Preserve Q: (tempo) in the ABC even when hidden, so playback timing remains correct.
        if (t.startsWith('R:') && v.rhythm === false) continue;
        if (t.startsWith('K:') && v.key === false) continue;
        if (t.startsWith('M:') && v.meter === false) continue;
        if (t.startsWith('L:') && v.length === false) continue;
        out.push(l);
      }
      return out.join('\n');
    },

    simplifyForTab: function(abc) {
      let s = abc || '';
      if (this.state.stripChordsForTabs) s = s.replace(/"[^\"]*"/g, '');
      // Keep first M: and L: only
      const lines = s.split('\n');
      let seenM = false, seenL = false;
      const out = [];
      for (const line of lines) {
        if (/^M:/.test(line)) {
          if (seenM) continue; seenM = true;
        }
        if (/^L:/.test(line)) {
          if (seenL) continue; seenL = true;
        }
        out.push(line);
      }
      return out.join('\n');
    },

    render: function(returnVisualObj) {
      try {
        if (!global.ABCJS || !ABCJS.renderAbc) return;
        const input = document.getElementById(this.state.inputId);
        const paperEl = document.getElementById(this.state.paperId);
        if (!input || !paperEl) return;
        paperEl.innerHTML = '';
        try { paperEl.style.position = paperEl.style.position || 'relative'; } catch(_) {}
        // Clear any previous highlight state on new render
        this.clearHighlight && this.clearHighlight();
        const raw = input.value || 'X:1\nT:Example\nM:4/4\nL:1/8\nK:C\nCDEF GABc|';
        const norm = this.normalizeAbc(raw);
        const filtered = this.filterHeaders(norm);

        // Build render options; when a tablature layer is chosen, render staff + tab together in one pass
        const hasTab = this.state.layer && this.state.layer !== 'none';
        const tabSpec = hasTab ? this.instruments[this.state.layer] : null;
        const baseOpts = { responsive: 'resize', add_classes: true, visualTranspose: this.state.vt, selectionColor: '#f59e0b', wrap: { preferredMeasuresPerLine: 5 } };
        const renderOpts = hasTab && tabSpec ? { ...baseOpts, tablature: [tabSpec] } : baseOpts;
        // Optionally strip chord symbols when rendering tabs for a cleaner layout
        const abcToRender = (hasTab && this.state.stripChordsForTabs) ? this.simplifyForTab(filtered) : filtered;
        const v = ABCJS.renderAbc(this.state.paperId, abcToRender, renderOpts);
        this.state.lastVisualObj = v && v[0];
        try { this.updateKeyLabel(filtered); } catch(_) {}
        try { this.applyThemeInline(); } catch(_) {}
        try { this.applyHeaderVisibilityToSvg(); } catch(_) {}
        try { this.ensureResponsiveSvgs(); } catch(_) {}
        try { this.updatePaperHeight(); } catch(_) {}

        if (returnVisualObj) return this.state.lastVisualObj;
      } catch (e) {
        console.error('ABC render failed:', e);
      }
    }
  };

  // --- Playback cursor/highlight helpers ---
  Viewer.clearHighlight = function() {
    try {
      // Prefer native engraver clear if available
      if (this.state.lastVisualObj && this.state.lastVisualObj.rangeHighlight) {
        try { this.state.lastVisualObj.rangeHighlight(0, 0); } catch(_) {}
      }
      try { if (this.state.cursorBallEl) this.state.cursorBallEl.style.opacity = '0'; } catch(_) {}
      (this.state.highlighted || []).forEach(el => {
        try {
          // Restore previous presentation attributes if we changed them
          if (el && el.dataset) {
            if (el.dataset.prevFill !== undefined) {
              if (el.dataset.prevFill === '__unset__') el.removeAttribute('fill');
              else el.setAttribute('fill', el.dataset.prevFill);
              delete el.dataset.prevFill;
            }
            if (el.dataset.prevStroke !== undefined) {
              if (el.dataset.prevStroke === '__unset__') el.removeAttribute('stroke');
              else el.setAttribute('stroke', el.dataset.prevStroke);
              delete el.dataset.prevStroke;
            }
          }
          el?.classList?.remove('abc-current-note');
        } catch(_) {}
      });
    } catch(_) {}
    this.state.highlighted = [];
  };

  Viewer.installTiming = function(vObj) {
    try {
      if (!vObj || !ABCJS) return null;
      if (!ABCJS.TimingCallbacks) { console.warn('ABCJS.TimingCallbacks not available in this build; skipping note highlight'); return null; }
      // Clean up any previous timer/highlights
      if (this.state.timer && this.state.timer.stop) {
        try { this.state.timer.stop(); } catch(_) {}
      }
      this.clearHighlight();
      // Let ABCJS use the tempo from the ABC (Q: header) directly to respect units
      const timer = new ABCJS.TimingCallbacks(vObj, {
        qpm: undefined,
        beatSubdivisions: 2,
        beatCallback: (beat, totalBeats, totalMs, position) => {
          if (!this.state.enableHighlight) return;
          // Lazy create cursor bar
          if (!this.state._cursorBallInit) {
            try {
              const paper = document.getElementById(this.state.paperId);
              if (paper && !document.getElementById('abc-cursor-bar')) {
                const el = document.createElement('div');
                el.id = 'abc-cursor-bar';
                el.style.position = 'absolute';
                el.style.width = '16px';
                el.style.height = '0px';
                el.style.marginLeft = '0';
                el.style.marginTop = '0';
                el.style.borderRadius = '2px';
                el.style.background = '#f59e0b';
                el.style.pointerEvents = 'none';
                el.style.opacity = '0';
                el.style.transition = 'opacity 120ms ease';
                paper.appendChild(el);
                this.state.cursorBallEl = el;
              }
              this.state._cursorBallInit = true;
            } catch(_) {}
          }
          const paper = document.getElementById(this.state.paperId);
          const svg = paper ? paper.querySelector('svg') : null;
          const ball = this.state.cursorBallEl;
          if (!paper || !svg || !ball || !position) return;
          const pr = paper.getBoundingClientRect();
          const sr = svg.getBoundingClientRect();
          // Scale SVG coords (viewBox) to rendered CSS pixels
          let scaleX = 1, scaleY = 1;
          try {
            const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
            if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
              scaleX = (sr.width || svg.clientWidth || 1) / vb[2];
              scaleY = (sr.height || svg.clientHeight || 1) / vb[3];
            }
          } catch(_) {}
          const barW = 16;
          const left = (sr.left - pr.left) + (position.left ? position.left * scaleX : 0) - (barW / 2);
          const topPx = (sr.top - pr.top) + (position.top ? position.top * scaleY : 0);
          const hPx = position.height ? (position.height * scaleY) : 0;
          ball.style.height = `${Math.round(hPx)}px`;
          ball.style.transform = `translate(${Math.round(left)}px, ${Math.round(topPx)}px)`;
          ball.style.opacity = '0.35';
    },
    
    // Visually hide selected headers in the rendered SVG without removing them from the ABC source
    applyHeaderVisibilityToSvg: function() {
      try {
        const svg = document.querySelector('#' + this.state.paperId + ' svg');
        if (!svg) return;
        const v = this.state.headerVisibility || {};
        // Tempo
        const hideTempo = v.tempo === false;
        svg.querySelectorAll('.abcjs-tempo').forEach(el => { el.style.display = hideTempo ? 'none' : ''; });
      } catch(_) {}
    },
        eventCallback: (ev) => {
          // End of tune sends null
          if (!ev) { this.clearHighlight(); return; }
          // Try abcjs native selection first using start/end char
          if (typeof ev.startChar === 'number' && typeof ev.endChar === 'number' && vObj && vObj.rangeHighlight) {
            try {
              vObj.rangeHighlight(ev.startChar, ev.endChar);
              return;
            } catch(_) { /* fall through to manual coloring */ }
          }
          // Fallback: manually color SVG elements
          this.clearHighlight();
          if (ev.elements) {
            try {
              ev.elements.forEach(set => {
                set.forEach(el => {
                  if (!el) return;
                  if (el.classList) {
                    el.classList.add('abc-current-note');
                  }
                  if (el.dataset) {
                    el.dataset.prevFill = el.getAttribute('fill') ?? '__unset__';
                    el.dataset.prevStroke = el.getAttribute('stroke') ?? '__unset__';
                  }
                  el.setAttribute('fill', '#f59e0b');
                  el.setAttribute('stroke', '#f59e0b');
                  this.state.highlighted.push(el);
                  // Also color children
                  try {
                    el.querySelectorAll && el.querySelectorAll('path,polygon,polyline,use,ellipse,circle,rect').forEach(ch => {
                      if (ch.dataset) {
                        ch.dataset.prevFill = ch.getAttribute('fill') ?? '__unset__';
                        ch.dataset.prevStroke = ch.getAttribute('stroke') ?? '__unset__';
                      }
                      ch.classList && ch.classList.add('abc-current-note');
                      ch.setAttribute('fill', '#f59e0b');
                      ch.setAttribute('stroke', '#f59e0b');
                      this.state.highlighted.push(ch);
                    });
                  } catch(_) {}
                });
              });
            } catch(_) {}
          }
        }
      });
      this.state.timer = timer;
      return timer;
    } catch (e) {
      console.error('Failed to install timing callbacks:', e);
      return null;
    }
  };

  // --- Key utilities ---
  Viewer.parseKeyFromAbc = function(abc) {
    if (!abc) return null;
    const m = abc.match(/^K:\s*([^\n\r]+)/m);
    if (!m) return null;
    const raw = m[1].trim();
    // Root note like C, G, D#, Eb
    const m2 = raw.match(/^([A-Ga-g])([#b]?)/);
    if (!m2) return null;
    const letter = m2[1].toUpperCase();
    const acc = m2[2] || '';
    const minor = /\bmin\b|\bm\b|\bminor\b|\baeo/i.test(raw) || /[a-g]/.test(m2[1]);
    const map = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
    let idx = map[letter];
    if (acc === '#') idx = (idx + 1) % 12;
    if (acc === 'b') idx = (idx + 11) % 12;
    return { index: idx, minor, raw };
  };

  Viewer.keyNameFor = function(index, preferSharps, minor) {
    const sharpNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const flatNames  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
    const name = (preferSharps ? sharpNames : flatNames)[((index%12)+12)%12];
    return minor ? (name + 'm') : name;
  };

  Viewer.updateKeyLabel = function(currentAbcFiltered) {
    const k = this.parseKeyFromAbc(currentAbcFiltered || this.state.fullAbc || '');
    const el = document.getElementById('currentKeyLabel');
    if (!el) return;
    if (!k) { el.textContent = 'K?'; return; }
    const idx = (k.index + (this.state.vt||0)) % 12;
    // Prefer flats when transposing down, sharps when up
    const preferSharps = (this.state.vt||0) >= 0;
    el.textContent = this.keyNameFor(idx, preferSharps, k.minor);
  };

  // --- Export utilities ---
  Viewer.download = function(filename, mime, dataUrlOrBlob) {
    try {
      const a = document.createElement('a');
      a.style.display = 'none';
      if (dataUrlOrBlob instanceof Blob) {
        const url = URL.createObjectURL(dataUrlOrBlob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        a.remove();
      } else {
        a.href = dataUrlOrBlob;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) { console.error('Download failed:', e); }
  };

  Viewer.sanitizeFilename = function(name, fallback) {
    const base = (name || fallback || 'tune').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_');
    return base || (fallback || 'tune');
  };

  Viewer.getCurrentTitle = function(abc) {
    const m = (abc||'').match(/^T:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  };

  Viewer.exportAbcCurrent = function() {
    const input = document.getElementById(this.state.inputId);
    if (!input) return;
    const abc = input.value || '';
    const title = this.getCurrentTitle(abc) || 'tune';
    const fname = this.sanitizeFilename(title, 'tune') + '.abc';
    const blob = new Blob([abc], { type: 'text/plain;charset=utf-8' });
    this.download(fname, 'text/plain', blob);
  };

  Viewer.exportAbcFull = function() {
    let abc = this.state.fullAbc || '';
    if (!abc) {
      const input = document.getElementById(this.state.inputId);
      abc = input ? (input.value || '') : '';
    }
    const title = this.getCurrentTitle(abc) || 'collection';
    const fname = this.sanitizeFilename(title, 'collection') + '.abc';
    const blob = new Blob([abc], { type: 'text/plain;charset=utf-8' });
    this.download(fname, 'text/plain', blob);
  };

  Viewer.exportPng = function() {
    try {
      const svg = document.querySelector('#' + this.state.paperId + ' svg');
      if (!svg) { alert('Nothing to export yet.'); return; }
      const clone = svg.cloneNode(true);
      // Ensure chosen theme colors render correctly
      const fg = this.state.theme.fg || '#000000';
      const bg = this.state.theme.bg || '#ffffff';
      clone.querySelectorAll('text').forEach(t => t.setAttribute('fill', fg));
      clone.querySelectorAll('path').forEach(p => p.setAttribute('stroke', fg));
      const xml = new XMLSerializer().serializeToString(clone);
      const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      const img = new Image();
      img.onload = () => {
        const vb = (clone.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const w = vb.length === 4 ? vb[2] : clone.clientWidth || 1400;
        const h = vb.length === 4 ? vb[3] : clone.clientHeight || 600;
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(w);
        canvas.height = Math.ceil(h);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0,0,canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const abc = document.getElementById(this.state.inputId)?.value;
        const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.png';
        this.download(fname, 'image/png', canvas.toDataURL('image/png'));
      };
      img.onerror = () => alert('SVG to PNG conversion failed.');
      img.src = svg64;
    } catch (e) {
      console.error('PNG export failed:', e);
      alert('PNG export failed');
    }
  };

  Viewer.exportMidi = async function() {
    try {
      const abc = document.getElementById(this.state.inputId)?.value || '';
      // Ensure the MIDI plugin is present; try to lazy-load if missing
      const ensureMidi = async () => {
        try {
          if (window.ABCJS && ABCJS.midi && typeof ABCJS.midi.getMidiFile === 'function') return true;
          if (this._loadingMidiPlugin) {
            // Wait for an in-flight load
            return new Promise((resolve) => {
              const chk = () => {
                if (window.ABCJS && ABCJS.midi && typeof ABCJS.midi.getMidiFile === 'function') resolve(true);
                else setTimeout(chk, 100);
              };
              chk();
            });
          }
          this._loadingMidiPlugin = true;
          const loadScript = (src) => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(s);
          });
          try {
            await loadScript('https://cdn.jsdelivr.net/npm/abcjs@6.4.4/dist/abcjs-midi-min.js');
          } catch (_) {
            // Fallback CDN
            await loadScript('https://unpkg.com/abcjs@6.4.4/dist/abcjs-midi-min.js');
          }
          this._loadingMidiPlugin = false;
          return !!(window.ABCJS && ABCJS.midi && typeof ABCJS.midi.getMidiFile === 'function');
        } catch (_) {
          this._loadingMidiPlugin = false;
          return false;
        }
      };
      const midiOk = await ensureMidi();
      if (!midiOk) {
        alert('MIDI export not available. Ensure abcjs-midi-min.js is loaded.');
        return;
      }
      if (ABCJS?.midi?.getMidiFile) {
        // 1) Prefer encoded data URI
        let res = ABCJS.midi.getMidiFile(abc, { midiOutputType: 'encoded', midiTranspose: (this.state.vt||0) });
        if (typeof res === 'string') {
          if (res.startsWith('data:audio/midi')) {
            const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
            this.download(fname, 'audio/midi', res);
            return;
          }
          const m = res.match(/href=["'](data:audio\/midi[^"']+)["']/i);
          if (m && m[1]) {
            const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
            this.download(fname, 'audio/midi', m[1]);
            return;
          }
        }
        // 2) Try binary output and build a Blob
        let bin = ABCJS.midi.getMidiFile(abc, { midiOutputType: 'binary', midiTranspose: (this.state.vt||0) });
        if (bin && (bin.byteLength || (typeof Uint8Array !== 'undefined' && bin instanceof Uint8Array))) {
          const blob = new Blob([bin], { type: 'audio/midi' });
          const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
          this.download(fname, 'audio/midi', blob);
          return;
        }
        // 3) Try with the current visual object source
        const vObjAlt = this.state.lastVisualObj || this.render(true);
        if (vObjAlt) {
          let res2 = ABCJS.midi.getMidiFile(vObjAlt, { midiOutputType: 'encoded', midiTranspose: (this.state.vt||0) });
          if (typeof res2 === 'string' && res2.startsWith('data:audio/midi')) {
            const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
            this.download(fname, 'audio/midi', res2);
            return;
          }
          const m2 = typeof res2 === 'string' ? res2.match(/href=["'](data:audio\/midi[^"']+)["']/i) : null;
          if (m2 && m2[1]) {
            const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
            this.download(fname, 'audio/midi', m2[1]);
            return;
          }
        }
      }
      if (ABCJS?.synth?.CreateSynth) {
        const vObj = this.render(true);
        const synth = new ABCJS.synth.CreateSynth();
        await synth.init({ visualObj: vObj, options: { midiTranspose: (this.state.vt||0) } });
        if (synth.downloadMidi) {
          const dataUrl = await synth.downloadMidi();
          if (dataUrl) {
            const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
            this.download(fname, 'audio/midi', dataUrl);
            return;
          }
        }
      }
      alert('MIDI export not available. Ensure abcjs-midi-min.js is loaded.');
    } catch (e) {
      console.error('MIDI export failed:', e);
      alert('MIDI export failed');
    }
  };

  // --- Sizing helper ---
  Viewer.updatePaperHeight = function() {
    const paper = document.getElementById(this.state.paperId);
    if (!paper) return;
    // Clear any fixed height first
    const wrapper = paper.parentElement;
    if (wrapper) wrapper.style.height = '';
    // Measure combined height of all SVGs (should be one after single-pass render)
    const svgs = paper.querySelectorAll('svg');
    let total = 0;
    svgs.forEach(svg => {
      try {
        // Prefer intrinsic bbox height, fallback to clientHeight
        const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const h = (vb.length === 4 ? vb[3] : 0) || svg.getBBox().height || svg.clientHeight || 0;
        total += Math.ceil(h);
      } catch(_) {
        total += svg.clientHeight || 0;
      }
    });
    // If we have a wrapper with constrained layout, set explicit px height to avoid excessive whitespace
    if (wrapper && total > 0) {
      // Scale to displayed width: height scales with width/viewBox; rely on auto vertical sizing
      // Use scrollHeight as final guard if computed total is off
      setTimeout(() => {
        const h = Math.max(paper.scrollHeight, total);
        wrapper.style.height = h + 'px';
      }, 0);
    }
  };

  // --- Responsiveness helper ---
  Viewer.ensureResponsiveSvgs = function() {
    const paper = document.getElementById(this.state.paperId);
    if (!paper) return;
    const svgs = paper.querySelectorAll('svg');
    svgs.forEach(svg => {
      try {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.maxWidth = '100%';
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        // Ensure viewBox exists for proper scaling
        if (!svg.getAttribute('viewBox')) {
          const bb = svg.getBBox();
          const w = Math.ceil(bb.width || svg.clientWidth || 1200);
          const h = Math.ceil(bb.height || svg.clientHeight || 400);
          svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
      } catch(_) {}
    });
  };

  global.ABCViewer = Viewer;
})(window);
