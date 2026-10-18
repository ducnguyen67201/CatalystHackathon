import { describe, expect, it } from 'vitest';
import { describeVoiceFailure } from '../src/web/VoiceFailure.js';

describe('voice failure diagnostics', () => {
  it('classifies browser and permission failures separately', () => {
    expect(describeVoiceFailure('WebRTC not supported in this browser').signals.browser).toBe(true);
    expect(describeVoiceFailure('NotAllowedError: permission denied').message).toContain(
      'Microphone unavailable',
    );
    expect(describeVoiceFailure('quota exceeded').message).toContain('usage limit');
  });

  it('never includes raw provider error content in diagnostics or UI messages', () => {
    const result = describeVoiceFailure(
      'Failed to connect https://example.com/?token=private-token financial-context',
    );
    expect(result.signals.authentication).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('financial-context');
    expect(JSON.stringify(result)).not.toContain('example.com');
    expect(describeVoiceFailure({ secret: 'private-token' }).message).toContain(
      'Diagnostic categories',
    );
  });

  it('identifies a rejected WebRTC configuration without mislabeling it as audio initialization', () => {
    const result = describeVoiceFailure(
      new Error(
        'Could not establish connection: Failed RTCPeerConnection configuration unsupported',
      ),
    );
    expect(result.code).toBe('webrtc_configuration');
    expect(result.message).toContain('connection configuration');
    expect(result.message).not.toContain('initialize browser audio');
    expect(describeVoiceFailure('undefined is not a function').code).toBe('unknown');
  });
});
