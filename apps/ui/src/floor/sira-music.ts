/**
 * Music for the sıra gecesi, made in the browser: a plucked line in a hicaz
 * scale over a hand-drum pattern. It is a short loop written for this app,
 * not a recording and not anyone's song.
 */
let context: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let master: GainNode | null = null;

// D hicaz: D E♭ F♯ G A B♭ C D, as frequencies from D4.
const SCALE = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33];
// Sixteen eighth-notes: steps of the scale, -1 for a rest.
const LINE = [0, 1, 2, 1, 0, -1, 2, 3, 4, 3, 2, 1, 2, -1, 1, 0, 4, 5, 4, 3, 2, 3, 4, -1, 7, 6, 5, 4, 3, 2, 1, 0];
// Düm and tek over eight eighths.
const DRUM = ["d", "", "t", "t", "d", "", "t", ""];
const EIGHTH = 0.3;

function pluck(at: number, frequency: number): void {
  const osc = context!.createOscillator();
  const filter = context!.createBiquadFilter();
  const gain = context!.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = frequency;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2600, at);
  filter.frequency.exponentialRampToValueAtTime(500, at + 0.25);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.22, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
  osc.connect(filter).connect(gain).connect(master!);
  osc.start(at);
  osc.stop(at + 0.45);
}

function drum(at: number, kind: string): void {
  const gain = context!.createGain();
  gain.connect(master!);
  if (kind === "d") {
    const osc = context!.createOscillator();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(55, at + 0.16);
    gain.gain.setValueAtTime(0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 0.25);
    return;
  }
  const length = Math.floor(context!.sampleRate * 0.06);
  const buffer = context!.createBuffer(1, length, context!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const noise = context!.createBufferSource();
  const filter = context!.createBiquadFilter();
  noise.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = 2200;
  gain.gain.value = 0.25;
  noise.connect(filter).connect(gain);
  noise.start(at);
}

export function startSiraMusic(): void {
  if (timer) return;
  try {
    // A quiet night, for whoever wants the gathering without the tune.
    if (localStorage.getItem("losperitos.sira.sound") === "off") return;
  } catch {
    // No storage: play.
  }
  try {
    context ??= new AudioContext();
  } catch {
    return; // No sound here: the night goes on without it.
  }
  void context.resume();
  master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);
  let step = 0;
  let next = context.currentTime + 0.1;
  const fill = () => {
    while (next < context!.currentTime + 0.6) {
      const note = LINE[step % LINE.length]!;
      if (note >= 0) pluck(next, SCALE[note]!);
      const beat = DRUM[step % DRUM.length]!;
      if (beat) drum(next, beat);
      step++;
      next += EIGHTH;
    }
  };
  fill();
  timer = setInterval(fill, 200);
}

export function stopSiraMusic(): void {
  clearInterval(timer);
  timer = undefined;
  if (master && context) {
    const fading = master;
    fading.gain.setTargetAtTime(0, context.currentTime, 0.15);
    setTimeout(() => fading.disconnect(), 800);
  }
  master = null;
}
