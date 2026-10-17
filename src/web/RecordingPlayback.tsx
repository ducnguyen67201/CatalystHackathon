import { useEffect, useRef, useState } from 'react';
import {
  recordingPlaybackSchema,
  type RecordingPlayback as Playback,
} from '../contracts/RecordingPlayback.js';
import { request, startLocalSession } from './ApiClient.js';
import type { ReviewFinding } from './PracticeReviewTranscript.js';

export function waveformPeaks(channels: Float32Array[], count = 160): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const bins = Math.min(count, length);
  return Array.from({ length: bins }, (_, index) => {
    let peak = 0;
    for (const channel of channels) {
      const start = Math.floor((index * length) / bins);
      const end = Math.floor(((index + 1) * length) / bins);
      for (let sample = start; sample < end; sample++)
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
    }
    return Math.min(1, peak);
  });
}
export function playbackTurn(segments: Playback['segments'], seconds: number): number | null {
  return segments.findLast((segment) => segment.startSeconds <= seconds)?.turnIndex ?? null;
}
export const playbackTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function RecordingPlayback({
  sessionId,
  findings,
  turns,
  selection,
  onSeek,
  onActiveTurn,
  onFindingSelect,
  onTiming,
}: {
  sessionId: string | undefined;
  findings: ReviewFinding[];
  turns: { id: string; role: 'agent' | 'user' }[];
  selection: { turnIndex: number; requestId: number } | null;
  onSeek: (turnIndex: number) => void;
  onActiveTurn: (turnIndex: number | null) => void;
  onFindingSelect: (id: string) => void;
  onTiming: (segments: Playback['segments']) => void;
}) {
  const [metadata, setMetadata] = useState<Playback | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const player = useRef<HTMLAudioElement>(null);
  const abort = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const decoder = useRef<AudioContext | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (decoder.current && decoder.current.state !== 'closed')
        void decoder.current.close().catch(() => undefined);
    },
    [],
  );
  useEffect(() => {
    if (!selection) return;
    const segment = metadata?.segments.find((item) => item.turnIndex === selection.turnIndex);
    if (segment && player.current && segment.startSeconds <= duration) {
      player.current.currentTime = segment.startSeconds;
      setCurrent(segment.startSeconds);
    }
  }, [selection, metadata, duration]);
  async function load() {
    if (!sessionId) return;
    abort.current?.abort();
    const controller = new AbortController();
    const isCancelled = () => controller.signal.aborted;
    abort.current = controller;
    setLoading(true);
    setError('');
    try {
      const details = await request(
        `/rehearsals/${encodeURIComponent(sessionId)}/playback`,
        recordingPlaybackSchema,
        undefined,
        'GET',
      );
      if (isCancelled()) return;
      setMetadata(details);
      onTiming(details.segments);
      if (!details.available) return;
      const url = `/api/rehearsals/${encodeURIComponent(sessionId)}/recording`;
      let response = await fetch(url, { signal: controller.signal });
      if (response.status === 401) {
        await startLocalSession();
        response = await fetch(url, { signal: controller.signal });
      }
      if (!response.ok) throw new Error('Recording unavailable');
      const bytes = await response.arrayBuffer();
      if (isCancelled()) return;
      if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024)
        throw new Error('Recording size is unsupported');
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(
        new Blob([bytes], { type: response.headers.get('content-type') ?? 'audio/mpeg' }),
      );
      setSource(objectUrl.current);
      if (typeof AudioContext !== 'undefined') {
        const context = new AudioContext();
        decoder.current = context;
        try {
          const buffer = await context.decodeAudioData(bytes.slice(0));
          if (!isCancelled())
            setPeaks(
              waveformPeaks(
                Array.from({ length: buffer.numberOfChannels }, (_, index) =>
                  buffer.getChannelData(index),
                ),
              ),
            );
        } catch {
          if (!isCancelled())
            setError('Waveform could not be decoded. Use the audio controls to listen.');
        } finally {
          if (context.state !== 'closed') await context.close();
          decoder.current = null;
        }
      }
    } catch {
      if (!isCancelled())
        setError('Could not load the provider recording. Your transcript remains available.');
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }
  const seek = (seconds: number) => {
    if (!player.current || !duration) return;
    const position = Math.max(0, Math.min(duration, seconds));
    player.current.currentTime = position;
    setCurrent(position);
    const index = playbackTurn(metadata?.segments ?? [], position);
    if (index !== null) onSeek(index);
  };
  return (
    <section className="recording-player" aria-label="Recording waveform and playback">
      <header>
        <div>
          <h4>Recording</h4>
          <p>{metadata?.label ?? 'Load retained provider audio to inspect the waveform.'}</p>
        </div>
        {!source && (
          <button
            className="button secondary"
            disabled={!sessionId || loading}
            onClick={() => void load()}
          >
            {loading
              ? 'Loading recording…'
              : metadata && !metadata.available
                ? 'Check recording again'
                : 'Load recording'}
          </button>
        )}
      </header>
      {metadata?.reason && <p className="muted">{metadata.reason}</p>}
      {error && (
        <p role="status">
          {error}{' '}
          {!source && (
            <button className="text-button" disabled={loading} onClick={() => void load()}>
              Retry recording
            </button>
          )}
        </p>
      )}
      {source && (
        <>
          {peaks.length > 0 && (
            <button
              className="recording-waveform-button"
              aria-label="Seek using waveform position"
              onClick={(event) => {
                if (event.detail === 0) return;
                const box = event.currentTarget.getBoundingClientRect();
                seek(((event.clientX - box.left) / box.width) * duration);
              }}
            >
              <svg
                className="recording-waveform"
                viewBox="0 0 800 120"
                role="img"
                aria-label="Audio amplitude waveform. Use the seek slider or assessment markers below to navigate."
              >
                <line x1="0" y1="60" x2="800" y2="60" stroke="#dce1d5" />
                {peaks.map((peak, index) => (
                  <rect
                    key={index}
                    x={(index * 800) / peaks.length}
                    y={60 - peak * 48}
                    width={Math.max(1, 800 / peaks.length - 1)}
                    height={Math.max(1, peak * 96)}
                    rx="1"
                    fill={
                      index / peaks.length <= current / Math.max(1, duration)
                        ? '#42683b'
                        : '#a3b391'
                    }
                  />
                ))}
                {duration > 0 && (
                  <line
                    x1={(current / duration) * 800}
                    x2={(current / duration) * 800}
                    y1="6"
                    y2="114"
                    stroke="#34482b"
                    strokeWidth="2"
                  />
                )}
              </svg>
            </button>
          )}
          <label className="recording-seek">
            Seek recording{' '}
            <span>
              {playbackTime(current)} / {playbackTime(duration)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.1"
              value={Math.min(current, duration || 1)}
              disabled={!duration}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </label>
          <audio
            ref={player}
            controls
            preload="metadata"
            src={source}
            onLoadedMetadata={(event) =>
              setDuration(
                Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0,
              )
            }
            onTimeUpdate={(event) => {
              const seconds = event.currentTarget.currentTime;
              setCurrent(seconds);
              onActiveTurn(playbackTurn(metadata?.segments ?? [], seconds));
            }}
            onError={() =>
              setError(
                'Audio playback is unavailable in this browser. The transcript is still saved.',
              )
            }
          />
          <div className="recording-markers" aria-label="Assessment locations in recording">
            {findings.map((finding) => {
              const turnIndex = turns.findIndex((turn) => turn.id === finding.turnId);
              const segment = metadata?.segments.find((item) => item.turnIndex === turnIndex);
              return segment ? (
                <button
                  key={finding.id}
                  className={finding.kind}
                  onClick={() => onFindingSelect(finding.id)}
                >
                  {finding.kind === 'strength' ? '✓' : '↗'} Turn starts at{' '}
                  {playbackTime(segment.startSeconds)} · {finding.title}
                </button>
              ) : null;
            })}
          </div>
        </>
      )}
      {!metadata && (
        <p className="muted">
          Waveforms use actual audio samples. Sessions without a retained recording stay
          transcript-only.
        </p>
      )}
    </section>
  );
}
