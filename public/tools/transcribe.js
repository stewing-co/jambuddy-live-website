// Live transcription for the Chord Browser "Transcribe" tab.
// Consumes JBDetectEngine frames -> segments melody notes + chord changes ->
// quantizes to 16ths -> builds ABC (rendered via abcjs). Port of the Android
// LiveNotationEngine + LiveNotationRenderer.
(function () {
  'use strict';

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FLAT_ROOTS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

  function preferSharpsForKey(key) {
    if (!key) return true;
    const m = key.match(/^([A-G][#b]?)/);
    return !(m && FLAT_ROOTS.has(m[1]));
  }

  // MIDI -> ABC pitch token (port of midiToAbcPitch).
  function midiToAbc(midi, preferSharps) {
    const pc = ((midi % 12) + 12) % 12;
    const nm = (preferSharps ? SHARP : FLAT)[pc];
    const letter = nm[0];
    const acc = nm.slice(1);
    const accSym = acc === '#' ? '^' : acc === 'b' ? '_' : '';
    const octave = Math.floor(midi / 12) - 1;
    const diff = octave - 4;
    let base, suffix;
    if (diff < 0) { base = letter.toUpperCase(); suffix = ','.repeat(-diff); }
    else if (diff === 0) { base = letter.toUpperCase(); suffix = ''; }
    else if (diff === 1) { base = letter.toLowerCase(); suffix = ''; }
    else { base = letter.toLowerCase(); suffix = "'".repeat(diff - 1); }
    return accSym + base + suffix;
  }

  function meterUnits(meter) {
    const m = (meter || '4/4').split('/');
    const num = parseInt(m[0], 10) || 4;
    const den = parseInt(m[1], 10) || 4;
    return Math.max(1, Math.round(num * (16 / den)));
  }

  function init() {
    const els = {
      start: document.getElementById('tx-start'),
      clear: document.getElementById('tx-clear'),
      cleanup: document.getElementById('tx-cleanup'),
      bpm: document.getElementById('tx-bpm'),
      meter: document.getElementById('tx-meter'),
      key: document.getElementById('tx-key'),
      paper: document.getElementById('tx-paper'),
      timeline: document.getElementById('tx-timeline'),
      addNote: document.getElementById('tx-add-note'),
      addRest: document.getElementById('tx-add-rest'),
      abc: document.getElementById('tx-abc'),
      status: document.getElementById('tx-status'),
      crepe: document.getElementById('tx-crepe'),
      modeBtns: Array.from(document.querySelectorAll('[data-tx-mode]'))
    };
    if (!els.start || !els.paper || els.start.dataset.txInit === '1') return;
    els.start.dataset.txInit = '1';

    const engine = window.JBDetectEngine;
    const state = {
      mode: 'both',
      capturing: false,
      events: [],        // {midi|null, durMs, chord}
      active: null,      // {midi|null, startMs, chord}
      pendingMidi: undefined,
      pendingFrames: 0,
      lastChord: null,   // last non-null chord seen
      lastEmittedChordForActive: null,
      bpm: 120,
      meter: '4/4',
      key: '',
      keyEdited: false,
      abcDirty: false,   // user edited the ABC box
      dirty: false,
      sel: -1,           // index of the note open in the editor popup
      onsetPending: false // a re-attack was detected; split at next confirmed pitch
    };

    function includesMelody() { return state.mode === 'both' || state.mode === 'melody'; }
    function includesChords() { return state.mode === 'both' || state.mode === 'chords'; }

    function sixteenthMs() { return 60000 / Math.max(40, Math.min(240, state.bpm)) / 4; }

    function flushActive(endMs) {
      if (!state.active) return;
      const durMs = Math.max(1, endMs - state.active.startMs);
      // durUnits (16th-note units) is the editable musical length and maps
      // directly to the ABC duration; durMs is kept for blip cleanup.
      state.events.push({ midi: state.active.midi, durMs, durUnits: quantize(durMs), chord: state.active.chord });
      state.active = null;
      state.dirty = true;
    }

    function onFrame(frame) {
      if (!state.capturing) return;
      if (frame.chord) state.lastChord = frame.chord;
      if (!state.keyEdited && frame.key) { state.key = frame.key; els.key.value = frame.key; }

      let cur; // the value the active segment should hold this frame
      let annot = includesChords() ? state.lastChord : null;

      if (includesMelody()) {
        // Latch a re-attack; apply it once the pitch settles (the transient
        // frame's pitch can be noisy, so onset and the confirmed pitch may
        // land on different frames).
        if (frame.onset) state.onsetPending = true;
        const midi = frame.pitch ? frame.pitch.midi : null;
        // Stability gate: confirm a value over 2 frames before acting.
        if (midi === state.pendingMidi) state.pendingFrames++;
        else { state.pendingMidi = midi; state.pendingFrames = 1; }
        if (state.pendingFrames < 2) return;
        cur = midi; // may be null (rest)
      } else {
        // Chords-only: each chord change is a rest segment carrying the chord.
        cur = null;
        if (!frame.chord) return;
      }

      // A re-attack on the SAME pitch should still start a new note.
      const reAttack = state.onsetPending && cur != null;

      if (!state.active) {
        state.active = { midi: cur, startMs: frame.time, chord: annot };
        state.onsetPending = false;
      } else if (state.active.midi !== cur || reAttack || (!includesMelody() && annot !== state.active.chord)) {
        flushActive(frame.time);
        state.active = { midi: cur, startMs: frame.time, chord: annot };
        state.onsetPending = false;
      }
    }

    // ---- ABC assembly ----
    function quantize(durMs) {
      const sixteenthMs = 60000 / Math.max(40, Math.min(240, state.bpm)) / 4;
      return Math.max(1, Math.round(durMs / sixteenthMs));
    }

    function buildAbc() {
      const preferSharps = preferSharpsForKey(state.key);
      const mUnits = meterUnits(state.meter);
      const keyHeader = (state.key || 'C').replace(/\s+(major|minor)$/i, (s, q) => (q.toLowerCase() === 'minor' ? 'm' : ''));
      const lines = [
        'X:1',
        'T:Live Transcription',
        'M:' + (state.meter || '4/4'),
        'L:1/16',
        'Q:1/4=' + Math.round(state.bpm),
        'K:' + (keyHeader || 'C')
      ];
      let body = '';
      let unitsInMeasure = 0;
      let measures = 0;
      let lastChord = null;

      const emitBar = () => {
        body += ' |';
        unitsInMeasure = 0;
        measures++;
        if (measures % 4 === 0) body += '\n';
      };

      state.events.forEach((ev) => {
        let units = ev.durUnits || quantize(ev.durMs);
        const token = ev.midi == null ? 'z' : midiToAbc(ev.midi, preferSharps);
        if (ev.chord && ev.chord !== lastChord && ev.midi != null) {
          body += ' "' + ev.chord + '"';
          lastChord = ev.chord;
        } else if (ev.chord && ev.chord !== lastChord && ev.midi == null) {
          body += ' "' + ev.chord + '"';
          lastChord = ev.chord;
        }
        // Split across barlines with ties for pitched notes.
        while (units > 0) {
          const avail = mUnits - unitsInMeasure;
          const take = Math.min(units, avail);
          body += ' ' + token + (take !== 1 ? take : '');
          units -= take;
          unitsInMeasure += take;
          if (units > 0 && ev.midi != null) body += '-';
          if (unitsInMeasure >= mUnits) emitBar();
        }
      });

      return lines.join('\n') + '\n' + body.trim();
    }

    function noteName(midi) {
      const pc = ((midi % 12) + 12) % 12;
      return SHARP[pc] + (Math.floor(midi / 12) - 1);
    }

    // Editable timeline: one cell per detected segment, strongest-frequency
    // note name shown, retune with ▲/▼, delete with ✕. The ABC + sheet are
    // generated from whatever the timeline holds after edits.
    function renderTimeline() {
      if (!els.timeline) return;
      els.timeline.innerHTML = '';
      if (!state.events.length) {
        els.timeline.innerHTML = '<span class="tool-hint">No notes captured yet — press Record and play a melody.</span>';
        return;
      }
      state.events.forEach((ev, i) => {
        const cell = document.createElement('div');
        cell.className = 'tx-cell' + (ev.midi == null ? ' is-rest' : '') + (i === state.sel ? ' is-selected' : '');
        cell.dataset.i = String(i);
        const units = ev.durUnits || 1;
        cell.style.width = Math.max(34, Math.min(120, 14 + units * 6)) + 'px';
        const label = ev.midi == null ? '—' : noteName(ev.midi);
        cell.innerHTML =
          '<div class="tx-cell-chord">' + (ev.chord || '') + '</div>' +
          '<div class="tx-cell-note">' + label + '</div>' +
          '<div class="tx-cell-len">' + units + '</div>';
        els.timeline.appendChild(cell);
      });
    }

    let abcjsWarned = false;
    // Paint with a FIXED staffwidth/scale (no responsive:'resize'). Responsive
    // mode + the CSS width:100% formed a feedback loop that re-inflated the
    // staff on every re-render ("getting larger as time passes").
    function paintAbc(abc) {
      if (window.ABCJS && window.ABCJS.renderAbc) {
        const w = Math.max(320, (els.paper.clientWidth || 700) - 8);
        try {
          const v = window.ABCJS.renderAbc('tx-paper', abc, { staffwidth: w, scale: 0.85, add_classes: false, wrap: { minSpacing: 1.6, maxSpacing: 2.6, preferredMeasuresPerLine: 4 } });
          state.visualObj = v && v[0];
        } catch (_) {}
      } else if (!abcjsWarned) {
        abcjsWarned = true;
        els.paper.textContent = 'Sheet renderer (abcjs) is still loading…';
      }
    }

    // ---- MIDI playback (abcjs synth) ----
    let synthControl = null;
    function initSynth() {
      if (synthControl) return;
      if (!(window.ABCJS && ABCJS.synth && ABCJS.synth.supportsAudio && ABCJS.synth.supportsAudio())) return;
      try {
        synthControl = new ABCJS.synth.SynthController();
        synthControl.load('#tx-audio', null, { displayPlay: true, displayProgress: true });
      } catch (_) { synthControl = null; }
    }
    function updateSynth(force) {
      initSynth();
      if (!synthControl || !state.visualObj) return;
      // setTune re-primes the audio buffers, so only refresh when not actively
      // capturing (otherwise the 600 ms re-render would thrash playback).
      if (state.capturing && !force) return;
      // Only let the synth play chord accompaniment when chords were actually
      // captured — otherwise (melody mode) abcjs would invent chords.
      const hasChords = state.events.some((e) => e.chord);
      try { synthControl.setTune(state.visualObj, false, { chordsOff: !hasChords }); } catch (_) {}
    }
    function stopSynth() { if (synthControl) { try { synthControl.pause(); } catch (_) {} } }

    function render() {
      renderTimeline();
      if (state.abcDirty) return; // user is editing the ABC box; don't clobber
      const abc = buildAbc();
      els.abc.value = abc;
      paintAbc(abc);
      if (!state.capturing) updateSynth(); // load the current tune for MIDI playback
    }

    // ---- Cleanup pass (blip removal, merge, trim) ----
    function cleanup() {
      flushActive(performance.now());
      const sixteenthMs = 60000 / Math.max(40, Math.min(240, state.bpm)) / 4;
      const blipMax = Math.min(160, Math.max(70, sixteenthMs * 0.75));
      // 1) short pitched blips -> rests
      let evs = state.events.map((e) => (e.midi != null && e.durMs <= blipMax ? { midi: null, durMs: e.durMs, durUnits: e.durUnits, chord: e.chord } : e));
      // 2) merge consecutive same-pitch (and same-rest) events
      const merged = [];
      evs.forEach((e) => {
        const last = merged[merged.length - 1];
        if (last && last.midi === e.midi) { last.durMs += e.durMs; last.durUnits += (e.durUnits || 0); if (!last.chord) last.chord = e.chord; }
        else merged.push({ midi: e.midi, durMs: e.durMs, durUnits: e.durUnits || quantize(e.durMs), chord: e.chord });
      });
      // 3) trim leading/trailing rests
      while (merged.length && merged[0].midi == null) merged.shift();
      while (merged.length && merged[merged.length - 1].midi == null) merged.pop();
      state.events = merged;
      state.abcDirty = false;
      render();
    }

    // ---- Controls ----
    function setMode(mode) {
      state.mode = mode;
      els.modeBtns.forEach((b) => b.classList.toggle('tool-btn-primary', b.dataset.txMode === mode));
    }

    function start() {
      if (!engine) { els.status.textContent = 'Detection engine failed to load.'; return; }
      stopSynth();          // don't keep playing the previous take while recording
      state.capturing = true;
      state.abcDirty = false;
      els.abc.classList.remove('tool-edited');
      engine.addListener(onFrame);
      engine.start().then((ok) => {
        if (!ok) { els.status.textContent = 'Microphone unavailable: ' + (engine.lastError || 'permission denied') + '.'; stop(); return; }
        els.start.textContent = '⏸ Pause';
        els.start.classList.add('tool-btn-active');
        els.status.textContent = 'Capturing ' + state.mode + '… play into the mic.';
      });
    }

    function stop() {
      state.capturing = false;
      if (engine) { engine.removeListener(onFrame); engine.stop(); }
      flushActive(performance.now());
      els.start.textContent = '● Record';
      els.start.classList.remove('tool-btn-active');
      render();
    }

    function clearAll() {
      state.events = [];
      state.active = null;
      state.lastChord = null;
      state.pendingMidi = undefined;
      state.pendingFrames = 0;
      state.onsetPending = false;
      state.abcDirty = false;
      els.abc.classList.remove('tool-edited');
      stopSynth();          // halt any current playback
      render();
      updateSynth(true);    // force-load the now-empty tune so play has nothing
      els.status.textContent = 'Cleared.';
    }

    // --- Note editor popup ---
    const editor = document.createElement('div');
    editor.className = 'tx-editor';
    editor.hidden = true;
    editor.innerHTML =
      '<div class="tx-editor-hd"><span id="tx-ed-note">—</span><button class="tx-cell-btn" data-act="close" title="Done">✕</button></div>' +
      '<div class="tx-editor-row"><span class="tx-editor-lbl">Pitch</span>' +
        '<button class="tool-btn tool-btn-ghost" data-act="down" title="Down a semitone">▼</button>' +
        '<button class="tool-btn tool-btn-ghost" data-act="up" title="Up a semitone">▲</button></div>' +
      '<div class="tx-editor-row"><span class="tx-editor-lbl">Length</span>' +
        '<button class="tool-btn tool-btn-ghost" data-act="len-" title="Shorter">–</button>' +
        '<span id="tx-ed-units">4</span>' +
        '<button class="tool-btn tool-btn-ghost" data-act="len+" title="Longer">+</button>' +
        '<span class="tx-editor-lbl">/16</span></div>' +
      '<div class="tx-editor-row">' +
        '<button class="tool-btn tool-btn-ghost" data-act="rest">Toggle rest</button>' +
        '<button class="tool-btn tool-btn-ghost" data-act="ins">Insert after</button>' +
        '<button class="tool-btn tool-btn-ghost tx-cell-del" data-act="del">Delete</button></div>';
    document.body.appendChild(editor);
    const edNote = editor.querySelector('#tx-ed-note');
    const edUnits = editor.querySelector('#tx-ed-units');

    function positionEditor() {
      const cell = els.timeline.querySelector('.tx-cell[data-i="' + state.sel + '"]');
      if (!cell) { closeEditor(); return; }
      editor.hidden = false; // make it measurable
      const r = cell.getBoundingClientRect();
      const ew = editor.offsetWidth || 200;
      const eh = editor.offsetHeight || 140;
      let left = Math.max(8, Math.min(window.innerWidth - ew - 8, r.left + r.width / 2 - ew / 2));
      let top = r.bottom + 6;
      if (top + eh > window.innerHeight - 8) top = Math.max(8, r.top - eh - 6);
      editor.style.left = left + 'px';
      editor.style.top = top + 'px';
    }

    function refreshEditor() {
      const ev = state.events[state.sel];
      if (!ev) { closeEditor(); return; }
      edNote.textContent = ev.midi == null ? 'Rest' : noteName(ev.midi);
      edUnits.textContent = String(ev.durUnits || 1);
    }

    function openEditor(i) {
      if (i < 0 || i >= state.events.length) return;
      state.sel = i;
      refreshEditor();
      renderTimeline();   // apply selection highlight
      positionEditor();
    }

    function closeEditor() {
      editor.hidden = true;
      if (state.sel !== -1) { state.sel = -1; renderTimeline(); }
    }

    // Click a compact cell to open its editor popup.
    if (els.timeline) {
      els.timeline.addEventListener('click', (e) => {
        const cell = e.target.closest('.tx-cell');
        if (!cell) return;
        // Stop this click reaching the document-level outside-close handler,
        // which would otherwise immediately dismiss the popup we're opening
        // (the clicked cell is detached when the timeline re-renders).
        e.stopPropagation();
        openEditor(Number(cell.dataset.i));
      });
    }

    editor.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'close') { closeEditor(); return; }
      const ev = state.events[state.sel];
      if (!ev) { closeEditor(); return; }
      if (act === 'del') {
        state.events.splice(state.sel, 1);
        state.abcDirty = false; els.abc.classList.remove('tool-edited');
        closeEditor(); render(); return;
      }
      if (act === 'up') ev.midi = ev.midi == null ? 60 : Math.min(96, ev.midi + 1);
      else if (act === 'down') ev.midi = ev.midi == null ? 60 : Math.max(24, ev.midi - 1);
      else if (act === 'len-') { ev.durUnits = Math.max(1, (ev.durUnits || 1) - 1); ev.durMs = ev.durUnits * sixteenthMs(); }
      else if (act === 'len+') { ev.durUnits = Math.min(64, (ev.durUnits || 1) + 1); ev.durMs = ev.durUnits * sixteenthMs(); }
      else if (act === 'rest') ev.midi = ev.midi == null ? 60 : null;
      else if (act === 'ins') {
        const u = 4;
        state.events.splice(state.sel + 1, 0, { midi: ev.midi == null ? 60 : ev.midi, durUnits: u, durMs: u * sixteenthMs(), chord: null });
      }
      state.abcDirty = false; els.abc.classList.remove('tool-edited');
      render();              // rebuild timeline + ABC from the edit
      refreshEditor();
      positionEditor();
    });

    // Dismiss the popup on outside click or Escape.
    document.addEventListener('click', (e) => {
      if (editor.hidden) return;
      if (editor.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.tx-cell')) return;
      closeEditor();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editor.hidden) closeEditor(); });

    function appendEvent(midi) {
      const u = 4;
      state.events.push({ midi, durUnits: u, durMs: u * sixteenthMs(), chord: null });
      state.abcDirty = false;
      els.abc.classList.remove('tool-edited');
      render();
    }
    if (els.addNote) els.addNote.addEventListener('click', () => appendEvent(60));
    if (els.addRest) els.addRest.addEventListener('click', () => appendEvent(null));

    els.start.addEventListener('click', () => (state.capturing ? stop() : start()));
    els.clear.addEventListener('click', clearAll);
    els.cleanup.addEventListener('click', () => { cleanup(); els.status.textContent = 'Cleanup applied.'; });
    els.modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.txMode)));
    els.bpm.addEventListener('change', () => { state.bpm = Math.max(40, Math.min(240, Number(els.bpm.value) || 120)); render(); });
    els.meter.addEventListener('change', () => { state.meter = els.meter.value; render(); });
    els.key.addEventListener('input', () => { state.keyEdited = true; state.key = els.key.value; render(); });
    els.abc.addEventListener('input', () => {
      state.abcDirty = true;
      els.abc.classList.add('tool-edited');
      paintAbc(els.abc.value);
    });

    if (els.crepe) {
      els.crepe.addEventListener('click', async () => {
        if (!window.JBCrepe) { els.status.textContent = 'CREPE module not loaded.'; return; }
        if (window.JBCrepe.ready) { engine.useCrepe = !engine.useCrepe; els.crepe.classList.toggle('tool-btn-active', engine.useCrepe); els.status.textContent = engine.useCrepe ? 'CREPE pitch ON.' : 'CREPE pitch OFF (using YIN).'; return; }
        els.crepe.disabled = true;
        const ok = await window.JBCrepe.load((s) => { els.status.textContent = s; });
        els.crepe.disabled = false;
        if (ok) { engine.useCrepe = true; els.crepe.classList.add('tool-btn-active'); els.crepe.textContent = 'CREPE pitch: ON'; els.status.textContent = 'CREPE ready — neural melody pitch active.'; }
        else { els.status.textContent = 'CREPE failed: ' + (window.JBCrepe.error || 'unknown') + '. Still using YIN.'; }
      });
    }

    // Periodic re-render while capturing so the sheet grows live.
    setInterval(() => { if (state.capturing && state.dirty) { state.dirty = false; render(); } }, 600);

    setMode('both');
    render();

    document.addEventListener('jb-tab-change', (e) => {
      if (e.detail && e.detail.tab !== 'transcribe' && state.capturing) {
        stop();
        els.status.textContent = 'Paused (left Transcribe tab).';
      }
    });
    window.addEventListener('pagehide', () => { if (state.capturing) stop(); });
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
