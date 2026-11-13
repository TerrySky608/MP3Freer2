import { getDefaultDownloadDir as invokeDefaultDownloadDir } from './services/rustBridge';

export type MusicSource = 'netease' | 'tencent' | 'kugou' | 'kuwo' | 'migu';

/**
 * 应用版本号（单一来源）。
 * package.json / tauri.conf.json / Cargo.toml 必须与此保持一致。
 * 显示时统一带 v 前缀。
 */
export const APP_VERSION = '26.11.17';

/** 音质档位：标准 128 / 高品 320 / 无损 / Hi-Res */
export type AudioQuality = 'standard' | 'high' | 'lossless' | 'hires';

export const QUALITY_OPTIONS: Array<{ id: AudioQuality; name: string; br: string }> = [
  { id: 'standard', name: '标准 128k', br: '128' },
  { id: 'high', name: '高品 320k', br: '320' },
  { id: 'lossless', name: '无损 FLAC', br: '999' },
  { id: 'hires', name: 'Hi-Res', br: '1999' },
];

export const DEFAULT_DOWNLOAD_PATH = '';
const LEGACY_PUBLIC_DOWNLOAD_PATH = 'C:\\Users\\Public\\Downloads';
export const DOWNLOAD_PATH_KEY = 'mp3freer_download_path';
export const DEFAULT_SEARCH_SOURCE_KEY = 'mp3freer_default_search_source';
export const DEFAULT_SEARCH_SOURCE: MusicSource = 'netease';
export const PROXY_URL_KEY = 'mp3freer_proxy_url';
export const ENABLED_API_ENDPOINTS_KEY = 'mp3freer_enabled_api_endpoints';
export const PREFERRED_QUALITY_KEY = 'mp3freer_preferred_quality';
export const DEFAULT_QUALITY: AudioQuality = 'high';
/** 收藏在线歌曲时是否同时下载到本地；默认关闭，仅收藏 */
export const DOWNLOAD_ON_FAVORITE_KEY = 'mp3freer_download_on_favorite';
export const DEFAULT_DOWNLOAD_ON_FAVORITE = false;

export const API_ENDPOINTS = [
  'https://musicserver.haitangw.cc',
  'https://api.xingzhige.com',
  'https://yy.zddyr.top',
  'https://music-api.gdstudio.xyz',
];

export interface ApiEndpointInfo {
  url: string;
  name: string;
  desc: string;
}

export const API_ENDPOINT_INFOS: ApiEndpointInfo[] = [
  {
    url: 'https://musicserver.haitangw.cc',
    name: '海棠 / 长青 SVIP 高速源',
    desc: '极速响应 (200ms)，支持酷我/网易/酷狗等多平台车机高品质与无损流'
  },
  {
    url: 'https://api.xingzhige.com',
    name: '星之阁 API 节点',
    desc: '多平台聚合搜索与音频直链解析节点'
  },
  {
    url: 'https://yy.zddyr.top',
    name: '星海音乐源 API 集群',
    desc: '多平台聚合解析源，支持酷我、咪咕、QQ、酷狗等歌曲直链'
  },
  {
    url: 'https://music-api.gdstudio.xyz',
    name: 'GDStudio 经典音源节点',
    desc: '经典公共音乐 API 服务，覆盖全网多平台搜索与基础音频'
  }
];

export const MUSIC_SOURCES: Array<{ id: MusicSource; name: string }> = [
  { id: 'netease', name: '网易云' },
  { id: 'kugou', name: '酷狗' },
  { id: 'kuwo', name: '酷我' },
  { id: 'migu', name: '咪咕' },
  { id: 'tencent', name: 'QQ' },
];

let cachedPlatformDefaultDownloadDir: string | null = null;
let resolvingDefaultDirPromise: Promise<string> | null = null;

/** 获取用户手动设置的自定义下载路径；未设置时返回空字符串 */
export function getCustomDownloadPath(): string {
  if (typeof window === 'undefined') return '';
  const savedPath = (localStorage.getItem(DOWNLOAD_PATH_KEY) || '').trim();
  // 兼容旧版硬编码公共路径：旧版本仅保存了默认占位符且未真正手动配置时，按未设置处理以迁移至平台默认下载目录
  if (!savedPath || savedPath === LEGACY_PUBLIC_DOWNLOAD_PATH) {
    return '';
  }
  return savedPath;
}

/** 异步解析当前平台默认下载目录（Android 优先原生外部音乐目录，桌面端走 Rust download_dir\MP3Terry） */
export async function resolveDefaultDownloadDir(): Promise<string> {
  if (cachedPlatformDefaultDownloadDir) {
    return cachedPlatformDefaultDownloadDir;
  }
  if (resolvingDefaultDirPromise) {
    return resolvingDefaultDirPromise;
  }

  resolvingDefaultDirPromise = (async () => {
    try {
      const bridge = typeof window !== 'undefined' ? (window as any).AndroidMediaBridge : undefined;
      if (bridge && typeof bridge.getDefaultDownloadDir === 'function') {
        const androidDir = String(bridge.getDefaultDownloadDir() || '').trim();
        if (androidDir) {
          cachedPlatformDefaultDownloadDir = androidDir;
          return androidDir;
        }
      }
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const rustDir = (await invokeDefaultDownloadDir()).trim();
        if (rustDir) {
          cachedPlatformDefaultDownloadDir = rustDir;
          return rustDir;
        }
      }
    } catch (err) {
      console.warn('Resolve default download directory failed:', err);
    } finally {
      resolvingDefaultDirPromise = null;
    }
    return '';
  })();

  return resolvingDefaultDirPromise;
}

/** 获取当前已缓存的默认下载路径（未初始化前可能为空） */
export function getCachedDefaultDownloadPath(): string {
  return cachedPlatformDefaultDownloadDir || '';
}

/** 异步解析当前实际生效的下载目录（优先用户在设置中配置的路径，否则返回平台默认下载目录） */
export async function resolveEffectiveDownloadPath(): Promise<string> {
  const custom = getCustomDownloadPath();
  if (custom) return custom;
  return await resolveDefaultDownloadDir();
}

/** 同步获取当前生效的下载路径（仅作界面显示/缓存读取，下载与扫描请优先调用 resolveEffectiveDownloadPath） */
export function getDownloadPath(): string {
  return getCustomDownloadPath() || getCachedDefaultDownloadPath();
}

export function setDownloadPath(path: string) {
  const clean = (path || '').trim();
  if (clean) {
    localStorage.setItem(DOWNLOAD_PATH_KEY, clean);
  } else {
    localStorage.removeItem(DOWNLOAD_PATH_KEY);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('downloadPathChanged', { detail: clean }));
  }
}

export function getDefaultSearchSource(): MusicSource {
  const savedSource = localStorage.getItem(DEFAULT_SEARCH_SOURCE_KEY);
  if (MUSIC_SOURCES.some(source => source.id === savedSource)) {
    return savedSource as MusicSource;
  }
  return DEFAULT_SEARCH_SOURCE;
}

export function setDefaultSearchSource(source: MusicSource) {
  localStorage.setItem(DEFAULT_SEARCH_SOURCE_KEY, source);
}

export function getProxyUrl(): string {
  return localStorage.getItem(PROXY_URL_KEY) || '';
}

export function setProxyUrl(url: string) {
  if (url) {
    localStorage.setItem(PROXY_URL_KEY, url);
  } else {
    localStorage.removeItem(PROXY_URL_KEY);
  }
}

export function getEnabledApiEndpoints(): string[] {
  const saved = localStorage.getItem(ENABLED_API_ENDPOINTS_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        // 只保留是字符串且以 http 开头的合法 URL，过滤掉被污染或手改坏的值
        const valid = parsed.filter(
          (ep): ep is string => typeof ep === 'string' && /^https?:\/\//i.test(ep)
        );
        // 校验后回写，剔除脏数据；若全部非法则走默认
        if (valid.length > 0) return valid;
      }
    } catch (e) {
      console.warn('Failed to parse enabled API endpoints', e);
    }
  }
  // Default: all enabled
  return [...API_ENDPOINTS];
}

export function setEnabledApiEndpoints(endpoints: string[]) {
  localStorage.setItem(ENABLED_API_ENDPOINTS_KEY, JSON.stringify(endpoints));
}

export function getPreferredQuality(): AudioQuality {
  const saved = localStorage.getItem(PREFERRED_QUALITY_KEY);
  if (QUALITY_OPTIONS.some(q => q.id === saved)) {
    return saved as AudioQuality;
  }
  return DEFAULT_QUALITY;
}

export function setPreferredQuality(quality: AudioQuality) {
  localStorage.setItem(PREFERRED_QUALITY_KEY, quality);
}

export function getDownloadOnFavorite(): boolean {
  const saved = localStorage.getItem(DOWNLOAD_ON_FAVORITE_KEY);
  if (saved === null) return DEFAULT_DOWNLOAD_ON_FAVORITE;
  return saved === 'true';
}

export function setDownloadOnFavorite(enabled: boolean) {
  localStorage.setItem(DOWNLOAD_ON_FAVORITE_KEY, enabled ? 'true' : 'false');
}

export function getQualityBr(quality: AudioQuality): string {
  return QUALITY_OPTIONS.find(q => q.id === quality)?.br || '320';
}

/** 自动预加载下一首歌曲音频：默认开启，切歌秒开无缝缓冲 */
export const PRELOAD_NEXT_SONG_KEY = 'mp3freer_preload_next_song';
export const DEFAULT_PRELOAD_NEXT_SONG = true;

export function getPreloadNextSong(): boolean {
  if (typeof window === 'undefined') return DEFAULT_PRELOAD_NEXT_SONG;
  const saved = localStorage.getItem(PRELOAD_NEXT_SONG_KEY);
  if (saved === null) return DEFAULT_PRELOAD_NEXT_SONG;
  return saved === 'true';
}

export function setPreloadNextSong(enabled: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(PRELOAD_NEXT_SONG_KEY, enabled ? 'true' : 'false');
  }
}
