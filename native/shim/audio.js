/* audio.js — el AudioContext que usa js/core/audio.js, sobre ps.au_* (native/audio.c).
 * Sólo lo que usa el juego: ganancia, oscilador, búfer, filtro, compresor, reverb ("convolver")
 * y la salida. Cada nodo guarda un asa de C: cuando el JS lo suelta, C lo libera al dejar de sonar.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  if (!ps.au_node) return;   // sin audio (no se pudo abrir la salida): el juego ya lo sabe llevar
  const N = { DEST: 0, GAIN: 1, OSC: 2, BUFSRC: 3, BIQUAD: 4, COMP: 5, REVERB: 6 };
  const WAVES = { sine: 0, square: 1, sawtooth: 2, triangle: 3 };
  const FILTERS = { lowpass: 0, highpass: 1, bandpass: 2 };
  const RATE = ps.AUDIO_RATE || 48000;

  // Un parámetro: no guarda el nodo (sólo su asa), así no hay ciclos que retrasen liberarlo.
  class AudioParam {
    constructor(h, i, def) { this._h = h; this._i = i; this.defaultValue = def; }
    get value() { return ps.au_value(this._h, this._i); }
    set value(v) { ps.au_param(this._h, this._i, 4, 0, +v); }
    setValueAtTime(v, t) { ps.au_param(this._h, this._i, 0, +t, +v); return this; }
    linearRampToValueAtTime(v, t) { ps.au_param(this._h, this._i, 1, +t, +v); return this; }
    exponentialRampToValueAtTime(v, t) { ps.au_param(this._h, this._i, 2, +t, +v); return this; }
    setTargetAtTime(v, t, tc) { ps.au_param(this._h, this._i, 3, +t, +v, +tc); return this; }
    cancelScheduledValues() { ps.au_param(this._h, this._i, 5, 0, 0); return this; }
    cancelAndHoldAtTime(t) { const v = this.value; this.cancelScheduledValues(); this.setValueAtTime(v, t); return this; }
  }
  // Los parámetros que no hacen nada aquí (knee, attack...): aceptan todo.
  const dummy = () => ({ value: 0, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
                         exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; }, cancelScheduledValues() { return this; } });

  class AudioNode {
    constructor(ctx, type) { this.context = ctx; this._h = ps.au_node(type); }
    connect(dest) {
      if (dest instanceof AudioParam) { ps.au_connect(this._h, dest._h, dest._i); return undefined; }
      if (dest && dest._h) ps.au_connect(this._h, dest._h, -1);
      return dest;
    }
    disconnect() { ps.au_disconnect(this._h); }
  }
  class GainNode extends AudioNode {
    constructor(ctx) { super(ctx, N.GAIN); }
    get gain() { return new AudioParam(this._h, 0, 1); }
  }
  class Source extends AudioNode {
    start(t = 0, offset = 0) { if (offset) ps.au_set(this._h, 4, +offset); ps.au_set(this._h, 2, +t); }
    stop(t = 0) { ps.au_set(this._h, 3, +t); }
  }
  class OscillatorNode extends Source {
    constructor(ctx) { super(ctx, N.OSC); this._type = 'sine'; this.onended = null; }
    get type() { return this._type; }
    set type(v) { if (v in WAVES) { this._type = v; ps.au_set(this._h, 0, WAVES[v]); } }
    get frequency() { return new AudioParam(this._h, 0, 440); }
    get detune() { return new AudioParam(this._h, 1, 0); }
  }
  class AudioBufferSourceNode extends Source {
    constructor(ctx) { super(ctx, N.BUFSRC); this._buf = null; this.loop = false; this.onended = null; }
    get buffer() { return this._buf; }
    set buffer(b) { this._buf = b; if (b) ps.au_buffer(this._h, b.getChannelData(0)); }
    get playbackRate() { return new AudioParam(this._h, 0, 1); }
    get detune() { return dummy(); }
  }
  class BiquadFilterNode extends AudioNode {
    constructor(ctx) { super(ctx, N.BIQUAD); this._type = 'lowpass'; }
    get type() { return this._type; }
    set type(v) { if (v in FILTERS) { this._type = v; ps.au_set(this._h, 1, FILTERS[v]); } }
    get frequency() { return new AudioParam(this._h, 0, 350); }
    get Q() { return new AudioParam(this._h, 1, 1); }
    get gain() { return dummy(); }
    get detune() { return dummy(); }
  }
  class DynamicsCompressorNode extends AudioNode {
    constructor(ctx) { super(ctx, N.COMP); this.knee = dummy(); this.attack = dummy(); this.release = dummy(); this.reduction = 0; }
    get threshold() { return new AudioParam(this._h, 0, -24); }
    get ratio() { return new AudioParam(this._h, 1, 12); }
  }
  // La reverb del juego: en C es algorítmica, la respuesta al impulso que se le dé no se usa.
  class ConvolverNode extends AudioNode {
    constructor(ctx) { super(ctx, N.REVERB); this.buffer = null; this.normalize = true; }
  }
  class AudioBuffer {
    constructor(channels, length, rate) {
      this.numberOfChannels = channels; this.length = length; this.sampleRate = rate; this.duration = length / rate;
      this._d = Array.from({ length: channels }, () => new Float32Array(length));
    }
    getChannelData(i) { return this._d[i]; }
  }

  let destination = null;
  class AudioContext {
    constructor() {
      this.sampleRate = RATE;
      this.state = 'running';
      this.onstatechange = null;
      if (!destination) destination = Object.assign(new AudioNode(this, N.DEST), { maxChannelCount: 2 });
      this.destination = destination;
    }
    get currentTime() { return ps.au_time(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return new GainNode(this); }
    createOscillator() { return new OscillatorNode(this); }
    createBufferSource() { return new AudioBufferSourceNode(this); }
    createBiquadFilter() { return new BiquadFilterNode(this); }
    createDynamicsCompressor() { return new DynamicsCompressorNode(this); }
    createConvolver() { return new ConvolverNode(this); }
    createBuffer(ch, len, rate) { return new AudioBuffer(ch, len, rate); }
    // Para grabar vídeos y el visualizador: aquí no hacen nada.
    createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect: d => d, disconnect() {},
                                getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); }, getFloatTimeDomainData(a) { a.fill(0); } }; }
    createMediaStreamDestination() { return { stream: null, connect: d => d, disconnect() {} }; }
    addEventListener() {} removeEventListener() {}
  }
  globalThis.AudioContext = AudioContext;
  globalThis.webkitAudioContext = AudioContext;
})();
