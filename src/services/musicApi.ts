import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

async function universalFetch(url: string, options?: any) {
  if (isTauri) {
    return await tauriFetch(url, options);
  } else {
    let proxyUrl = "/api/proxy?url=" + encodeURIComponent(url);
    return await fetch(proxyUrl, options);
  }
}

import { getEnabledApiEndpoints, getProxyUrl, AudioQuality, getQualityBr } from '../settings';
import { lxSourceEngine } from './lxSourceAdapter';

export interface OnlineSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  /** 所属专辑 id（网易接口带在 album.id 里，用于点专辑名进专辑详情；可能为空） */
  albumId?: string;
  source: string;
  url_id: string;
  pic_id: string;
  lyric_id: string;
  pic: string | null;
  url: string | null;
  duration: number;
  has_hires: boolean;
}

export interface OnlinePlaylist {
  id: string;
  name: string;
  cover: string;
  creatorName: string;
  creatorAvatar: string | null;
  count?: number;
  playCount?: number;
  trackCount?: number;
}

export interface ToplistDetail extends OnlinePlaylist {
  topTracks: {
    first: string;
    second: string;
  }[];
}

export interface PlaylistDetail extends OnlinePlaylist {
  item: OnlineSong[];
}

async function postRequest(types: string, extraParams: Record<string, any>): Promise<any> {
  const endpoints = getEnabledApiEndpoints();
  if (endpoints.length === 0) {
    throw new Error('No third-party API endpoints enabled');
  }

  let lastError: any;

  for (const endpoint of endpoints) {
    try {
      const proxyUrl = getProxyUrl();

      const url = new URL(`${endpoint}/api.php`);
      url.searchParams.append('types', types);
      for (const [key, value] of Object.entries(extraParams)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      }

      const fetchOptions: any = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `${endpoint}/`,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9'
        },
      };

      if (proxyUrl) {
        fetchOptions.proxy = { all: proxyUrl };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      fetchOptions.signal = controller.signal;

      let response;
      try {
        response = await universalFetch(url.toString(), fetchOptions);
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`API error at ${endpoint}, status: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.warn(`Request failed for endpoint ${endpoint}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All third-party endpoints failed');
}

function firstString(...args: any[]): string {
  for (const arg of args) {
    if (typeof arg === 'string' && arg.trim() !== '') {
      return arg.trim();
    }
  }
  return '';
}

/**
 * 规范化封面 URL。
 * Android Release 默认禁止明文 HTTP，网易等 CDN 常返回 http://，需升到 https://。
 */
export function resolveImageUrl(...args: any[]): string | null {
  for (const arg of args) {
    if (typeof arg === 'string' && arg.trim() !== '') {
      let url = arg.trim();
      if (url.startsWith('//y/')) {
        url = url.replace('//y/', 'https://y');
      }
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }
      if (url.startsWith('http://')) {
        url = 'https://' + url.slice('http://'.length);
      }
      if (url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) {
        return url;
      }
    }
  }
  return null;
}

function mapOnlineSong(item: any, fallbackSource: string): OnlineSong {
  const arNames = Array.isArray(item.ar) ? item.ar.map((ar: any) => ar.name).join(', ') : '';
  const artist = Array.isArray(item.artist)
    ? item.artist.join(', ')
    : firstString(item.artist, arNames, item.singer, '未知歌手');
  const album = firstString(item.album, item.al?.name, item.albumName, '未知专辑');
  // 专辑 id：网易接口放在 album.id / al.id；第三方接口通常无，置空表示无法进专辑
  const rawAlbumId = item.album?.id ?? item.al?.id ?? item.albumId ?? item.album_id ?? null;
  const albumId = rawAlbumId != null ? String(rawAlbumId) : undefined;
  const duration = Number(item.extra_data?.duration || item.duration || (item.dt ? Math.floor(Number(item.dt) / 1000) : 0));

  return {
    id: String(item.id),
    name: firstString(item.name, item.title, '未知歌曲'),
    artist,
    album,
    albumId,
    source: firstString(item.source, fallbackSource),
    url_id: String(item.url_id || item.id),
    pic_id: String(item.pic_id || item.al?.pic || item.id || ''),
    lyric_id: String(item.lyric_id || item.id),
    pic: resolveImageUrl(item.pic, item.picUrl, item.al?.picUrl, item.album?.picUrl, item.cover) || null,
    url: firstString(item.url) || null,
    duration,
    has_hires: !!(item.extra_data?.has_hires || (item.sq?.br && item.sq.br > 320000)),
  };
}

function mapPlaylist(item: any): OnlinePlaylist {
  const creator = item.creator || item.creatorName || item.user || item.author || {};

  return {
    id: String(item.id),
    name: firstString(item.name, item.title, '未知歌单名'),
    cover: resolveImageUrl(
      item.cover,
      item.coverImgUrl,
      item.picUrl,
      item.picture,
      item.img,
      item.image,
      item.cover_url,
      item.coverUrl,
      item.pic
    ) || '',
    creatorName: firstString(
      typeof creator === 'object' ? creator.nickname : creator,
      typeof creator === 'object' ? creator.name : '',
      item.creatorName,
      item.nickname,
      item.author
    ),
    creatorAvatar: resolveImageUrl(
      typeof creator === 'object' ? creator.avatarUrl : '',
      item.creatorAvatar,
      item.avatarUrl
    ),
    count: Number(item.count || item.trackCount || item.playCount || 0),
    playCount: Number(item.playCount || 0),
    trackCount: Number(item.trackCount || item.count || 0),
  };
}

export interface LyricData {
  original: string;
  translated: string;
  romanized: string;
}

export const MusicApiService = {
  async searchArtist(keyword: string): Promise<any> {
    try {
      const response = await universalFetch(`http://music.163.com/api/cloudsearch/pc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com'
        },
        body: `s=${encodeURIComponent(keyword)}&type=100&limit=1&offset=0`,
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.code === 200 && data?.result?.artists && data.result.artists.length > 0) {
          const artist = data.result.artists[0];
          return {
            id: String(artist.id),
            name: artist.name,
            picUrl: resolveImageUrl(artist.picUrl, artist.img1v1Url) || '',
            source: 'netease',
          };
        }
      }
      return null;
    } catch (err) {
      console.warn('Search artist failed', err);
      return null;
    }
  },

  async searchSongs(keyword: string, source: string = 'netease', page: number = 1): Promise<OnlineSong[]> {
    try {
      if (source === 'netease') {
        const limit = 30;
        const offset = (page - 1) * limit;
        try {
          const response = await universalFetch(`http://music.163.com/api/cloudsearch/pc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': 'https://music.163.com'
            },
            body: `s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=${offset}`,
          });
          if (response.ok) {
            const data = await response.json();
            if (data?.code === 200 && data?.result?.songs) {
              return data.result.songs.map((item: any) => mapOnlineSong(item, source));
            }
          }
        } catch (err) {
          console.warn('Official netease search failed, falling back to third-party', err);
        }
      }

      if (source === 'kuwo') {
        const limit = 30;
        const offset = (page - 1) * limit;
        try {
          const kwUrl = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${offset}&rn=${limit}&uid=794761770&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newsearch=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
          const response = await universalFetch(kwUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://www.kuwo.cn/'
            }
          });
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data?.abslist) && data.abslist.length > 0) {
              return data.abslist.map((item: any) => {
                const songId = String(item.DC_TARGETID || item.id || item.MUSICRID?.replace('MUSIC_', '') || '');
                const rawCover = [
                  item.hts_MVPIC,
                  item.web_albumpic_short ? `https://img1.kuwo.cn/star/albumcover/${item.web_albumpic_short}` : '',
                  item.MVPIC ? `https://img4.kuwo.cn/wmvpic/${item.MVPIC}` : '',
                  item.web_artistpic_short ? `https://img1.kuwo.cn/star/starheads/${item.web_artistpic_short}` : '',
                ].find(u => typeof u === 'string' && u.trim().length > 0);
                const cover = resolveImageUrl(rawCover) || null;
                const duration = Number(item.DURATION || item.duration || 0);
                const hasHires = !!(item.N_MINFO && (item.N_MINFO.includes('flac') || item.N_MINFO.includes('zp')));
                return {
                  id: songId,
                  name: firstString(item.SONGNAME, item.NAME, item.name, '未知歌曲'),
                  artist: firstString(item.ARTIST, item.FARTIST, item.artist, '未知歌手'),
                  album: firstString(item.ALBUM, item.album, '未知专辑'),
                  albumId: item.ALBUMID ? String(item.ALBUMID) : undefined,
                  source: 'kuwo',
                  url_id: songId,
                  pic_id: songId,
                  lyric_id: songId,
                  pic: cover,
                  url: null,
                  duration,
                  has_hires: hasHires,
                };
              });
            }
          }
        } catch (err) {
          console.warn('Official kuwo search failed, falling back to third-party', err);
        }
      }

      if (source === 'tencent') {
        const limit = 30;
        try {
          const qqUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=${page}&n=${limit}&w=${encodeURIComponent(keyword)}&format=json`;
          const response = await universalFetch(qqUrl, {
            headers: { 'Referer': 'https://y.qq.com/' }
          });
          if (response.ok) {
            const data = await response.json();
            const songList = data?.data?.song?.list;
            if (Array.isArray(songList) && songList.length > 0) {
              return songList.map((item: any) => {
                const songId = String(item.songmid || item.songid || '');
                const singer = Array.isArray(item.singer) ? item.singer.map((s: any) => s.name).join(', ') : '未知歌手';
                const album = item.albumname || '未知专辑';
                const albumId = item.albummid ? String(item.albummid) : undefined;
                const cover = item.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${item.albummid}.jpg` : null;
                return {
                  id: songId,
                  name: firstString(item.songname, '未知歌曲'),
                  artist: singer,
                  album,
                  albumId,
                  source: 'tencent',
                  url_id: songId,
                  pic_id: item.albummid ? String(item.albummid) : songId,
                  lyric_id: songId,
                  pic: resolveImageUrl(cover) || null,
                  url: null,
                  duration: Number(item.interval || 0),
                  has_hires: !!(item.sizeflac && item.sizeflac > 0),
                };
              });
            }
          }
        } catch (err) {
          console.warn('Official tencent search failed, falling back to third-party', err);
        }
      }

      if (source === 'kugou') {
        const limit = 30;
        try {
          const kgUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&clientver=&platform=WebFilter`;
          const response = await universalFetch(kgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
          });
          if (response.ok) {
            const data = await response.json();
            const songList = data?.data?.lists;
            if (Array.isArray(songList) && songList.length > 0) {
              return songList.map((item: any) => {
                const songId = String(item.SQFileHash || item.HQFileHash || item.FileHash || '');
                const rawImg = (item.Image || item.trans_param?.union_cover || '').replace(/\{size\}/g, '400');
                const cover = resolveImageUrl(rawImg) || null;
                return {
                  id: songId,
                  name: firstString(item.SongName, '未知歌曲'),
                  artist: firstString(item.SingerName, '未知歌手'),
                  album: firstString(item.AlbumName, '未知专辑'),
                  albumId: item.AlbumID ? String(item.AlbumID) : undefined,
                  source: 'kugou',
                  url_id: songId,
                  pic_id: songId,
                  lyric_id: `${songId}@@${item.SongName || ''}`,
                  pic: cover,
                  url: null,
                  duration: Number(item.Duration || 0),
                  has_hires: !!item.SQFileHash,
                };
              });
            }
          }
        } catch (err) {
          console.warn('Official kugou search failed, falling back to third-party', err);
        }
      }

      if (source === 'migu') {
        const limit = 30;
        try {
          const mgUrl = `https://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(keyword)}&pageNo=${page}&pageSize=${limit}&searchSwitch={song:1}`;
          const response = await universalFetch(mgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
          });
          if (response.ok) {
            const data = await response.json();
            const songList = data?.songResultData?.result;
            if (Array.isArray(songList) && songList.length > 0) {
              return songList.map((item: any) => {
                const songId = String(item.id || item.copyrightId || '');
                const singer = Array.isArray(item.singers) ? item.singers.map((s: any) => s.name).join(', ') : '未知歌手';
                const album = item.albums?.[0]?.name || '未知专辑';
                const cover = item.imgItems?.[0]?.img || null;
                return {
                  id: songId,
                  name: firstString(item.name, '未知歌曲'),
                  artist: singer,
                  album,
                  source: 'migu',
                  url_id: songId,
                  pic_id: songId,
                  lyric_id: String(item.copyrightId || songId),
                  pic: resolveImageUrl(cover) || null,
                  url: null,
                  duration: 0,
                  has_hires: false,
                };
              });
            }
          }
        } catch (err) {
          console.warn('Official migu search failed, falling back to third-party', err);
        }
      }

      try {
        const data = await postRequest('search', {
          count: '30',
          source,
          pages: String(page),
          name: keyword,
        });

        if (!Array.isArray(data)) return [];
        return data.map((item: any) => mapOnlineSong(item, source));
      } catch (err) {
        console.warn('Fallback search failed for source:', source, err);
        return [];
      }
    } catch (err) {
      console.error('Search songs error:', err);
      return [];
    }
  },

  async searchPlaylists(keyword: string, page: number = 1): Promise<OnlinePlaylist[]> {
    try {
      const limit = 30;
      const offset = (page - 1) * limit;
      let data: any = null;

      try {
        const response = await universalFetch(`http://music.163.com/api/cloudsearch/pc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://music.163.com'
          },
          body: `s=${encodeURIComponent(keyword)}&type=1000&limit=${limit}&offset=${offset}`,
        });
        if (response.ok) {
          data = await response.json();
        }
      } catch (err) {
        console.warn('Cloudsearch API failed, falling back to old search API', err);
      }

      if (!data || data.code !== 200) {
        const response = await universalFetch(`http://music.163.com/api/search/get/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://music.163.com'
          },
          body: `s=${encodeURIComponent(keyword)}&type=1000&limit=${limit}&offset=${offset}`,
        });
        if (response.ok) {
          data = await response.json();
        }
      }

      if (!data || data.code !== 200 || !data.result || !data.result.playlists) {
        return [];
      }

      return data.result.playlists.map((item: any) => mapPlaylist(item));
    } catch (err) {
      console.error('Search playlists error:', err);
      throw err;
    }
  },

  async getSongUrl(
    songId: string,
    source: string,
    quality: AudioQuality | string = 'high',
    extraInfo?: { name?: string; singer?: string; artist?: string }
  ): Promise<string | null> {
    const candidates = await this.getSongUrlCandidates(songId, source, quality, extraInfo);
    return candidates.length > 0 ? candidates[0] : null;
  },

  /**
   * 获取歌曲播放直链的全部可用候选源（按优先级排序）。
   * 用于播放失败时的毫秒级智能故障转移（Failover）。
   */
  async getSongUrlCandidates(
    songId: string,
    source: string,
    quality: AudioQuality | string = 'high',
    extraInfo?: { name?: string; singer?: string; artist?: string }
  ): Promise<string[]> {
    const q: AudioQuality = typeof quality === 'string' && ['standard', 'high', 'lossless', 'hires'].includes(quality)
      ? (quality as AudioQuality)
      : 'high';
    const br = getQualityBr(q);
    const enabledEndpoints = getEnabledApiEndpoints();
    const candidateUrls: string[] = [];
    const seenUrls = new Set<string>();

    const addCandidate = (url: string | null | undefined) => {
      if (url && typeof url === 'string' && url.trim() !== '') {
        const clean = url.trim();
        if (!seenUrls.has(clean)) {
          seenUrls.add(clean);
          candidateUrls.push(clean);
        }
      }
    };

    // 梯队 1：海棠 / 长青 SVIP 高速服务端（若启用）
    if (enabledEndpoints.some(ep => ep.includes('haitangw.cc'))) {
      try {
        const sourceMap: Record<string, string> = { netease: 'wy', kuwo: 'kw', kugou: 'kg', tencent: 'tx', migu: 'mg' };
        const levelMap: Record<AudioQuality, string> = { standard: 'standard', high: 'exhigh', lossless: 'lossless', hires: 'hires' };
        const s = sourceMap[source] || source;
        const level = levelMap[q] || 'exhigh';
        const url = 'https://musicserver.haitangw.cc/v1/music/resolve-url';
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const resp = await universalFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: s, rid: songId, level }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const resData = await resp.json();
          if (resData?.code === 0 && resData?.data?.url) {
            addCandidate(resData.data.url);
          }
        }
      } catch (e) {
        console.warn('Haitang SVIP music resolve failed or timed out:', e);
      }
    }

    // 梯队 2：网易云官方高码率 direct 接口（针对网易云歌曲）
    if (source === 'netease') {
      try {
        const neteaseBr = br === '1999' || br === '999' ? '999000' : '3200000';
        const response = await universalFetch(`http://music.163.com/api/song/enhance/player/url?id=${songId}&ids=[${songId}]&br=${neteaseBr}`, {
          headers: { 'Referer': 'http://music.163.com' }
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.data?.[0]?.url) {
            addCandidate(data.data[0].url);
          }
        }
      } catch (e) {
        console.warn('Official netease getSongUrl failed:', e);
      }
    }

    // 梯队 3：星海音乐源 API 集群（若启用）
    if (enabledEndpoints.some(ep => ep.includes('zddyr.top') || ep.includes('zrcdy.dpdns.org'))) {
      try {
        const sourceMap: Record<string, string> = { netease: 'netease', kuwo: 'kw', kugou: 'kg', tencent: 'qq', migu: 'migu' };
        const qMap: Record<AudioQuality, string> = { standard: '128k', high: '320k', lossless: 'flac', hires: 'hires' };
        const s = sourceMap[source] || source;
        const xq = qMap[q] || '320k';
        const songName = extraInfo?.name || '';
        const singerName = extraInfo?.singer || extraInfo?.artist || '';

        const domains = ['yy.zddyr.top', 'zrcdy.dpdns.org'];
        for (const domain of domains) {
          const xurl = `https://${domain}/lx/api/?source=${s}&name=${encodeURIComponent(songName)}&singer=${encodeURIComponent(singerName)}&songmid=${songId}&quality=${xq}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          try {
            const resp = await universalFetch(xurl, {
              method: 'GET',
              headers: { 'User-Agent': 'LX-Music-Mobile' },
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (resp.ok) {
              const xData = await resp.json();
              if (xData?.code === 200 && xData?.url) {
                addCandidate(xData.url);
                break;
              }
            }
          } catch (err) {
            clearTimeout(timeoutId);
          }
        }
      } catch (e) {
        console.warn('Xinghai API resolve failed or timed out:', e);
      }
    }

    // 梯队 4：经典 postRequest 聚合节点（GDStudio 等）
    if (enabledEndpoints.some(ep => !ep.includes('haitangw.cc') && !ep.includes('zddyr.top') && !ep.includes('zrcdy.dpdns.org'))) {
      try {
        const data = await postRequest('url', { id: songId, source, br });
        if (data?.url) {
          addCandidate(data.url);
        }
      } catch (err) {
        console.warn('postRequest endpoints failed:', err);
      }
    }

    // 梯队 5：内置洛雪自定义音源引擎（墨澜多后端自动容灾与无损直链解析）
    try {
      const lxUrl = await lxSourceEngine.getSongUrl(
        source,
        {
          id: songId,
          url_id: songId,
          name: extraInfo?.name || '',
          artist: extraInfo?.singer || extraInfo?.artist || ''
        },
        q
      );
      if (lxUrl) {
        addCandidate(lxUrl);
      }
    } catch (e) {
      console.warn('LX Source Engine resolve failed:', e);
    }

    return candidateUrls;
  },

  async getSongLyric(
    lyricId: string,
    source: string,
    extraInfo?: { name?: string; singer?: string }
  ): Promise<LyricData> {
    const empty: LyricData = { original: '', translated: '', romanized: '' };
    try {
      if (source === 'netease') {
        try {
          const response = await universalFetch(`http://music.163.com/api/song/lyric?id=${lyricId}&lv=1&kv=1&tv=-1`, {
            method: 'GET',
            headers: { 'Referer': 'http://music.163.com' }
          });
          if (response.ok) {
            const data = await response.json();
            return {
              original: data?.lrc?.lyric || '',
              translated: data?.tlyric?.lyric || '',
              romanized: data?.romalrc?.lyric || '',
            };
          }
        } catch (e) {
          console.warn('Official getSongLyric failed', e);
        }
      }

      if (source === 'kuwo') {
        try {
          const response = await universalFetch(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${lyricId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
              'Referer': 'https://m.kuwo.cn/'
            }
          });
          if (response.ok) {
            const data = await response.json();
            const lrclist = data?.data?.lrclist;
            if (Array.isArray(lrclist) && lrclist.length > 0) {
              const original = lrclist.map((l: any) => {
                const t = Number(l.time || 0);
                const m = Math.floor(t / 60);
                const s = (t % 60).toFixed(2);
                const timeStr = `[${String(m).padStart(2, '0')}:${String(s).padStart(5, '0')}]`;
                return `${timeStr}${l.lineLyric || ''}`;
              }).join('\n');
              return { original, translated: '', romanized: '' };
            }
          }
        } catch (e) {
          console.warn('Official kuwo getSongLyric failed', e);
        }
      }

      if (source === 'tencent') {
        try {
          const response = await universalFetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${lyricId}&format=json&nobase64=1`, {
            headers: { 'Referer': 'https://y.qq.com/' }
          });
          if (response.ok) {
            const data = await response.json();
            if (data?.lyric) {
              return {
                original: data.lyric,
                translated: data.trans || '',
                romanized: '',
              };
            }
          }
        } catch (e) {
          console.warn('Official tencent getSongLyric failed', e);
        }
      }

      if (source === 'kugou') {
        try {
          const songTitle = extraInfo?.name || '';
          const hash = lyricId.includes('@@') ? lyricId.split('@@')[0] : lyricId;
          const searchKw = lyricId.includes('@@') ? lyricId.split('@@')[1] : (songTitle || hash);
          const searchUrl = `http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(searchKw)}&hash=${hash}`;
          const sRes = await universalFetch(searchUrl);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (Array.isArray(sData?.candidates) && sData.candidates.length > 0) {
              const cand = sData.candidates[0];
              const dlUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`;
              const dlRes = await universalFetch(dlUrl);
              if (dlRes.ok) {
                const dlData = await dlRes.json();
                  let raw = '';
                  try {
                    const decodedStr = atob(dlData.content);
                    const bytes = new Uint8Array(decodedStr.length);
                    for (let i = 0; i < decodedStr.length; i++) {
                      bytes[i] = decodedStr.charCodeAt(i);
                    }
                    raw = new TextDecoder('utf-8').decode(bytes);
                  } catch (_e) {
                    raw = atob(dlData.content);
                  }
                  if (raw) return { original: raw, translated: '', romanized: '' };
              }
            }
          }
        } catch (e) {
          console.warn('Official kugou getSongLyric failed', e);
        }
      }

      if (source === 'migu') {
        try {
          const fetchMiguLrc = async (cid: string): Promise<string> => {
            if (!cid) return '';
            const resUrl = `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${cid}&resourceType=2`;
            const resp = await universalFetch(resUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (resp.ok) {
              const data = await resp.json();
              const lrcUrl = data?.resource?.[0]?.lrcUrl;
              if (lrcUrl) {
                const lrcResp = await universalFetch(lrcUrl);
                if (lrcResp.ok) {
                  const text = await lrcResp.text();
                  if (text && text.trim().length > 0) return text;
                }
              }
            }
            return '';
          };

          let lrcText = await fetchMiguLrc(lyricId);
          // 若直接使用 lyricId 未取到且有歌名，从咪咕官方检索反查真实 copyrightId
          if (!lrcText && extraInfo?.name) {
            const query = `${extraInfo.name} ${extraInfo.singer || ''}`.trim();
            const sUrl = `https://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(query)}&pageNo=1&pageSize=1&searchSwitch={song:1}`;
            const sResp = await universalFetch(sUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (sResp.ok) {
              const sData = await sResp.json();
              const foundCid = sData?.songResultData?.result?.[0]?.copyrightId;
              if (foundCid) {
                lrcText = await fetchMiguLrc(foundCid);
              }
            }
          }

          if (lrcText) {
            return { original: lrcText, translated: '', romanized: '' };
          }
        } catch (e) {
          console.warn('Official migu getSongLyric failed', e);
        }
      }

      // 跨源智能兜底：若前序接口未取到，且有歌名，从网易云开放接口检索匹配同名歌词
      if (extraInfo?.name) {
        try {
          const query = `${extraInfo.name} ${extraInfo.singer || ''}`.trim();
          const fallbackRes = await universalFetch(`http://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&total=true&limit=1`, {
            method: 'GET',
            headers: { 'Referer': 'http://music.163.com' }
          });
          if (fallbackRes.ok) {
            const fData = await fallbackRes.json();
            const matchedSongId = fData?.result?.songs?.[0]?.id;
            if (matchedSongId) {
              const lrcRes = await universalFetch(`http://music.163.com/api/song/lyric?id=${matchedSongId}&lv=1&kv=1&tv=-1`, {
                headers: { 'Referer': 'http://music.163.com' }
              });
              if (lrcRes.ok) {
                const lrcData = await lrcRes.json();
                if (lrcData?.lrc?.lyric) {
                  return {
                    original: lrcData.lrc.lyric,
                    translated: lrcData.tlyric?.lyric || '',
                    romanized: lrcData.romalrc?.lyric || ''
                  };
                }
              }
            }
          }
        } catch (fbErr) {
          console.warn('Cross-platform lyric fallback failed', fbErr);
        }
      }

      try {
        const data = await postRequest('lyric', { id: lyricId, source });
        return {
          original: data?.lyric || '',
          translated: data?.tlyric || '',
          romanized: data?.roma || '',
        };
      } catch (err) {
        console.warn(`Fallback get lyric error (ID: ${lyricId}, Source: ${source}):`, err);
        return empty;
      }
    } catch (err) {
      console.error(`Get lyric error (ID: ${lyricId}, Source: ${source}):`, err);
      return empty;
    }
  },


  async getSongPic(picId: string, source: string, size: string = '300', extraInfo?: { name?: string; singer?: string }): Promise<string | null> {
    try {
      if (source === 'netease') {
        try {
          const response = await universalFetch(`http://music.163.com/api/song/detail/?id=${picId}&ids=[${picId}]`, {
            method: 'GET',
            headers: { 'Referer': 'http://music.163.com' }
          });
          if (response.ok) {
            const data = await response.json();
            if (data?.songs?.[0]?.al?.picUrl) {
              return resolveImageUrl(data.songs[0].al.picUrl);
            }
          }
        } catch (e) {
          console.warn('Official getSongPic failed', e);
        }
      }

      if (source === 'kuwo') {
        try {
          const response = await universalFetch(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${picId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
              'Referer': 'https://m.kuwo.cn/'
            }
          });
          if (response.ok) {
            const data = await response.json();
            const pic = data?.data?.songinfo?.pic || data?.data?.songinfo?.mvpic;
            if (pic) return resolveImageUrl(pic);
          }
        } catch (e) {
          console.warn('Official kuwo getSongPic failed', e);
        }
      }

      if (source === 'tencent') {
        if (picId) {
          const qqPic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${picId}.jpg`;
          return resolveImageUrl(qqPic);
        }
      }

      if (source === 'kugou') {
        try {
          const query = extraInfo?.name ? `${extraInfo.name} ${extraInfo.singer || ''}`.trim() : picId;
          const kgUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=1&platform=WebFilter`;
          const res = await universalFetch(kgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (res.ok) {
            const data = await res.json();
            const first = data?.data?.lists?.[0];
            const raw = (first?.Image || first?.trans_param?.union_cover || '').replace(/\{size\}/g, '400');
            if (raw) return resolveImageUrl(raw);
          }
        } catch (e) {
          console.warn('Official kugou getSongPic failed', e);
        }
      }

      if (source === 'migu') {
        try {
          const query = extraInfo?.name ? `${extraInfo.name} ${extraInfo.singer || ''}`.trim() : picId;
          const mgUrl = `https://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(query)}&pageNo=1&pageSize=1&searchSwitch={song:1}`;
          const res = await universalFetch(mgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (res.ok) {
            const data = await res.json();
            const first = data?.songResultData?.result?.[0];
            const img = first?.imgItems?.[0]?.img;
            if (img) return resolveImageUrl(img);
          }
        } catch (e) {
          console.warn('Official migu getSongPic failed', e);
        }
      }

      // 跨源智能兜底：若前序接口未取到封面，从网易云开放接口匹配同名超清封面
      if (extraInfo?.name) {
        try {
          const query = `${extraInfo.name} ${extraInfo.singer || ''}`.trim();
          const fallbackRes = await universalFetch(`http://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&total=true&limit=1`, {
            method: 'GET',
            headers: { 'Referer': 'http://music.163.com' }
          });
          if (fallbackRes.ok) {
            const fData = await fallbackRes.json();
            const matchedCover = fData?.result?.songs?.[0]?.album?.picUrl || fData?.result?.songs?.[0]?.artists?.[0]?.img1v1Url;
            if (matchedCover) {
              return resolveImageUrl(matchedCover);
            }
          }
        } catch (fbErr) {
          console.warn('Cross-platform cover fallback failed', fbErr);
        }
      }

      try {
        const data = await postRequest('pic', { id: picId, source, size: String(size) });
        return resolveImageUrl(data?.url) || null;
      } catch (err) {
        console.warn(`Fallback get pic error (ID: ${picId}, Source: ${source}):`, err);
        return null;
      }
    } catch (err) {
      console.error(`Get pic error (ID: ${picId}, Source: ${source}):`, err);
      return null;
    }
  },

  async getPlaylistDetails(
    playlistId: string,
    isNeteaseDirect: boolean = false,
    source: string = 'netease',
  ): Promise<PlaylistDetail | null> {
    try {
      if (isNeteaseDirect) {
        const res = await universalFetch(`http://music.163.com/api/v6/playlist/detail?id=${playlistId}`, {
          method: 'POST',
          headers: { 'Referer': 'http://music.163.com' }
        });
        const data1 = await res.json();
        const playlist = data1.playlist;
        if (!playlist) return null;

        const trackIds = (playlist.trackIds || []).map((t: any) => ({ id: t.id }));
        const chunks = [];
        for (let i = 0; i < trackIds.length; i += 500) {
          chunks.push(trackIds.slice(i, i + 500));
        }

        let allSongs: any[] = [];
        for (const chunk of chunks) {
          const res2 = await universalFetch(`http://music.163.com/api/v3/song/detail`, {
            method: 'POST',
            headers: {
              'Referer': 'http://music.163.com',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `c=${encodeURIComponent(JSON.stringify(chunk))}`
          });
          const data2 = await res2.json();
          if (data2.songs) allSongs = allSongs.concat(data2.songs);
        }

        return {
          id: playlistId,
          name: playlist.name,
          cover: resolveImageUrl(playlist.coverImgUrl) || '',
          creatorName: playlist.creator?.nickname || 'Official',
          creatorAvatar: resolveImageUrl(playlist.creator?.avatarUrl) || '',
          item: allSongs.map(song => mapOnlineSong(song, 'netease'))
        };
      }

      const data = await postRequest('playlist', { id: playlistId, source });
      const playlist = data?.playlist || data;
      if (!playlist) return null;

      const tracks = Array.isArray(playlist.tracks)
        ? playlist.tracks
        : Array.isArray(playlist.item)
          ? playlist.item
          : [];

      return {
        id: playlistId,
        name: firstString(playlist.name, playlist.title, 'Playlist'),
        cover: resolveImageUrl(playlist.coverImgUrl, playlist.cover, playlist.picUrl, playlist.picture) || '',
        creatorName: firstString(playlist.creator?.nickname, playlist.creator?.name, playlist.creator),
        creatorAvatar: resolveImageUrl(playlist.creator?.avatarUrl, playlist.creatorAvatar),
        // 保留每首歌自己的 source；无则回退到请求时传入的 source
        item: tracks.map((track: any) => mapOnlineSong(track, firstString(track.source, source))),
      };
    } catch (err) {
      console.error(`Get playlist details error (ID: ${playlistId}):`, err);
      throw err;
    }
  },

  async getNeteaseToplists(): Promise<ToplistDetail[]> {
    try {
      const fetchOptions: any = {
        method: 'GET',
        headers: { 
          'Referer': 'http://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };
      const response = await universalFetch('https://music.163.com/api/toplist/detail', fetchOptions);
      if (!response.ok) return [];
      const data = await response.json();
      if (data.code !== 200) {
        throw new Error(`Netease Toplists API returned code: ${data.code}`);
      }

      if (Array.isArray(data.list)) {
        return data.list.slice(0, 4).map((tl: any) => ({
          id: String(tl.id),
          name: tl.name,
          cover: resolveImageUrl(tl.coverImgUrl, tl.picUrl) || '',
          creatorName: 'Official',
          creatorAvatar: '',
          playCount: tl.playCount,
          trackCount: tl.trackCount,
          topTracks: Array.isArray(tl.tracks) ? tl.tracks.map((t: any) => ({
            first: t.first,
            second: t.second
          })) : []
        }));
      }
    } catch (err: any) {
      console.warn('Failed to fetch Netease Toplists:', err);
      throw err;
    }
    return [];
  },

  /**
   * 网易云精品歌单。
   * - cat: 分类（华语/流行/电子…），默认「全部」
   * - before: 分页游标，取上一页最后一项的 updateTime
   * - limit: 条数，默认 40（便于前端打乱后展示一批）
   */
  async getNeteaseHighQualityPlaylists(options: {
    limit?: number;
    before?: number;
    cat?: string;
  } = {}): Promise<{ playlists: OnlinePlaylist[]; lastUpdateTime?: number }> {
    const limit = options.limit ?? 40;
    const cat = options.cat && options.cat !== '全部' ? options.cat : undefined;
    try {
      const fetchOptions: any = {
        method: 'GET',
        headers: {
          'Referer': 'http://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };
      const url = new URL('https://music.163.com/api/playlist/highquality/list');
      url.searchParams.set('limit', String(limit));
      if (cat) url.searchParams.set('cat', cat);
      if (options.before) url.searchParams.set('before', String(options.before));

      const response = await universalFetch(url.toString(), fetchOptions);
      if (!response.ok) return { playlists: [] };
      const data = await response.json();
      if (data.code !== 200) {
        throw new Error(`Netease HighQuality API returned code: ${data.code}`);
      }
      if (!Array.isArray(data.playlists)) return { playlists: [] };

      const playlists = data.playlists.map((pl: any) => ({
        id: String(pl.id),
        name: pl.name,
        cover: resolveImageUrl(pl.coverImgUrl, pl.picUrl) || '',
        creatorName: pl.creator?.nickname || 'Unknown',
        creatorAvatar: resolveImageUrl(pl.creator?.avatarUrl) || '',
        playCount: pl.playCount,
        trackCount: pl.trackCount,
      }));
      const last = data.playlists[data.playlists.length - 1];
      const lastUpdateTime = last?.updateTime ? Number(last.updateTime) : undefined;
      return { playlists, lastUpdateTime };
    } catch (err: any) {
      console.warn('Failed to fetch high quality playlists:', err);
      throw err;
    }
  },

  async getHotPlaylists(): Promise<OnlinePlaylist[]> {
    try {
      const data = await postRequest('hot_list', {});
      const playlists = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return playlists.map((pl: any) => ({
        id: String(pl.id),
        name: pl.name || pl.title,
        cover: resolveImageUrl(pl.cover, pl.picUrl, pl.coverImgUrl) || '',
        creatorName: pl.creator || 'Unknown',
        creatorAvatar: '',
        playCount: pl.playCount || 0,
        trackCount: pl.trackCount || 0
      }));
    } catch (err) {
      console.error('Failed to get hot playlists:', err);
      return [];
    }
  },

  async getNewSongs(): Promise<OnlineSong[]> {
    try {
      const fetchOptions: any = {
        method: 'GET',
        headers: { 
          'Referer': 'http://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };
      const response = await universalFetch('https://music.163.com/api/personalized/newsong', fetchOptions);
      if (!response.ok) return [];
      const data = await response.json();
      if (data.code !== 200 || !Array.isArray(data.result)) {
        throw new Error(`Netease NewSongs API returned code: ${data.code}`);
      }

      return data.result.map((item: any) => {
        const song = item.song || {};
        return mapOnlineSong({
          ...song,
          picUrl: song.album?.picUrl || item.picUrl || '',
          source: 'netease'
        }, 'netease');
      });
    } catch (err: any) {
      console.error('Failed to get new songs:', err);
      throw err;
    }
    return [];
  },

  async getTopArtists(): Promise<any[]> {
    try {
      const fetchOptions: any = {
        method: 'POST',
        headers: { 
          'Referer': 'http://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'limit=12&offset=0&type=1&area=7'
      };
      const response = await universalFetch('https://music.163.com/api/artist/list', fetchOptions);
      if (!response.ok) return [];
      const data = await response.json();
      if (data.code !== 200 || !Array.isArray(data.artists)) {
        throw new Error(`Netease Artists API returned code: ${data.code}`);
      }

      return data.artists.map((artist: any) => ({
        id: String(artist.id),
        name: artist.name,
        picUrl: resolveImageUrl(artist.picUrl, artist.img1v1Url) || '',
        source: 'netease',
      }));
    } catch (err: any) {
      console.error('Failed to get top artists:', err);
      throw err;
    }
    return [];
  },

  /**
   * 获取专辑详情（曲目列表）。
   * 复用 PlaylistDetail 结构以便 SearchPanel 的详情页直接渲染。
   * 仅网易源有免费官方接口；其它源返回 null。
   */
  async getAlbumDetail(albumId: string, source: string = 'netease'): Promise<PlaylistDetail | null> {
    if (source !== 'netease' || !albumId) return null;
    // 网易云专辑接口实测：未登录时 GET /api/album/{id} 返回 -462、GET /api/v1/album?id= 返回 404。
    // 真正可用的是 POST /api/v1/album/{id}（客户端用的那个），以及第三方接口的 album 类型。
    const attempts: Array<{ url: string; init?: any }> = [
      { url: `http://music.163.com/api/v1/album/${albumId}`, init: { method: 'POST', headers: { 'Referer': 'http://music.163.com' } } },
      { url: `http://music.163.com/api/album/${albumId}`, init: { method: 'POST', headers: { 'Referer': 'http://music.163.com' } } },
    ];
    // 第三方接口回退：部分的 GD/xingzhige 提供 playlist 查询，复用歌单接口拿专辑
    const fallbackEndpoints = getEnabledApiEndpoints();
    for (const ep of fallbackEndpoints) {
      attempts.push({ url: `${ep}/api.php?types=playlist&id=${albumId}` });
    }

    for (const { url, init } of attempts) {
      try {
        const response = await universalFetch(url, init || { headers: { 'Referer': 'http://music.163.com' } });
        if (!response.ok) {
          continue;
        }
        const data = await response.json();

        // 网易官方返回：{ album, songs[] }
        const album = data?.album;
        const songs = Array.isArray(data?.songs) ? data.songs : [];
        if (album && Array.isArray(data?.songs)) {
          return {
            id: String(album.id),
            name: firstString(album.name, '未知专辑'),
            cover: resolveImageUrl(album.picUrl, album.blurPicUrl) || '',
            creatorName: firstString(album.artist?.name, '未知歌手'),
            creatorAvatar: resolveImageUrl(album.artist?.picUrl, album.artist?.img1v1Url),
            item: songs.map((song: any) => mapOnlineSong(song, 'netease')),
          };
        }

        // 第三方接口回退：返回 { playlist: { tracks[] } } 或 { tracks[] }
        const playlist = data?.playlist || data;
        const tracks = Array.isArray(playlist?.tracks)
          ? playlist.tracks
          : Array.isArray(playlist?.item)
            ? playlist.item
            : [];
        if (tracks.length > 0) {
          const cover = resolveImageUrl(playlist?.coverImgUrl, playlist?.cover, playlist?.picUrl) || '';
          return {
            id: String(playlist?.id || albumId),
            name: firstString(playlist?.name, playlist?.title, '未知专辑'),
            cover,
            creatorName: firstString(playlist?.creator?.nickname, playlist?.creator?.name, playlist?.creator, '未知歌手'),
            creatorAvatar: resolveImageUrl(playlist?.creator?.avatarUrl, playlist?.creatorAvatar),
            item: tracks.map((track: any) => mapOnlineSong(track, firstString(track.source, source))),
          };
        }
        continue;
      } catch (err) {
        console.warn(`Get album detail attempt failed (${url}):`, err);
      }
    }
    console.error(`Get album detail error (ID: ${albumId}): all endpoints failed`);
    return null;
  }
};
