import { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react';

export interface QueueItem {
  id: string;
  name: string;
  url: string;
  mediaType: 'audio' | 'video';
}

interface MediaPlayerState {
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  playbackRate: number;
  isQueueOpen: boolean;
}

type Action =
  | { type: 'PLAY_NOW'; item: QueueItem }
  | { type: 'ADD_TO_QUEUE'; item: QueueItem }
  | { type: 'PLAY_NEXT'; item: QueueItem }
  | { type: 'REMOVE_FROM_QUEUE'; index: number }
  | { type: 'JUMP_TO'; index: number }
  | { type: 'SKIP_NEXT' }
  | { type: 'SKIP_PREV' }
  | { type: 'SET_PLAYING'; value: boolean }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'SET_PLAYBACK_RATE'; rate: number }
  | { type: 'TOGGLE_QUEUE' }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'TRACK_ENDED' };

const LS_VOLUME = 'media_player_volume';
const LS_RATE = 'media_player_rate';

function getInitialVolume(): number {
  const v = localStorage.getItem(LS_VOLUME);
  return v !== null ? parseFloat(v) : 0.8;
}

function getInitialRate(): number {
  const v = localStorage.getItem(LS_RATE);
  return v !== null ? parseFloat(v) : 1;
}

const initialState: MediaPlayerState = {
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  volume: getInitialVolume(),
  playbackRate: getInitialRate(),
  isQueueOpen: false,
};

function reducer(state: MediaPlayerState, action: Action): MediaPlayerState {
  switch (action.type) {
    case 'PLAY_NOW':
      return { ...state, queue: [action.item], currentIndex: 0, isPlaying: true };
    case 'ADD_TO_QUEUE': {
      if (state.queue.some(q => q.id === action.item.id)) return state;
      const queue = [...state.queue, action.item];
      const currentIndex = state.currentIndex === -1 ? 0 : state.currentIndex;
      const isPlaying = state.currentIndex === -1 ? true : state.isPlaying;
      return { ...state, queue, currentIndex, isPlaying };
    }
    case 'PLAY_NEXT': {
      if (state.queue.some(q => q.id === action.item.id)) return state;
      const insertAt = state.currentIndex + 1;
      const queue = [...state.queue.slice(0, insertAt), action.item, ...state.queue.slice(insertAt)];
      return { ...state, queue };
    }
    case 'REMOVE_FROM_QUEUE': {
      const queue = state.queue.filter((_, i) => i !== action.index);
      let currentIndex = state.currentIndex;
      if (action.index < currentIndex) currentIndex--;
      else if (action.index === currentIndex) {
        if (queue.length === 0) return { ...state, queue: [], currentIndex: -1, isPlaying: false };
        currentIndex = Math.min(currentIndex, queue.length - 1);
      }
      return { ...state, queue, currentIndex };
    }
    case 'JUMP_TO':
      return { ...state, currentIndex: action.index, isPlaying: true };
    case 'SKIP_NEXT': {
      if (state.currentIndex >= state.queue.length - 1) return { ...state, isPlaying: false };
      return { ...state, currentIndex: state.currentIndex + 1, isPlaying: true };
    }
    case 'SKIP_PREV': {
      // "Restart if > 3s" logic lives in MediaPlayer to keep currentTime out of global state
      if (state.currentIndex <= 0) return state;
      return { ...state, currentIndex: state.currentIndex - 1, isPlaying: true };
    }
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.value };
    case 'SET_VOLUME':
      return { ...state, volume: action.volume };
    case 'SET_PLAYBACK_RATE':
      return { ...state, playbackRate: action.rate };
    case 'TOGGLE_QUEUE':
      return { ...state, isQueueOpen: !state.isQueueOpen };
    case 'CLEAR_QUEUE':
      return { ...state, queue: [], currentIndex: -1, isPlaying: false, isQueueOpen: false };
    case 'TRACK_ENDED': {
      if (state.currentIndex >= state.queue.length - 1) return { ...state, isPlaying: false };
      return { ...state, currentIndex: state.currentIndex + 1, isPlaying: true };
    }
    default:
      return state;
  }
}

interface MediaPlayerContextValue {
  state: MediaPlayerState;
  playNow: (item: QueueItem) => void;
  addToQueue: (item: QueueItem) => void;
  playNext: (item: QueueItem) => void;
  removeFromQueue: (index: number) => void;
  jumpTo: (index: number) => void;
  skipNext: () => void;
  skipPrev: () => void;
  setPlaying: (value: boolean) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  toggleQueue: () => void;
  clearQueue: () => void;
  _trackEnded: () => void;
}

const MediaPlayerContext = createContext<MediaPlayerContextValue | null>(null);

export function MediaPlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    localStorage.setItem(LS_VOLUME, String(state.volume));
  }, [state.volume]);

  useEffect(() => {
    localStorage.setItem(LS_RATE, String(state.playbackRate));
  }, [state.playbackRate]);

  const playNow = useCallback((item: QueueItem) => dispatch({ type: 'PLAY_NOW', item }), []);
  const addToQueue = useCallback((item: QueueItem) => dispatch({ type: 'ADD_TO_QUEUE', item }), []);
  const playNext = useCallback((item: QueueItem) => dispatch({ type: 'PLAY_NEXT', item }), []);
  const removeFromQueue = useCallback((index: number) => dispatch({ type: 'REMOVE_FROM_QUEUE', index }), []);
  const jumpTo = useCallback((index: number) => dispatch({ type: 'JUMP_TO', index }), []);
  const skipNext = useCallback(() => dispatch({ type: 'SKIP_NEXT' }), []);
  const skipPrev = useCallback(() => dispatch({ type: 'SKIP_PREV' }), []);
  const setPlaying = useCallback((value: boolean) => dispatch({ type: 'SET_PLAYING', value }), []);
  const setVolume = useCallback((volume: number) => dispatch({ type: 'SET_VOLUME', volume }), []);
  const setPlaybackRate = useCallback((rate: number) => dispatch({ type: 'SET_PLAYBACK_RATE', rate }), []);
  const toggleQueue = useCallback(() => dispatch({ type: 'TOGGLE_QUEUE' }), []);
  const clearQueue = useCallback(() => dispatch({ type: 'CLEAR_QUEUE' }), []);
  const _trackEnded = useCallback(() => dispatch({ type: 'TRACK_ENDED' }), []);

  return (
    <MediaPlayerContext.Provider value={{
      state, playNow, addToQueue, playNext, removeFromQueue, jumpTo,
      skipNext, skipPrev, setPlaying, setVolume, setPlaybackRate,
      toggleQueue, clearQueue, _trackEnded,
    }}>
      {children}
    </MediaPlayerContext.Provider>
  );
}

export function useMediaPlayer() {
  const ctx = useContext(MediaPlayerContext);
  if (!ctx) throw new Error('useMediaPlayer must be used inside MediaPlayerProvider');
  return ctx;
}
