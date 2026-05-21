import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, VolumeX, Settings, ListMusic,
  Maximize2, X, Film,
} from 'lucide-react';
import { useMediaPlayer } from '../../hooks/useMediaPlayer';
import QueuePanel from './QueuePanel';

function formatTime(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const SPEEDS = [0.5, 1, 1.5, 2];

export default function MediaPlayer() {
  const {
    state,
    setPlaying, skipNext, skipPrev, _trackEnded,
    setVolume, setPlaybackRate, toggleQueue,
  } = useMediaPlayer();

  const { queue, currentIndex, isPlaying, volume, playbackRate, isQueueOpen } = state;

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // currentTime and duration are local — keeping them out of global context
  // prevents all useMediaPlayer() consumers from re-rendering on every timeupdate (~4×/sec)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const currentItem = currentIndex >= 0 ? queue[currentIndex] : null;
  const isVideo = currentItem?.mediaType === 'video';

  const activeRef = isVideo ? videoRef : audioRef;

  const progress = useMemo(() => {
    const t = isDragging ? dragTime : currentTime;
    return duration > 0 ? (t / duration) * 100 : 0;
  }, [isDragging, dragTime, currentTime, duration]);

  // Load media when item changes
  useEffect(() => {
    const el = activeRef.current;
    if (!el || !currentItem) return;
    el.src = currentItem.url;
    el.volume = volume;
    el.playbackRate = playbackRate;
    setCurrentTime(0);
    setDuration(0);
    el.load();
    if (isPlaying) {
      el.play().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.id]);

  // Sync play/pause
  useEffect(() => {
    const el = activeRef.current;
    if (!el || !currentItem) return;
    if (isPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, currentItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  // Sync playback rate
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const handleMediaTimeUpdate = useCallback((el: HTMLMediaElement) => {
    setCurrentTime(el.currentTime);
    if ('mediaSession' in navigator && el.duration > 0) {
      navigator.mediaSession.setPositionState({ duration: el.duration, position: el.currentTime, playbackRate });
    }
  }, [playbackRate]);

  const handleMediaDurationChange = useCallback((el: HTMLMediaElement) => {
    if (el.duration && isFinite(el.duration)) setDuration(el.duration);
  }, []);

  // Restart track if > 3s in, otherwise go to previous — handled here
  // because currentTime is local state (not in context)
  const handleSkipPrev = useCallback(() => {
    if (currentTime > 3 || currentIndex <= 0) {
      const el = activeRef.current;
      if (el) el.currentTime = 0;
      setCurrentTime(0);
    } else {
      skipPrev();
    }
  }, [currentTime, currentIndex, skipPrev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Media session API
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentItem) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: currentItem.name, artist: 'Local Media' });
    navigator.mediaSession.setActionHandler('play', () => setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', skipNext);
    navigator.mediaSession.setActionHandler('previoustrack', handleSkipPrev);
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
    };
  }, [currentItem?.id, setPlaying, skipNext, handleSkipPrev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Body padding when player is visible
  useEffect(() => {
    if (currentItem) {
      document.body.classList.add('pb-player');
    } else {
      document.body.classList.remove('pb-player');
    }
    return () => document.body.classList.remove('pb-player');
  }, [!!currentItem]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show video card when a video starts
  useEffect(() => {
    if (isVideo) setIsVideoVisible(true);
  }, [isVideo]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = pct * duration;
    const el = activeRef.current;
    if (el) el.currentTime = t;
    setCurrentTime(t);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setIsDragging(true);
    setDragTime(pct * duration);

    const onMove = (ev: MouseEvent) => {
      const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      setDragTime(p * duration);
    };
    const onUp = (ev: MouseEvent) => {
      const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = p * duration;
      const el = activeRef.current;
      if (el) el.currentTime = t;
      setCurrentTime(t);
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFullscreen = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
  }, []);

  if (!currentItem) return null;

  const displayTime = formatTime(isDragging ? dragTime : currentTime);
  const totalTime = formatTime(duration);

  return (
    <>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        preload="metadata"
        style={{ display: 'none' }}
        onTimeUpdate={(e) => handleMediaTimeUpdate(e.currentTarget)}
        onDurationChange={(e) => handleMediaDurationChange(e.currentTarget)}
        onEnded={_trackEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* Floating video card */}
      {isVideo && isVideoVisible && (
        <div className="fixed bottom-[6.5rem] right-8 w-72 sm:w-80 rounded-xl overflow-hidden shadow-xl border border-[var(--color-border)] bg-[var(--color-bg-media)] z-[999]">
          <video
            ref={videoRef}
            className="w-full aspect-video object-contain bg-black"
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => handleMediaTimeUpdate(e.currentTarget)}
            onDurationChange={(e) => handleMediaDurationChange(e.currentTarget)}
            onEnded={_trackEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              onClick={handleFullscreen}
              className="p-1 rounded bg-black/50 text-white hover:bg-black/70 transition"
              title="Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsVideoVisible(false)}
              className="p-1 rounded bg-black/50 text-white hover:bg-black/70 transition"
              title="Hide video"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Show video button when card is hidden */}
      {isVideo && !isVideoVisible && (
        <div className="fixed bottom-[6.5rem] right-8 z-[999]">
          <button
            onClick={() => setIsVideoVisible(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-sub)] shadow hover:bg-[var(--color-bg-muted)] transition"
          >
            <Film className="w-3.5 h-3.5" />Show video
          </button>
        </div>
      )}

      {/* Queue panel */}
      {isQueueOpen && (
        <div className="fixed bottom-[7rem] left-8 right-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl z-[998] overflow-hidden">
          <QueuePanel />
        </div>
      )}

      {/* Pill bar */}
      <div className="fixed bottom-8 left-8 right-8 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-full z-[1000] px-4 py-3 flex items-center gap-3 shadow-lg">

        {/* Skip prev */}
        <button
          onClick={handleSkipPrev}
          disabled={currentIndex === 0 && currentTime < 1}
          className="hidden sm:flex shrink-0 items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] transition disabled:opacity-30"
          title="Previous"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        {/* Play/Pause */}
        <button
          onClick={() => setPlaying(!isPlaying)}
          className="shrink-0 flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[var(--color-bg-muted)] text-[var(--color-text)] hover:bg-[var(--color-border)] transition active:scale-95"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5" />}
        </button>

        {/* Skip next */}
        <button
          onClick={skipNext}
          disabled={currentIndex >= queue.length - 1}
          className="hidden sm:flex shrink-0 items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] transition disabled:opacity-30"
          title="Next"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Track info */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <p className="text-sm font-medium text-[var(--color-text)] truncate leading-tight" title={currentItem.name}>
            {currentItem.name}
          </p>
          <p className="text-xs text-[var(--color-text-faint)]">{displayTime} / {totalTime}</p>
        </div>

        {/* Progress bar */}
        <div className="flex-[3] min-w-0 hidden sm:block">
          <div
            ref={progressRef}
            className="relative h-1.5 bg-[var(--color-progress)] rounded-full cursor-pointer group hover:h-2.5 transition-all"
            onMouseDown={handleProgressMouseDown}
            onClick={handleProgressClick}
          >
            <div
              className="h-full bg-[var(--color-progress-fill)] rounded-full pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[var(--color-progress-fill)] opacity-0 group-hover:opacity-100 transition pointer-events-none"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>
        </div>

        {/* Volume — desktop */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] transition"
          >
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0" max="1" step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-16 accent-[var(--color-progress-fill)] cursor-pointer"
          />
        </div>

        {/* Speed — desktop */}
        <div className="relative hidden sm:block shrink-0">
          <button
            onClick={() => setIsSpeedOpen(v => !v)}
            className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] hover:bg-[var(--color-bg-muted)] transition"
            title="Playback speed"
          >
            <Settings className="w-4 h-4" />
          </button>
          {isSpeedOpen && (
            <div className="absolute bottom-full right-0 mb-2 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden z-[1001]">
              {SPEEDS.map(rate => (
                <button
                  key={rate}
                  onClick={() => { setPlaybackRate(rate); setIsSpeedOpen(false); }}
                  className={`block w-full px-4 py-2 text-sm text-left transition ${playbackRate === rate ? 'bg-[var(--color-bg-muted)] font-semibold text-[var(--color-text)]' : 'text-[var(--color-text-sub)] hover:bg-[var(--color-bg-muted)]'}`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile settings */}
        <div className="relative sm:hidden shrink-0">
          <button
            onClick={() => setIsMobileSettingsOpen(v => !v)}
            className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] hover:bg-[var(--color-bg-muted)] transition"
          >
            <Settings className="w-4 h-4" />
          </button>
          {isMobileSettingsOpen && (
            <div className="absolute bottom-full right-0 mb-2 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl shadow-lg p-4 z-[1001] w-52">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">Volume</p>
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-[var(--color-text-faint)]" />
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-[var(--color-progress-fill)]"
                  />
                </div>
              </div>
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">Skip</p>
                <div className="flex gap-2">
                  <button onClick={handleSkipPrev} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-[var(--color-bg-muted)] transition">
                    <SkipBack className="w-3.5 h-3.5" />Prev
                  </button>
                  <button onClick={skipNext} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-[var(--color-bg-muted)] transition">
                    <SkipForward className="w-3.5 h-3.5" />Next
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">Speed</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SPEEDS.map(rate => (
                    <button
                      key={rate}
                      onClick={() => { setPlaybackRate(rate); setIsMobileSettingsOpen(false); }}
                      className={`py-1.5 rounded-lg text-xs font-medium transition ${playbackRate === rate ? 'bg-[var(--color-bg-muted)] text-[var(--color-text)] font-semibold' : 'text-[var(--color-text-sub)] border border-[var(--color-border)] hover:bg-[var(--color-bg-muted)]'}`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Queue toggle */}
        <button
          onClick={toggleQueue}
          className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full transition relative ${isQueueOpen ? 'bg-[var(--color-bg-muted)] text-[var(--color-text)]' : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] hover:bg-[var(--color-bg-muted)]'}`}
          title="Queue"
        >
          <ListMusic className="w-4 h-4" />
          {queue.length > 1 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-progress-fill)] text-white text-[10px] font-bold flex items-center justify-center">
              {queue.length > 9 ? '9+' : queue.length}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
