export type VoiceBrowserSupport = {
  supported: boolean;
  reason: 'missing_api' | 'peer_connection_failed' | null;
};

function hasMicrophoneApi(devices: MediaDevices | undefined): boolean {
  return typeof devices?.getUserMedia === 'function';
}

/** Constructor presence alone is insufficient in embedded browsers. No offer or media is created. */
export function checkVoiceBrowserSupport(): VoiceBrowserSupport {
  if (
    typeof RTCPeerConnection === 'undefined' ||
    typeof AudioContext === 'undefined' ||
    !hasMicrophoneApi(typeof navigator === 'undefined' ? undefined : navigator.mediaDevices)
  )
    return { supported: false, reason: 'missing_api' };
  try {
    const peer = new RTCPeerConnection({ iceServers: [] });
    peer.close();
    return { supported: true, reason: null };
  } catch {
    return { supported: false, reason: 'peer_connection_failed' };
  }
}
