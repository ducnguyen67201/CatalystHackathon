import { afterEach, describe, expect, it, vi } from 'vitest';
import { pauseVoiceForInspection } from '../src/web/InspectionPause.js';

afterEach(() => vi.useRealTimers());
describe('reading an explanation during voice practice', () => {
  it.each([false, true])(
    'keeps June quiet and restores microphone mute=%s on resume',
    (isMuted) => {
      vi.useFakeTimers();
      const controls = {
        isMuted,
        setMuted: vi.fn(),
        setVolume: vi.fn(),
        sendUserActivity: vi.fn(),
      };
      const pause = pauseVoiceForInspection(controls);
      expect(controls.setMuted).toHaveBeenLastCalledWith(true);
      expect(controls.setVolume).toHaveBeenLastCalledWith({ volume: 0 });
      vi.advanceTimersByTime(5000);
      expect(controls.sendUserActivity).toHaveBeenCalledTimes(6);
      pause.resume();
      expect(controls.setMuted).toHaveBeenLastCalledWith(isMuted);
      expect(controls.setVolume).toHaveBeenLastCalledWith({ volume: 1 });
      vi.advanceTimersByTime(5000);
      expect(controls.sendUserActivity).toHaveBeenCalledTimes(6);
      pause.resume();
      expect(controls.setVolume).toHaveBeenCalledTimes(2);
    },
  );
  it('cleans up on disconnect without reopening the microphone or resuming audio', () => {
    vi.useFakeTimers();
    const controls = {
      isMuted: false,
      setMuted: vi.fn(),
      setVolume: vi.fn(),
      sendUserActivity: vi.fn(),
    };
    const pause = pauseVoiceForInspection(controls);
    pause.dispose();
    vi.advanceTimersByTime(10000);
    pause.resume();
    expect(controls.sendUserActivity).toHaveBeenCalledTimes(1);
    expect(controls.setMuted).toHaveBeenCalledTimes(1);
    expect(controls.setVolume).toHaveBeenCalledTimes(1);
  });
});
