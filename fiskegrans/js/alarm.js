// Larmljud som syntetiseras med Web Audio – inga ljudfiler behövs offline.

export const SOUNDS = {
  pip: 'Pip',
  dubbelpip: 'Dubbelpip',
  klocka: 'Klocka',
  sonar: 'Sonar',
  siren: 'Siren',
  mjuk: 'Mjuk ton',
  klick: 'Klick',
};

let ctx = null;
let keepAlive = null;

/** Måste anropas från en användargest (knapptryck) – krav i iOS Safari. */
export async function unlockAudio() {
  // iOS 17+: spela även när ringknappen står på ljudlöst.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (_) { /* stöds ej */ }
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== 'running') await ctx.resume();
  // En tyst, oändlig källa håller ljudkontexten vaken mellan larmen.
  if (!keepAlive) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.00001;
    osc.connect(g).connect(ctx.destination);
    osc.start();
    keepAlive = osc;
  }
  return ctx.state;
}

export function audioState() {
  return ctx ? ctx.state : 'locked';
}

function tone(t0, { freq, dur, vol, type = 'sine', attack = 0.005, freqEnd = null }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.linearRampToValueAtTime(freqEnd, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Spelar ett ljud. volume 0–1. */
export function play(name, volume = 0.8) {
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume();
  const t = ctx.currentTime + 0.02;
  const v = Math.max(0, Math.min(1, volume));
  switch (name) {
    case 'pip':
      tone(t, { freq: 1000, dur: 0.18, vol: v, type: 'square' });
      break;
    case 'dubbelpip':
      tone(t, { freq: 1200, dur: 0.12, vol: v, type: 'square' });
      tone(t + 0.2, { freq: 1200, dur: 0.12, vol: v, type: 'square' });
      break;
    case 'klocka':
      [1, 2.76, 5.4].forEach((m, i) => tone(t, { freq: 660 * m, dur: 1.4 / (i + 1), vol: v / (i + 1.5), attack: 0.002 }));
      break;
    case 'sonar':
      tone(t, { freq: 1500, dur: 0.9, vol: v, attack: 0.003, freqEnd: 1350 });
      break;
    case 'siren':
      tone(t, { freq: 650, dur: 0.45, vol: v, type: 'sawtooth', freqEnd: 1300 });
      tone(t + 0.45, { freq: 1300, dur: 0.45, vol: v, type: 'sawtooth', freqEnd: 650 });
      break;
    case 'mjuk':
      tone(t, { freq: 440, dur: 0.8, vol: v * 0.8, attack: 0.15 });
      break;
    case 'klick':
      tone(t, { freq: 2200, dur: 0.04, vol: v, type: 'square', attack: 0.001 });
      break;
    default:
      tone(t, { freq: 880, dur: 0.2, vol: v });
  }
}

/** Vibration fungerar på Android men ignoreras av iOS Safari. */
export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
