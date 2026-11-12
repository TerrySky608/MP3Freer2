import { Song, FavoritePlaylist, FavoriteArtist } from '../types/music';
import { storage, StorageKeys } from './storage';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface FavoritesBackupData {
  version: string;
  app: string;
  syncCode: string;
  deviceId: string;
  exportedAt: number;
  favorites: {
    songs: Song[];
    playlists: FavoritePlaylist[];
    artists: FavoriteArtist[];
  };
}

/**
 * 按照规则生成随机暗号：SKY-开头 + 1个随机大写字母 + 1个随机三位数
 * 例如: SKY-A128, SKY-K892, SKY-Z007
 */
export function generateRandomSyncCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const randomLetter = letters[Math.floor(Math.random() * letters.length)];
  const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `SKY-${randomLetter}${randomNum}`;
}

export const DEFAULT_SYNC_CODE = 'SKY-R608';
/** 默认基于 Vercel 代理 → Cloudflare KV 的永久云端同步中继网关（国内直连，永久存储） */
export const DEFAULT_KV_RELAY_URL = 'https://music.terrysky.fun/cloudsync';
const DEVICE_ID_KEY = 'mp3tao_device_id';
const LAST_SYNC_TIME_KEY = 'mp3tao_last_sync_time';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

async function universalFetch(url: string, options?: any) {
  if (isTauri) {
    return await tauriFetch(url, options);
  }
  return await fetch(url, options);
}

/** 带超时限制的请求封装（避免某些境外节点在国内无 VPN 时长时间挂起） */
async function fetchWithTimeout(url: string, options?: any, timeoutMs = 3500): Promise<any> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`请求超时(${timeoutMs}ms)`)), timeoutMs);
  });
  try {
    const fetchPromise = universalFetch(url, options);
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 获取当前同步暗号（若本地未设置，则自动按规则生成并持久化一个独立随机暗号） */
export function getSyncCode(): string {
  if (typeof window === 'undefined') return DEFAULT_SYNC_CODE;
  const saved = storage.getString(StorageKeys.SYNC_CODE);
  if (saved && saved.trim().length > 0) {
    return saved.trim();
  }
  const newCode = generateRandomSyncCode();
  storage.setString(StorageKeys.SYNC_CODE, newCode);
  return newCode;
}

/** 设置同步暗号 */
export function setSyncCode(code: string): void {
  const clean = (code || '').trim() || generateRandomSyncCode();
  storage.setString(StorageKeys.SYNC_CODE, clean);
}

/** 获取自定义同步服务器地址（可选） */
export function getSyncServerUrl(): string {
  if (typeof window === 'undefined') return '';
  let val = storage.getString(StorageKeys.SYNC_SERVER_URL) || '';
  // 若残留有境内阻断的 workers.dev 地址，自动重置为空，以便默认走极速直连的 music.terrysky.fun
  if (val.includes('workers.dev')) {
    storage.setString(StorageKeys.SYNC_SERVER_URL, '');
    val = '';
  }
  return val;
}

/** 获取当前生效的同步目标端点描述（用于用户界面与弹窗精确提示） */
export function getSyncEndpointDescription(): { name: string; host: string } {
  const serverUrl = getSyncServerUrl();
  if (serverUrl) {
    try {
      const u = new URL(serverUrl);
      return { name: `自建节点 (${u.host})`, host: u.host };
    } catch {
      return { name: `自建节点 (${serverUrl})`, host: serverUrl };
    }
  }
  return { name: '专属永久云 (music.terrysky.fun)', host: 'music.terrysky.fun' };
}

/** 设置自定义同步服务器地址 */
export function setSyncServerUrl(url: string): void {
  storage.setString(StorageKeys.SYNC_SERVER_URL, (url || '').trim());
}

/**
 * 获取本机的唯一设备识别码（用于日志与来源追踪）
 */
export function getDeviceId(): string {
  if (typeof window !== 'undefined') {
    const bridge = (window as any).AndroidMediaBridge;
    if (bridge && typeof bridge.getDeviceId === 'function') {
      try {
        const androidId = bridge.getDeviceId();
        if (androidId && typeof androidId === 'string' && androidId.trim().length > 4) {
          return `android_${androidId.trim()}`;
        }
      } catch (e) {
        console.warn('Failed to get native Android ID:', e);
      }
    }

    let saved = localStorage.getItem(DEVICE_ID_KEY);
    if (!saved || saved.length < 8) {
      saved = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, saved);
    }
    return saved;
  }
  return 'unknown_device';
}

export function getLastSyncTime(): number {
  if (typeof window === 'undefined') return 0;
  const t = localStorage.getItem(LAST_SYNC_TIME_KEY);
  return t ? Number(t) || 0 : 0;
}

export function setLastSyncTime(time: number): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_SYNC_TIME_KEY, String(time));
  }
}

/** 将暗号转换为安全的网络路径标识（保留连字符与下划线，使用户在浏览器直连时与暗号字面完全对齐） */
function getSafeSyncPath(syncCode: string): string {
  const safe = (syncCode || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `mp3tao_sync_${safe || 'SKY-R608'}`;
}

/** 纯净化收藏歌曲：剥离临时流地址及大段歌词文本，大幅缩减体积并加速同步与持久化 */
export function sanitizeFavoriteSong(s: Song): Song {
  const { lyric, ...rest } = s;
  return {
    ...rest,
    url: s.isLocal ? (s.localPath || s.url || null) : null,
  };
}

/** 后台静默异步将数据冗余推送到备用剪贴板通道（不阻塞界面响应） */
async function pushFallbackMirrorAsync(syncCode: string, payload: FavoritesBackupData): Promise<void> {
  try {
    const path = getSafeSyncPath(syncCode);
    const postBody = new URLSearchParams({
      content: JSON.stringify(payload),
      ttl: '1550',
    }).toString();

    await universalFetch(`https://cl1p.net/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      body: postBody,
    });
  } catch (err) {
    console.warn('[SyncService] Background mirror push silent error:', err);
  }
}

/**
 * 将收藏数据备份到云端（以暗号 SKY-0608 为凭证）
 */
export async function backupFavoritesToCloud(favorites: {
  songs: Song[];
  playlists: FavoritePlaylist[];
  artists: FavoriteArtist[];
}): Promise<{ success: boolean; message?: string; target?: string }> {
  const syncCode = getSyncCode();
  const deviceId = getDeviceId();
  const now = Date.now();

  try {
    // 过滤在线歌曲临时的短期有效流 url 并剔除歌词文本，保持数据极简轻量
    const cleanedSongs = (favorites.songs || []).map(sanitizeFavoriteSong);

    const payload: FavoritesBackupData = {
      version: '1.0',
      app: 'MP3Tao',
      syncCode,
      deviceId,
      exportedAt: now,
      favorites: {
        songs: cleanedSongs,
        playlists: favorites.playlists || [],
        artists: favorites.artists || [],
      },
    };

    const serverUrl = getSyncServerUrl();

    // 1. 若配置了自定义云端同步服务器，优先推送到自定义服务器
    if (serverUrl) {
      try {
        const resp = await fetchWithTimeout(
          `${serverUrl.replace(/\/+$/, '')}/api/sync`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Id': deviceId,
              'X-Sync-Code': syncCode,
            },
            body: JSON.stringify({
              action: 'backup',
              syncCode,
              deviceId,
              favorites: payload.favorites,
            }),
          },
          3500
        );
        if (resp && resp.ok) {
          const resData = await resp.json().catch(() => null);
          if (resData && resData.success) {
            setLastSyncTime(now);
            return { success: true, target: '自建节点' };
          }
        }
      } catch (custErr) {
        console.warn('Custom sync server failed, falling back to public relay:', custErr);
      }
    }

    // 2. 默认国内直连专属永久云中继（music.terrysky.fun → Cloudflare KV，永久持久化，秒级响应）
    const kvBaseUrl = DEFAULT_KV_RELAY_URL.replace(/\/+$/, '');
    try {
      const kvResp = await fetchWithTimeout(`${kvBaseUrl}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
          'X-Sync-Code': syncCode,
        },
        body: JSON.stringify({
          action: 'backup',
          syncCode,
          deviceId,
          favorites: payload.favorites,
        }),
      }, 3500);
      if (kvResp && kvResp.ok) {
        const resData = await kvResp.json().catch(() => null);
        if (resData && resData.success) {
          setLastSyncTime(now);
          // 在后台静默异步推送到备用镜像，绝不阻塞用户界面响应
          void pushFallbackMirrorAsync(syncCode, payload);
          return { success: true, target: 'music.terrysky.fun' };
        }
      }
    } catch (kvErr) {
      console.warn('Permanent KV relay push warning, trying fallback:', kvErr);
    }

    // 3. 仅在专属永久云连接异常时，才同步阻塞等待备用公共中继（cl1p.net）
    try {
      const path = getSafeSyncPath(syncCode);
      const postBody = new URLSearchParams({
        content: JSON.stringify(payload),
        ttl: '1550',
      }).toString();

      const resp = await universalFetch(`https://cl1p.net/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: postBody,
      });

      if (resp.ok) {
        setLastSyncTime(now);
        return { success: true, target: 'cl1p.net(备用)' };
      }
    } catch (clipErr) {
      console.warn('Fallback relay push warning:', clipErr);
    }

    return { success: false, message: '未能连接云端同步服务，请检查网络' };
  } catch (err: any) {
    console.error('[SyncService] Cloud backup error:', err);
    return { success: false, message: err?.message || '网络连接异常' };
  }
}

/**
 * 从云端拉取恢复收藏数据（以暗号为凭证）
 */
export async function restoreFavoritesFromCloud(): Promise<{
  songs: Song[];
  playlists: FavoritePlaylist[];
  artists: FavoriteArtist[];
  updatedAt: number;
  source?: string;
} | null> {
  const syncCode = getSyncCode();
  const deviceId = getDeviceId();
  const serverUrl = getSyncServerUrl();

  try {
    // 1. 若配置了自定义云端同步服务器，优先拉取
    if (serverUrl) {
      try {
        const resp = await fetchWithTimeout(
          `${serverUrl.replace(/\/+$/, '')}/api/sync?action=restore&syncCode=${encodeURIComponent(syncCode)}&deviceId=${encodeURIComponent(deviceId)}`,
          {
            method: 'GET',
            headers: {
              'X-Device-Id': deviceId,
              'X-Sync-Code': syncCode,
            },
          },
          3500
        );
        if (resp && resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data && data.success && data.favorites) {
            const fav = data.favorites;
            const songs = Array.isArray(fav.songs) ? fav.songs.map(sanitizeFavoriteSong) : [];
            const playlists = Array.isArray(fav.playlists) ? fav.playlists : [];
            const artists = Array.isArray(fav.artists) ? fav.artists : [];
            const updatedAt = data.updatedAt || data.exportedAt || 0;
            if (updatedAt) setLastSyncTime(updatedAt);
            if (songs.length > 0 || playlists.length > 0 || artists.length > 0) {
              return { songs, playlists, artists, updatedAt, source: '自建节点' };
            }
          }
        }
      } catch (custErr) {
        console.warn('Custom sync restore failed, fallback to public relay:', custErr);
      }
    }

    // 2. 默认开箱即用的 Cloudflare KV 永久持久化中继通道（无 TTL 限制，支持永久读取）
    const kvBaseUrl = DEFAULT_KV_RELAY_URL.replace(/\/+$/, '');
    try {
      const kvResp = await fetchWithTimeout(
        `${kvBaseUrl}/api/sync?action=restore&syncCode=${encodeURIComponent(syncCode)}&deviceId=${encodeURIComponent(deviceId)}`,
        {
          method: 'GET',
          headers: {
            'X-Device-Id': deviceId,
            'X-Sync-Code': syncCode,
          },
        },
        3500
      );
      if (kvResp && kvResp.ok) {
        const data = await kvResp.json().catch(() => null);
        if (data && data.success && data.favorites) {
          const fav = data.favorites;
          const songs = Array.isArray(fav.songs) ? fav.songs.map(sanitizeFavoriteSong) : [];
          const playlists = Array.isArray(fav.playlists) ? fav.playlists : [];
          const artists = Array.isArray(fav.artists) ? fav.artists : [];
          const updatedAt = data.updatedAt || data.exportedAt || 0;
          if (updatedAt) setLastSyncTime(updatedAt);
          if (songs.length > 0 || playlists.length > 0 || artists.length > 0) {
            return { songs, playlists, artists, updatedAt, source: 'music.terrysky.fun' };
          }
        }
      }
    } catch (kvErr) {
      console.warn('Permanent KV relay restore warning (falling back to mirror):', kvErr);
    }

    // 3. 冗余公共中继通道（保留中划线，作为双通道兜底）
    const path = getSafeSyncPath(syncCode);
    const resp = await universalFetch(`https://cl1p.net/${path}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (resp.ok) {
      const html = await resp.text();
      const match =
        html.match(/<textarea[^>]*id=["']cl1ptextarea["'][^>]*>([\s\S]*?)<\/textarea>/i) ||
        html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);

      if (match && match[1] && match[1].trim().length > 0) {
        // 严格安全地解码 HTML 实体（&amp; 必须最后替换，避免破坏其它实体转义）
        const rawContent = match[1]
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .trim();

        if (rawContent && rawContent !== '{}') {
          try {
            const parsed = JSON.parse(rawContent);
            const fav = parsed.favorites || parsed;
            const rawSongs = Array.isArray(fav.songs) ? fav.songs : [];
            const songs = rawSongs.map(sanitizeFavoriteSong);
            const playlists = Array.isArray(fav.playlists) ? fav.playlists : [];
            const artists = Array.isArray(fav.artists) ? fav.artists : [];
            const updatedAt = parsed.exportedAt || parsed.updatedAt || 0;
            if (updatedAt) setLastSyncTime(updatedAt);
            return {
              songs,
              playlists,
              artists,
              updatedAt,
              source: 'cl1p.net(备用)',
            };
          } catch (jsonErr) {
            console.warn('[SyncService] Parse cloud json warning:', jsonErr);
          }
        }
      }
    }
    return null;
  } catch (err) {
    console.warn('[SyncService] Cloud restore warning:', err);
    return null;
  }
}

/**
 * 智能合并本地与云端收藏（并集去重，剥离歌词与失效流地址）
 */
export function mergeFavoritesData(
  local: { songs: Song[]; playlists: FavoritePlaylist[]; artists: FavoriteArtist[] },
  cloud: { songs: Song[]; playlists: FavoritePlaylist[]; artists: FavoriteArtist[] }
) {
  // 1. 合并歌曲 (以 ID 去重并纯净化)
  const songMap = new Map<string, Song>();
  (local.songs || []).forEach(s => songMap.set(s.id, sanitizeFavoriteSong(s)));
  (cloud.songs || []).forEach(s => {
    if (!songMap.has(s.id)) {
      songMap.set(s.id, sanitizeFavoriteSong(s));
    }
  });

  // 2. 合并歌单 (以 ID 去重)
  const playlistMap = new Map<string, FavoritePlaylist>();
  (local.playlists || []).forEach(p => playlistMap.set(p.id, p));
  (cloud.playlists || []).forEach(p => {
    if (!playlistMap.has(p.id)) {
      playlistMap.set(p.id, p);
    }
  });

  // 3. 合并歌手 (以 ID 或 name 去重)
  const artistMap = new Map<string, FavoriteArtist>();
  (local.artists || []).forEach(a => artistMap.set(a.id || a.name, a));
  (cloud.artists || []).forEach(a => {
    const key = a.id || a.name;
    if (!artistMap.has(key)) {
      artistMap.set(key, a);
    }
  });

  return {
    songs: Array.from(songMap.values()),
    playlists: Array.from(playlistMap.values()),
    artists: Array.from(artistMap.values()),
  };
}

/**
 * 导出收藏为轻量 JSON 文件并触发下载（彻底剔除歌词与临时流地址）
 */
export function exportFavoritesToFile(favorites: {
  songs: Song[];
  playlists: FavoritePlaylist[];
  artists: FavoriteArtist[];
}) {
  try {
    const syncCode = getSyncCode();
    const backup: FavoritesBackupData = {
      version: '1.0',
      app: 'MP3Tao',
      syncCode,
      deviceId: getDeviceId(),
      exportedAt: Date.now(),
      favorites: {
        songs: (favorites.songs || []).map(sanitizeFavoriteSong),
        playlists: favorites.playlists || [],
        artists: favorites.artists || [],
      },
    };

    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `MP3Terry_收藏备份_${syncCode}_${dateStr}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  } catch (err: any) {
    console.error('Export failed:', err);
    throw err;
  }
}

/**
 * 从上传的 JSON 文件中解析收藏数据（自动剔除大段歌词）
 */
export async function importFavoritesFromFile(file: File): Promise<{
  songs: Song[];
  playlists: FavoritePlaylist[];
  artists: FavoriteArtist[];
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          throw new Error('文件内容为空');
        }
        const data = JSON.parse(text);
        let songs: Song[] = [];
        let playlists: FavoritePlaylist[] = [];
        let artists: FavoriteArtist[] = [];

        if (data.favorites) {
          songs = Array.isArray(data.favorites.songs) ? data.favorites.songs : [];
          playlists = Array.isArray(data.favorites.playlists) ? data.favorites.playlists : [];
          artists = Array.isArray(data.favorites.artists) ? data.favorites.artists : [];
        } else if (Array.isArray(data)) {
          songs = data;
        } else if (Array.isArray(data.songs)) {
          songs = data.songs;
          playlists = data.playlists || [];
          artists = data.artists || [];
        } else {
          throw new Error('无法识别的收藏备份格式');
        }

        resolve({
          songs: songs.map(sanitizeFavoriteSong),
          playlists,
          artists,
        });
      } catch (err: any) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}
