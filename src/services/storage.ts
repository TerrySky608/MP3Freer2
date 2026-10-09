/**
 * localStorage 抽象层
 * 统一 JSON 序列化与异常处理，避免散落的 try/catch
 * key 保持原样（不自动加前缀），向后兼容现有数据
 */

export const storage = {
  /** 读取并 JSON 解析，失败返回 fallback */
  getJSON<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[storage] Failed to parse JSON for key "${key}":`, err);
      return fallback;
    }
  },

  /** JSON 序列化后写入 */
  setJSON<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn(`[storage] Failed to serialize for key "${key}":`, err);
    }
  },

  /** 读取原始字符串 */
  getString(key: string): string | null {
    return localStorage.getItem(key);
  },

  /** 写入原始字符串 */
  setString(key: string, value: string): void {
    localStorage.setItem(key, value);
  },

  /** 读取布尔值（默认 false，除非值 === 'true'） */
  getBool(key: string, fallback = false): boolean {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  },

  /** 移除 */
  remove(key: string): void {
    localStorage.removeItem(key);
  },
};

/** 项目内统一使用的 localStorage key 常量 */
export const StorageKeys = {
  LOCAL_SONGS: 'mp3freer_local_songs',
  FAVORITE_SONGS: 'mp3freer_favorite_songs',
  PLAY_HISTORY: 'mp3freer_play_history',
  CURRENT_PLAYLIST: 'mp3freer_current_playlist',
  CURRENT_PLAYINDEX: 'mp3freer_current_playindex',
  FAVORITE_PLAYLISTS: 'mp3freer_favorite_playlists',
  FAVORITE_ARTISTS: 'mp3freer_favorite_artists',
  SHOW_TRANSLATION: 'mp3freer_show_translation',
  LOCAL_DIRECTORY: 'local_directory_key',
  VOLUME: 'mp3freer_volume',
} as const;
