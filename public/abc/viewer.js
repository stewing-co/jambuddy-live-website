/* Lightweight ABC viewer with header toggles and single tablature layer.
 * Depends on abcjs-basic-min.js being loaded first.
 */
(function(global) {
  const STORAGE_KEY = 'jamBuddyAbcViewerState';

  function getStorage() {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch (error) {
      console.warn('ABCViewer: localStorage unavailable', error);
      return null;
    }
  }

  function normalizeClefMode(raw) {
    if (raw === null || typeof raw === 'undefined') return 'treble';
    const value = String(raw).trim().toLowerCase();
    switch (value) {
      case 'auto':
        return 'auto';
      case 'treble':
      case 'g':
      case 'treble8':
      case 'treble-8':
      case 'treble_8':
        return 'treble';
      case 'alto':
      case 'c3':
        return 'alto';
      case 'tenor':
      case 'c4':
        return 'tenor';
      case 'bass':
      case 'f':
        return 'bass';
      default:
        return 'treble';
    }
  }

  function applyClefOverride(abcText, clefMode) {
    try {
      if (!abcText || typeof abcText !== 'string') return abcText;
      const target = normalizeClefMode(clefMode);
      if (target === 'auto') return abcText;
      const clefRegex = /(clef\s*=\s*)([^\s]+)/i;
      let appliedToVoice = false;
      const processed = abcText.split('\n').map(line => {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith('V:') || trimmed.startsWith('[V:')) return line;
        const leading = line.substring(0, line.length - trimmed.length);
        const commentIndex = trimmed.indexOf('%');
        let body = commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed;
        const comment = commentIndex >= 0 ? trimmed.slice(commentIndex) : '';
        if (clefRegex.test(body)) {
          body = body.replace(clefRegex, (_, prefix) => prefix + target);
        } else {
          const needsSpace = body.length > 0 && !/\s$/.test(body);
          body = body + (needsSpace ? ' ' : '') + 'clef=' + target;
        }
        appliedToVoice = true;
        return leading + body + comment;
      });
      if (!appliedToVoice) {
        let updatedKey = false;
        const keyRegex = /^K:\s*/i;
        return processed.map(line => {
          if (updatedKey) return line;
          const trimmed = line.trimStart();
          if (!keyRegex.test(trimmed)) return line;
          const leading = line.substring(0, line.length - trimmed.length);
          const commentIndex = trimmed.indexOf('%');
          let body = commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed;
          const comment = commentIndex >= 0 ? trimmed.slice(commentIndex) : '';
          if (clefRegex.test(body)) {
            body = body.replace(clefRegex, (_, prefix) => prefix + target);
          } else {
            const needsSpace = body.length > 0 && !/\s$/.test(body);
            body = body + (needsSpace ? ' ' : '') + 'clef=' + target;
          }
          updatedKey = true;
          return leading + body + comment;
        }).join('\n');
      }
      return processed.join('\n');
    } catch (error) {
      console.warn('ABCViewer: applyClefOverride failed', error);
      return abcText;
    }
  }

  const Viewer = {
    state: {
      vt: 0,
      octaveShift: 0,
      minOctaveShift: -3,
      maxOctaveShift: 3,
      clef: 'auto',
      clefUserOverride: false,
      // headerVisibility removed — header toggles are handled in native apps only
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
      // Elements temporarily highlighted by TimingCallbacks for current-note
      // cursor progression. Kept separate from `highlighted` so persistent
      // selections remain when playback stops.
      timerHighlighted: [],
      enableHighlight: false,
      playbackMode: 'mixed', // 'mixed', 'chords', 'melody'
      synthControl: null,
      synthUiEl: null,
      finishTimeout: null,
      renderScale: 60, // percent of viewport height to aim SVG max-height
      // cursor state
      _cursorBallInit: false,
      cursorBallEl: null,
      _highlightLocked: false,
      // metronome/count-in state
      metronomeEnabled: false,
      metronomeTimer: null,
      metronomeBeat: 0,
      metronomeDisplayEl: null,
      metronomeCountCancel: false,
      isCountingIn: false,
      leadInEnabled: true
    },
    collectionSelections: {},
    preferencesLoaded: false,

    instruments: {
      guitar: { instrument: 'guitar', tuning: ["E,","A,","D","G","B","e"], label: 'Guitar' },
      mandolin: { instrument: 'violin', tuning: ["G,","D","A","e"], label: 'Mandolin' },
      ukulele: { instrument: 'violin', tuning: ["G,","C","E","A"], label: 'Ukulele' },
      baritone: { instrument: 'violin', tuning: ["D,","G,","B,","E"], label: 'Baritone' }
    },

    loadPersistedState: function() {
      if (this.preferencesLoaded) return;
      this.preferencesLoaded = true;
      const storage = getStorage();
      if (!storage) return;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return;
        if (typeof data.enableHighlight === 'boolean') {
          this.state.enableHighlight = data.enableHighlight;
        }
        if (typeof data.metronomeEnabled === 'boolean') {
          this.state.metronomeEnabled = data.metronomeEnabled;
        }
        if (typeof data.leadInEnabled === 'boolean') {
          this.state.leadInEnabled = data.leadInEnabled;
        }
        if (typeof data.clef === 'string') {
          this.state.clef = normalizeClefMode(data.clef);
          this.state.clefUserOverride = true;
        }
        if (typeof data.octaveShift === 'number' && Number.isFinite(data.octaveShift)) {
          const rounded = Math.round(data.octaveShift);
          const clamped = Math.min(this.state.maxOctaveShift, Math.max(this.state.minOctaveShift, rounded));
          this.state.octaveShift = clamped;
        }
        if (data.selectedTunes && typeof data.selectedTunes === 'object') {
          this.collectionSelections = { ...data.selectedTunes };
        }
      } catch (error) {
        console.warn('ABCViewer: failed to load persisted state', error);
      }
    },

    persistState: function() {
      const storage = getStorage();
      if (!storage) return;
      try {
        const payload = {
          enableHighlight: !!this.state.enableHighlight,
          metronomeEnabled: !!this.state.metronomeEnabled,
          leadInEnabled: !!this.state.leadInEnabled,
          clef: normalizeClefMode(this.state.clef),
          octaveShift: this.state.octaveShift || 0,
          selectedTunes: this.collectionSelections || {}
        };
        storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn('ABCViewer: failed to persist state', error);
      }
    },

    getCollectionSlug: function() {
      const selectEl = document.getElementById('tuneSelect');
      if (selectEl && selectEl.dataset && selectEl.dataset.collection) {
        return selectEl.dataset.collection;
      }
      const container = document.querySelector('[data-abc-collection]');
      if (container) {
        const slug = container.getAttribute('data-abc-collection');
        if (slug) return slug;
      }
      return null;
    },

    persistSelectedTune: function(x) {
      const slug = this.getCollectionSlug();
      if (!slug) return;
      if (!this.collectionSelections) {
        this.collectionSelections = {};
      }
      if (x == null || x === '') {
        delete this.collectionSelections[slug];
      } else {
        this.collectionSelections[slug] = String(x);
      }
      this.persistState();
    },

    getTotalTranspose: function() {
      const semitoneShift = Number.isFinite(this.state.vt) ? this.state.vt : 0;
      const octaveShift = Number.isFinite(this.state.octaveShift) ? this.state.octaveShift : 0;
      return semitoneShift + (octaveShift * 12);
    },

    updateOctaveControls: function() {
      const shift = Number.isFinite(this.state.octaveShift) ? this.state.octaveShift : 0;
      const display = shift > 0 ? `+${shift}` : String(shift);
      const min = this.state.minOctaveShift;
      const max = this.state.maxOctaveShift;
      const disableDown = shift <= min;
      const disableUp = shift >= max;
      ['octaveLabel', 'octaveLabelBlank'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = display;
      });
      ['octaveDown', 'octaveDownBlank'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = disableDown;
      });
      ['octaveUp', 'octaveUpBlank'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = disableUp;
      });
      const shiftStr = String(shift);
      ['octaveSelect', 'octaveSelectBlank'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        Array.from(sel.options).forEach(opt => {
          const optVal = Number(opt.value);
          if (Number.isFinite(optVal)) {
            opt.disabled = optVal < min || optVal > max;
          }
        });
        if (sel.value !== shiftStr) {
          sel.value = shiftStr;
        }
      });
    },

    init: function(inputId, paperId) {
      this.state.inputId = inputId;
      this.state.paperId = paperId;
      this.loadPersistedState();
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

      // Header toggles removed from web viewer

      const transposeInfo = q('transposeInfo');
      const down = q('transposeDown');
      const up = q('transposeUp');
      const renderBtn = q('renderBtn');
      if (down) down.addEventListener('click', () => { this.state.vt--; if (transposeInfo) transposeInfo.textContent = this.state.vt + ' st'; this.render(); });
      if (up) up.addEventListener('click', () => { this.state.vt++; if (transposeInfo) transposeInfo.textContent = this.state.vt + ' st'; this.render(); });
      if (renderBtn) renderBtn.addEventListener('click', () => this.render());

      const setOctaveShift = (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        const rounded = Math.round(numeric);
        const next = Math.min(this.state.maxOctaveShift, Math.max(this.state.minOctaveShift, rounded));
        if (next === this.state.octaveShift) return;
        this.state.octaveShift = next;
        this.persistState();
        this.updateOctaveControls();
        this.render();
      };
      const applyOctaveDelta = (delta) => {
        const current = Number.isFinite(this.state.octaveShift) ? this.state.octaveShift : 0;
        setOctaveShift(current + delta);
      };
      const octaveDownEls = [q('octaveDown'), q('octaveDownBlank')].filter(Boolean);
      const octaveUpEls = [q('octaveUp'), q('octaveUpBlank')].filter(Boolean);
      octaveDownEls.forEach(btn => btn.addEventListener('click', () => applyOctaveDelta(-1)));
      octaveUpEls.forEach(btn => btn.addEventListener('click', () => applyOctaveDelta(1)));
      const octaveSelectEls = [q('octaveSelect'), q('octaveSelectBlank')].filter(Boolean);
      octaveSelectEls.forEach(sel => sel.addEventListener('change', evt => {
        const val = evt?.target?.value;
        setOctaveShift(val);
      }));
      this.updateOctaveControls();

      const clefSel = q('clefSelect');
      const clefSelBlank = q('clefSelectBlank');
      const syncClefSelectValues = () => {
        const val = normalizeClefMode(this.state.clef);
        [clefSel, clefSelBlank].forEach(sel => {
          if (sel) sel.value = val;
        });
      };
      syncClefSelectValues();
      const handleClefChange = (evt) => {
        const val = normalizeClefMode(evt?.target?.value);
        this.state.clef = val;
        this.state.clefUserOverride = true;
        syncClefSelectValues();
        this.persistState();
        this.render();
      };
      if (clefSel) clefSel.addEventListener('change', handleClefChange);
      if (clefSelBlank) clefSelBlank.addEventListener('change', handleClefChange);

      const layerSel = q('layerSelect');
      const strip = q('stripChords');
      const applyClefDefaultForLayer = () => {
        if (!layerSel) return;
        const layerValue = layerSel.value;
        if (this.state.clefUserOverride) return;
        const currentClef = normalizeClefMode(this.state.clef);
        if (layerValue === 'bass' && currentClef !== 'bass') {
          this.state.clef = 'bass';
        } else if (layerValue !== 'bass' && currentClef === 'bass') {
          this.state.clef = 'treble';
        }
      };
      if (layerSel) {
        const onLayerChange = () => {
          this.state.layer = layerSel.value;
          applyClefDefaultForLayer();
          syncClefSelectValues();
          this.persistState();
          this.render();
        };
        applyClefDefaultForLayer();
        syncClefSelectValues();
        layerSel.addEventListener('change', onLayerChange);
      }
      if (strip) strip.addEventListener('change', () => { this.state.stripChordsForTabs = !!strip.checked; this.render(); });

      // Tune selection (only on collection pages)
      const input = q(this.state.inputId);
      if (input) {
        this.state.fullAbc = input.value || '';
        this.buildTuneIndex();
        const tuneSel = q('tuneSelect');
        if (tuneSel) {
          this.populateTuneSelect(tuneSel);
          const slug = tuneSel.dataset ? tuneSel.dataset.collection : null;
          const storedX = slug && this.collectionSelections ? this.collectionSelections[slug] : null;
          if (storedX && (this.state.tunes || []).some(t => String(t.x) === String(storedX))) {
            tuneSel.value = String(storedX);
            this.selectTuneByX(storedX);
          }
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
          this.stop();
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

      // Playback mode toggle button
      const playbackModeToggle = q('playbackModeToggle');
      if (playbackModeToggle) {
        playbackModeToggle.addEventListener('click', () => {
          // Cycle through modes: mixed -> chords -> melody -> mixed
          const modes = ['mixed', 'chords', 'melody'];
          const currentIndex = modes.indexOf(this.state.playbackMode);
          const nextIndex = (currentIndex + 1) % modes.length;
          this.state.playbackMode = modes[nextIndex];
          this.updatePlaybackModeButton(playbackModeToggle);
        });
        this.updatePlaybackModeButton(playbackModeToggle);
      }

      // Highlight toggle wiring
      const highlightToggle = q('highlightToggle');
      if (highlightToggle) {
        // Initialize control state
        this.updateHighlightControl(highlightToggle, this.state.enableHighlight);
        highlightToggle.addEventListener('click', async () => {
          // Toggle state
          this.state.enableHighlight = !this.state.enableHighlight;
          this.updateHighlightControl(highlightToggle, this.state.enableHighlight);
          this.persistState();
          if (this.state.enableHighlight) {
            // If a visual object is available and playback is active, install timing
            try {
              // Clear transient highlights/cursor so timing begins from the first note
              try { this._clearTransientHighlights(); } catch(_) {}
              try { this._clearCursor(); } catch(_) {}
              const displayVObj = this.state.lastVisualObj || this.render(true);
              const timer = this.installTiming(displayVObj);
              if (timer && timer.start && this.state.isPlaying) timer.start(0);
            } catch (e) {
              console.warn('Failed to enable highlight timing:', e);
            }
          } else {
            // Disable timing and clear any highlights
            try { if (this.state.timer && this.state.timer.stop) this.state.timer.stop(); } catch(_) {}
            this.clearHighlight();
          }
        });
      }

      // Metronome toggle wiring
      const metToggleEls = ['metronomeToggle', 'metronomeToggleBlank']
        .map(id => q(id))
        .filter(Boolean);
      const metDisplayEls = ['metronomeDisplay', 'metronomeDisplayBlank']
        .map(id => q(id))
        .filter(Boolean);
      if (metDisplayEls.length && !this.state.metronomeDisplayEl) {
        this.state.metronomeDisplayEl = metDisplayEls[0];
      }
      const syncMetDisplayCopies = () => {
        if (!this.state.metronomeDisplayEl || metDisplayEls.length < 2) return;
        metDisplayEls.forEach(el => {
          if (el !== this.state.metronomeDisplayEl) {
            el.textContent = this.state.metronomeDisplayEl.textContent;
            el.className = this.state.metronomeDisplayEl.className;
          }
        });
      };
      const updateMetLabel = () => {
        const enabled = !!this.state.metronomeEnabled;
        metToggleEls.forEach(btn => {
          btn.textContent = enabled ? 'Metronome: On' : 'Metronome: Off';
          btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
          btn.classList.toggle('bg-blue-500/20', enabled);
          btn.classList.toggle('text-white', enabled);
          btn.classList.toggle('text-blue-200', !enabled);
        });
        if (!enabled) {
          this.clearMetronomeDisplay();
        } else if (!this.state.isPlaying && !this.state.isCountingIn) {
          this.updateMetronomeDisplay('Ready');
        }
        syncMetDisplayCopies();
      };
      if (metToggleEls.length) {
        updateMetLabel();
        metToggleEls.forEach(btn => {
          btn.addEventListener('click', async () => {
            this.state.metronomeEnabled = !this.state.metronomeEnabled;
            this.persistState();
            if (!this.state.metronomeEnabled) {
              this.state.metronomeCountCancel = true;
              this.stopMetronomeLoop();
              this.clearMetronomeDisplay();
            } else {
              this.state.metronomeCountCancel = false;
              if (this.state.isPlaying) {
                await this.startMetronomeLoop(this.state.leadInEnabled);
              } else {
                this.updateMetronomeDisplay('Ready');
              }
            }
            updateMetLabel();
          });
        });
      }

      const leadInToggleEls = ['leadInToggle', 'leadInToggleBlank']
        .map(id => q(id))
        .filter(Boolean);
      const updateLeadInUi = () => {
        const enabled = !!this.state.leadInEnabled;
        leadInToggleEls.forEach(btn => {
          btn.textContent = enabled ? 'Lead-in: On' : 'Lead-in: Off';
          btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
          btn.classList.toggle('bg-indigo-500/20', enabled);
          btn.classList.toggle('text-white', enabled);
          btn.classList.toggle('text-indigo-200', !enabled);
        });
      };
      if (leadInToggleEls.length) {
        updateLeadInUi();
        leadInToggleEls.forEach(btn => {
          btn.addEventListener('click', () => {
            this.state.leadInEnabled = !this.state.leadInEnabled;
            if (!this.state.leadInEnabled) {
              this.state.metronomeCountCancel = true;
              if (this.state.isCountingIn) {
                this.state.isCountingIn = false;
                this.clearMetronomeDisplay();
              }
            }
            this.persistState();
            updateLeadInUi();
          });
        });
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
      document.querySelectorAll('[data-print-trigger]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          try { if (ev && typeof ev.preventDefault === 'function') ev.preventDefault(); } catch (_) {}
          this.printSheet();
        });
      });
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
            try { this._clearTransientHighlights(); } catch(_) {}
            try {
              if (this.state.enableHighlight) {
                try { if (this.state.timer && this.state.timer.stop) this.state.timer.stop(); } catch(_) {}
                const displayVObj = this.state.lastVisualObj || this.render(true);
                const timer = this.installTiming(displayVObj);
                if (timer && timer.start && this.state.isPlaying) timer.start(0);
              }
            } catch(_) {}
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
          try { this._clearTransientHighlights(); } catch(_) {}
          try {
            if (this.state.enableHighlight) {
              // Keep persistent highlights; just clear transient cursor/highlights
              try { if (this.state.timer && this.state.timer.stop) this.state.timer.stop(); } catch(_) {}
              try { this._clearTransientHighlights(); } catch(_) {}
              try { this._clearCursor(); } catch(_) {}
              const displayVObj = this.state.lastVisualObj || this.render(true);
              const timer = this.installTiming(displayVObj);
              if (timer && timer.start && this.state.isPlaying) timer.start(0);
            }
          } catch(_) {}
        });
      } catch(_) {}

      // Render scale control wiring (if present)
      const scaleSlider = q('renderScale');
      const scaleLabel = q('renderScaleLabel');
      if (scaleSlider) {
        const setVal = () => {
          const v = parseInt(scaleSlider.value, 10) || 60;
          this.state.renderScale = v;
          if (scaleLabel) scaleLabel.textContent = `${v}%`;
          try { this.applyRenderScale(); } catch(_) {}
          try {
            if (this.state.enableHighlight) {
              try { if (this.state.timer && this.state.timer.stop) this.state.timer.stop(); } catch(_) {}
              const displayVObj = this.state.lastVisualObj || this.render(true);
              const timer = this.installTiming(displayVObj);
              if (timer && timer.start && this.state.isPlaying) timer.start(0);
            }
          } catch(_) {}
        };
        scaleSlider.value = String(this.state.renderScale);
        if (scaleLabel) scaleLabel.textContent = `${this.state.renderScale}%`;
        scaleSlider.addEventListener('input', setVal);
        scaleSlider.addEventListener('change', setVal);
      }
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
      const slug = selectEl.dataset ? selectEl.dataset.collection : null;
      if (slug && this.collectionSelections && this.collectionSelections[slug]) {
        selectEl.value = String(this.collectionSelections[slug]);
      }
    },

    selectTuneByX: function(x) {
      const input = document.getElementById(this.state.inputId);
      if (!input) return;
      if (!x) {
        input.value = this.state.fullAbc;
        this.state.selectedX = null;
        this.state.selectedIndex = -1;
        this.stop();
        this.render();
        this.persistSelectedTune(null);
        return;
      }
      const idx = (this.state.tunes || []).findIndex(t => String(t.x) === String(x));
      if (idx >= 0) {
        const hit = this.state.tunes[idx];
        this.state.selectedX = hit.x;
        this.state.selectedIndex = idx;
        const selectEl = document.getElementById('tuneSelect');
        if (selectEl) selectEl.value = String(hit.x);
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
        this.persistSelectedTune(hit.x);
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

    getActiveAbcText: function() {
      const input = document.getElementById(this.state.inputId);
      return input ? (input.value || '') : '';
    },

    getBeatsPerMeasureFromAbc: function(abc) {
      if (!abc) return null;
      const m = abc.match(/^M:\s*([^\r\n]+)/m);
      if (!m) return null;
      const raw = m[1].trim();
      if (!raw) return null;
      if (raw === 'C') return 4;
      if (raw === 'C|') return 2;
      const frac = raw.match(/^(\d+)\s*\/\s*(\d+)/);
      if (frac) {
        const num = parseInt(frac[1], 10);
        const den = parseInt(frac[2], 10);
        if (Number.isFinite(num) && num > 0 && Number.isFinite(den) && den > 0) return num;
      }
      const asInt = parseInt(raw, 10);
      return Number.isFinite(asInt) && asInt > 0 ? asInt : null;
    },

    getActiveBeatsPerMeasure: function() {
      const beats = this.getBeatsPerMeasureFromAbc(this.getActiveAbcText());
      return beats || 4;
    },

    delay: function(ms) {
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
    },

    updateMetronomeDisplay: function(message) {
      const el = this.state.metronomeDisplayEl;
      if (!el) return;
      if (!message) {
        el.textContent = '';
        el.classList.remove('opacity-100');
        el.classList.add('opacity-60');
        return;
      }
      el.textContent = message;
      el.classList.add('opacity-100');
      el.classList.remove('opacity-60');
    },

    clearMetronomeDisplay: function() {
      this.updateMetronomeDisplay('');
    },

    playMetronomeClick: async function(strong, ctx) {
      try {
        const ac = ctx || await this.ensureAudioContext();
        const now = ac.currentTime + 0.003;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const peak = strong ? 0.22 : 0.14;
        const freq = strong ? 1760 : 1320;
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(now);
        osc.stop(now + 0.2);
      } catch (err) {
        console.warn('Metronome click failed:', err);
      }
    },

    startMetronomeLoop: async function(skipImmediate) {
      try { this.stopMetronomeLoop(); } catch (_) {}
      if (!this.state.metronomeEnabled || this.state.isCountingIn) return;
      const tempo = this.state.currentTempo || 120;
      if (!tempo || !isFinite(tempo) || tempo <= 0) return;
      const interval = 60000 / tempo;
      const beatsPerMeasure = this.getActiveBeatsPerMeasure();
      const ac = await this.ensureAudioContext();
      this.state.metronomeBeat = skipImmediate ? 1 : 0;
      const fireBeat = () => {
        if (!this.state.metronomeEnabled || this.state.isCountingIn) {
          this.stopMetronomeLoop();
          return;
        }
        this.state.metronomeBeat = (this.state.metronomeBeat % beatsPerMeasure) + 1;
        const isStrong = this.state.metronomeBeat === 1;
        this.playMetronomeClick(isStrong, ac);
        this.updateMetronomeDisplay(`Beat ${this.state.metronomeBeat}`);
      };
      if (!skipImmediate) fireBeat();
      this.state.metronomeTimer = setInterval(fireBeat, interval);
    },

    stopMetronomeLoop: function() {
      if (this.state.metronomeTimer) {
        try { clearInterval(this.state.metronomeTimer); } catch (_) {}
        this.state.metronomeTimer = null;
      }
      this.state.metronomeBeat = 0;
    },

    performCountIn: async function() {
      if (!this.state.leadInEnabled) return true;
      const tempo = this.state.currentTempo || 120;
      if (!tempo || !isFinite(tempo) || tempo <= 0) return true;
      const beats = this.getActiveBeatsPerMeasure();
      const interval = 60000 / tempo;
      const ac = await this.ensureAudioContext();
      this.state.isCountingIn = true;
      this.state.metronomeCountCancel = false;
      this.state.metronomeBeat = 0;
      for (let i = beats; i >= 1; i--) {
        if (this.state.metronomeCountCancel) {
          this.state.isCountingIn = false;
          this.clearMetronomeDisplay();
          return false;
        }
        this.updateMetronomeDisplay(`Count-in: ${i}`);
        this.playMetronomeClick(i === beats, ac);
        await this.delay(interval);
      }
      if (this.state.metronomeCountCancel) {
        this.state.isCountingIn = false;
        this.clearMetronomeDisplay();
        return false;
      }
      this.updateMetronomeDisplay('Go!');
      await this.delay(Math.min(interval / 3, 200));
      this.state.isCountingIn = false;
      if (this.state.metronomeEnabled) {
        this.updateMetronomeDisplay('Beat 1');
      } else {
        this.clearMetronomeDisplay();
      }
      return true;
    },

    getProgramForPlaybackMode: function() {
      switch (this.state.playbackMode) {
        case 'chords': return 24; // Acoustic Guitar
        case 'melody': return 40; // Violin
        case 'mixed':
        default: return 0; // Piano
      }
    },

    filterAbcForPlaybackMode: function(abcText) {
      switch (this.state.playbackMode) {
        case 'chords':
          // Keep header lines (like X:, T:, K:, Q:, etc.) and chord quotes, but replace melody notes with rests
          return this._filterChordsOnly(abcText);
        case 'melody':
          // Remove quoted chord symbols from music lines, keep headers
          return this._filterMelodyOnly(abcText);
        case 'mixed':
        default:
          return abcText;
      }
    },

    // Helper used by filterAbcForPlaybackMode
    _filterChordsOnly: function(abcContent) {
      const lines = (abcContent || '').split('\n');
      const out = [];
      for (let line of lines) {
        // Preserve header lines (capital-letter key:value)
        if (/^[A-Z]:/.test(line)) {
          out.push(line);
          continue;
        }
        let filteredLine = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuote = !inQuote;
            filteredLine += ch;
          } else if (inQuote) {
            // keep chord text
            filteredLine += ch;
          } else {
            // Outside quotes: replace note letters with rests, keep other characters
            if (/[A-Ga-g]/.test(ch)) {
              filteredLine += 'z';
            } else {
              filteredLine += ch;
            }
          }
        }
        out.push(filteredLine);
      }
      return out.join('\n');
    },

    _filterMelodyOnly: function(abcContent) {
      const lines = (abcContent || '').split('\n');
      const out = [];
      for (let line of lines) {
        if (/^[A-Z]:/.test(line)) { out.push(line); continue; }
        let filteredLine = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuote = !inQuote; continue; }
          if (!inQuote) filteredLine += ch;
          // skip characters inside quotes
        }
        out.push(filteredLine);
      }
      return out.join('\n');
    },

    setPlaybackMode: function(mode) {
      this.state.playbackMode = mode;
      // If currently playing, restart playback with new mode
      if (this.state.isPlaying) {
        this.restartPlayback().catch(e => console.error('Failed to restart playback with new mode:', e));
      }
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
        options: {
          soundFont,
          program: this.getProgramForPlaybackMode(),
          midiTranspose: this.getTotalTranspose(),
          gain: 0.7,
          // Apply playback mode settings
          chordsOff: this.state.playbackMode === 'melody',  // Disable chords for melody-only
          voicesOff: this.state.playbackMode === 'chords'   // Disable melody voices for chords-only
        }
      });
      await synth.prime();
      this.state.synth = synth;
      return synth;
    },

    play: async function() {
      try {
        if (!window.ABCJS?.synth) throw new Error('abcjs synth not available');
        const wantsMetronome = !!this.state.metronomeEnabled;
        const wantsLeadIn = !!this.state.leadInEnabled;
        this.state.metronomeCountCancel = false;
        if (wantsLeadIn) {
          if (!this.state.isPlaying) {
            this.state.isPlaying = true;
            this.updatePlayButton();
          }
          this.state.metronomeCountCancel = false;
          const proceed = await this.performCountIn();
          if (!proceed) {
            this.state.isPlaying = false;
            this.updatePlayButton();
            return;
          }
        } else if (wantsMetronome && !this.state.isPlaying && !this.state.isCountingIn) {
          this.updateMetronomeDisplay('Ready');
        }
        this.stopMetronomeLoop();
        // Bump a play session id so any stale async callbacks from previous
        // runs won't clear highlights after the user stops playback.
        this.state.playSession = (this.state.playSession || 0) + 1;
        const __playSession = this.state.playSession;
        // Ensure a visible DOM-attached visual object exists for timing/highlights
        // and also obtain a playback-only visual object for synth initialization.
        let displayVObj = this.state.lastVisualObj || null;
        if (!displayVObj) {
          try { displayVObj = this.render(true); } catch(_) { displayVObj = null; }
        }
        // Build playback-only visual object (non-DOM) for the synth
        const vObj = this.render(true, true);
        if (!vObj) throw new Error('render failed');
        // Default path: our CreateSynth, optional TimingCallbacks
        await this.ensureSynth(vObj);
        if (this.state.enableHighlight) {
          // Ensure a DOM-attached visual object is available for timing callbacks.
          try {
            if (!this.state.lastVisualObj) {
              try { this.render(); } catch(_) {}
            }
          } catch(_) {}
          // Ensure transient highlights/cursor are cleared so timing begins at the first note consistently.
          try { this._clearTransientHighlights(); } catch(_) {}
          try { this._clearCursor(); } catch(_) {}
          // Prefer the visible display VObj we ensured above; fall back to whatever vObj we have.
          const useDisplay = this.state.lastVisualObj || displayVObj || vObj;
          let timer = this.installTiming(useDisplay);
          // Defensive retry if needed
          if (!timer) {
            try { this.render(); } catch(_) {}
            try { timer = this.installTiming(this.state.lastVisualObj || useDisplay); } catch(_) { timer = null; }
          }
          if (timer && timer.start) timer.start(0);
        } else {
          if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
          this.clearHighlight();
        }
        // Clear any previous finish polling/timeouts
        if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
        if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
        const startResult = this.state.synth.start();
        if (this.state.metronomeEnabled) {
          await this.startMetronomeLoop(this.state.leadInEnabled);
        } else {
          this.clearMetronomeDisplay();
        }
        this.state.isPlaying = true;
        this.updatePlayButton();
        // Reapply render scaling after playback starts
        try { this.applyRenderScale(); } catch(_) {}
        // Duration-based watchdog
        try {
          const d = Number(this.state.synth && this.state.synth.duration);
          if (d && isFinite(d) && d > 0) {
            this.state.finishTimeout = setTimeout(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
              this.clearHighlight();
              this.stopMetronomeLoop();
              this.clearMetronomeDisplay();
              this.state.finishTimeout = null;
            }, Math.ceil(d * 1000) + 250);
          }
        } catch(_) {}
        // Handle playback finish to toggle Stop -> Play automatically
        if (startResult && typeof startResult.then === 'function') {
          startResult.then(() => {
            if (this.state.playSession !== __playSession) return;
            this.state.isPlaying = false;
            this.updatePlayButton();
            if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
            this.clearHighlight();
            this.stopMetronomeLoop();
            this.clearMetronomeDisplay();
            if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          }).catch(() => {
            if (this.state.playSession !== __playSession) return;
            this.state.isPlaying = false;
            this.updatePlayButton();
            if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
            this.clearHighlight();
            this.stopMetronomeLoop();
            this.clearMetronomeDisplay();
            if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          });
        } else {
          // Fallback: poll isRunning if no promise
          const poll = () => {
            try {
              if (this.state.playSession !== __playSession) { this.state.playFinishTimer = null; return; }
              if (!this.state.synth || !this.state.synth.isRunning) {
                if (this.state.playSession !== __playSession) { this.state.playFinishTimer = null; return; }
                this.state.isPlaying = false;
                this.updatePlayButton();
                this.state.playFinishTimer = null;
                if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
                this.clearHighlight();
                this.stopMetronomeLoop();
                this.clearMetronomeDisplay();
                if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
                return;
              }
            } catch(_) {}
            this.state.playFinishTimer = setTimeout(poll, 500);
          };
          this.state.playFinishTimer = setTimeout(poll, 500);
        }
      } catch (e) {
        console.error('Play failed:', e);
        this.stopMetronomeLoop();
        if (!this.state.isCountingIn) this.clearMetronomeDisplay();
        this.state.isPlaying = false;
        this.updatePlayButton();
        alert('Playback failed. Ensure soundfonts exist under /abcjs/soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/.');
      }
    },

    stop: function() {
      this.state.metronomeCountCancel = true;
      this.stopMetronomeLoop();
      if (!this.state.isCountingIn) this.clearMetronomeDisplay();
      this.state.isCountingIn = false;
      try { if (this.state.synth) this.state.synth.stop(); } catch(_) {}
      try { if (this.state.synthControl) this.state.synthControl.stop(); } catch(_) {}
      if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
      if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
      // Clear transient timer highlights and cursor artifacts so the next
      // play installs fresh timing highlights from the start.
      // Invalidate any pending async finish handlers
      try { this.state.playSession = (this.state.playSession || 0) + 1; } catch(_) {}
      try { this._clearTransientHighlights(); } catch(_) {}
      try { this._clearCursor(); } catch(_) {}
      try { this.state.timer = null; } catch(_) {}
      if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
      this.state.isPlaying = false;
      this.updatePlayButton();
    },

    restartPlayback: async function() {
      try {
        this.stopMetronomeLoop();
        const vObj = this.render(true, true);
        await this.ensureSynth(vObj);
        if (this.state.enableHighlight) {
          // Ensure DOM-attached visualObj exists for highlight callbacks
          if (!this.state.lastVisualObj) { try { this.render(); } catch(_) {} }
          try { this._clearTransientHighlights(); } catch(_) {}
          try { this._clearCursor(); } catch(_) {}
          const useDisplay = this.state.lastVisualObj || vObj;
          let timer = this.installTiming(useDisplay);
          if (!timer) {
            try { this.render(); } catch(_) {}
            try { timer = this.installTiming(this.state.lastVisualObj || useDisplay); } catch(_) { timer = null; }
          }
          if (timer && timer.start) timer.start(0);
        } else {
          if (this.state.timer && this.state.timer.stop) { try { this.state.timer.stop(); } catch(_) {} }
          this.clearHighlight();
        }
        if (this.state.playFinishTimer) { try { clearTimeout(this.state.playFinishTimer); } catch(_) {} this.state.playFinishTimer = null; }
        if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
        const startResult = this.state.synth.start();
        if (this.state.metronomeEnabled) {
          await this.startMetronomeLoop(true);
        } else {
          this.clearMetronomeDisplay();
        }
        this.state.isPlaying = true;
        this.updatePlayButton();
        try { this.applyRenderScale(); } catch(_) {}
        try {
          const d = Number(this.state.synth && this.state.synth.duration);
          if (d && isFinite(d) && d > 0) {
            this.state.finishTimeout = setTimeout(() => {
              this.state.isPlaying = false;
              this.updatePlayButton();
              if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
              try { this._clearCursor(); } catch(_) {}
              this.stopMetronomeLoop();
              this.clearMetronomeDisplay();
              this.state.finishTimeout = null;
            }, Math.ceil(d * 1000) + 250);
          }
        } catch(_) {}
        if (startResult && typeof startResult.then === 'function') {
          startResult.then(() => {
            this.state.isPlaying = false;
            this.updatePlayButton();
            if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
            try { this._clearCursor(); } catch(_) {}
            this.stopMetronomeLoop();
            this.clearMetronomeDisplay();
            if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
          }).catch(() => {
            this.state.isPlaying = false;
            this.updatePlayButton();
            if (this.state.timer && this.state.timer.stop) this.state.timer.stop();
            try { this._clearCursor(); } catch(_) {}
            this.stopMetronomeLoop();
            this.clearMetronomeDisplay();
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
                try { this._clearCursor(); } catch(_) {}
                this.stopMetronomeLoop();
                this.clearMetronomeDisplay();
                if (this.state.finishTimeout) { try { clearTimeout(this.state.finishTimeout); } catch(_) {} this.state.finishTimeout = null; }
                return;
              }
            } catch(_) {}
            this.state.playFinishTimer = setTimeout(poll, 500);
          };
          this.state.playFinishTimer = setTimeout(poll, 500);
        }
      } catch (e) {
        console.error('Restart playback failed:', e);
        this.stopMetronomeLoop();
        this.clearMetronomeDisplay();
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

    updateHighlightControl: function(btn, enabled) {
      if (!btn) return;
      const active = !!enabled;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.textContent = active ? 'Highlight notes: On' : 'Highlight notes: Off';
      btn.classList.toggle('bg-amber-500', active);
      btn.classList.toggle('text-black', active);
      btn.classList.toggle('text-amber-400', !active);
    },
    updatePlaybackModeButton: function(btn) {
      if (!btn) return;
      const modes = {
        mixed: { icon: '🎵', text: 'Mixed', title: 'Playback Mode: Chords + Melody' },
        chords: { icon: '🎹', text: 'Chords', title: 'Playback Mode: Chords Only' },
        melody: { icon: '🎶', text: 'Melody', title: 'Playback Mode: Melody Only' }
      };
      const mode = modes[this.state.playbackMode] || modes.mixed;
      btn.textContent = `${mode.icon} ${mode.text}`;
      btn.title = mode.title;
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
      // Header visibility toggles removed from web viewer — return ABC unchanged
      return abc || '';
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

    render: function(returnVisualObj, forPlayback) {
      try {
        if (!global.ABCJS || !ABCJS.renderAbc) return;
        const input = document.getElementById(this.state.inputId);
        const paperEl = document.getElementById(this.state.paperId);
        this.updateOctaveControls();
        if (!input || !paperEl) return;
        paperEl.innerHTML = '';
        // NEW: reset cursor state because the node was just removed
        try { this.state._cursorBallInit = false; this.state.cursorBallEl = null; } catch(_) {}
        try {
          paperEl.style.position = paperEl.style.position || 'relative';
          paperEl.style.display = paperEl.style.display || 'flex';
          paperEl.style.flexDirection = paperEl.style.flexDirection || 'column';
          paperEl.style.height = '100%';
        } catch(_) {}
        // Clear any previous transient highlight/cursor state on new render
        try { this._clearTransientHighlights(); } catch(_) {}
        // If this is a visible DOM render (not a playback-only render) and
        // playback was active, stop now and restart after rendering so the
        // playback always begins from the first note on SVG changes.
        const wasPlaying = !!this.state.isPlaying;
        if (!forPlayback && wasPlaying) {
          try { this.stop(); } catch(_) {}
          this._restartAfterRender = true;
        }
        const raw = input.value || 'X:1\nT:Example\nM:4/4\nL:1/8\nK:C\nCDEF GABc|';
        const norm = this.normalizeAbc(raw);
        const filtered = this.filterHeaders(norm);
        const clefMode = normalizeClefMode(this.state.clef);
        const clefAdjusted = applyClefOverride(filtered, clefMode);
        const playbackFiltered = forPlayback ? this.filterAbcForPlaybackMode(clefAdjusted) : clefAdjusted;

        // Build render options; when a tablature layer is chosen, render staff + tab together in one pass
  const hasTab = this.state.layer && this.state.layer !== 'none';
  const tabSpec = hasTab ? this.instruments[this.state.layer] : null;
  const paperWidth = Math.max(paperEl.clientWidth || paperEl.offsetWidth || 740, 320);
  const totalTranspose = this.getTotalTranspose();
  const baseOpts = { responsive: 'resize', add_classes: true, visualTranspose: totalTranspose, selectionColor: '#f59e0b', wrap: { preferredMeasuresPerLine: 5 } };
        const renderOpts = hasTab && tabSpec ? { ...baseOpts, tablature: [tabSpec] } : baseOpts;

        // Render the visible paper from the unmodified (display) ABC so playback filtering does not affect rendering
        const abcForDisplay = (hasTab && this.state.stripChordsForTabs) ? this.simplifyForTab(clefAdjusted) : clefAdjusted;
        const vDisplay = ABCJS.renderAbc(this.state.paperId, abcForDisplay, renderOpts);
        this.state.lastVisualObj = vDisplay && vDisplay[0];
        // If caller wants a visual object for playback, build it from the playback-filtered ABC but do not replace the visible rendering
        if (returnVisualObj && forPlayback) {
          try {
            const abcForPlayback = (hasTab && this.state.stripChordsForTabs) ? this.simplifyForTab(playbackFiltered) : playbackFiltered;
            // Use a non-DOM container ("*") to obtain a visual object suitable for the synth/midi without touching the page
            const vPlayback = ABCJS.renderAbc("*", abcForPlayback, renderOpts);
            return vPlayback && vPlayback[0];
          } catch (e) {
            // Fall back to the display visual object if playback-specific render fails
            console.warn('Playback visual render failed, falling back to display visualObj', e);
            return this.state.lastVisualObj;
          }
        }
        try { this.updateKeyLabel(playbackFiltered); } catch(_) {}
        try { this.applyThemeInline(); } catch(_) {}
        try { this.applyHeaderVisibilityToSvg?.(); } catch(_) {}
        try { this.ensureResponsiveSvgs(); } catch(_) {}
        try { this.updatePaperHeight(); } catch(_) {}

        if (returnVisualObj) return this.state.lastVisualObj;
        // If we stopped playback at the beginning of render because the SVG
        // changed, restart playback now so it begins from the first note.
        if (this._restartAfterRender) {
          this._restartAfterRender = false;
          try { this.play(); } catch(_) {}
        }
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
          // Restore previous inline styles (important) and presentation attrs
          if (el && el.dataset) {
            if (el.dataset.prevStyleFill !== undefined) {
              const v = el.dataset.prevStyleFill;
              if (v) el.style.setProperty('fill', v);
              else el.style.removeProperty('fill');
              delete el.dataset.prevStyleFill;
            } else {
              el.style.removeProperty('fill');
            }
            if (el.dataset.prevStyleStroke !== undefined) {
              const v = el.dataset.prevStyleStroke;
              if (v) el.style.setProperty('stroke', v);
              else el.style.removeProperty('stroke');
              delete el.dataset.prevStyleStroke;
            } else {
              el.style.removeProperty('stroke');
            }
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
    try {
      if (this._highlightUnlockTimer) { try { clearTimeout(this._highlightUnlockTimer); } catch(_) {} this._highlightUnlockTimer = null; }
      this.state._highlightLocked = false;
    } catch(_) {}
  };

  // Clear only the transient cursor artifacts (cursor bar and timing state)
  Viewer._clearCursor = function() {
    try {
      if (this.state.timer && this.state.timer.stop) {
        try { this.state.timer.stop(); } catch(_) {}
      }
    } catch(_) {}
    try { if (this.state.cursorBallEl) this.state.cursorBallEl.style.opacity = '0'; } catch(_) {}
    // NEW: ensure stale references don't block re-creation
    try { this.state._cursorBallInit = false; this.state.cursorBallEl = null; } catch(_) {}
    try {
      if (this._highlightUnlockTimer) { try { clearTimeout(this._highlightUnlockTimer); } catch(_) {} this._highlightUnlockTimer = null; }
      this.state._highlightLocked = false;
    } catch(_) {}
  };

  // Apply transient timer-driven highlights (do not modify persistent highlights)
  Viewer._applyTransientHighlights = function(elems) {
    try {
      // Clear any previous transient highlights first
      this._clearTransientHighlights();
    } catch(_) {}
    try {
      this.state.timerHighlighted = [];
      const highlightFill = '#f59e0b';
      elems.forEach(el => {
        if (!el) return;
        try {
          if (el.dataset) {
            // Save previous inline styles and presentation attrs
            const prevStyleFill = el.style.getPropertyValue('fill');
            const prevStyleStroke = el.style.getPropertyValue('stroke');
            if (prevStyleFill !== undefined) el.dataset.prevStyleFill = prevStyleFill;
            if (prevStyleStroke !== undefined) el.dataset.prevStyleStroke = prevStyleStroke;
            el.dataset.prevFill = el.getAttribute('fill') ?? '__unset__';
            el.dataset.prevStroke = el.getAttribute('stroke') ?? '__unset__';
          }
          el.classList && el.classList.add('abc-current-note');
          // Critical: inline style with !important to beat theme CSS
          el.style.setProperty('fill', highlightFill, 'important');
          el.style.setProperty('stroke', highlightFill, 'important');
          this.state.timerHighlighted.push(el);
        } catch(_) {}
      });
    } catch(_) {}
  };

  Viewer._clearTransientHighlights = function() {
    try {
      (this.state.timerHighlighted || []).forEach(el => {
        try {
          if (!el) return;
          // Restore inline styles (or remove if none)
          if (el.dataset && el.dataset.prevStyleFill !== undefined) {
            const v = el.dataset.prevStyleFill;
            if (v) el.style.setProperty('fill', v);
            else el.style.removeProperty('fill');
            delete el.dataset.prevStyleFill;
          } else {
            el.style.removeProperty('fill');
          }
          if (el.dataset && el.dataset.prevStyleStroke !== undefined) {
            const v = el.dataset.prevStyleStroke;
            if (v) el.style.setProperty('stroke', v);
            else el.style.removeProperty('stroke');
            delete el.dataset.prevStyleStroke;
          } else {
            el.style.removeProperty('stroke');
          }
          // Restore presentation attributes
          if (el.dataset) {
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
    this.state.timerHighlighted = [];
  };

  Viewer.installTiming = function(vObj) {
    try {
      if (!vObj || !ABCJS) return null;
      if (!ABCJS.TimingCallbacks) { console.warn('ABCJS.TimingCallbacks not available in this build; skipping note highlight'); return null; }
      // Clean up any previous timer/highlights — do NOT remove persistent
      // user-selected highlights here. Only stop the timer and clear
      // transient cursor/highlight artifacts so persistent selections stay.
      if (this.state.timer && this.state.timer.stop) {
        try { this.state.timer.stop(); } catch(_) {}
      }
      try { this._clearTransientHighlights(); } catch(_) {}
      try { this._clearCursor(); } catch(_) {}
      // Let ABCJS use the tempo from the ABC (Q: header) directly to respect units
      const timer = new ABCJS.TimingCallbacks(vObj, {
        qpm: undefined,
        beatSubdivisions: 2,
        beatCallback: (beat, totalBeats, totalMs, position) => {
          if (!this.state.enableHighlight) return;
          // Robust cursor creation: (re)build if missing, detached, or not found
          if (!this.state.cursorBallEl || !this.state.cursorBallEl.isConnected || !document.getElementById('abc-cursor-bar')) {
            try {
              const paper = document.getElementById(this.state.paperId);
              if (paper) {
                try { const old = document.getElementById('abc-cursor-bar'); if (old) old.remove(); } catch(_) {}
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
                el.style.transition = 'opacity 120ms ease, transform 120ms ease, height 120ms ease';
                paper.appendChild(el);
                this.state.cursorBallEl = el;
                this.state._cursorBallInit = true;
              }
            } catch(_) {}
          }
          const paper = document.getElementById(this.state.paperId);
          const svg = paper ? paper.querySelector('svg') : null;
          const ball = this.state.cursorBallEl;
          if (!paper || !svg || !ball || !position) return;
          const pr = paper.getBoundingClientRect();
          const sr = svg.getBoundingClientRect();
          if (this.state._highlightLocked) return;
          try {
            // Prefer transient timer-driven highlights, then DOM elements with
            // the current-note class, then persistent highlighted elements.
            // If we find multiple elements, compute their union bounding box.
            let elemsToUse = null;
            if (this.state.timerHighlighted && this.state.timerHighlighted.length) elemsToUse = Array.from(this.state.timerHighlighted);
            if (!elemsToUse) {
              const paperNode = document.getElementById(this.state.paperId);
              if (paperNode) {
                const domSelAll = paperNode.querySelectorAll('.abc-current-note');
                if (domSelAll && domSelAll.length) elemsToUse = Array.from(domSelAll);
              }
            }
            if (!elemsToUse && this.state.highlighted && this.state.highlighted.length) elemsToUse = Array.from(this.state.highlighted);
            if (elemsToUse && elemsToUse.length) {
              // Compute union bounding rect
              let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
              elemsToUse.forEach(el => {
                if (!el || !el.getBoundingClientRect) return;
                try {
                  const r = el.getBoundingClientRect();
                  if (r.left < minL) minL = r.left;
                  if (r.top < minT) minT = r.top;
                  if (r.right > maxR) maxR = r.right;
                  if (r.bottom > maxB) maxB = r.bottom;
                } catch(_) {}
              });
              if (isFinite(minL) && isFinite(minT) && isFinite(maxR) && isFinite(maxB)) {
                const width = Math.max(0, maxR - minL);
                const height = Math.max(0, maxB - minT);
                const barW = 16;
                const left = (minL - pr.left) + (width ? (width / 2) : 0) - (barW / 2);
                const topPx = (minT - pr.top);
                ball.style.height = `${Math.round(height)}px`;
                ball.style.transform = `translate(${Math.round(left)}px, ${Math.round(topPx)}px)`;
                ball.style.opacity = '0.35';
                // Record that we positioned via DOM elements so beatCallback
                // won't override with viewBox-based coords immediately after.
                try { this.state._lastElementPlacementTime = Date.now(); } catch(_) {}
                return;
              }
            }
          } catch(_) {}
          // If we recently placed the cursor using DOM element bounding boxes,
          // avoid immediately overriding that placement with viewBox-mapped
          // coordinates which can jump when CSS scaling is present.
          if (this.state._lastElementPlacementTime && (Date.now() - this.state._lastElementPlacementTime) < 1200) return;

          // Map the viewBox/user coords to screen coordinates using SVG CTM
          try {
            if (svg.createSVGPoint && svg.getScreenCTM) {
              const pt = svg.createSVGPoint();
              pt.x = position.left || 0;
              pt.y = position.top || 0;
              const screenP = pt.matrixTransform(svg.getScreenCTM());
              let heightPx = 0;
              if (position.height) {
                const pt2 = svg.createSVGPoint();
                pt2.x = position.left || 0;
                pt2.y = (position.top || 0) + position.height;
                const screenP2 = pt2.matrixTransform(svg.getScreenCTM());
                heightPx = Math.abs(screenP2.y - screenP.y);
              }
              const barW = 16;
              const left = screenP.x - pr.left - (barW / 2);
              const topPx = screenP.y - pr.top;
              ball.style.height = `${Math.round(heightPx)}px`;
              ball.style.transform = `translate(${Math.round(left)}px, ${Math.round(topPx)}px)`;
              ball.style.opacity = '0.35';
              return;
            }
          } catch (_) {}
          // Fallback: Scale SVG coords (viewBox) to rendered CSS pixels
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
        eventCallback: (ev) => {
          // End of tune sends null
          if (!ev) { try { this._clearTransientHighlights(); } catch(_) {} return; }
          // Try abcjs native selection first using start/end char
          if (typeof ev.startChar === 'number' && typeof ev.endChar === 'number' && vObj && vObj.rangeHighlight) {
            try {
              vObj.rangeHighlight(ev.startChar, ev.endChar);
              // Prevent the beatCallback from immediately overriding this element-based placement
              try {
                this.state._highlightLocked = true;
                if (this._highlightUnlockTimer) { try { clearTimeout(this._highlightUnlockTimer); } catch(_) {} this._highlightUnlockTimer = null; }
                this._highlightUnlockTimer = setTimeout(() => { try { this.state._highlightLocked = false; this._highlightUnlockTimer = null; } catch(_) {} }, 1200);
              } catch(_) {}
              return;
            } catch(_) { /* fall through to manual coloring */ }
          }
          // Fallback: manually color SVG elements — treat these as transient
          if (ev.elements) {
            try {
              const elems = [];
              ev.elements.forEach(set => set.forEach(el => { if (el) elems.push(el); }));
              try { this._applyTransientHighlights(elems); } catch(_) {}
              
              // Position the cursor bar relative to the first highlighted element's
              // bounding box so the cursor aligns with the actual DOM layout and
              // respects any CSS-based max-height/width scaling.
              try {
                const paper = document.getElementById(this.state.paperId);
                const ball = this.state.cursorBallEl;
                if (paper && ball) {
                  // Find first element node within ev.elements
                  let firstEl = null;
                  for (const set of ev.elements) {
                    if (Array.isArray(set) && set.length) { firstEl = set[0]; break; }
                    if (set && set.nodeType) { firstEl = set; break; }
                  }
                  if (firstEl && firstEl.getBoundingClientRect) {
                    const pr = paper.getBoundingClientRect();
                    const er = firstEl.getBoundingClientRect();
                    const barW = parseInt(ball.style.width || '16', 10) || 16;
                    const left = (er.left - pr.left) + (er.width ? (er.width/2) : 0) - (barW / 2);
                    const topPx = (er.top - pr.top);
                    const hPx = er.height || 0;
                    ball.style.height = `${Math.round(hPx)}px`;
                    ball.style.transform = `translate(${Math.round(left)}px, ${Math.round(topPx)}px)`;
                    ball.style.opacity = '0.35';
                    // Lock beatCallback updates briefly to avoid overriding this DOM-based placement
                    try {
                      this.state._highlightLocked = true;
                      if (this._highlightUnlockTimer) { try { clearTimeout(this._highlightUnlockTimer); } catch(_) {} this._highlightUnlockTimer = null; }
                      this._highlightUnlockTimer = setTimeout(() => { try { this.state._highlightLocked = false; this._highlightUnlockTimer = null; } catch(_) {} }, 1200);
                    } catch(_) {}
                  }
                }
              } catch(_) {}
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
    const m = abc.match(/^(K:\s*[^\n\r]+)/m);
    if (!m) return null;
    const raw = m[1].replace(/^K:\s*/, '').trim();
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
    const labels = ['currentKeyLabel', 'currentKeyLabelBlank']
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (!labels.length) return;
    if (!k) {
      labels.forEach(el => { el.textContent = 'K?'; });
      return;
    }
    const idx = (k.index + (this.state.vt||0)) % 12;
    // Prefer flats when transposing down, sharps when up
    const preferSharps = (this.state.vt||0) >= 0;
    const label = this.keyNameFor(idx, preferSharps, k.minor);
    labels.forEach(el => { el.textContent = label; });
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

  Viewer.printSheet = function() {
    try {
      if (!window.ABCJS || typeof ABCJS.renderAbc !== 'function') {
        alert('Printing requires abcjs to be loaded.');
        return;
      }

      const raw = this.getActiveAbcText() || '';
      const normalized = this.normalizeAbc(raw);
      const filtered = this.filterHeaders(normalized);
      const hasTab = this.state.layer && this.state.layer !== 'none';
      const tabSpec = hasTab ? this.instruments[this.state.layer] : null;
      const abcForPrint = (hasTab && this.state.stripChordsForTabs)
        ? this.simplifyForTab(filtered)
        : filtered;
      if (!abcForPrint || !abcForPrint.trim()) {
        alert('Nothing to print yet.');
        return;
      }

      const renderOpts = {
        add_classes: true,
        responsive: 'resize',
        visualTranspose: this.getTotalTranspose(),
        print: true
      };
      if (hasTab && tabSpec) renderOpts.tablature = [tabSpec];

      const styles = `
        :root { color-scheme: light; }
        @page { size: letter portrait; margin: 1cm; }
        body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: #000000;
          font-family: "Libre Baskerville", "Times New Roman", serif;
        }
        .print-container {
          width: calc(8.5in - 2cm);
          margin: 0 auto;
        }
        .print-container svg {
          width: 100% !important;
          height: auto !important;
          preserve-aspect-ratio: xMinYMin meet;
        }
        .abcjs-highlight, .abcjs-cursor, .abcjs-box-second {
          display: none !important;
        }
      `;

      const safeSvg = (() => {
        const svg = paper.querySelector('svg');
        if (!svg) return '';
        const clone = svg.cloneNode(true);
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        clone.setAttribute('preserveAspectRatio', 'xMinYMin meet');
        clone.setAttribute('style', 'display:block;width:100%;height:auto;');
        return new XMLSerializer().serializeToString(clone);
      })();

      const html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>Print Music</title>
            <style>${styles}</style>
          </head>
          <body>
            <div class="print-container">${safeSvg}</div>
          </body>
        </html>
      `;

      const blob = new Blob([html], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, '_blank', 'noopener=yes,width=960,height=720');
      if (!printWindow) {
        URL.revokeObjectURL(blobUrl);
        alert('Allow pop-ups to print the music.');
        return;
      }
      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
      }, 60000);

      const finish = () => {
        setTimeout(() => {
          try { printWindow.focus(); printWindow.print(); } catch (_) {}
          setTimeout(() => { try { printWindow.close(); } catch (_) {} }, 300);
        }, 120);
      };
      if (printWindow.document.readyState === 'complete') finish();
      else printWindow.addEventListener('load', finish, { once: true });
    } catch (e) {
      console.error('Print failed:', e);
      alert('Printing is not available right now.');
    }
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
  let res = ABCJS.midi.getMidiFile(abc, { midiOutputType: 'encoded', midiTranspose: this.getTotalTranspose() });
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
  let bin = ABCJS.midi.getMidiFile(abc, { midiOutputType: 'binary', midiTranspose: this.getTotalTranspose() });
        if (bin && (bin.byteLength || (typeof Uint8Array !== 'undefined' && bin instanceof Uint8Array))) {
          const blob = new Blob([bin], { type: 'audio/midi' });
          const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
          this.download(fname, 'audio/midi', blob);
          return;
        }
        // 3) Try with the current visual object source
        const vObjAlt = this.state.lastVisualObj || this.render(true);
        if (vObjAlt) {
          let res2 = ABCJS.midi.getMidiFile(vObjAlt, { midiOutputType: 'encoded', midiTranspose: this.getTotalTranspose() });
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
        const vObj = this.render(true, true);
        const synth = new ABCJS.synth.CreateSynth();
  await synth.init({ visualObj: vObj, options: { midiTranspose: this.getTotalTranspose() } });
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
    const wrapper = paper.parentElement;
    if (wrapper) {
      wrapper.style.height = '100%';
      wrapper.style.display = wrapper.style.display || 'flex';
      wrapper.style.flexDirection = wrapper.style.flexDirection || 'column';
    }
    paper.style.height = '100%';
    paper.style.display = paper.style.display || 'flex';
    paper.style.flexDirection = paper.style.flexDirection || 'column';
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
        svg.style.maxHeight = 'none';
        svg.style.display = 'block';
        const container = svg.closest('.abcjs-container');
        // Ensure viewBox exists for proper scaling
        if (!svg.getAttribute('viewBox')) {
          const bb = svg.getBBox();
          const w = Math.ceil(bb.width || svg.clientWidth || 1200);
          const h = Math.ceil(bb.height || svg.clientHeight || 400);
          svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
      } catch(_) {}
    });
    try { this.applyRenderScale(); } catch(_) {}
  };

  Viewer.applyRenderScale = function() {
    try {
      const paper = document.getElementById(this.state.paperId);
      if (!paper) return;
      const svgs = paper.querySelectorAll('svg');
      const pct = Math.max(20, Math.min(100, Number(this.state.renderScale || 60)));
      const maxPx = Math.round((window.innerHeight || 800) * (pct / 100));
      svgs.forEach(svg => {
        try {
          svg.style.maxHeight = maxPx + 'px';
        } catch(_) {}
      });
    } catch (e) { /* no-op */ }
  };

  global.ABCViewer = Viewer;
})(window);
