import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkVoiceBrowserSupport } from '../src/web/VoiceBrowserSupport.js';

afterEach(() => vi.unstubAllGlobals());

function APIs() {
  vi.stubGlobal('AudioContext', function FakeAudioContext() {
    return {};
  });
  const getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return getUserMedia;
}

describe('voice browser preflight', () => {
  it('closes its probe without requesting microphone audio or a provider session', () => {
    const getUserMedia = APIs();
    const close = vi.fn();
    const createOffer = vi.fn();
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        close = close;
        createOffer = createOffer;
      },
    );
    expect(checkVoiceBrowserSupport()).toEqual({ supported: true, reason: null });
    expect(close).toHaveBeenCalledOnce();
    expect(createOffer).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('recognizes browsers that expose the API but reject construction', () => {
    const getUserMedia = APIs();
    vi.stubGlobal('RTCPeerConnection', function UnsupportedPeer() {
      throw new Error('Not supported');
    });
    expect(checkVoiceBrowserSupport()).toEqual({
      supported: false,
      reason: 'peer_connection_failed',
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('recognizes a missing microphone API before a token can be requested', () => {
    APIs();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('RTCPeerConnection', function FakePeer() {
      return {};
    });
    expect(checkVoiceBrowserSupport()).toEqual({ supported: false, reason: 'missing_api' });
  });
});
