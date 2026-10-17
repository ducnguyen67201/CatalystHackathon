interface VoiceControls {
  isMuted: boolean;
  setMuted(muted: boolean): void;
  setVolume(options: { volume: number }): void;
  sendUserActivity(): void;
}

/** Activity signals hold the agent's turn while the microphone and playback are quiet. */
export function pauseVoiceForInspection(controls: VoiceControls) {
  const wasMuted = controls.isMuted;
  controls.sendUserActivity();
  controls.setVolume({ volume: 0 });
  controls.setMuted(true);
  const timer = setInterval(() => controls.sendUserActivity(), 1000);
  let stopped = false;
  return {
    resume() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      controls.setVolume({ volume: 1 });
      controls.setMuted(wasMuted);
    },
    dispose() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
