// Tiny WebAudio synth for the game layer (ARCHITECTURE §5.13): no audio files, nothing fetched.
//
//   const sound = createSound({ enabled: () => app.settings.sound });
//   sound.play('whistle');   // a drill freezes
//   sound.play('star', { index: 0..2 }), sound.play('good'), sound.play('cheer'), sound.play('levelup')
//   sound.play('groan')      // Player mode "Who's open?": the pass is cut out (a crowd's low "ooh")
//   sound.play('lift')       // Player mode "Who's open?": the pass breaks a line (a short crowd lift)
//
// Player-mode rules (docs/KID_REDESIGN.md §5, R32): short event sounds only; nothing plays during Watch or Decide
// (the whistle marks the freeze); a sound never carries meaning on its own (the screen always says it too); the one
// mute setting (settings.sound) silences everything.
//
// The AudioContext is created on the first user gesture (browsers refuse to start one earlier) and only while
// sound is on. Every call is wrapped: a browser without WebAudio, a blocked context or a failed node never
// throws; play() just returns false. Volumes are modest (SOUND_DEFAULTS.volume on a master gain).

export const SOUND_DEFAULTS = Object.freeze({
  volume: 0.28, // [D] master gain
  whistle: Object.freeze({ freq: 2900, trillHz: 32, trillDepth: 190, length: 0.52, gain: 0.34, breath: 0.22 }), // [D]
  star: Object.freeze({ notes: Object.freeze([1318.5, 1568, 2093]), length: 0.2, gain: 0.26 }), // [D] E6, G6, C7
  good: Object.freeze({ notes: Object.freeze([1046.5, 1568]), gap: 0.11, length: 0.55, gain: 0.3 }), // [D] C6 then G6
  cheer: Object.freeze({ length: 1.7, swell: 0.4, gain: 0.34 }), // [D]
  levelup: Object.freeze({ notes: Object.freeze([523.25, 659.25, 783.99, 1046.5]), step: 0.09, hold: 0.45, gain: 0.22 }), // [D] C5 E5 G5 C6
  groan: Object.freeze({ length: 0.8, from: 620, to: 260, gain: 0.3, tone: 0.1 }), // [D] a falling crowd "ooh" (filter sweeps down)
  lift: Object.freeze({ length: 0.95, from: 600, to: 1500, swell: 0.35, gain: 0.3 }), // [D] a short rising crowd swell
});

export const SOUND_NAMES = Object.freeze(['whistle', 'star', 'good', 'cheer', 'levelup', 'groan', 'lift']);

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];

/**
 * @param {{ enabled?: () => boolean, volume?: number, win?: object }} [opts]
 *   win: where AudioContext and the gesture listeners live (default globalThis; tests pass a fake)
 * @returns {{ play(name: string, opts?: object): boolean, unlock(): boolean, readonly ready: boolean, destroy(): void }}
 */
export function createSound({ enabled = () => true, volume = SOUND_DEFAULTS.volume, win = globalThis } = {}) {
  const P = SOUND_DEFAULTS;
  let ctx = null, master = null, noise = null;
  let gestured = false;
  const isOn = () => { try { return !!enabled(); } catch { return false; } };

  /** Create (or wake) the context. Only after a user gesture, and only while sound is on. */
  function unlock() {
    if (!gestured || !isOn()) return false;
    try {
      if (!ctx) {
        const AC = win?.AudioContext ?? win?.webkitAudioContext;
        if (typeof AC !== 'function') return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume?.()?.catch?.(() => {});
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  const onGesture = () => {
    // A touch's pointerdown comes before the browser counts it as a gesture (that is its pointerup or touchend):
    // starting the context then only earns a console warning and a suspended context, so wait for the real one.
    const ua = win?.navigator?.userActivation;
    if (ua && !ua.isActive && !ua.hasBeenActive) return;
    gestured = true;
    if (unlock() && ctx?.state !== 'suspended') for (const t of GESTURES) win?.removeEventListener?.(t, onGesture, true);
  };
  for (const t of GESTURES) win?.addEventListener?.(t, onGesture, { capture: true, passive: true });

  function noiseBuffer() {
    if (noise) return noise;
    const len = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 12345; // deterministic white noise (no Math.random: the same cheer every time)
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) >>> 0; data[i] = (seed / 4294967296) * 2 - 1; }
    return noise;
  }

  /** A gain node with a simple envelope: 0 → peak (attack) → hold → 0 (release). */
  function envelope(t0, { peak, attack = 0.01, hold = 0, release = 0.2, exp = true }) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t0 + attack + hold);
    const end = t0 + attack + hold + release;
    if (exp) g.gain.exponentialRampToValueAtTime(0.0001, end);
    else g.gain.linearRampToValueAtTime(0.0001, end);
    return { node: g, end };
  }

  function tone(t0, { freq, type = 'sine', peak, attack, hold, release, out = master, detune = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune?.setValueAtTime(detune, t0);
    const env = envelope(t0, { peak, attack, hold, release });
    osc.connect(env.node);
    env.node.connect(out);
    osc.start(t0);
    osc.stop(env.end + 0.02);
    return osc;
  }

  function noiseBurst(t0, { length, filter = 'bandpass', freq, q = 1, out }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.setValueAtTime(q, t0);
    src.connect(f);
    f.connect(out);
    src.start(t0);
    src.stop(t0 + length + 0.05);
    return { src, filter: f };
  }

  const SYNTHS = {
    // A referee's whistle: a high tone trilled by the pea (frequency and loudness wobble together) plus breath.
    whistle(t0) {
      const W = P.whistle;
      const env = envelope(t0, { peak: W.gain, attack: 0.02, hold: W.length - 0.12, release: 0.1, exp: false });
      env.node.connect(master);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(W.freq, t0);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(W.trillHz, t0);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(W.trillDepth, t0);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const trem = ctx.createGain();
      trem.gain.setValueAtTime(0.75, t0);
      const tremDepth = ctx.createGain();
      tremDepth.gain.setValueAtTime(0.25, t0);
      lfo.connect(tremDepth);
      tremDepth.connect(trem.gain);
      osc.connect(trem);
      trem.connect(env.node);
      const breath = ctx.createGain();
      breath.gain.setValueAtTime(W.breath, t0);
      breath.connect(env.node);
      noiseBurst(t0, { length: W.length, freq: W.freq, q: 6, out: breath });
      for (const o of [osc, lfo]) { o.start(t0); o.stop(env.end + 0.02); }
    },
    // A soft tick per star, a step higher each time.
    star(t0, { index = 0 } = {}) {
      const S = P.star;
      const freq = S.notes[Math.max(0, Math.min(S.notes.length - 1, Math.round(index) || 0))];
      tone(t0, { freq, peak: S.gain, attack: 0.004, release: S.length });
      tone(t0, { freq: freq / 2, type: 'triangle', peak: S.gain * 0.25, attack: 0.004, release: S.length * 0.7 });
    },
    // A bright two-note ding (an A or an S).
    good(t0) {
      const G = P.good;
      G.notes.forEach((freq, i) => {
        const t = t0 + i * G.gap;
        tone(t, { freq, peak: G.gain, attack: 0.005, release: G.length });
        tone(t, { freq: freq * 2, peak: G.gain * 0.18, attack: 0.005, release: G.length * 0.5 });
      });
    },
    // A short crowd swell: two bands of noise that rise and fall, one of them fluttering like voices.
    cheer(t0) {
      const C = P.cheer;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.linearRampToValueAtTime(C.gain, t0 + C.swell);
      out.gain.linearRampToValueAtTime(C.gain * 0.75, t0 + C.length * 0.55);
      out.gain.linearRampToValueAtTime(0.0001, t0 + C.length);
      out.connect(master);
      noiseBurst(t0, { length: C.length, freq: 900, q: 0.7, out });
      const voices = ctx.createGain();
      voices.gain.setValueAtTime(0.5, t0);
      const flutter = ctx.createOscillator();
      flutter.type = 'sine';
      flutter.frequency.setValueAtTime(7, t0);
      const flutterDepth = ctx.createGain();
      flutterDepth.gain.setValueAtTime(0.3, t0);
      flutter.connect(flutterDepth);
      flutterDepth.connect(voices.gain);
      voices.connect(out);
      noiseBurst(t0, { length: C.length, freq: 2100, q: 1.4, out: voices });
      flutter.start(t0);
      flutter.stop(t0 + C.length + 0.05);
    },
    // A crowd's disappointed "ooh": voice-band noise whose filter falls, with a soft low tone falling under it.
    groan(t0) {
      const G = P.groan;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.linearRampToValueAtTime(G.gain, t0 + 0.08);
      out.gain.linearRampToValueAtTime(G.gain * 0.7, t0 + G.length * 0.6);
      out.gain.linearRampToValueAtTime(0.0001, t0 + G.length);
      out.connect(master);
      const { filter } = noiseBurst(t0, { length: G.length, freq: G.from, q: 2.2, out });
      filter.frequency.exponentialRampToValueAtTime?.(G.to, t0 + G.length);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(G.from / 2.5, t0);
      osc.frequency.exponentialRampToValueAtTime?.(G.to / 2.5, t0 + G.length);
      const env = envelope(t0, { peak: G.tone, attack: 0.06, hold: G.length * 0.4, release: G.length * 0.5 });
      osc.connect(env.node);
      env.node.connect(master);
      osc.start(t0);
      osc.stop(env.end + 0.02);
    },
    // A short crowd lift (a line broken): noise that swells while its band rises, then falls away.
    lift(t0) {
      const L = P.lift;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.linearRampToValueAtTime(L.gain, t0 + L.swell);
      out.gain.linearRampToValueAtTime(0.0001, t0 + L.length);
      out.connect(master);
      const { filter } = noiseBurst(t0, { length: L.length, freq: L.from, q: 0.9, out });
      filter.frequency.exponentialRampToValueAtTime?.(L.to, t0 + L.swell + 0.1);
    },
    // A quick rising arpeggio, the last note held.
    levelup(t0) {
      const L = P.levelup;
      L.notes.forEach((freq, i) => {
        const t = t0 + i * L.step;
        const last = i === L.notes.length - 1;
        tone(t, { freq, type: 'triangle', peak: L.gain, attack: 0.01, hold: last ? L.hold * 0.5 : 0.03, release: last ? L.hold : 0.12 });
        tone(t, { freq, type: 'square', peak: L.gain * 0.12, attack: 0.01, hold: last ? L.hold * 0.4 : 0.02, release: last ? L.hold * 0.7 : 0.1, detune: 5 });
      });
    },
  };

  /** Play one of SOUND_NAMES. @returns {boolean} true when it was scheduled */
  function play(name, opts = {}) {
    if (!isOn() || !SYNTHS[name]) return false;
    if (!ctx && !unlock()) return false;
    try {
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume?.()?.catch?.(() => {});
      SYNTHS[name](ctx.currentTime + 0.01, opts);
      return true;
    } catch {
      return false;
    }
  }

  return {
    play,
    unlock,
    get ready() { return !!ctx; },
    destroy() {
      for (const t of GESTURES) win?.removeEventListener?.(t, onGesture, true);
      try { ctx?.close?.()?.catch?.(() => {}); } catch { /* already closed */ }
      ctx = master = noise = null;
    },
  };
}
