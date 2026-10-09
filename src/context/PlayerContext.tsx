import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { exists, readDir, readTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { emit } from '@tauri-apps/api/event';
import md5 from 'js-md5';
import { MusicApiService } from '../services/musicApi';
import { getDefaultSearchSource, getDownloadOnFavorite, getDownloadPath, getPreferredQuality } from '../settings';
import { resolveImageUrl } from '../services/musicApi';
import { readAudioMetadata, downloadFile } from '../services/rustBridge';
import { useToast } from './ToastContext';
import { storage, StorageKeys } from '../services/storage';
import { resourceCache } from '../services/cache';
import { playbackActions } from '../services/playbackProgress';
import { usePlaybackProgress } from '../services/playbackProgress';
import { isAndroid, isMobileShell } from '../utils/platform';
import {
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
  setupMediaSessionHandlers,
} from '../utils/mediaSession';
import { parseLrcWithExtras } from '../utils/lyricParser';
import {
  sanitizeFileName,
  joinPath,
  withoutExtension,
  parseSongName,
  directoryExists,
  isAudioFile,
  resolveOnlineApiId,
  normalizePersistedSong,
  normalizePersistedSongs,
  normalizePersistedHistory,
  stripEphemeralStreamUrl,
} from '../utils/songUtils';
import {
  backupFavoritesToCloud,
  restoreFavoritesFromCloud,
  exportFavoritesToFile,
  importFavoritesFromFile,
} from '../services/syncService';
import type {
  Song,
  LyricLine,
  FavoritePlaylist,
  FavoriteArtist,
  PlayMode,
  HistoryEntry,
} from '../types/music';
// re-export 类型与解析函数，保持现有 `import { Song } from '../context/PlayerContext'` 兼容
export type { Song, LyricLine, FavoritePlaylist, FavoriteArtist, PlayMode, HistoryEntry };
export { parseLrc, parseLrcWithExtras } from '../utils/lyricParser';

interface PlayerContextType {
  currentSong: Song | null;
  // 注：isPlaying / currentTime / duration 已抽离到独立的 playbackProgress store，
  // 请通过 usePlaybackProgress() 订阅，避免每秒触发全量重渲染。
  isLoading: boolean;
  playlist: Song[];
  playIndex: number;
  playMode: PlayMode;
  volume: number;
  lyrics: LyricLine[];
  currentLyricIndex: number;
  localSongs: Song[];
  favoriteSongs: Song[];
  favoritePlaylists: FavoritePlaylist[];
  favoriteArtists: FavoriteArtist[];
  isFavorite: (songId: string) => boolean;
  isFavoritePlaylist: (id: string) => boolean;
  toggleFavoritePlaylist: (playlistInfo: FavoritePlaylist) => void;
  isFavoriteArtist: (id: string) => boolean;
  toggleFavoriteArtist: (artistInfo: FavoriteArtist) => void;
  playSong: (song: Song) => Promise<void>;
  togglePlay: () => void;
  /** 暂停并回到开头（媒体键 Stop） */
  stopPlayback: () => void;
  /** 按当前音质设置重新拉流（设置页改音质后调用） */
  reloadCurrentSong: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seekTo: (time: number) => void;
  setVolumeLevel: (vol: number) => void;
  changePlayMode: () => void;
  addToPlaylist: (song: Song, playImmediately?: boolean) => void;
  removeFromPlaylist: (songId: string) => void;
  clearPlaylist: () => void;
  toggleFavorite: (song: Song) => Promise<void>;
  importLocalDirectory: () => Promise<void>;
  loadLocalSongLyric: (song: Song) => Promise<string>;
  playAll: (songs: Song[]) => void;
  addAllToPlaylist: (songs: Song[]) => void;
  localDirectory: string | null;
  refreshLocalDirectory: () => Promise<void>;
  /** 最近播放记录（最新在前，最多 1000 条） */
  playHistory: HistoryEntry[];
  /** 最近 7 天播放次数最多的歌曲（最多 50 首） */
  topPlayed: HistoryEntry[];
  /** 清空播放历史 */
  clearPlayHistory: () => void;
  /** 当前歌词整体偏移（秒） */
  lyricOffset: number;
  /** 调整歌词偏移，delta 单位秒 */
  adjustLyricOffset: (delta: number) => void;
  /** 重置歌词偏移 */
  resetLyricOffset: () => void;
  /** 是否显示歌词翻译 */
  showTranslation: boolean;
  toggleShowTranslation: () => void;
  /** WebAudio 频谱分析节点 */
  analyser: AnalyserNode | null;
  /** 手动触发一次云端同步 */
  syncFavoritesNow: () => Promise<void>;
  /** 导出收藏备份文件 */
  exportFavorites: () => void;
  /** 从 JSON 文件导入收藏 */
  importFavorites: (file: File) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useToast();
  const [playlist, setPlaylist] = useState<Song[]>(() =>
    normalizePersistedSongs(storage.getJSON<Song[]>(StorageKeys.CURRENT_PLAYLIST, []))
  );
  const [playIndex, setPlayIndex] = useState<number>(() => {
    const saved = storage.getString(StorageKeys.CURRENT_PLAYINDEX);
    return saved ? parseInt(saved, 10) : -1;
  });
  const [localDirectory, setLocalDirectory] = useState<string | null>(() => storage.getString(StorageKeys.LOCAL_DIRECTORY) || null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  // currentTime / duration / isPlaying 已抽离到独立的 playbackProgress store，
  // 避免每秒触发所有消费 usePlayer() 的组件重渲染。
  // isPlayingRef 镜像播放状态，供异步回调（canplay 等）读取最新值，
  // 避免闭包捕获陈旧的 isPlaying（loadSongDetails 的 race 修复）。
  const isPlayingRef = useRef<boolean>(false);
  const [playMode, setPlayMode] = useState<PlayMode>('list-loop');
  const [volume, setVolume] = useState<number>(() => {
    const saved = storage.getString(StorageKeys.VOLUME);
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
    return 1; // 首次启动默认 100%
  });
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number>(-1);
  const [localSongs, setLocalSongs] = useState<Song[]>([]);
  const [favoriteSongs, setFavoriteSongs] = useState<Song[]>([]);
  const [favoritePlaylists, setFavoritePlaylists] = useState<FavoritePlaylist[]>(() => storage.getJSON<FavoritePlaylist[]>(StorageKeys.FAVORITE_PLAYLISTS, []));
  const [favoriteArtists, setFavoriteArtists] = useState<FavoriteArtist[]>(() => storage.getJSON<FavoriteArtist[]>(StorageKeys.FAVORITE_ARTISTS, []));
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [playHistory, setPlayHistory] = useState<HistoryEntry[]>(() =>
    normalizePersistedHistory(storage.getJSON<HistoryEntry[]>(StorageKeys.PLAY_HISTORY, []))
  );
  const [lyricOffset, setLyricOffset] = useState<number>(0);
  const [showTranslation, setShowTranslation] = useState<boolean>(() => storage.getString(StorageKeys.SHOW_TRANSLATION) !== 'false');
  // 缓存当前歌曲的结构化歌词数据（原文+翻译+罗马音），供偏移/翻译切换时重建
  const rawLyricDataRef = useRef<{ original: string; translated: string; romanized: string }>({ original: '', translated: '', romanized: '' });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const playModeRef = useRef<PlayMode>(playMode);
  const playlistRef = useRef<Song[]>(playlist);
  const playHistoryRef = useRef<HistoryEntry[]>(playHistory);
  const playIndexRef = useRef<number>(playIndex);
  const playSessionIdRef = useRef<number>(0);
  const onCanPlayRef = useRef<any>(null);
  const autoSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 用户/逻辑期望播放；切歌时 audio.load() 会误触 pause，不能靠 pause 事件清掉它 */
  const playIntentRef = useRef<boolean>(false);
  /** 为 true 时忽略 audio 的 pause 事件同步（切歌 pause/load 期间） */
  const suppressPauseSyncRef = useRef<boolean>(false);
  /** 本次播放结束已被处理（ended 或 timeupdate 兜底先到者置位），
   *  防止 ended 事件与 timeupdate 兜底重复触发 handleSongEnded。
   *  切歌（loadSongDetails 开头）复位为 false，单曲循环 play() 成功后也复位。 */
  const endedGuardRef = useRef<boolean>(false);
  /** 收藏下载会话 token：取消收藏时递增，避免下载完成后把歌重新写回 */
  const favoriteDownloadTokenRef = useRef<Map<string, number>>(new Map());

  // 频谱用 SpectrumVisualizer 模拟律动，不再挂 createMediaElementSource。
  // WebAudio 接管后若 AudioContext 被挂起（Android WebView 常见），会出现「在播但无声」。
  const analyser: AnalyserNode | null = null;

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    // 持久化时剥离在线流 URL，避免重启后复用失效 CDN 链接
    storage.setJSON(StorageKeys.CURRENT_PLAYLIST, playlist.map(stripEphemeralStreamUrl));
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    playHistoryRef.current = playHistory;
  }, [playHistory]);

  useEffect(() => {
    playIndexRef.current = playIndex;
  }, [playIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    audio.volume = volume;

    // 直接用原生 audio 元素播放，不走 WebAudio 图。
    // 之前接 WebAudio（createMediaElementSource）导致一系列 user gesture / suspended 问题，
    // 声音是底线，频谱改为模拟律动（见 SpectrumVisualizer）。

    const onTimeUpdate = () => {
      playbackActions.setCurrentTime(audio.currentTime);
      // Android WebView 下隐藏/不可见的 <audio> 在自然播放结束时 ended 事件可能丢失，
      // 用 timeupdate 兜底：接近末尾且本次未处理过结束时主动连播。
      // endedGuardRef 由 handleSongEnded 置位、loadSongDetails 切歌时复位，
      // 保证 ended 与兜底谁先到都只触发一次。
      if (!endedGuardRef.current
        && audio.duration && !Number.isNaN(audio.duration)
        && audio.duration > 1
        && audio.currentTime >= audio.duration - 0.3) {
        handleSongEnded();
      }
    };
    const onDurationChange = () => {
      if (audio.duration && !Number.isNaN(audio.duration)) {
        playbackActions.setDuration(audio.duration);
        updateMediaSessionPositionState({
          duration: audio.duration,
          position: audio.currentTime,
        });
      }
    };
    const onEnded = () => handleSongEnded();
    // 让 <audio> 元素本身成为播放状态的真相源：无论谁触发播放（用户手势、自动续播、
    // 程序调用），只要 audio 真的 play/pause 了，就同步 store 与 ref。
    // 之前只靠各调用方手动 setIsPlaying，路径多了容易漏，导致 ref 与实际状态不一致。
    const onPlay = () => {
      playIntentRef.current = true;
      isPlayingRef.current = true;
      playbackActions.setIsPlaying(true);
    };
    const onPause = () => {
      // 切歌时 pause()/load()/createMediaElementSource 都会触发 pause；
      // 若此时清掉意图，canplay 后就不会 play，歌词进度也会停在 0。
      if (suppressPauseSyncRef.current) return;
      // ended 时浏览器会先 pause 再 ended；意图交由 handleSongEnded 重新置位
      if (audio.ended) return;
      playIntentRef.current = false;
      isPlayingRef.current = false;
      playbackActions.setIsPlaying(false);
    };
    // 全局 error 只做日志；自动跳过由 loadSongDetails 的会话级 handler 负责，避免双重 skip
    const onError = (e: Event) => {
      console.error('Audio playback error:', e);
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        if (playIntentRef.current && audio.paused && audio.src) {
          audio.play().catch(err => {
            console.warn('Auto-resume playback on visibilitychange:', err);
          });
        }
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const savedLocal = storage.getString(StorageKeys.LOCAL_SONGS);
    if (savedLocal) {
      setLocalSongs(normalizePersistedSongs(storage.getJSON<Song[]>(StorageKeys.LOCAL_SONGS, [])));
    }

    const savedFavorites = storage.getString(StorageKeys.FAVORITE_SONGS);
    const parsedFavs = savedFavorites ? storage.getJSON<Song[]>(StorageKeys.FAVORITE_SONGS, []) : [];
    if (parsedFavs.length > 0) {
      // 收藏可能含已下载本地曲（保留 localPath/url）与在线条目（规范化 id、剥离流 url）
      setFavoriteSongs(parsedFavs.map(s => (s.isLocal ? s : normalizePersistedSong(s))));
    } else {
      // 本地收藏为空（如重装或新安装打开），根据设备 ID 自动静默从云端拉取历史备份
      void restoreFavoritesFromCloud().then(cloudFav => {
        if (cloudFav && cloudFav.songs && cloudFav.songs.length > 0) {
          const restoredSongs = cloudFav.songs.map(normalizePersistedSong);
          setFavoriteSongs(restoredSongs);
          storage.setJSON(
            StorageKeys.FAVORITE_SONGS,
            restoredSongs.map(s => (s.isLocal ? s : stripEphemeralStreamUrl(s))),
          );
          if (cloudFav.playlists && cloudFav.playlists.length > 0) {
            setFavoritePlaylists(cloudFav.playlists);
            storage.setJSON(StorageKeys.FAVORITE_PLAYLISTS, cloudFav.playlists);
          }
          if (cloudFav.artists && cloudFav.artists.length > 0) {
            setFavoriteArtists(cloudFav.artists);
            storage.setJSON(StorageKeys.FAVORITE_ARTISTS, cloudFav.artists);
          }
          toast.success(`已根据设备 ID 自动找回 ${cloudFav.songs.length} 首云端收藏歌曲`);
        }
      });
    }

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      audio.pause();
      if (autoSkipTimerRef.current) clearTimeout(autoSkipTimerRef.current);
    };
  }, []);

  // 订阅播放进度 store：把高频更新的 currentTime / isPlaying 拿到本地，
  // 喂给下方"歌词高亮"和"overlay 同步"两个 effect。
  // 这样只有这两个 effect 跟随进度变化，而不会触发整个 Provider value 重建
  // （value 里已不含 currentTime / isPlaying）。
  const { currentTime, isPlaying: isPlayingProgress } = usePlaybackProgress();
  // isPlayingRef 始终镜像最新播放状态，供异步回调读取
  isPlayingRef.current = isPlayingProgress;

  useEffect(() => {
    if (lyrics.length === 0) {
      setCurrentLyricIndex(-1);
      return;
    }

    let activeIndex = -1;
    for (let i = 0; i < lyrics.length; i += 1) {
      if (currentTime >= lyrics[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }
    setCurrentLyricIndex(activeIndex);
  }, [currentTime, lyrics]);

  // 同步歌词到桌面悬浮窗（lyric-overlay）
  useEffect(() => {
    // 移动端/车机无悬浮窗第二窗口；后台不可见状态下跳过 IPC 广播以省电和防止卡顿
    if (isAndroid() || isMobileShell()) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const pushOverlayLyric = () => {
      const prevLine = currentLyricIndex > 0 ? lyrics[currentLyricIndex - 1]?.text || '' : '';
      const currentLine = currentLyricIndex >= 0 ? lyrics[currentLyricIndex]?.text || '' : '';
      const nextLine = currentLyricIndex >= 0 && currentLyricIndex < lyrics.length - 1
        ? lyrics[currentLyricIndex + 1]?.text || ''
        : '';
      const payload = {
        prev: prevLine,
        current: currentLine,
        next: nextLine,
        songName: currentSong?.name || '',
        artist: currentSong?.artist || '',
        isPlaying: isPlayingProgress,
      };
      // emit 失败（浏览器环境/窗口未启动）静默忽略
      emit('overlay-lyric', payload).catch(() => {});
    };

    pushOverlayLyric();
    // 刚打开桌面歌词时主动要一帧，避免等到下一句才显示
    window.addEventListener('desktop-lyric-sync', pushOverlayLyric);
    return () => window.removeEventListener('desktop-lyric-sync', pushOverlayLyric);
  }, [currentLyricIndex, lyrics, currentSong, isPlayingProgress]);

  // 同步系统媒体会话元数据（通知栏/车机仪表盘/锁屏）
  useEffect(() => {
    updateMediaSessionMetadata(currentSong);
  }, [currentSong]);

  // 同步系统媒体会话播放状态
  useEffect(() => {
    updateMediaSessionPlaybackState(isPlayingProgress);
  }, [isPlayingProgress]);

  const prefetchNextSong = (currentIndex: number) => {
    const pl = playlistRef.current;
    if (!pl || pl.length <= 1) return;
    // 预热接下来两首歌曲的播放直链，确保锁屏/后台切歌时直链早已在内存缓存，0ms 瞬间无缝切歌
    const targets = playModeRef.current === 'random'
      ? [Math.floor(Math.random() * pl.length)]
      : [(currentIndex + 1) % pl.length, (currentIndex + 2) % pl.length];

    for (const nextIdx of targets) {
      const nextSong = pl[nextIdx];
      if (nextSong && !nextSong.isLocal) {
        void resolveOnlinePlayUrl(nextSong).catch(() => {});
        if (nextSong.pic_id) {
          const cachedPic = resourceCache.getPic(nextSong.source, nextSong.pic_id);
          if (!cachedPic) {
            MusicApiService.getSongPic(nextSong.pic_id, nextSong.source)
              .then(pic => { if (pic) resourceCache.setPic(nextSong.source, nextSong.pic_id!, pic); })
              .catch(() => {});
          }
        }
      }
    }
  };

  /**
   * 核心切歌方法：直接触发 loadSongDetails，无需经过 React 渲染帧被动调度，
   * 彻底解决手机锁屏/后台休眠期间 React useEffect 调度被挂起导致的连播中断。
   */
  const playSongAtIndex = (targetIndex: number, options: { forceReplay?: boolean } = {}) => {
    const pl = playlistRef.current;
    if (pl.length === 0 || targetIndex < 0 || targetIndex >= pl.length) return;

    const targetSong = pl[targetIndex];
    const isSameIndex = targetIndex === playIndexRef.current;

    playIndexRef.current = targetIndex;
    setPlayIndex(targetIndex);
    setCurrentSong(targetSong);
    playIntentRef.current = true;
    isPlayingRef.current = true;
    playbackActions.setIsPlaying(true);
    setLyricOffset(0);
    rawLyricDataRef.current = { original: '', translated: '', romanized: '' };
    storage.setString(StorageKeys.CURRENT_PLAYINDEX, String(targetIndex));

    if (isSameIndex && !options.forceReplay && audioRef.current && audioRef.current.src && !audioRef.current.error) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(console.error);
    } else {
      void loadSongDetails(targetSong);
    }
  };

  // 仅在首次启动或外部清空歌单时作为保底同步
  useEffect(() => {
    storage.setString(StorageKeys.CURRENT_PLAYINDEX, String(playIndex));
    if (playIndex < 0 || playIndex >= playlist.length) {
      if (playlist.length === 0) {
        setCurrentSong(null);
        setLyrics([]);
        playIntentRef.current = false;
        playbackActions.reset();
      }
    }
  }, [playIndex, playlist.length]);

  const scheduleAutoSkip = (reason: string) => {
    if (autoSkipTimerRef.current) return;
    console.log(`Auto-skipping to next song (${reason})...`);
    autoSkipTimerRef.current = setTimeout(() => {
      autoSkipTimerRef.current = null;
      handleSongEnded();
    }, 2000);
  };

  const resolveOnlinePlayUrl = async (
    song: Song,
    options: { forceRefresh?: boolean; allowExpiredFallback?: boolean } = {},
  ): Promise<string | null> => {
    const apiId = resolveOnlineApiId(song);
    const quality = getPreferredQuality();
    if (options.forceRefresh) {
      resourceCache.invalidateUrl(song.source, apiId);
    }
    let playUrl = options.forceRefresh
      ? null
      : resourceCache.getUrl(song.source, apiId, quality);
    if (!playUrl) {
      playUrl = await MusicApiService.getSongUrl(apiId, song.source, quality, {
        name: song.name,
        singer: song.artist,
        artist: song.artist,
      });
      if (playUrl) resourceCache.setUrl(song.source, apiId, quality, playUrl);
    }
    if (!playUrl && options.allowExpiredFallback) {
      playUrl = resourceCache.getUrl(song.source, apiId, quality, true);
    }
    return playUrl;
  };

  const loadSongDetails = async (song: Song) => {
    const audio = audioRef.current;
    if (!audio) return;

    // 切到新歌加载：解除上一首的结束保护，允许本次播放自然结束时重新触发连播
    endedGuardRef.current = false;

    if (autoSkipTimerRef.current) {
      clearTimeout(autoSkipTimerRef.current);
      autoSkipTimerRef.current = null;
    }
    if (onCanPlayRef.current) {
      audio.removeEventListener('canplay', onCanPlayRef.current.canplay);
      audio.removeEventListener('loadeddata', onCanPlayRef.current.canplay);
      audio.removeEventListener('error', onCanPlayRef.current.error);
      onCanPlayRef.current = null;
    }

    // 切断旧音频播放，切歌期间保持 audio 实例与会话连续性
    try {
      audio.pause();
    } catch (_e) {}

    // 整段加载期间忽略 pause 同步：pause()/换 src/WebAudio 初始化都可能触发 pause
    suppressPauseSyncRef.current = true;
    const wantPlay = playIntentRef.current || isPlayingRef.current;
    if (wantPlay) playIntentRef.current = true;
    
    playbackActions.setCurrentTime(0);
    playbackActions.setDuration(0);
    if (wantPlay) {
      isPlayingRef.current = true;
      playbackActions.setIsPlaying(true);
    }

    playSessionIdRef.current += 1;
    const currentSession = playSessionIdRef.current;
    let startedPlayback = false;

    const releasePauseSuppress = () => {
      if (currentSession === playSessionIdRef.current) {
        suppressPauseSyncRef.current = false;
      }
    };

    try {
      setIsLoading(!song.isLocal);
      let playUrl: string | null = null;
      let lyricText = song.lyric || '';
      let picUrl = song.pic;

      if (song.isLocal) {
        const localPath = song.localPath || song.url || '';
        if (isTauri && localPath && await exists(localPath)) {
          playUrl = convertFileSrc(localPath);
          const localData = await loadLocalSongData({ ...song, localPath });
          lyricText = localData.lyricText;
          if (!picUrl) picUrl = localData.picUrl;
        } else {
          toast.error(`本地歌曲文件不存在，无法播放：\n${localPath || song.name}`);
          playUrl = null;
        }
      } else {
        // 在线歌曲始终动态解析 URL，不信任持久化/传入的 song.url（CDN 易过期）
        playUrl = await resolveOnlinePlayUrl(song, { allowExpiredFallback: true });
        if (!lyricText && (song.lyric_id || song.name)) {
          const lrcData = await MusicApiService.getSongLyric(song.lyric_id || '', song.source, {
            name: song.name,
            singer: song.artist,
          });
          lyricText = lrcData.original;
          rawLyricDataRef.current = { original: lrcData.original, translated: lrcData.translated, romanized: lrcData.romanized };
        }
        if (!picUrl) {
          if (song.pic_id) {
            picUrl = resourceCache.getPic(song.source, song.pic_id);
          }
          if (!picUrl) {
            picUrl = await MusicApiService.getSongPic(song.pic_id || '', song.source, '300', {
              name: song.name,
              singer: song.artist,
            });
            if (picUrl && song.pic_id) resourceCache.setPic(song.source, song.pic_id, picUrl);
          }
        }
      }

      if (currentSession !== playSessionIdRef.current) {
        return; // 用户已切换到其他歌曲，丢弃本次结果（suppress 由新会话接管）
      }

      // 歌词就绪后立刻解析上屏，不依赖 canplay（避免 canplay 未触发时歌词空白/停住）
      const rawForLyrics = rawLyricDataRef.current.original
        ? rawLyricDataRef.current
        : { original: lyricText, translated: '', romanized: '' };
      setLyrics(parseLrcWithExtras(rawForLyrics.original, rawForLyrics.translated, rawForLyrics.romanized, 0));

      // 内存中可暂存当前会话 playUrl；持久化层会剥离在线 url
      const updatedSong = {
        ...song,
        url: song.isLocal ? (song.localPath || playUrl) : playUrl,
        lyric: lyricText,
        pic: resolveImageUrl(picUrl) || picUrl || null,
      };
      setCurrentSong(updatedSong);
      setPlaylist(prev => {
        const copy = [...prev];
        const idx = playIndexRef.current;
        if (idx >= 0 && idx < copy.length) copy[idx] = updatedSong;
        return copy;
      });

      if (!playUrl) {
        toast.error(`获取歌曲播放链接失败！即将自动跳过...\n\n歌曲：${song.name}\n该歌曲可能为 VIP 专享或接口无响应，请稍后重试。`);
        playIntentRef.current = false;
        isPlayingRef.current = false;
        playbackActions.setIsPlaying(false);
        releasePauseSuppress();
        scheduleAutoSkip('empty playUrl');
        return;
      }

      const startPlaybackIfNeeded = () => {
        if (currentSession !== playSessionIdRef.current) return;
        if (startedPlayback) return;
        startedPlayback = true;

        // 真正开始播放时记历史（覆盖自动连播路径）
        recordPlay(song);

        if (!playIntentRef.current) {
          releasePauseSuppress();
          return;
        }

        isPlayingRef.current = true;
        playbackActions.setIsPlaying(true);
        audio.play()
          .then(() => {
            playIntentRef.current = true;
            isPlayingRef.current = true;
            playbackActions.setIsPlaying(true);
            prefetchNextSong(playIndexRef.current);
          })
          .catch(err => {
            console.warn('Playback start deferred or pending in background:', err);
            // 注意：后台或息屏被拦截时不抹掉 playIntentRef，使 canplay / loadeddata / visibilitychange 能重新拉起
          })
          .finally(() => {
            releasePauseSuppress();
          });
      };

      const onCanPlay = () => {
        if (currentSession !== playSessionIdRef.current) return;
        if (onCanPlayRef.current) {
          audio.removeEventListener('canplay', onCanPlayRef.current.canplay);
          audio.removeEventListener('loadeddata', onCanPlayRef.current.canplay);
          audio.removeEventListener('error', onCanPlayRef.current.error);
          onCanPlayRef.current = null;
        }
        startPlaybackIfNeeded();
        if (playIntentRef.current && audio.paused) {
          audio.play().catch(e => console.warn('Retry play on canplay:', e));
        }
      };

      let candidateUrls: string[] = [];
      let candidateIndex = 0;

      const onError = () => {
        if (currentSession !== playSessionIdRef.current) return;
        void (async () => {
          // 在线流播放或解码异常：自动触发多音源智能故障转移（Smart Failover）
          if (!song.isLocal) {
            try {
              const apiId = resolveOnlineApiId(song);
              const quality = getPreferredQuality();
              if (candidateUrls.length === 0) {
                candidateUrls = await MusicApiService.getSongUrlCandidates(apiId, song.source, quality, {
                  name: song.name,
                  singer: song.artist,
                  artist: song.artist,
                });
              }

              candidateIndex++;
              while (candidateIndex < candidateUrls.length) {
                const nextUrl = candidateUrls[candidateIndex];
                if (nextUrl && nextUrl !== audio.src) {
                  console.log(`[Failover] 自动切换至备选音源 #${candidateIndex + 1}`);
                  resourceCache.setUrl(song.source, apiId, quality, nextUrl);
                  startedPlayback = false;
                  audio.removeAttribute('src');
                  audio.src = nextUrl;
                  audio.load();
                  return;
                }
                candidateIndex++;
              }
            } catch (err) {
              console.warn('Failover audio retry failed:', err);
            }
          }
          console.error('Audio playback error:', audio.error);
          if (song.isLocal) {
            toast.error(`本地音频加载失败，即将跳过：\n${song.localPath || song.name}`);
          } else {
            toast.error(`音频流加载失败(Error Code: ${audio.error?.code})，已尝试全部备选音源，即将自动跳过下一首。`);
          }
          playIntentRef.current = false;
          isPlayingRef.current = false;
          playbackActions.setIsPlaying(false);
          releasePauseSuppress();
          scheduleAutoSkip('audio error');
        })();
      };

      onCanPlayRef.current = { canplay: onCanPlay, error: onError };
      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('loadeddata', onCanPlay);
      audio.addEventListener('error', onError);

      // 直接给 audio 元素赋予新地址，保留已有的用户手势与前台播放授权
      if (audio.src !== playUrl) {
        audio.src = playUrl;
      }

      // 无论资源是否已在缓冲区，只要有播放意图立刻发起 play() 启动流拉取与解码
      if (playIntentRef.current) {
        startPlaybackIfNeeded();
      }
    } catch (err) {
      console.error('Error loading song details:', err);
      playIntentRef.current = false;
      isPlayingRef.current = false;
      playbackActions.setIsPlaying(false);
      releasePauseSuppress();
      toast.error('无法加载该歌曲的播放资源。\n\n建议：如果频繁发生，请尝试在“设置”中配置代理，或者勾选更换其他第三方接口节点。');
    } finally {
      if (currentSession === playSessionIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSongEnded = () => {
    // ended 事件与 timeupdate 兜底都可能调用此函数，用 guard 保证只处理一次
    if (endedGuardRef.current) return;
    endedGuardRef.current = true;
    playIntentRef.current = true;
    if (playModeRef.current === 'single-loop') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        isPlayingRef.current = true;
        playbackActions.setIsPlaying(true);
        audioRef.current.play()
          .catch(console.error)
          .finally(() => {
            // 重新播放后解除 guard，允许下次自然结束再次触发
            endedGuardRef.current = false;
          });
      }
      return;
    }

    const pl = playlistRef.current;
    if (pl.length === 0) return;

    const nextIdx = playModeRef.current === 'random'
      ? Math.floor(Math.random() * pl.length)
      : (playIndexRef.current + 1) % pl.length;

    playSongAtIndex(nextIdx, { forceReplay: true });
  };

  // 记录播放历史（去重：同一首歌 5 秒内不重复记录）
  const lastRecordedRef = useRef<string>('');
  const lastRecordedTimeRef = useRef<number>(0);

  // 历史持久化防抖：避免每次播放都把整个 history（最多 1000 条完整 Song）
  // 同步 stringify 写入 localStorage，主线程开销大。改为延迟合并写入。
  const persistHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePersistHistory = (entries: HistoryEntry[]) => {
    if (persistHistoryTimerRef.current) clearTimeout(persistHistoryTimerRef.current);
    persistHistoryTimerRef.current = setTimeout(() => {
      storage.setJSON(
        StorageKeys.PLAY_HISTORY,
        entries.map(e => ({ ...e, song: stripEphemeralStreamUrl(e.song) })),
      );
      persistHistoryTimerRef.current = null;
    }, 1500);
  };

  const flushPlayHistory = () => {
    if (!persistHistoryTimerRef.current) return;
    clearTimeout(persistHistoryTimerRef.current);
    persistHistoryTimerRef.current = null;
    storage.setJSON(
      StorageKeys.PLAY_HISTORY,
      playHistoryRef.current.map(e => ({ ...e, song: stripEphemeralStreamUrl(e.song) })),
    );
  };

  // 退出/切后台时立即刷盘，避免 1.5s 防抖丢最近记录
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPlayHistory();
    };
    window.addEventListener('beforeunload', flushPlayHistory);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', flushPlayHistory);
      document.removeEventListener('visibilitychange', onHide);
      flushPlayHistory();
    };
  }, []);

  const recordPlay = (song: Song) => {
    const now = Date.now();
    // 同一首歌 5 秒内不重复记录
    if (song.id === lastRecordedRef.current && now - lastRecordedTimeRef.current < 5000) return;
    lastRecordedRef.current = song.id;
    lastRecordedTimeRef.current = now;

    setPlayHistory(prev => {
      // 纯追加：不再去重，为了智能歌单能够正确统计播放次数
      const entrySong = stripEphemeralStreamUrl(song);
      const updated = [{ song: entrySong, playedAt: now }, ...prev].slice(0, 1000);
      schedulePersistHistory(updated);
      return updated;
    });
  };

  // 本周最爱：最近 7 天播放次数 Top 50
  // 用 useMemo 仅在 playHistory 变化时重算，避免每次渲染都遍历全量历史
  const topPlayed = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = playHistory.filter(e => e.playedAt >= weekAgo);
    const countMap = new Map<string, { entry: HistoryEntry; count: number }>();
    for (const entry of recent) {
      const existing = countMap.get(entry.song.id);
      if (existing) {
        existing.count++;
      } else {
        countMap.set(entry.song.id, { entry, count: 1 });
      }
    }
    return Array.from(countMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map(v => v.entry);
  }, [playHistory]);

  const clearPlayHistory = () => {
    if (persistHistoryTimerRef.current) clearTimeout(persistHistoryTimerRef.current);
    setPlayHistory([]);
    storage.remove(StorageKeys.PLAY_HISTORY);
  };

  // 用当前缓存的原始歌词数据 + 给定偏移重建 lyrics
  const rebuildLyrics = (offset: number) => {
    const raw = rawLyricDataRef.current;
    if (!raw.original) return;
    setLyrics(parseLrcWithExtras(raw.original, raw.translated, raw.romanized, offset));
  };

  const adjustLyricOffset = (delta: number) => {
    setLyricOffset(prev => {
      // 限制在 ±10 秒内，步长 0.5 秒对齐
      const next = Math.round((prev + delta) * 2) / 2;
      const clamped = Math.max(-10, Math.min(10, next));
      rebuildLyrics(clamped);
      return clamped;
    });
  };

  const resetLyricOffset = () => {
    setLyricOffset(0);
    rebuildLyrics(0);
  };

  const toggleShowTranslation = () => {
    setShowTranslation(prev => {
      const next = !prev;
      storage.setString(StorageKeys.SHOW_TRANSLATION, String(next));
      return next;
    });
  };

  const playSong = async (song: Song) => {
    playIntentRef.current = true;
    const pl = playlistRef.current;
    const idx = pl.findIndex(s => s.id === song.id);
    if (idx >= 0) {
      playSongAtIndex(idx);
      return;
    }

    const newPlaylist = [...pl, song];
    playlistRef.current = newPlaylist;
    setPlaylist(newPlaylist);
    playSongAtIndex(newPlaylist.length - 1, { forceReplay: true });
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    // 读 ref 而非闭包 isPlaying，保证拿到最新状态
    if (isPlayingRef.current || playIntentRef.current) {
      playIntentRef.current = false;
      audio.pause();
      isPlayingRef.current = false;
      playbackActions.setIsPlaying(false);
    } else {
      playIntentRef.current = true;
      audio.play()
        .then(() => {
          isPlayingRef.current = true;
          playbackActions.setIsPlaying(true);
        })
        .catch(err => {
          console.error('Toggle play failed:', err);
          playIntentRef.current = false;
        });
    }
  };

  const stopPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playIntentRef.current = false;
    suppressPauseSyncRef.current = false;
    audio.pause();
    isPlayingRef.current = false;
    playbackActions.setIsPlaying(false);
    audio.currentTime = 0;
    playbackActions.setCurrentTime(0);
  };

  const reloadCurrentSong = () => {
    const idx = playIndexRef.current;
    const pl = playlistRef.current;
    if (idx < 0 || idx >= pl.length) return;
    const song = pl[idx];
    if (song.isLocal) return;
    resourceCache.invalidateUrl(song.source, resolveOnlineApiId(song));
    void loadSongDetails({ ...song, url: null });
  };

  const nextSong = () => {
    const pl = playlistRef.current;
    if (pl.length === 0) return;
    playIntentRef.current = true;
    const nextIdx = playModeRef.current === 'random'
      ? Math.floor(Math.random() * pl.length)
      : (playIndexRef.current + 1) % pl.length;
    playSongAtIndex(nextIdx, { forceReplay: true });
  };

  const prevSong = () => {
    const pl = playlistRef.current;
    if (pl.length === 0) return;
    playIntentRef.current = true;
    const prevIdx = playModeRef.current === 'random'
      ? Math.floor(Math.random() * pl.length)
      : (playIndexRef.current - 1 + pl.length) % pl.length;
    playSongAtIndex(prevIdx, { forceReplay: true });
  };

  const seekTo = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      playbackActions.setCurrentTime(time);
    }
  };

  // 注册系统级媒体控制事件（车机方向盘、通知栏控制器、蓝牙按键）
  useEffect(() => {
    const cleanup = setupMediaSessionHandlers({
      onPlay: () => {
        const audio = audioRef.current;
        if (audio && audio.src) {
          playIntentRef.current = true;
          audio.play().catch(console.error);
        }
      },
      onPause: () => {
        const audio = audioRef.current;
        if (audio) {
          playIntentRef.current = false;
          audio.pause();
        }
      },
      onNext: () => nextSong(),
      onPrev: () => prevSong(),
      onSeek: (time: number) => seekTo(time),
    });
    return cleanup;
  }, [nextSong, prevSong]);

  const setVolumeLevel = (vol: number) => {
    const safeVol = Math.max(0, Math.min(1, vol));
    setVolume(safeVol);
    storage.setString(StorageKeys.VOLUME, String(safeVol));
    if (audioRef.current) audioRef.current.volume = safeVol;
  };

  const changePlayMode = () => {
    setPlayMode(prev => {
      let next: PlayMode = 'list-loop';
      if (prev === 'list-loop') next = 'single-loop';
      else if (prev === 'single-loop') next = 'random';
      else next = 'list-loop';

      const modeLabels: Record<PlayMode, string> = {
        'list-loop': '列表循环',
        'single-loop': '单曲循环',
        'random': '随机播放',
      };
      toast.info(`已切换为：${modeLabels[next]}`);
      return next;
    });
  };

  const addToPlaylist = (song: Song, playImmediately = false) => {
    const pl = playlistRef.current;
    const idx = pl.findIndex(s => s.id === song.id);
    if (idx >= 0) {
      if (playImmediately) {
        playSongAtIndex(idx);
      }
      return;
    }

    const newPlaylist = [...pl, song];
    playlistRef.current = newPlaylist;
    setPlaylist(newPlaylist);
    if (playImmediately) {
      playSongAtIndex(newPlaylist.length - 1, { forceReplay: true });
    }
  };

  const removeFromPlaylist = (songId: string) => {
    const pl = playlistRef.current;
    const idx = pl.findIndex(s => s.id === songId);
    if (idx < 0) return;

    const newPlaylist = pl.filter(s => s.id !== songId);
    playlistRef.current = newPlaylist;
    setPlaylist(newPlaylist);

    if (newPlaylist.length === 0) {
      playIntentRef.current = false;
      setPlayIndex(-1);
      playIndexRef.current = -1;
      isPlayingRef.current = false;
      playbackActions.setIsPlaying(false);
      if (audioRef.current) audioRef.current.src = '';
    } else if (idx === playIndexRef.current) {
      const nextIdx = idx >= newPlaylist.length ? 0 : idx;
      playSongAtIndex(nextIdx);
    } else if (idx < playIndexRef.current) {
      const nextIdx = playIndexRef.current - 1;
      playIndexRef.current = nextIdx;
      setPlayIndex(nextIdx);
    }
  };

  const clearPlaylist = () => {
    playIntentRef.current = false;
    playlistRef.current = [];
    setPlaylist([]);
    setPlayIndex(-1);
    playIndexRef.current = -1;
    isPlayingRef.current = false;
    playbackActions.setIsPlaying(false);
    if (audioRef.current) audioRef.current.src = '';
    playbackActions.reset();
  };

  const playAll = (songs: Song[]) => {
    if (songs.length === 0) return;
    playlistRef.current = songs;
    setPlaylist(songs);
    playSongAtIndex(0, { forceReplay: true });
  };

  const addAllToPlaylist = (songs: Song[]) => {
    if (songs.length === 0) return;
    setPlaylist(prev => {
      const existingIds = new Set(prev.map(s => s.id));
      const newSongs = songs.filter(s => !existingIds.has(s.id));
      return [...prev, ...newSongs];
    });
  };

  const isFavorite = (songId: string) => favoriteSongs.some(s => s.id === songId);

  const isFavoritePlaylist = (id: string) => favoritePlaylists.some(p => p.id === id);

  const toggleFavoritePlaylist = (playlistInfo: FavoritePlaylist) => {
    setFavoritePlaylists(prev => {
      const isFav = prev.some(p => p.id === playlistInfo.id);
      const newFavs = isFav ? prev.filter(p => p.id !== playlistInfo.id) : [...prev, playlistInfo];
      storage.setJSON(StorageKeys.FAVORITE_PLAYLISTS, newFavs);
      return newFavs;
    });
  };

  const isFavoriteArtist = (id: string) => {
    return favoriteArtists.some(a => a.id === id);
  };

  const toggleFavoriteArtist = (artistInfo: FavoriteArtist) => {
    setFavoriteArtists(prev => {
      const isFav = prev.some(a => a.id === artistInfo.id);
      const newFavs = isFav ? prev.filter(a => a.id !== artistInfo.id) : [...prev, artistInfo];
      storage.setJSON(StorageKeys.FAVORITE_ARTISTS, newFavs);
      return newFavs;
    });
  };

  const persistFavorites = (updater: (songs: Song[]) => Song[]) => {
    setFavoriteSongs(prev => {
      const updated = updater(prev);
      storage.setJSON(
        StorageKeys.FAVORITE_SONGS,
        updated.map(s => (s.isLocal ? s : stripEphemeralStreamUrl(s))),
      );
      return updated;
    });
  };

  const upsertFavorite = (song: Song) => {
    persistFavorites(prev => {
      const idx = prev.findIndex(item => item.id === song.id);
      if (idx < 0) return [...prev, song];

      const updated = [...prev];
      updated[idx] = song;
      return updated;
    });
  };

  const toggleFavorite = async (song: Song) => {
    const existsInFavorites = favoriteSongs.some(s => s.id === song.id);
    if (existsInFavorites) {
      favoriteDownloadTokenRef.current.set(
        song.id,
        (favoriteDownloadTokenRef.current.get(song.id) || 0) + 1,
      );
      persistFavorites(prev => prev.filter(s => s.id !== song.id));
      return;
    }

    const downloadToken = (favoriteDownloadTokenRef.current.get(song.id) || 0) + 1;
    favoriteDownloadTokenRef.current.set(song.id, downloadToken);

    let songToSave: Song = {
      ...stripEphemeralStreamUrl(song),
      url: song.isLocal ? (song.url || song.localPath || null) : null,
    };
    upsertFavorite(songToSave);

    if (!song.isLocal && getDownloadOnFavorite()) {
      const downloadPath = getDownloadPath();
      if (isTauri && !(await directoryExists(downloadPath))) {
        toast.error(`收藏下载目录不存在，请先到设置中重新选择：\n${downloadPath}`);
        return;
      }

      try {
        const fileName = sanitizeFileName(`${songToSave.artist} - ${songToSave.name}.mp3`);
        const filePath = joinPath(downloadPath, fileName);
        const lrcFileName = sanitizeFileName(`${songToSave.artist} - ${songToSave.name}.lrc`);
        const lrcPath = joinPath(downloadPath, lrcFileName);

        if (isTauri && !(await exists(filePath))) {
          const apiId = resolveOnlineApiId(song);
          let downloadUrl = resourceCache.getUrl(song.source, apiId, getPreferredQuality());
          if (!downloadUrl) {
            downloadUrl = await MusicApiService.getSongUrl(apiId, song.source, getPreferredQuality());
            if (downloadUrl) resourceCache.setUrl(song.source, apiId, getPreferredQuality(), downloadUrl);
          }
          if (!downloadUrl) {
            downloadUrl = resourceCache.getUrl(song.source, apiId, getPreferredQuality(), true);
          }

          if (!downloadUrl) {
            toast.warning(`未能获取歌曲下载地址，已收藏但无法下载：${song.artist} - ${song.name}`);
            return;
          }

          await downloadFile(downloadUrl, filePath, (percent) => {
            console.log(`[下载] ${song.artist} - ${song.name}: ${percent.toFixed(0)}%`);
          });
        }

        if (favoriteDownloadTokenRef.current.get(song.id) !== downloadToken) return;

        let lyricText = songToSave.lyric || '';
        if (!lyricText && songToSave.lyric_id) {
          lyricText = (await MusicApiService.getSongLyric(songToSave.lyric_id, songToSave.source)).original;
        }
        if (isTauri && lyricText && !(await exists(lrcPath))) {
          await writeFile(lrcPath, new TextEncoder().encode(lyricText));
        }

        if (favoriteDownloadTokenRef.current.get(song.id) !== downloadToken) return;

        songToSave = {
          ...songToSave,
          id: song.id,
          url: filePath,
          isLocal: true,
          localPath: filePath,
          lyric: lyricText,
        };
        upsertFavorite(songToSave);
      } catch (err) {
        if (favoriteDownloadTokenRef.current.get(song.id) !== downloadToken) return;
        console.error('Failed to download favorite song:', err);
        toast.error(`已收藏，但下载歌曲失败：${song.artist} - ${song.name}`);
      }
    }
  };

  const loadLocalSongData = async (song: Song): Promise<{ lyricText: string, picUrl: string | null }> => {
    const localPath = song.localPath || song.url || '';
    if (!song.isLocal || !localPath) return { lyricText: '', picUrl: null };

    const sameNameLrcPath = `${withoutExtension(localPath)}.lrc`;
    let existingLyric = '';
    try {
      const content = await readTextFile(sameNameLrcPath);
      if (content) existingLyric = content;
    } catch {
      // No local lyric yet.
    }

    try {
      const source = getDefaultSearchSource();
      const searchResults = await MusicApiService.searchSongs(`${song.artist} ${song.name}`, source);
      const songNameLower = song.name.toLowerCase().trim();
      const artistToken = song.artist.split(/[/,&，、]/)[0]?.toLowerCase().trim() || '';
      // 高置信匹配：歌名足够像 + 歌手对得上；不再盲目取 searchResults[0]
      const matched = searchResults.find(s => {
        const candidateName = s.name.toLowerCase().trim();
        const nameClose =
          candidateName === songNameLower ||
          (songNameLower.length >= 4 && (
            candidateName.includes(songNameLower) || songNameLower.includes(candidateName)
          ));
        if (!nameClose) return false;
        if (!artistToken || artistToken === '未知歌手') return candidateName === songNameLower;
        const candidateArtist = s.artist.toLowerCase();
        return candidateArtist.includes(artistToken) || artistToken.includes(candidateArtist.split(/[/,&，、]/)[0] || '');
      });

      if (!matched) return { lyricText: existingLyric, picUrl: null };

      let fetchedPic = matched.pic || null;
      if (!fetchedPic && matched.pic_id) {
        fetchedPic = await MusicApiService.getSongPic(matched.pic_id, matched.source) || null;
      }

      if (existingLyric) {
        return { lyricText: existingLyric, picUrl: fetchedPic };
      }

      if (!matched.lyric_id) return { lyricText: '', picUrl: fetchedPic };

      const lyricText = (await MusicApiService.getSongLyric(matched.lyric_id, matched.source)).original;
      if (!lyricText) return { lyricText: '', picUrl: fetchedPic };

      await writeFile(sameNameLrcPath, new TextEncoder().encode(lyricText));
      return { lyricText, picUrl: fetchedPic };
    } catch (err) {
      console.warn('Failed to search or save online data for local song:', song.name, err);
      return { lyricText: existingLyric, picUrl: null };
    }
  };

  const loadLocalSongLyric = async (song: Song): Promise<string> => {
    const data = await loadLocalSongData(song);
    return data.lyricText;
  };

  // 公共：从目录条目构建 Song，优先用 Rust 读取真实元数据，失败则 fallback 到文件名解析
  const buildSongFromEntry = async (dir: string, name: string): Promise<Song | null> => {
    if (!isAudioFile(name)) return null;

    const localPath = joinPath(dir, name);
    const id = `local_${(md5 as unknown as (value: string) => string)(localPath)}`;

    let songName = '';
    let artist = '';
    let album = '本地导入';
    let duration = 0;

    try {
      const meta = await readAudioMetadata(localPath);
      // 有真实 tag 才覆盖，否则 fallback 到文件名
      songName = meta.title || parseSongName(name).name;
      artist = meta.artist || parseSongName(name).artist;
      if (meta.album) album = meta.album;
      duration = meta.durationSecs || 0;
    } catch {
      const fallback = parseSongName(name);
      songName = fallback.name;
      artist = fallback.artist;
    }

    return {
      id,
      name: songName,
      artist,
      album,
      url: null,
      pic: null,
      duration,
      isLocal: true,
      localPath,
      source: 'local',
    };
  };

  const importLocalDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '请选择包含音乐文件的文件夹',
      });

      if (!selected || Array.isArray(selected)) return;

      const entries = await readDir(selected);
      const audioFiles: Song[] = [];

      for (const entry of entries) {
        if (!entry.isFile) continue;
        const song = await buildSongFromEntry(selected, entry.name);
        if (song) audioFiles.push(song);
      }

      if (audioFiles.length > 0 || selected) {
        setLocalDirectory(selected);
        storage.setString(StorageKeys.LOCAL_DIRECTORY, selected);
      }

      setLocalSongs(prev => {
        const existingPaths = new Set(prev.map(s => s.localPath));
        const filteredNew = audioFiles.filter(s => !existingPaths.has(s.localPath));
        const merged = [...prev, ...filteredNew];
        storage.setJSON(StorageKeys.LOCAL_SONGS, merged);
        return merged;
      });
    } catch (err) {
      console.error('Failed to import local folder:', err);
    }
  };

  const refreshLocalDirectory = async () => {
    // 聚合：当前目录 + 已导入歌曲涉及的所有父目录（支持多目录 import 后刷新不丢）
    const dirs = new Set<string>();
    if (localDirectory) dirs.add(localDirectory);
    for (const s of localSongs) {
      const path = s.localPath;
      if (!path) continue;
      const slash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
      if (slash > 0) dirs.add(path.slice(0, slash));
    }
    if (dirs.size === 0) return;

    try {
      const audioFiles: Song[] = [];
      const seenPaths = new Set<string>();

      for (const dir of dirs) {
        try {
          const entries = await readDir(dir);
          for (const entry of entries) {
            if (!entry.isFile) continue;
            const song = await buildSongFromEntry(dir, entry.name);
            if (song?.localPath && !seenPaths.has(song.localPath)) {
              seenPaths.add(song.localPath);
              audioFiles.push(song);
            }
          }
        } catch (err) {
          console.warn('Failed to refresh local folder:', dir, err);
        }
      }

      setLocalSongs(audioFiles);
      storage.setJSON(StorageKeys.LOCAL_SONGS, audioFiles);
    } catch (err) {
      console.error('Failed to refresh local folders:', err);
    }
  };

  // 收藏变动时自动防抖静默同步到云端（基于设备 ID）
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (favoriteSongs.length === 0 && favoritePlaylists.length === 0 && favoriteArtists.length === 0) {
      return;
    }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void backupFavoritesToCloud({
        songs: favoriteSongs,
        playlists: favoritePlaylists,
        artists: favoriteArtists,
      });
      syncTimerRef.current = null;
    }, 2500);
  }, [favoriteSongs, favoritePlaylists, favoriteArtists]);

  // 手动触发一次云端同步
  const syncFavoritesNow = async () => {
    try {
      const backupOk = await backupFavoritesToCloud({
        songs: favoriteSongs,
        playlists: favoritePlaylists,
        artists: favoriteArtists,
      });
      const cloudData = await restoreFavoritesFromCloud();
      if (cloudData && cloudData.songs && cloudData.songs.length > 0) {
        // 合并云端与本地歌曲
        const localMap = new Map(favoriteSongs.map(s => [s.id, s]));
        cloudData.songs.forEach(s => {
          if (!localMap.has(s.id)) {
            localMap.set(s.id, normalizePersistedSong(s));
          }
        });
        const merged = Array.from(localMap.values());
        setFavoriteSongs(merged);
        storage.setJSON(
          StorageKeys.FAVORITE_SONGS,
          merged.map(s => (s.isLocal ? s : stripEphemeralStreamUrl(s))),
        );
        toast.success(`云端同步成功！已同步 ${merged.length} 首收藏歌曲`);
      } else if (backupOk) {
        toast.success(`已将当前 ${favoriteSongs.length} 首收藏成功备份至云端`);
      } else {
        toast.success('已连接云端同步服务');
      }
    } catch (err: any) {
      console.error('Manual sync failed:', err);
      toast.error(`同步失败: ${err?.message || '网络异常'}`);
    }
  };

  // 导出收藏备份文件
  const exportFavorites = () => {
    try {
      const filename = exportFavoritesToFile({
        songs: favoriteSongs,
        playlists: favoritePlaylists,
        artists: favoriteArtists,
      });
      toast.success(`收藏已成功导出为文件：\n${filename}`);
    } catch (err: any) {
      toast.error(`导出失败: ${err?.message || '未知错误'}`);
    }
  };

  // 从文件导入收藏备份
  const importFavorites = async (file: File) => {
    try {
      const data = await importFavoritesFromFile(file);
      if (!data.songs || data.songs.length === 0) {
        toast.error('导入的文件中未发现有效的歌曲数据');
        return;
      }

      // 合并入当前收藏列表
      const localMap = new Map(favoriteSongs.map(s => [s.id, s]));
      let addedCount = 0;
      data.songs.forEach(s => {
        if (!localMap.has(s.id)) {
          localMap.set(s.id, normalizePersistedSong(s));
          addedCount++;
        }
      });
      const merged = Array.from(localMap.values());
      setFavoriteSongs(merged);
      storage.setJSON(
        StorageKeys.FAVORITE_SONGS,
        merged.map(s => (s.isLocal ? s : stripEphemeralStreamUrl(s))),
      );

      // 合并歌单与歌手
      if (data.playlists && data.playlists.length > 0) {
        const plMap = new Map(favoritePlaylists.map(p => [p.id, p]));
        data.playlists.forEach(p => plMap.set(p.id, p));
        const mergedPl = Array.from(plMap.values());
        setFavoritePlaylists(mergedPl);
        storage.setJSON(StorageKeys.FAVORITE_PLAYLISTS, mergedPl);
      }

      if (data.artists && data.artists.length > 0) {
        const arMap = new Map(favoriteArtists.map(a => [a.id, a]));
        data.artists.forEach(a => arMap.set(a.id, a));
        const mergedAr = Array.from(arMap.values());
        setFavoriteArtists(mergedAr);
        storage.setJSON(StorageKeys.FAVORITE_ARTISTS, mergedAr);
      }

      // 立即触发一次云端备份
      void backupFavoritesToCloud({
        songs: merged,
        playlists: favoritePlaylists,
        artists: favoriteArtists,
      });

      toast.success(`成功导入收藏！新增 ${addedCount} 首歌曲，当前共 ${merged.length} 首`);
    } catch (err: any) {
      console.error('Import failed:', err);
      toast.error(`导入失败: ${err?.message || '文件格式不正确'}`);
    }
  };

  return (
    <PlayerContext.Provider value={{
      currentSong,
      isLoading,
      playlist,
      playIndex,
      playMode,
      volume,
      lyrics,
      currentLyricIndex,
      localSongs,
      favoriteSongs,
      isFavorite,
      playSong,
      togglePlay,
      stopPlayback,
      reloadCurrentSong,
      nextSong,
      prevSong,
      seekTo,
      setVolumeLevel,
      changePlayMode,
      addToPlaylist,
      removeFromPlaylist,
      clearPlaylist,
      playAll,
      addAllToPlaylist,
      toggleFavorite,
      importLocalDirectory,
      loadLocalSongLyric,
      localDirectory,
      refreshLocalDirectory,
      favoritePlaylists,
      isFavoritePlaylist,
      toggleFavoritePlaylist,
      favoriteArtists,
      isFavoriteArtist,
      toggleFavoriteArtist,
      playHistory,
      topPlayed,
      clearPlayHistory,
      lyricOffset,
      adjustLyricOffset,
      resetLyricOffset,
      showTranslation,
      toggleShowTranslation,
      analyser,
      syncFavoritesNow,
      exportFavorites,
      importFavorites,
    }}>
      {/* 不设 crossOrigin：在线 CDN 常无 CORS，会导致 Android/WebView 无声或无法解码。
          不用 display:none：Android WebView 会把不可见媒体元素节流，导致 ended 事件丢失、
          播放结束不连播。改用屏幕外 1px 视觉隐藏，元素仍参与渲染/不被节流。 */}
      <audio ref={audioRef} preload="auto" style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '1px', height: '1px', opacity: '0' }} />
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};
