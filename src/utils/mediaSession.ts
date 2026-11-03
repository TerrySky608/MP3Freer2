import type { Song } from '../types/music';

declare global {
  interface Window {
    AndroidMediaBridge?: {
      updateMedia: (
        title: string,
        artist: string,
        coverUrl: string,
        isPlaying: boolean,
        durationSec: number,
        currentSec: number
      ) => void;
      clearMedia: () => void;
      exitApp?: () => void;
    };
  }
}

export interface MediaSessionActionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onToggle?: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek?: (time: number) => void;
}

let lastSongCache: Song | null = null;
let lastIsPlayingCache = false;
let lastDurationCache = 0;
let lastPositionCache = 0;

function syncToAndroidNative() {
  if (typeof window !== 'undefined' && window.AndroidMediaBridge) {
    try {
      if (!lastSongCache) {
        window.AndroidMediaBridge.clearMedia();
      } else {
        window.AndroidMediaBridge.updateMedia(
          lastSongCache.name || '未知曲目',
          lastSongCache.artist || 'MP3Terry',
          lastSongCache.pic || '',
          lastIsPlayingCache,
          lastDurationCache || (lastSongCache.duration || 0),
          lastPositionCache
        );
      }
    } catch (err) {
      console.warn('Sync to Android native media session failed:', err);
    }
  }
}

/**
 * 检查当前运行环境是否支持 MediaSession API
 */
export function isMediaSessionSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/**
 * 更新系统媒体通知元数据（歌名、歌手、专辑、封面）
 */
export function updateMediaSessionMetadata(song: Song | null): void {
  lastSongCache = song;
  syncToAndroidNative();

  if (!isMediaSessionSupported()) return;

  if (!song) {
    navigator.mediaSession.metadata = null;
    return;
  }

  const artwork: MediaImage[] = [];
  if (song.pic) {
    artwork.push(
      { src: song.pic, sizes: '96x96', type: 'image/jpeg' },
      { src: song.pic, sizes: '128x128', type: 'image/jpeg' },
      { src: song.pic, sizes: '256x256', type: 'image/jpeg' },
      { src: song.pic, sizes: '512x512', type: 'image/jpeg' }
    );
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name || '未知歌曲',
      artist: song.artist || '未知歌手',
      album: song.album || 'MP3Terry',
      artwork: artwork.length > 0 ? artwork : undefined,
    });
  } catch (err) {
    console.warn('Failed to update MediaSession metadata:', err);
  }
}

/**
 * 更新系统播放状态：'playing' | 'paused' | 'none'
 */
export function updateMediaSessionPlaybackState(isPlaying: boolean): void {
  lastIsPlayingCache = isPlaying;
  syncToAndroidNative();

  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  } catch (err) {
    console.warn('Failed to update MediaSession playbackState:', err);
  }
}

/**
 * 更新系统播放进度与时长（供车机/通知栏进度条显示）
 */
export function updateMediaSessionPositionState(state: {
  duration?: number;
  playbackRate?: number;
  position?: number;
}): void {
  if (typeof state.duration === 'number') lastDurationCache = state.duration;
  if (typeof state.position === 'number') lastPositionCache = state.position;

  if (!isMediaSessionSupported() || !navigator.mediaSession.setPositionState) return;
  try {
    if (state.duration && state.duration > 0 && typeof state.position === 'number') {
      navigator.mediaSession.setPositionState({
        duration: Math.max(0, state.duration),
        playbackRate: state.playbackRate || 1.0,
        position: Math.min(Math.max(0, state.position), state.duration),
      });
    }
  } catch (_e) {
    // 忽略异常
  }
}

/**
 * 注册系统级媒体动作响应（车机方向盘实体键、蓝牙耳机按键、系统锁屏与通知栏）
 */
export function setupMediaSessionHandlers(handlers: MediaSessionActionHandlers): () => void {
  const nativeListener = (e: Event) => {
    const custom = e as CustomEvent;
    const detail = custom.detail;
    if (detail === 'play') {
      handlers.onPlay();
    } else if (detail === 'pause') {
      handlers.onPause();
    } else if (detail === 'toggle') {
      if (handlers.onToggle) {
        handlers.onToggle();
      } else if (lastIsPlayingCache) {
        handlers.onPause();
      } else {
        handlers.onPlay();
      }
    } else if (detail === 'next') {
      handlers.onNext();
    } else if (detail === 'prev') {
      handlers.onPrev();
    } else if (typeof detail === 'object' && detail?.action === 'seek' && typeof detail?.position === 'number' && handlers.onSeek) {
      handlers.onSeek(detail.position);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('nativeMediaAction', nativeListener);
  }

  if (!isMediaSessionSupported()) {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('nativeMediaAction', nativeListener);
      }
    };
  }

  const actionMap: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ['play', () => handlers.onPlay()],
    ['pause', () => handlers.onPause()],
    ['previoustrack', () => handlers.onPrev()],
    ['nexttrack', () => handlers.onNext()],
    [
      'seekto',
      (details: MediaSessionActionDetails) => {
        if (details.seekTime !== undefined && handlers.onSeek) {
          handlers.onSeek(details.seekTime);
        }
      },
    ],
  ];

  actionMap.forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (_e) {}
  });

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('nativeMediaAction', nativeListener);
    }
    if (!isMediaSessionSupported()) return;
    actionMap.forEach(([action]) => {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch (_e) {}
    });
  };
}
