import { exists, readDir } from '@tauri-apps/plugin-fs';
import type { HistoryEntry, Song } from '../types/music';
import type { OnlineSong } from '../services/musicApi';

/**
 * 文件名/路径与歌曲身份相关的纯工具函数
 */

/** 在线歌曲统一转为播放器 Song（所有入口必须走这里，避免 id 不一致） */
export function toPlayerSong(onlineSong: OnlineSong): Song {
  return {
    id: `online_${onlineSong.source}_${onlineSong.id}`,
    originalId: onlineSong.id,
    name: onlineSong.name,
    artist: onlineSong.artist,
    album: onlineSong.album,
    url: null, // 在线流地址易过期，播放时动态解析，不写入 Song
    pic: onlineSong.pic || null,
    duration: onlineSong.duration || 0,
    isLocal: false,
    source: onlineSong.source,
    pic_id: onlineSong.pic_id,
    lyric_id: onlineSong.lyric_id,
  };
}

/** 解析在线歌曲的平台原始 ID（用于 API 请求） */
export function resolveOnlineApiId(song: { id: string; originalId?: string; source?: string }): string {
  if (song.originalId) return song.originalId;
  const prefix = `online_${song.source}_`;
  if (song.id.startsWith(prefix)) return song.id.slice(prefix.length);
  return song.id;
}

/** 规范化用于比对的文本（去除多余空格、不可见字符，转小写） */
export function normalizeSongText(text?: string | null): string {
  if (!text) return '';
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 规范化在线歌曲的统一 Canonical ID */
export function getCanonicalSongId(song: { id: string; originalId?: string; source?: string }): string {
  const source = song.source || '';
  const originalId = song.originalId || (source && song.id.startsWith(`online_${source}_`) ? song.id.slice(`online_${source}_`.length) : song.id);
  if (source) {
    return `online_${source}_${originalId}`.toLowerCase();
  }
  return song.id.toLowerCase();
}

/**
 * 判断两个歌曲实体（或歌曲与ID）是否代表同一首歌曲。
 * 遵循多维等价比对规则：
 * 1. 物理 ID 直接严格匹配（忽略大小写）；
 * 2. 规范化 Canonical ID 匹配（例如 online_netease_186016 与 186016 或 netease 平台 ID）；
 * 3. 语义等价匹配：歌名与歌手规范化后一致（有效歌名且非未知）。
 */
export function isSameSong(
  a: Song | { id: string; originalId?: string; name?: string; artist?: string; source?: string } | null | undefined,
  b: Song | { id: string; originalId?: string; name?: string; artist?: string; source?: string } | string | null | undefined,
): boolean {
  if (!a || !b) return false;

  // 如果 b 是纯 ID 字符串
  if (typeof b === 'string') {
    const bId = b.trim();
    if (!bId) return false;
    if (a.id === bId || a.originalId === bId) return true;
    if (a.id.toLowerCase() === bId.toLowerCase()) return true;
    if (a.originalId && a.originalId.toLowerCase() === bId.toLowerCase()) return true;

    // 检查 a 剥离前缀后的 raw id
    if (a.source) {
      const prefix = `online_${a.source}_`;
      if (a.id.startsWith(prefix) && a.id.slice(prefix.length).toLowerCase() === bId.toLowerCase()) return true;
      if (bId.startsWith(prefix) && bId.slice(prefix.length).toLowerCase() === (a.originalId || a.id).toLowerCase()) return true;
    }
    return false;
  }

  // 1. 物理 ID 直接匹配
  if (a.id === b.id) return true;
  if (a.id && b.id && a.id.toLowerCase() === b.id.toLowerCase()) return true;

  // 2. 规范化 Canonical ID 匹配
  const canonicalA = getCanonicalSongId(a);
  const canonicalB = getCanonicalSongId(b);
  if (canonicalA && canonicalB && canonicalA === canonicalB) return true;

  // 原始 ID + source 相同
  const origA = (a.originalId || resolveOnlineApiId(a)).toLowerCase();
  const origB = (b.originalId || resolveOnlineApiId(b)).toLowerCase();
  if (origA && origB && origA === origB && a.source && b.source && a.source.toLowerCase() === b.source.toLowerCase()) {
    return true;
  }

  // 3. 歌名 + 歌手语义等价比对（核心防重保底机制，即使是本地歌曲与在线歌曲、或者不同格式/音源的同一首歌也能精准对齐）
  const nameA = normalizeSongText(a.name);
  const nameB = normalizeSongText(b.name);
  if (nameA && nameB && nameA === nameB && nameA !== '未知歌曲' && nameA !== 'unknown') {
    const artistA = normalizeSongText(a.artist);
    const artistB = normalizeSongText(b.artist);
    if (!artistA || !artistB || artistA === '未知歌手' || artistB === '未知歌手') {
      return false;
    }
    if (artistA === artistB) return true;
    // 歌手包含判定（如 "周杰伦" 与 "周杰伦, 阿信"）
    if (artistA.includes(artistB) || artistB.includes(artistA)) return true;
  }

  return false;
}

/**
 * 歌曲列表去重（去重保底，保留首个完整项）
 */
export function deduplicateSongs(songs: Song[]): Song[] {
  const result: Song[] = [];
  for (const song of songs) {
    if (!song) continue;
    const exists = result.some(item => isSameSong(item, song));
    if (!exists) {
      result.push(song);
    }
  }
  return result;
}

/**
 * 规范化歌曲身份，剥离易过期的在线流地址与大段歌词文本（歌词播放时动态拉取或读本地 .lrc，不入库）。
 * 用于从 localStorage 恢复旧数据（曾用原始平台 id、写入了 CDN url 或包含庞大歌词文本）。
 */
export function normalizePersistedSong(song: Song): Song {
  const { lyric, ...rest } = song;
  if (song.isLocal) {
    return {
      ...rest,
      url: song.localPath || song.url || null,
    };
  }

  const originalId = resolveOnlineApiId(song);
  const canonicalId = `online_${song.source}_${originalId}`;
  return {
    ...rest,
    id: canonicalId,
    originalId,
    url: null,
  };
}

export function normalizePersistedSongs(songs: Song[]): Song[] {
  return songs.map(normalizePersistedSong);
}

export function normalizePersistedHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.map(entry => ({
    ...entry,
    song: normalizePersistedSong(entry.song),
  }));
}

/** 持久化前剥离在线流 URL 与歌词文本，避免占用大量存储空间与复用失效链接 */
export function stripEphemeralStreamUrl(song: Song): Song {
  const { lyric, ...rest } = song;
  if (song.isLocal) {
    return { ...rest, url: song.localPath || song.url || null };
  }
  return { ...rest, url: null };
}

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unknown';
}

export function joinPath(dir: string, fileName: string): string {
  const separator = dir.includes('/') ? '/' : '\\';
  return `${dir.replace(/[\\/]$/, '')}${separator}${fileName}`;
}

export function withoutExtension(filePath: string): string {
  const slashIdx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  const dotIdx = filePath.lastIndexOf('.');
  return dotIdx > slashIdx ? filePath.slice(0, dotIdx) : filePath;
}

export function parseSongName(fileName: string): { artist: string; name: string } {
  const extIdx = fileName.lastIndexOf('.');
  const nameWithoutExt = extIdx > 0 ? fileName.substring(0, extIdx) : fileName;
  const dashMatch = nameWithoutExt.match(/^(.*?)\s*-\s*(.*?)$/);

  if (dashMatch?.[1] && dashMatch?.[2]) {
    return {
      artist: dashMatch[1].trim() || '未知歌手',
      name: dashMatch[2].trim() || nameWithoutExt,
    };
  }

  return {
    artist: '未知歌手',
    name: nameWithoutExt.trim() || fileName,
  };
}

/** 检查目录是否存在且可读 */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    if (!path || !(await exists(path))) return false;
    await readDir(path);
    return true;
  } catch {
    return false;
  }
}

/** 支持的音频扩展名 */
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a'];

export function isAudioFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}
