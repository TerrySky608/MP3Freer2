import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MusicApiService,
  OnlineAlbum,
  OnlinePlaylist,
  OnlineSong,
  ToplistDetail,
} from '../services/musicApi';
import { usePlayer } from '../context/PlayerContext';
import { Play, Music, Flame, Mic2, Compass, Disc, Loader2, ArrowLeft } from 'lucide-react';
import { toPlayerSong } from '../utils/songUtils';
import { CoverImage } from './CoverImage';
import { registerBackHandler } from '../utils/navigationManager';

const DISCOVERY_TTL_MS = 15 * 60 * 1000;

const ARTIST_AREAS = [
  { label: '华语', value: 7 },
  { label: '欧美', value: 96 },
  { label: '日本', value: 8 },
  { label: '韩国', value: 16 },
  { label: '其他', value: 0 },
];

const ARTIST_TYPES = [
  { label: '全部', value: -1 },
  { label: '男', value: 1 },
  { label: '女', value: 2 },
  { label: '乐队/组合', value: 3 },
];

const GENRE_LIST = [
  { name: '流行', icon: '🎧', color: 'rgba(168, 85, 247, 0.16)' },
  { name: '摇滚', icon: '🎸', color: 'rgba(239, 68, 68, 0.16)' },
  { name: '民谣', icon: '🌿', color: 'rgba(16, 185, 129, 0.16)' },
  { name: '电子', icon: '⚡', color: 'rgba(59, 130, 246, 0.16)' },
  { name: '说唱', icon: '🎤', color: 'rgba(245, 158, 11, 0.16)' },
  { name: '古风', icon: '🏮', color: 'rgba(236, 72, 153, 0.16)' },
  { name: '轻音乐', icon: '🍃', color: 'rgba(20, 184, 166, 0.16)' },
  { name: '华语', icon: '🎵', color: 'rgba(139, 92, 246, 0.16)' },
  { name: '欧美', icon: '🌍', color: 'rgba(99, 102, 241, 0.16)' },
  { name: 'ACG', icon: '✨', color: 'rgba(244, 63, 94, 0.16)' },
  { name: '爵士', icon: '🎷', color: 'rgba(217, 119, 6, 0.16)' },
  { name: '影视原声', icon: '🎬', color: 'rgba(14, 165, 233, 0.16)' },
];

export const DiscoveryView: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const { playSong, isFavoriteArtist, toggleFavoriteArtist } = usePlayer();
  const [toplists, setToplists] = useState<ToplistDetail[]>([]);
  const [topArtists, setTopArtists] = useState<any[]>([]);
  const [activeGenre, setActiveGenre] = useState<string>('流行');
  const [genrePlaylists, setGenrePlaylists] = useState<OnlinePlaylist[]>([]);
  const [genreLoading, setGenreLoading] = useState<boolean>(false);
  const [newTab, setNewTab] = useState<'songs' | 'albums'>('songs');
  const [newSongs, setNewSongs] = useState<OnlineSong[]>([]);
  const [newAlbums, setNewAlbums] = useState<OnlineAlbum[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 歌手分类二级视图状态（对齐网易云：华语默认 area=7，全部类型 type=-1）
  const [showAllArtists, setShowAllArtists] = useState<boolean>(false);

  // 注册屏幕边缘向右滑或全局返回动作拦截
  useEffect(() => {
    if (!showAllArtists) return;
    return registerBackHandler(() => {
      setShowAllArtists(false);
      return true;
    });
  }, [showAllArtists]);
  const [artistArea, setArtistArea] = useState<number>(7);
  const [artistType, setArtistType] = useState<number>(-1);
  const [fullArtists, setFullArtists] = useState<any[]>([]);
  const [artistsLoading, setArtistsLoading] = useState<boolean>(false);

  const fetchedRef = useRef(false);
  const lastFetchedAtRef = useRef(0);
  const genreCacheRef = useRef<Record<string, OnlinePlaylist[]>>({});

  const loadGenrePlaylists = useCallback(async (genre: string) => {
    setActiveGenre(genre);
    if (genreCacheRef.current[genre] && genreCacheRef.current[genre].length > 0) {
      setGenrePlaylists(genreCacheRef.current[genre]);
      return;
    }
    setGenreLoading(true);
    try {
      const list = await MusicApiService.getPlaylistsByCategory(genre, 8);
      genreCacheRef.current[genre] = list || [];
      setGenrePlaylists(list || []);
    } catch (e) {
      console.error('Failed to load genre playlists:', e);
    } finally {
      setGenreLoading(false);
    }
  }, []);

  const loadArtistList = useCallback(async (area: number, type: number) => {
    setArtistsLoading(true);
    try {
      const list = await MusicApiService.getArtistList({ area, type, limit: 60 });
      setFullArtists(list || []);
    } catch (e) {
      console.error('Failed to load artist list:', e);
    } finally {
      setArtistsLoading(false);
    }
  }, []);

  const handleOpenAllArtists = () => {
    setShowAllArtists(true);
    if (fullArtists.length === 0) {
      void loadArtistList(artistArea, artistType);
    }
  };

  const handleAreaChange = (area: number) => {
    setArtistArea(area);
    void loadArtistList(area, artistType);
  };

  const handleTypeChange = (type: number) => {
    setArtistType(type);
    void loadArtistList(artistArea, type);
  };

  useEffect(() => {
    if (!active) return;
    const stale = Date.now() - lastFetchedAtRef.current > DISCOVERY_TTL_MS;
    if (fetchedRef.current && !stale) return;
    fetchedRef.current = true;

    const fetchDiscoveryData = async () => {
      setLoading(true);
      try {
        const [tLists, artists, genrePl, nSongs, nAlbums] = await Promise.all([
          MusicApiService.getNeteaseToplists().catch(() => [] as ToplistDetail[]),
          MusicApiService.getTopArtists().catch(() => []),
          MusicApiService.getPlaylistsByCategory('流行', 8).catch(() => [] as OnlinePlaylist[]),
          MusicApiService.getNewSongs().catch(() => [] as OnlineSong[]),
          MusicApiService.getNewAlbums(12).catch(() => [] as OnlineAlbum[]),
        ]);

        setToplists(tLists || []);
        setTopArtists((artists || []).slice(0, 12));
        genreCacheRef.current['流行'] = genrePl || [];
        setGenrePlaylists(genrePl || []);
        setNewSongs((nSongs || []).slice(0, 10));
        setNewAlbums((nAlbums || []).slice(0, 12));
        lastFetchedAtRef.current = Date.now();
      } catch (e: any) {
        console.error('Failed to fetch discovery data', e);
        setErrorMsg(e?.message || String(e));
        fetchedRef.current = false;
      } finally {
        setLoading(false);
      }
    };

    void fetchDiscoveryData();
  }, [active]);

  const handlePlaylistClick = (id: string) => {
    window.dispatchEvent(
      new CustomEvent('openPlaylist', {
        detail: { id, isNeteaseDirect: true, source: 'netease' },
      })
    );
  };

  const handleAlbumClick = (album: OnlineAlbum) => {
    window.dispatchEvent(
      new CustomEvent('openAlbum', {
        detail: {
          albumId: album.id,
          albumName: album.name,
          artistName: album.artist,
          source: 'netease',
        },
      })
    );
  };

  const formatCount = (count?: number) => {
    if (!count) return '0';
    if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
    if (count > 10000) return (count / 10000).toFixed(1) + '万';
    return count.toString();
  };

  const handlePlaySong = (onlineSong: OnlineSong) => {
    void playSong(toPlayerSong(onlineSong));
  };

  if (loading) {
    return (
      <div className="discovery-view-root" style={{ display: 'flex', flexDirection: 'column', gap: 28, padding: '12px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="skeleton-box" style={{ width: 120, height: 24, borderRadius: 8 }} />
          <div className="toplist-grid">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton-box" style={{ height: 110, borderRadius: 12 }} />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="skeleton-box" style={{ width: 120, height: 24, borderRadius: 8 }} />
          <div className="playlist-grid">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton-box" style={{ aspectRatio: '1/1', borderRadius: 12 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (showAllArtists) {
    return (
      <div className="discovery-view-root" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0', animation: 'fadeIn 0.25s ease' }}>
        {/* 顶部标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 4 }}>
          <button
            type="button"
            className="back-btn"
            onClick={() => setShowAllArtists(false)}
            title="返回探索发现"
            style={{ width: 34, height: 34, borderRadius: '50%' }}
          >
            <ArrowLeft size={18} />
          </button>
          <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>歌手分类</h2>
        </div>

        {/* 第 1 排：地区分类标签 */}
        <div className="artist-filter-row">
          {ARTIST_AREAS.map(a => (
            <button
              key={a.value}
              type="button"
              className={`artist-filter-tab ${artistArea === a.value ? 'active' : ''}`}
              onClick={() => handleAreaChange(a.value)}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* 第 2 排：性别/组合类型分类标签 */}
        <div className="artist-filter-row">
          {ARTIST_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              className={`artist-filter-tab ${artistType === t.value ? 'active' : ''}`}
              onClick={() => handleTypeChange(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 热门歌手小灰条标题 */}
        <div className="artist-section-bar">
          <span>热门歌手</span>
        </div>

        {artistsLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: 'var(--text-muted)', gap: 8 }}>
            <Loader2 size={20} className="animate-spin" />
            <span>正在加载歌手列表...</span>
          </div>
        ) : (
          <div className="artist-list-container">
            {fullArtists.map(artist => {
              const isFav = isFavoriteArtist(artist.id);
              return (
                <div
                  key={artist.id}
                  className="artist-list-row"
                  onClick={() => window.dispatchEvent(new CustomEvent('globalSearch', { detail: artist.name }))}
                  title={`搜索歌手: ${artist.name}`}
                >
                  <div className="artist-avatar-wrap">
                    <CoverImage src={artist.picUrl} alt={artist.name} className="artist-avatar-img" />
                  </div>
                  <div className="artist-info-wrap">
                    <span className="artist-name-text">{artist.name}</span>
                  </div>
                  <button
                    type="button"
                    className={`artist-follow-btn ${isFav ? 'followed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavoriteArtist({
                        id: artist.id,
                        name: artist.name,
                        picUrl: artist.picUrl,
                        source: 'netease',
                      });
                    }}
                    title={isFav ? '已关注/已收藏' : '关注/收藏歌手'}
                  >
                    {isFav ? '已关注' : '+ 关注'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="discovery-view-root"
      style={{ display: 'flex', flexDirection: 'column', gap: 28, padding: '12px 0', animation: 'fadeIn 0.4s ease' }}
    >
      {/* 1. 排行榜模块 */}
      {toplists.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Flame size={19} style={{ color: '#ef4444' }} />
            <h2 style={{ fontSize: 17, margin: 0 }}>排行榜</h2>
          </div>
          <div className="toplist-grid">
            {toplists.map(tl => (
              <div key={tl.id} className="toplist-card glass-card" onClick={() => handlePlaylistClick(tl.id)}>
                <div className="toplist-cover-wrapper">
                  <CoverImage src={tl.cover} alt={tl.name} className="toplist-cover" />
                  <div className="toplist-overlay">
                    <Play size={24} fill="white" />
                  </div>
                </div>
                <div className="toplist-info">
                  <div className="toplist-tracks">
                    {tl.topTracks?.map((track, idx) => (
                      <div key={idx} className="toplist-track-item">
                        <span className="track-idx">{idx + 1}</span>
                        <span className="track-name">{track.first}</span>
                        <span className="track-artist">- {track.second}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. 热门歌手模块（单行列表，右侧带关注/收藏按钮） */}
      {topArtists.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mic2 size={19} style={{ color: '#10b981' }} />
              <h2 style={{ fontSize: 17, margin: 0 }}>热门歌手</h2>
            </div>
            <button
              type="button"
              className="discovery-more-btn"
              onClick={handleOpenAllArtists}
              title="查看歌手分类"
            >
              <span>更多</span>
              <span>&gt;&gt;</span>
            </button>
          </div>
          <div className="artist-list-container glass-card" style={{ padding: '4px 10px' }}>
            {topArtists.slice(0, 6).map(artist => {
              const isFav = isFavoriteArtist(artist.id);
              return (
                <div
                  key={artist.id}
                  className="artist-list-row"
                  onClick={() => window.dispatchEvent(new CustomEvent('globalSearch', { detail: artist.name }))}
                  title={`搜索歌手: ${artist.name}`}
                >
                  <div className="artist-avatar-wrap">
                    <CoverImage src={artist.picUrl} alt={artist.name} className="artist-avatar-img" />
                  </div>
                  <div className="artist-info-wrap">
                    <span className="artist-name-text">{artist.name}</span>
                  </div>
                  <button
                    type="button"
                    className={`artist-follow-btn ${isFav ? 'followed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavoriteArtist({
                        id: artist.id,
                        name: artist.name,
                        picUrl: artist.picUrl,
                        source: 'netease',
                      });
                    }}
                    title={isFav ? '已关注/已收藏' : '关注/收藏歌手'}
                  >
                    {isFav ? '已关注' : '+ 关注'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. 曲风专区模块 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Compass size={19} style={{ color: '#a855f7' }} />
          <h2 style={{ fontSize: 17, margin: 0 }}>曲风分类</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>点击曲风探索对应歌单</span>
        </div>

        <div className="genre-chips-grid">
          {GENRE_LIST.map(g => {
            const isSelected = activeGenre === g.name;
            return (
              <button
                key={g.name}
                type="button"
                className={`genre-chip-btn ${isSelected ? 'active' : ''}`}
                onClick={() => void loadGenrePlaylists(g.name)}
                style={{
                  background: isSelected ? 'var(--primary-color)' : g.color,
                  borderColor: isSelected ? 'var(--primary-hover)' : 'rgba(255,255,255,0.08)',
                }}
              >
                <span className="genre-chip-icon">{g.icon}</span>
                <span className="genre-chip-name">{g.name}</span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 12 }}>
          {genreLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              <Loader2 size={16} className="animate-spin" />
              <span>正在加载「{activeGenre}」曲风歌单...</span>
            </div>
          ) : (
            <div className="playlist-grid">
              {genrePlaylists.map(pl => (
                <div key={pl.id} className="playlist-card" onClick={() => handlePlaylistClick(pl.id)}>
                  <div className="playlist-cover-wrapper">
                    <CoverImage src={pl.cover} alt="" className="playlist-card-cover" />
                    <div className="playlist-stats">
                      <div className="playlist-stat-item">
                        <Play size={10} fill="currentColor" />
                        <span>{formatCount(pl.playCount)}</span>
                      </div>
                    </div>
                  </div>
                  <span className="playlist-card-name" title={pl.name}>
                    {pl.name}
                  </span>
                  <span className="playlist-card-author">{pl.creatorName || activeGenre}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 4. 新歌新碟模块（支持 新歌速递 / 新碟上架 切换） */}
      {(newSongs.length > 0 || newAlbums.length > 0) && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Disc size={19} style={{ color: '#3b82f6' }} />
              <h2 style={{ fontSize: 17, margin: 0 }}>新歌新碟</h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setNewTab('songs')}
                className={`source-tab ${newTab === 'songs' ? 'active' : ''}`}
                style={{ padding: '4px 12px', borderRadius: 14, fontSize: 12 }}
              >
                新歌速递
              </button>
              <button
                type="button"
                onClick={() => setNewTab('albums')}
                className={`source-tab ${newTab === 'albums' ? 'active' : ''}`}
                style={{ padding: '4px 12px', borderRadius: 14, fontSize: 12 }}
              >
                新碟上架
              </button>
            </div>
          </div>

          {newTab === 'songs' ? (
            <div className="song-list-container discovery-newsong-grid">
              {newSongs.map(song => (
                <div
                  key={song.id}
                  className="song-row discovery-song-row"
                  onClick={() => handlePlaySong(song)}
                >
                  <CoverImage src={song.pic || ''} alt="" className="discovery-song-cover" />
                  <div className="song-col-info" style={{ flex: 1, minWidth: 0 }}>
                    <div className="song-title-row">
                      <span className="song-name" style={{ fontSize: 14 }}>
                        {song.name}
                      </span>
                    </div>
                    <span className="song-artist" style={{ fontSize: 12 }}>
                      {song.artist}
                    </span>
                  </div>
                  <div className="discovery-play-icon">
                    <Play size={15} fill="currentColor" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="playlist-grid">
              {newAlbums.map(album => (
                <div key={album.id} className="playlist-card" onClick={() => handleAlbumClick(album)}>
                  <div className="playlist-cover-wrapper">
                    <CoverImage src={album.picUrl} alt={album.name} className="playlist-card-cover" />
                    {album.size ? (
                      <div className="playlist-stats">
                        <div className="playlist-stat-item">
                          <Music size={10} />
                          <span>{album.size}首</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <span className="playlist-card-name" title={album.name}>
                    {album.name}
                  </span>
                  <span className="playlist-card-author" title={album.artist}>
                    {album.artist}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 空状态保护 */}
      {!loading && toplists.length === 0 && topArtists.length === 0 && newSongs.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            marginTop: 60,
          }}
        >
          <Compass size={48} strokeWidth={1} style={{ marginBottom: 16, color: 'var(--primary-color)' }} />
          <h3 style={{ margin: 0 }}>探索发现</h3>
          <p style={{ marginTop: 8, fontSize: 13 }}>暂未获取到音乐馆内容，请尝试在上方搜索你想听的歌曲</p>
          {errorMsg && (
            <p style={{ marginTop: 16, fontSize: 12, color: '#ef4444', maxWidth: '80%', textAlign: 'center', wordBreak: 'break-all' }}>
              Error Detail: {errorMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
