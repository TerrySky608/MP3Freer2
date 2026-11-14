import { universalFetch } from "./httpClient";
import { getEnabledApiEndpoints, getProxyUrl, AudioQuality, getQualityBr, MUSIC_SOURCES } from '../settings';
import { lxSourceEngine } from './lxSourceAdapter';
import { isSameSong } from '../utils/songUtils';

export interface FallbackSongResult {
  fallbackSong: OnlineSong;
  playUrl: string;
  playUrls: string[];
  sourceName: string;
}

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

export interface HotSearchItem {
  searchWord: string;
  score?: number;
  content?: string;
  source?: number;
  iconType?: number;
  iconUrl?: string;
}

export interface PlaylistDetail extends OnlinePlaylist {
  item: OnlineSong[];
}

export interface OnlineAlbum {
  id: string;
  name: string;
  artist: string;
  picUrl: string;
  publishTime?: number;
  size?: number;
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
        timeoutMs: 6000,
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

      const response = await universalFetch(url.toString(), fetchOptions);

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
  // 1. 歌手名解析：兼容 item.ar、item.artists（网易云常见）、item.artist（数组或字符串）、item.singer / item.singers
  const arList = Array.isArray(item.ar)
    ? item.ar
    : Array.isArray(item.artists)
    ? item.artists
    : Array.isArray(item.singers)
    ? item.singers
    : null;
  const arNames = arList
    ? arList.map((a: any) => (typeof a === 'string' ? a : a?.name || '')).filter(Boolean).join(', ')
    : '';

  const artist = Array.isArray(item.artist)
    ? item.artist.join(', ')
    : firstString(
        arNames,
        typeof item.artist === 'string' ? item.artist : '',
        typeof item.singer === 'string' ? item.singer : '',
        '未知歌手'
      );

  // 2. 专辑名解析：兼容 item.album（可能是对象 { name, id } 或字符串）、item.al?.name、item.albumName
  const albumObjName = typeof item.album === 'object' && item.album !== null ? item.album.name : undefined;
  const albumStr = typeof item.album === 'string' ? item.album : undefined;
  const album = firstString(
    albumObjName,
    albumStr,
    item.al?.name,
    item.albumName,
    '未知专辑'
  );

  // 3. 专辑 ID 解析：网易云接口放在 album.id / al.id / albumId / album_id
  const rawAlbumId =
    item.album?.id ??
    item.al?.id ??
    item.albumId ??
    item.album_id ??
    null;
  const albumId = rawAlbumId != null ? String(rawAlbumId) : undefined;

  const duration = Number(
    item.extra_data?.duration ||
    item.duration ||
    (item.dt ? Math.floor(Number(item.dt) / 1000) : 0)
  );

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
    pic: resolveImageUrl(
      item.pic,
      item.picUrl,
      item.al?.picUrl,
      item.album?.picUrl,
      item.album?.blurPicUrl,
      item.cover
    ) || null,
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
                const rawAlbumId = item.albums?.[0]?.id ? String(item.albums[0].id) : undefined;
                const cover = item.imgItems?.[0]?.img || null;
                return {
                  id: songId,
                  name: firstString(item.name, '未知歌曲'),
                  artist: singer,
                  album,
                  albumId: rawAlbumId,
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

        const resp = await universalFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: s, rid: songId, level }),
          timeoutMs: 3500,
        });
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
          headers: { 'Referer': 'http://music.163.com' },
          timeoutMs: 5000,
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
          try {
            const resp = await universalFetch(xurl, {
              method: 'GET',
              headers: { 'User-Agent': 'LX-Music-Mobile' },
              timeoutMs: 4000,
            });
            if (resp.ok) {
              const xData = await resp.json();
              if (xData?.code === 200 && xData?.url) {
                addCandidate(xData.url);
                break;
              }
            }
          } catch (_err) {
            // 尝试下一集群域名
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

  /**
   * 跨平台智能语义兜底解析：
   * 当原音源平台（例如网易云）下架或直链失效时，自动根据歌名+歌手在其他可用平台（酷狗、酷我、QQ、咪咕等）中检索，
   * 结合语义匹配置信度验证找到最匹配的版本，并尝试解析出可用播放直链。
   */
  async resolveCrossPlatformFallback(
    song: { id: string; originalId?: string; name: string; artist: string; source: string; album?: string },
    quality: AudioQuality | string = 'high',
    options: { excludeUrls?: Iterable<string>; excludeSources?: string[] } = {}
  ): Promise<FallbackSongResult | null> {
    if (!song.name || song.name === '未知歌曲') return null;

    const excludedUrlSet = new Set(options.excludeUrls || []);
    const excludedSourceSet = new Set([song.source, ...(options.excludeSources || [])]);

    // 候选平台排除当前原平台，并按可用率与资源丰富度排序：酷我、酷狗最全，QQ、网易云、咪咕随后
    const priorityOrder = ['kuwo', 'kugou', 'tencent', 'netease', 'migu'];
    const otherSources = MUSIC_SOURCES
      .filter(s => !excludedSourceSet.has(s.id))
      .sort((a, b) => {
        const idxA = priorityOrder.indexOf(a.id);
        const idxB = priorityOrder.indexOf(b.id);
        return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
      });

    const artistClean = (!song.artist || song.artist === '未知歌手') ? '' : song.artist.trim();
    const searchKeyword = artistClean ? `${artistClean} ${song.name}`.trim() : song.name.trim();

    for (const targetSource of otherSources) {
      try {
        console.log(`[CrossFallback] 尝试在【${targetSource.name}】全网检索: ${searchKeyword}`);
        const candidates = await this.searchSongs(searchKeyword, targetSource.id, 1);
        if (!candidates || candidates.length === 0) continue;

        // 在前 6 条搜索结果中，使用 isSameSong 进行高置信度语义匹配
        const matched = candidates.slice(0, 6).find(c => {
          if (isSameSong(
            { id: c.id, name: c.name, artist: c.artist, source: c.source },
            { id: song.id, originalId: song.originalId, name: song.name, artist: song.artist, source: song.source }
          )) {
            return true;
          }
          // 容错兜底：歌名一致且歌手包含
          const origNameClean = song.name.toLowerCase().replace(/[\s()（）\[\]【】{}《》「」『』·•・\-_~]/g, '');
          const candNameClean = c.name.toLowerCase().replace(/[\s()（）\[\]【】{}《》「」『』·•・\-_~]/g, '');
          if (origNameClean && candNameClean && origNameClean === candNameClean) {
            if (!artistClean) return true;
            const candArtistClean = (c.artist || '').toLowerCase();
            const origArtistClean = artistClean.toLowerCase();
            if (candArtistClean.includes(origArtistClean) || origArtistClean.includes(candArtistClean)) {
              return true;
            }
          }
          return false;
        });

        if (!matched) continue;

        // 获取该候选匹配歌曲的全部直链候选（过滤已知失败地址，避免反复试同一个死链）
        const playUrls = (await this.getSongUrlCandidates(matched.id, matched.source, quality, {
          name: matched.name,
          singer: matched.artist,
          artist: matched.artist,
        })).filter(u => !excludedUrlSet.has(u));

        if (playUrls.length > 0) {
          console.log(`[CrossFallback] 成功在【${targetSource.name}】匹配到 ${playUrls.length} 条可用直链:`, matched.name, matched.artist);
          return {
            fallbackSong: matched,
            playUrl: playUrls[0],
            playUrls,
            sourceName: targetSource.name,
          };
        }
      } catch (err) {
        console.warn(`[CrossFallback] 平台 ${targetSource.name} 检索或直链解析异常:`, err);
      }
    }

    return null;
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
          'Referer': 'https://music.163.com',
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
        const topLists: ToplistDetail[] = data.list.slice(0, 6).map((tl: any) => ({
          id: String(tl.id),
          name: tl.name,
          cover: resolveImageUrl(tl.coverImgUrl, tl.picUrl) || '',
          creatorName: 'Official',
          creatorAvatar: '',
          playCount: tl.playCount,
          trackCount: tl.trackCount,
          topTracks: Array.isArray(tl.tracks) && tl.tracks.length > 0 ? tl.tracks.map((t: any) => ({
            first: t.first,
            second: t.second
          })) : []
        }));

        // 补全前 6 个榜单中 tracks 为空的榜单（如古典榜、电音榜等分榜）
        await Promise.all(
          topLists.map(async (tl) => {
            if (tl.topTracks.length === 0) {
              try {
                const detail = await this.getPlaylistDetails(tl.id, true, 'netease');
                if (detail && Array.isArray(detail.item) && detail.item.length > 0) {
                  tl.topTracks = detail.item.slice(0, 3).map(song => ({
                    first: song.name,
                    second: song.artist
                  }));
                }
              } catch (e) {
                // 忽略单个补全失败
              }
            }
          })
        );

        return topLists;
      }
    } catch (err: any) {
      console.warn('Failed to fetch Netease Toplists:', err);
      throw err;
    }
    return [];
  },

  /**
   * 获取网易云热搜榜列表（优先尝试 hotsearchlist，回退 search/hot）
   */
  async getHotSearchList(): Promise<HotSearchItem[]> {
    try {
      const response = await universalFetch('https://music.163.com/api/hotsearchlist/get', {
        method: 'GET',
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.code === 200 && Array.isArray(data.data) && data.data.length > 0) {
          return data.data.slice(0, 20).map((item: any) => ({
            searchWord: item.searchWord,
            score: item.score,
            content: item.content,
            source: item.source,
            iconType: item.iconType,
            iconUrl: item.iconUrl
          }));
        }
      }
    } catch (e) {
      console.warn('Failed to fetch hotsearchlist/get, trying fallback:', e);
    }

    try {
      const fallbackRes = await universalFetch('https://music.163.com/api/search/hot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: 'type=1'
      });
      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        if (fbData.code === 200 && fbData.result && Array.isArray(fbData.result.hots)) {
          return fbData.result.hots.slice(0, 20).map((h: any) => ({
            searchWord: h.first
          }));
        }
      }
    } catch (fbErr) {
      console.warn('Fallback search/hot failed:', fbErr);
    }
    return [];
  },

  /**
   * 获取歌手完整分类列表（网易云歌手接口）
   * @param area -1:全部, 7:华语, 96:欧美, 8:日本, 16:韩国, 0:其他
   * @param type -1:全部, 1:男歌手, 2:女歌手, 3:乐队
   */
  async getArtistList(options: {
    area?: number;
    type?: number;
    initial?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const area = options.area ?? 7;
    const type = options.type ?? -1;
    const initial = options.initial ?? '-1';
    const limit = options.limit ?? 60;
    const offset = options.offset ?? 0;
    try {
      // 优先尝试网易云标准 v1 接口
      const response = await universalFetch('https://music.163.com/api/v1/artist/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: `limit=${limit}&offset=${offset}&type=${type}&area=${area}&initial=${encodeURIComponent(initial)}`
      });
      if (response.ok) {
        const data = await response.json();
        if (data.code === 200 && Array.isArray(data.artists) && data.artists.length > 0) {
          return data.artists.map((item: any) => ({
            id: String(item.id),
            name: item.name,
            picUrl: resolveImageUrl(item.picUrl, item.img1v1Url) || '',
            musicSize: item.musicSize,
            albumSize: item.albumSize,
            trans: item.trans || '',
          }));
        }
      }
    } catch (err) {
      console.warn('Failed to fetch v1 artist list, trying fallback:', err);
    }

    try {
      const fallbackRes = await universalFetch('https://music.163.com/api/artist/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: `limit=${limit}&offset=${offset}&type=${type}&area=${area}&initial=${encodeURIComponent(initial)}`
      });
      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        if (fbData.code === 200 && Array.isArray(fbData.artists)) {
          return fbData.artists.map((item: any) => ({
            id: String(item.id),
            name: item.name,
            picUrl: resolveImageUrl(item.picUrl, item.img1v1Url) || '',
            musicSize: item.musicSize,
            albumSize: item.albumSize,
            trans: item.trans || '',
          }));
        }
      }
    } catch (fbErr) {
      console.warn('Fallback artist list failed:', fbErr);
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
      const list = await this.getArtistList({ area: 7, type: -1, limit: 12 });
      if (list && list.length > 0) {
        return list;
      }
    } catch (err: any) {
      console.error('Failed to get top artists:', err);
    }
    return [];
  },

  /**
   * 将任意来源的歌曲解析为网易云数字 songId（用于调用网易云相似歌曲/相似歌单推荐接口）
   */
  async resolveNeteaseSongId(seed: { id?: string; name: string; artist?: string; source?: string }): Promise<string | null> {
    if (seed.source === 'netease' && seed.id && /^\d+$/.test(String(seed.id))) {
      return String(seed.id);
    }
    const rawId = String(seed.id || '').replace(/^netease_/, '');
    if (/^\d+$/.test(rawId) && (!seed.source || seed.source === 'netease')) {
      return rawId;
    }
    const query = `${seed.name || ''} ${seed.artist || ''}`.trim();
    if (!query) return null;
    try {
      const response = await universalFetch(`http://music.163.com/api/cloudsearch/pc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com',
        },
        body: `s=${encodeURIComponent(query)}&type=1&limit=1&offset=0`,
      });
      if (response.ok) {
        const data = await response.json();
        const foundId = data?.result?.songs?.[0]?.id;
        if (foundId) return String(foundId);
      }
    } catch (err) {
      console.warn('resolveNeteaseSongId failed:', err);
    }
    return null;
  },

  /**
   * 根据听过的歌曲获取相似歌单推荐 (/api/discovery/simiPlaylist)
   */
  async getSimiPlaylists(
    seed: { id?: string; name: string; artist?: string; source?: string },
    limit: number = 8
  ): Promise<OnlinePlaylist[]> {
    try {
      const neteaseId = await this.resolveNeteaseSongId(seed);
      if (!neteaseId) return [];
      const response = await universalFetch(
        `https://music.163.com/api/discovery/simiPlaylist?songid=${encodeURIComponent(neteaseId)}&limit=${limit}&offset=0`,
        {
          method: 'GET',
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (data?.code === 200 && Array.isArray(data.playlists)) {
        return data.playlists.map((pl: any) => mapPlaylist(pl));
      }
    } catch (err) {
      console.warn('getSimiPlaylists failed:', err);
    }
    return [];
  },

  /**
   * 根据听过的歌曲获取相似歌曲推荐 (/api/v1/discovery/simiSong + 相似歌单曲目智能兜底)
   */
  async getSimiSongs(
    seed: { id?: string; name: string; artist?: string; source?: string },
    limit: number = 12
  ): Promise<OnlineSong[]> {
    try {
      const neteaseId = await this.resolveNeteaseSongId(seed);
      if (neteaseId) {
        const response = await universalFetch(
          `https://music.163.com/api/v1/discovery/simiSong?songid=${encodeURIComponent(neteaseId)}&limit=${limit}&offset=0`,
          {
            method: 'GET',
            headers: {
              'Referer': 'https://music.163.com',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          if (data?.code === 200 && Array.isArray(data.songs) && data.songs.length > 0) {
            return data.songs.slice(0, limit).map((item: any) => mapOnlineSong({
              ...item,
              picUrl: item.album?.picUrl || item.al?.picUrl || '',
            }, 'netease'));
          }
        }

        // 若单曲 simiSong 返回为空，自动从包含该歌曲的相似歌单 (simiPlaylist) 中提取同品味曲目
        const simiPls = await this.getSimiPlaylists(seed, 2);
        if (simiPls.length > 0) {
          const detail = await this.getPlaylistDetails(simiPls[0].id, true, 'netease').catch(() => null);
          if (detail && detail.item.length > 0) {
            const filtered = detail.item.filter(
              s => s.id !== neteaseId && s.name !== seed.name
            );
            if (filtered.length > 0) {
              return filtered.slice(0, limit);
            }
          }
        }
      }

      // 终极兜底：按同歌手检索热门代表作
      if (seed.artist && seed.artist !== '未知歌手') {
        const firstArtist = seed.artist.split(/[/,&，、]/)[0].trim();
        if (firstArtist) {
          const byArtist = await this.searchSongs(firstArtist, 'netease', 1);
          return byArtist.filter(s => s.name !== seed.name).slice(0, limit);
        }
      }
    } catch (err) {
      console.warn('getSimiSongs failed:', err);
    }
    return [];
  },

  /**
   * 网易云官方每日精选推荐歌单 (/api/personalized/playlist)
   */
  async getPersonalizedPlaylists(limit: number = 12): Promise<OnlinePlaylist[]> {
    try {
      const response = await universalFetch(
        `https://music.163.com/api/personalized/playlist?limit=${limit}`,
        {
          method: 'GET',
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        if (data?.code === 200 && Array.isArray(data.result)) {
          return data.result.map((pl: any) => ({
            id: String(pl.id),
            name: pl.name || '精选歌单',
            cover: resolveImageUrl(pl.picUrl, pl.coverImgUrl) || '',
            creatorName: pl.copywriter || '推荐精选',
            creatorAvatar: '',
            playCount: Number(pl.playCount || 0),
            trackCount: Number(pl.trackCount || 0),
          }));
        }
      }
    } catch (err) {
      console.warn('getPersonalizedPlaylists failed:', err);
    }
    return [];
  },

  /**
   * 按曲风分类获取热门歌单 (/api/playlist/list?cat=xxx&order=hot)
   */
  async getPlaylistsByCategory(cat: string, limit: number = 12, offset: number = 0): Promise<OnlinePlaylist[]> {
    try {
      const url = `https://music.163.com/api/playlist/list?cat=${encodeURIComponent(cat)}&order=hot&limit=${limit}&offset=${offset}`;
      const response = await universalFetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.code === 200 && Array.isArray(data.playlists) && data.playlists.length > 0) {
          return data.playlists.map((pl: any) => mapPlaylist(pl));
        }
      }
    } catch (err) {
      console.warn('getPlaylistsByCategory failed, falling back to highquality:', err);
    }
    const hq = await this.getNeteaseHighQualityPlaylists({ cat, limit }).catch(() => ({ playlists: [] }));
    return hq.playlists;
  },

  /**
   * 获取新碟上架列表 (/api/album/new)
   */
  async getNewAlbums(limit: number = 12, area: string = 'ALL'): Promise<OnlineAlbum[]> {
    try {
      const url = `https://music.163.com/api/album/new?area=${encodeURIComponent(area)}&offset=0&limit=${limit}&total=true`;
      const response = await universalFetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.code === 200 && Array.isArray(data.albums)) {
          return data.albums.map((al: any) => {
            const artistName = Array.isArray(al.artists) && al.artists.length > 0
              ? al.artists.map((a: any) => a.name).join(' / ')
              : (al.artist?.name || '未知歌手');
            return {
              id: String(al.id),
              name: al.name || '未知专辑',
              artist: artistName,
              picUrl: resolveImageUrl(al.picUrl, al.blurPicUrl) || '',
              publishTime: al.publishTime ? Number(al.publishTime) : undefined,
              size: al.size ? Number(al.size) : undefined,
            };
          });
        }
      }
    } catch (err) {
      console.warn('getNewAlbums failed:', err);
    }
    return [];
  },

  /**
   * 获取专辑详情（曲目列表）。
   * 复用 PlaylistDetail 结构以便 SearchPanel 的详情页直接渲染。
   * 仅网易源有免费官方接口；其它源返回 null。
   */
  async getAlbumDetail(
    albumId: string,
    source: string = 'netease',
    albumNameOpt?: string,
    artistNameOpt?: string
  ): Promise<PlaylistDetail | null> {
    if (!albumId && !albumNameOpt) return null;

    // 1. 酷狗音乐 (kugou) 官方接口
    if (source === 'kugou' && albumId) {
      try {
        const infoUrl = `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(albumId)}`;
        const songUrl = `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${encodeURIComponent(albumId)}&page=1&pagesize=100`;
        const [infoRes, songRes] = await Promise.all([
          universalFetch(infoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
          universalFetch(songUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
        ]);
        let albumName = albumNameOpt || '未知专辑';
        let singerName = artistNameOpt || '未知歌手';
        let coverUrl = '';
        if (infoRes && infoRes.ok) {
          const infoData = await infoRes.json().catch(() => null);
          const d = infoData?.data;
          if (d) {
            if (d.albumname) albumName = d.albumname;
            if (d.singername) singerName = d.singername;
            if (d.imgurl) coverUrl = resolveImageUrl(d.imgurl.replace('{size}', '400')) || '';
          }
        }
        if (songRes && songRes.ok) {
          const songData = await songRes.json().catch(() => null);
          const songList = songData?.data?.info;
          if (Array.isArray(songList) && songList.length > 0) {
            const items: OnlineSong[] = songList.map((item: any) => {
              const hash = String(item.hash || item.sqhash || item['320hash'] || '');
              let songName = item.songname || item.filename || '未知歌曲';
              let artist = singerName;
              if (item.filename && item.filename.includes(' - ')) {
                const parts = item.filename.split(' - ');
                artist = parts[0]?.trim() || singerName;
                songName = parts.slice(1).join(' - ').trim() || songName;
              }
              const rawImg = item.trans_param?.union_cover
                ? String(item.trans_param.union_cover).replace('{size}', '400')
                : coverUrl;
              return {
                id: hash,
                name: songName,
                artist,
                album: albumName,
                albumId,
                source: 'kugou',
                url_id: hash,
                pic_id: hash,
                lyric_id: `${hash}@@${item.filename || songName}`,
                pic: resolveImageUrl(rawImg) || (coverUrl || null),
                url: null,
                duration: Number(item.duration || 0),
                has_hires: !!(item.sqhash || (item.sqfilesize && item.sqfilesize > 0)),
              };
            });
            return {
              id: albumId,
              name: albumName,
              cover: coverUrl || items[0]?.pic || '',
              creatorName: singerName,
              creatorAvatar: null,
              item: items,
            };
          }
        }
      } catch (err) {
        console.warn('Kugou album detail error:', err);
      }
    }

    // 2. 酷我音乐 (kuwo) 官方接口
    if (source === 'kuwo' && albumId) {
      try {
        const kwUrl = `http://search.kuwo.cn/r.s?pn=0&rn=100&albumid=${encodeURIComponent(albumId)}&stype=albuminfo&show_copyright_off=1&encoding=utf8&rformat=json`;
        const response = await universalFetch(kwUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kuwo.cn/',
          }
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          if (data && Array.isArray(data.musiclist) && data.musiclist.length > 0) {
            const albumName = firstString(data.name, data.title, albumNameOpt, '未知专辑');
            const singerName = firstString(data.artist, data.fartist, artistNameOpt, '未知歌手');
            const coverUrl = resolveImageUrl(
              data.pic,
              data.hts_img,
              data.img ? `http://img3.sycdn.kuwo.cn/wmvpic/${data.img}` : '',
              data.artistpic
            ) || '';

            const items: OnlineSong[] = data.musiclist.map((item: any) => {
              const songId = String(item.id || item.musicrid || item.DC_TARGETID || '');
              const rawPic = [
                item.pic120,
                item.web_albumpic_short ? `https://img1.kuwo.cn/star/albumcover/${item.web_albumpic_short}` : '',
                item.img,
                coverUrl
              ].find((u: any) => typeof u === 'string' && u.trim().length > 0);
              return {
                id: songId,
                name: firstString(item.name, item.songname, '未知歌曲'),
                artist: firstString(item.artist, singerName, '未知歌手'),
                album: albumName,
                albumId,
                source: 'kuwo',
                url_id: songId,
                pic_id: songId,
                lyric_id: songId,
                pic: resolveImageUrl(rawPic) || (coverUrl || null),
                url: null,
                duration: Number(item.duration || 0),
                has_hires: !!(item.N_MINFO && (item.N_MINFO.includes('flac') || item.N_MINFO.includes('zp'))),
              };
            });

            return {
              id: albumId,
              name: albumName,
              cover: coverUrl || items[0]?.pic || '',
              creatorName: singerName,
              creatorAvatar: resolveImageUrl(data.artistpic) || null,
              item: items,
            };
          }
        }
      } catch (err) {
        console.warn('Kuwo album detail error:', err);
      }
    }

    // 3. 腾讯音乐 (tencent) 官方接口
    if (source === 'tencent' && albumId) {
      try {
        const qqUrl = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(albumId)}&format=json`;
        const response = await universalFetch(qqUrl, {
          headers: { 'Referer': 'https://y.qq.com/' }
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const d = data?.data;
          if (d && Array.isArray(d.list) && d.list.length > 0) {
            const albumName = firstString(d.name, albumNameOpt, '未知专辑');
            const singerName = firstString(d.singername, artistNameOpt, '未知歌手');
            const coverUrl = d.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${d.mid}.jpg` : '';

            const items: OnlineSong[] = d.list.map((item: any) => {
              const songId = String(item.songmid || item.songid || '');
              const singer = Array.isArray(item.singer) ? item.singer.map((s: any) => s.name).join(', ') : singerName;
              return {
                id: songId,
                name: firstString(item.songname, '未知歌曲'),
                artist: singer,
                album: albumName,
                albumId: String(d.mid || albumId),
                source: 'tencent',
                url_id: songId,
                pic_id: String(d.mid || songId),
                lyric_id: songId,
                pic: resolveImageUrl(coverUrl) || null,
                url: null,
                duration: Number(item.interval || 0),
                has_hires: !!(item.sizeflac && item.sizeflac > 0),
              };
            });

            return {
              id: albumId,
              name: albumName,
              cover: coverUrl,
              creatorName: singerName,
              creatorAvatar: null,
              item: items,
            };
          }
        }
      } catch (err) {
        console.warn('Tencent album detail error:', err);
      }
    }

    // 4. 咪咕音乐 (migu) 官方接口
    if (source === 'migu' && albumId) {
      try {
        const mgUrl = `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?needSimple=01&resourceId=${encodeURIComponent(albumId)}&resourceType=2003`;
        const response = await universalFetch(mgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://m.music.migu.cn/'
          }
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const res = data?.resource?.[0];
          if (res && Array.isArray(res.songItems) && res.songItems.length > 0) {
            const albumName = firstString(res.title, albumNameOpt, '未知专辑');
            const singerName = firstString(res.singer, artistNameOpt, '未知歌手');
            const rawCover = res.imgItems?.[0]?.img || res.imgItems?.[1]?.img || '';
            const coverUrl = resolveImageUrl(rawCover) || '';

            const items: OnlineSong[] = res.songItems.map((item: any) => {
              const songId = String(item.songId || item.copyrightId || item.contentId || '');
              const singer = item.singer || (Array.isArray(item.artists) ? item.artists.map((a: any) => a.name).join(', ') : singerName);
              const itemCover = item.albumImgs?.[0]?.img || coverUrl;
              let durationSec = 0;
              if (item.length && typeof item.length === 'string' && item.length.includes(':')) {
                const parts = item.length.split(':').map(Number);
                if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                else if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
              }
              return {
                id: songId,
                name: firstString(item.songName, '未知歌曲'),
                artist: singer,
                album: albumName,
                albumId,
                source: 'migu',
                url_id: songId,
                pic_id: songId,
                lyric_id: String(item.copyrightId || songId),
                pic: resolveImageUrl(itemCover) || (coverUrl || null),
                url: null,
                duration: durationSec,
                has_hires: !!(item.codeRate?.SQ || item.codeRate?.ZQ),
              };
            });

            return {
              id: albumId,
              name: albumName,
              cover: coverUrl || items[0]?.pic || '',
              creatorName: singerName,
              creatorAvatar: null,
              item: items,
            };
          }
        }
      } catch (err) {
        console.warn('Migu album detail error:', err);
      }
    }

    // 5. 网易云音乐 (netease) 官方接口与第三方回退
    if (source === 'netease' && albumId) {
      const attempts: Array<{ url: string; init?: any }> = [
        { url: `http://music.163.com/api/v1/album/${albumId}`, init: { method: 'POST', headers: { 'Referer': 'http://music.163.com' } } },
        { url: `http://music.163.com/api/album/${albumId}`, init: { method: 'POST', headers: { 'Referer': 'http://music.163.com' } } },
      ];
      const fallbackEndpoints = getEnabledApiEndpoints();
      for (const ep of fallbackEndpoints) {
        attempts.push({ url: `${ep}/api.php?types=playlist&id=${albumId}` });
      }

      for (const { url, init } of attempts) {
        try {
          const response = await universalFetch(url, init || { headers: { 'Referer': 'http://music.163.com' } });
          if (!response.ok) continue;
          const data = await response.json();

          const album = data?.album;
          const songs = Array.isArray(data?.songs) ? data.songs : [];
          if (album && Array.isArray(data?.songs)) {
            return {
              id: String(album.id),
              name: firstString(album.name, albumNameOpt, '未知专辑'),
              cover: resolveImageUrl(album.picUrl, album.blurPicUrl) || '',
              creatorName: firstString(album.artist?.name, artistNameOpt, '未知歌手'),
              creatorAvatar: resolveImageUrl(album.artist?.picUrl, album.artist?.img1v1Url),
              item: songs.map((song: any) => mapOnlineSong(song, 'netease')),
            };
          }

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
              name: firstString(playlist?.name, playlist?.title, albumNameOpt, '未知专辑'),
              cover,
              creatorName: firstString(playlist?.creator?.nickname, playlist?.creator?.name, playlist?.creator, artistNameOpt, '未知歌手'),
              creatorAvatar: resolveImageUrl(playlist?.creator?.avatarUrl, playlist?.creatorAvatar),
              item: tracks.map((track: any) => mapOnlineSong(track, firstString(track.source, source))),
            };
          }
        } catch (err) {
          console.warn(`Get album detail attempt failed (${url}):`, err);
        }
      }
    }

    // 6. 智能降级回退 (Fallback by Album Name)：若按 ID 获取失败或无 ID，但有专辑名称，按专辑名+歌手聚合歌曲
    if (albumNameOpt && albumNameOpt !== '未知专辑' && albumNameOpt !== '-') {
      try {
        const queryTerm = artistNameOpt && artistNameOpt !== '未知歌手'
          ? `${artistNameOpt} ${albumNameOpt}`
          : albumNameOpt;
        const searchedSongs = await this.searchSongs(queryTerm, source, 1);
        if (searchedSongs.length > 0) {
          // 优先筛选出与该专辑完全一致的歌曲；若少于 1 首则保留搜索出的前 30 首
          const matchedSongs = searchedSongs.filter(s => s.album && s.album.trim() === albumNameOpt.trim());
          const finalSongs = matchedSongs.length > 0 ? matchedSongs : searchedSongs;
          const cover = finalSongs.find(s => s.pic)?.pic || '';
          return {
            id: albumId || `search_album_${Date.now()}`,
            name: albumNameOpt,
            cover: cover || '',
            creatorName: artistNameOpt || finalSongs[0]?.artist || '未知歌手',
            creatorAvatar: null,
            item: finalSongs,
          };
        }
      } catch (fbErr) {
        console.warn('Fallback search by album name failed:', fbErr);
      }
    }

    console.error(`Get album detail error (ID: ${albumId}, Source: ${source}): all endpoints failed`);
    return null;
  }
};
