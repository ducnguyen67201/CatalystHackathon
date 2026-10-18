/** SDK errors can contain URLs or credentials. Keep only recognized diagnostic categories. */
export function describeVoiceFailure(message: unknown) {
  const text = (
    typeof message === 'string' ? message : message instanceof Error ? message.message : ''
  ).toLowerCase();
  const connectionConfiguration =
    /rtcpeerconnection/.test(text) && /configuration|unsupported|not supported/.test(text);
  const signals = {
    microphone: /notallowed|permission|microphone|notfound|device/.test(text),
    network: /network|fetch|websocket|signal|connection|room|timeout/.test(text),
    authentication: /unauthorized|forbidden|401|403|token|authentication/.test(text),
    quota: /quota|credit|limit|subscription/.test(text),
    context: /dynamic|variable|override|prompt/.test(text),
    browser: /audiocontext|worklet|unsupported|not supported/.test(text),
  };
  return {
    signals,
    code: connectionConfiguration
      ? 'webrtc_configuration'
      : signals.microphone
        ? 'microphone'
        : signals.quota
          ? 'provider_limit'
          : signals.authentication
            ? 'authentication'
            : signals.context
              ? 'session_context'
              : signals.browser
                ? 'browser_audio'
                : signals.network
                  ? 'network'
                  : 'unknown',
    message: connectionConfiguration
      ? 'The browser rejected the voice connection configuration. Retry, or open this same practice link in Chrome.'
      : signals.microphone
        ? 'Microphone unavailable. Allow microphone access for this page and check your input device.'
        : signals.quota
          ? 'ElevenLabs rejected this session because of an account or usage limit.'
          : signals.authentication
            ? 'ElevenLabs rejected the connection credentials. Check the agent access settings.'
            : signals.context
              ? 'ElevenLabs rejected the session context. Check the agent’s dynamic variables.'
              : signals.browser
                ? 'The voice SDK could not initialize browser audio. Try this page in Chrome.'
                : signals.network
                  ? 'The voice connection failed. Check whether your network allows WebRTC audio.'
                  : 'Voice could not connect. Diagnostic categories are available in the browser console.',
  };
}
