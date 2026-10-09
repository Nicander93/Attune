let context: AudioContext | undefined;
export function keySound(): void {
  try {
    context ??= new AudioContext();
    void context.resume();
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(650, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(180, context.currentTime + 0.025);
    gain.gain.setValueAtTime(0.012, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.035);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.04);
  } catch {
    /* Optional sound must not interrupt typing. */
  }
}
