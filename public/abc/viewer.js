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
      selectedIndex: -1,
      theme: { bg: '#ffffff', fg: '#000000' }
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
        const bpmFromAbc = this.parseTempoFromAbc(input ? input.value : '') || 120;
        this.state.currentTempo = bpmFromAbc;
        tempoSlider.value = String(bpmFromAbc);
        if (tempoLabel) tempoLabel.textContent = bpmFromAbc + ' BPM';
        const onTempoChange = async () => {
          const bpm = parseInt(tempoSlider.value, 10) || 120;
          this.state.currentTempo = bpm;
          if (tempoLabel) tempoLabel.textContent = bpm + ' BPM';
          // Update ABC Q: header in the editor to reflect tempo and re-render
          if (input) {
            input.value = this.setAbcTempo(input.value, bpm);
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

      // Initialize theme color pickers if present
      const bgPicker = q('paperBgColor');
      const fgPicker = q('inkColor');
      if (bgPicker) bgPicker.value = this.state.theme.bg;
      if (fgPicker) fgPicker.value = this.state.theme.fg;
      const onTheme = () => {
        const bg = (bgPicker && bgPicker.value) || this.state.theme.bg;
        const fg = (fgPicker && fgPicker.value) || this.state.theme.fg;
        this.setThemeColors(bg, fg);
      };
      if (bgPicker) bgPicker.addEventListener('input', onTheme);
      if (fgPicker) fgPicker.addEventListener('input', onTheme);
      // Apply defaults on load
      this.setThemeColors(this.state.theme.bg, this.state.theme.fg);
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
        const bpmFromAbc = this.parseTempoFromAbc(hit.abc) || this.state.currentTempo || 120;
        if (tempoSlider) tempoSlider.value = String(bpmFromAbc);
        if (tempoLabel) tempoLabel.textContent = bpmFromAbc + ' BPM';
        // Ensure ABC has Q header to match slider value for clarity
        input.value = this.setAbcTempo(input.value, bpmFromAbc);
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
        // Try forms like Q:1/4=120 or Q:120
        const m1 = line.match(/=(\d+)/);
        if (m1) return parseInt(m1[1], 10);
        const m2 = line.match(/^Q:\s*(\d+)/);
        if (m2) return parseInt(m2[1], 10);
      }
      return null;
    },

    setAbcTempo: function(abc, bpm) {
      if (!abc) return '';
      // Remove existing Q: lines including trailing newline
      let text = abc.replace(/^[ \t]*Q:\s*.*(?:\r?\n)?/gm, '');
      // Insert Q: after first K: line if present, else prepend
      const kMatch = text.match(/^(K:[^\n\r]*)/m);
      if (kMatch) {
        const kLine = kMatch[0];
        text = text.replace(kLine, kLine + `\nQ:${bpm}`);
      } else {
        text = `Q:${bpm}\n` + text;
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
      const soundFont = function(filename) {
        // Soundfont path (relative to site root). Copy MP3s to public/abcjs/soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/
        // Use a relative URL so it also works on subpaths.
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
        await this.ensureSynth(vObj);
        await this.state.synth.start();
        this.state.isPlaying = true;
        this.updatePlayButton();
      } catch (e) {
        console.error('Play failed:', e);
        alert('Playback failed. Ensure soundfonts exist under /abcjs/soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/.');
      }
    },

    stop: function() {
      try { if (this.state.synth) this.state.synth.stop(); } catch(_) {}
      this.state.isPlaying = false;
      this.updatePlayButton();
    },

    restartPlayback: async function() {
      try {
        const vObj = this.render(true);
        await this.ensureSynth(vObj);
        await this.state.synth.start();
        this.state.isPlaying = true;
        this.updatePlayButton();
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
        if (t.startsWith('Q:') && v.tempo === false) continue;
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
        const raw = input.value || 'X:1\nT:Example\nM:4/4\nL:1/8\nK:C\nCDEF GABc|';
        const norm = this.normalizeAbc(raw);
        const filtered = this.filterHeaders(norm);

        // Build render options; when a tablature layer is chosen, render staff + tab together in one pass
        const hasTab = this.state.layer && this.state.layer !== 'none';
        const tabSpec = hasTab ? this.instruments[this.state.layer] : null;
        const baseOpts = { responsive: 'resize', add_classes: true, visualTranspose: this.state.vt, wrap: { preferredMeasuresPerLine: 5 } };
        const renderOpts = hasTab && tabSpec ? { ...baseOpts, tablature: [tabSpec] } : baseOpts;
        // Optionally strip chord symbols when rendering tabs for a cleaner layout
        const abcToRender = (hasTab && this.state.stripChordsForTabs) ? this.simplifyForTab(filtered) : filtered;
        const v = ABCJS.renderAbc(this.state.paperId, abcToRender, renderOpts);
        this.state.lastVisualObj = v && v[0];
        try { this.updateKeyLabel(filtered); } catch(_) {}
        try { this.applyThemeInline(); } catch(_) {}
        try { this.ensureResponsiveSvgs(); } catch(_) {}
        try { this.updatePaperHeight(); } catch(_) {}

        if (returnVisualObj) return this.state.lastVisualObj;
      } catch (e) {
        console.error('ABC render failed:', e);
      }
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
      if (ABCJS?.midi?.getMidiFile) {
        const dataUrl = ABCJS.midi.getMidiFile(abc);
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:audio/midi')) {
          const fname = this.sanitizeFilename(this.getCurrentTitle(abc), 'tune') + '.mid';
          this.download(fname, 'audio/midi', dataUrl);
          return;
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
