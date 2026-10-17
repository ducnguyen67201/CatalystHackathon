/** SDK errors can contain URLs or credentials. Keep only recognized diagnostic categories. */
export function describeVoiceFailure(message: unknown) {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  const signals = {
    microphone: /notallowed|permission|microphone|notfound|device/.test(text),
    network: /network|fetch|websocket|signal|connection|room|timeout/.test(text),
    authentication: /unauthorized|forbidden|401|403|token|authentication/.test(text),
    quota: /quota|credit|limit|subscription/.test(text),
    context: /dynamic|variable|override|prompt/.test(text),
    browser: /audiocontext|worklet|unsupported|not supported|undefined/.test(text),
  };
  return {
    signals,
    message: signals.microphone
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
