import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Compass,
  Heart,
  Loader2,
  Music,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  ArrowLeft,
  Sun,
  Moon,
} from 'lucide-react';
import { getSavedTheme, toggleTheme, ThemeMode } from '../utils/themeManager';
import { MusicApiService, OnlinePlaylist, OnlineSong, PlaylistDetail } from '../services/musicApi';
import { usePlayer } from '../context/PlayerContext';
import { useToast } from '../context/ToastContext';
import { toPlayerSong, isSameSong } from '../utils/songUtils';
import { computeReportStats } from '../utils/reportStats';
import { MUSIC_SOURCES } from '../settings';
import { CoverImage } from './CoverImage';
import { registerBackHandler } from '../utils/navigationManager';
import type { Song } from '../types/music';

const RECOMMEND_TTL_MS = 15 * 60 * 1000;

function dedupeOnlineSongs(songs: OnlineSong[]): OnlineSong[] {
  const seen = new Set<string>();
  const out: OnlineSong[] = [];
  for (const s of songs) {
    const key = `${s.name.trim().toLowerCase()}|${s.artist.trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function dedupePlaylists(list: OnlinePlaylist[]): OnlinePlaylist[] {
  const seen = new Set<string>();
  const out: OnlinePlaylist[] = [];
  for (const pl of list) {
    if (pl.id && !seen.has(pl.id)) {
      seen.add(pl.id);
      out.push(pl);
    }
  }
  return out;
}

const formatCount = (count?: number) => {
  if (!count) return '0';
  if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
  if (count > 10000) return (count / 10000).toFixed(1) + '万';
  return count.toString();
};

const formatSecs = (secs: number) => {
  if (!secs) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const sourceName = (source: string) =>
  MUSIC_SOURCES.find(item => item.id === source)?.name || source;

export const RecommendPanel: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const {
    currentSong,
    playHistory,
    favoriteSongs,
    playSong,
    addToPlaylist,
    playAll,
    addAllToPlaylist,
    isFavorite,
    toggleFavorite,
    isFavoritePlaylist,
    toggleFavoritePlaylist,
  } = usePlayer();
  const toast = useToast();

  const [dailySongs, setDailySongs] = useState<OnlineSong[]>([]);
  const [simiSongs, setSimiSongs] = useState<OnlineSong[]>([]);
  const [simiLoading, setSimiLoading] = useState<boolean>(false);
  const [curatedPlaylists, setCuratedPlaylists] = useState<OnlinePlaylist[]>([]);
  const [playlistPool, setPlaylistPool] = useState<OnlinePlaylist[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  // 懒加载控制：初始展示 8 首，上滑触底增加
  const [visibleCount, setVisibleCount] = useState<number>(8);
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(() => getSavedTheme());

  const handleToggleTheme = () => {
    const next = toggleTheme();
    setCurrentTheme(next);
  };
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // 基于听歌年报最爱歌曲（不随单次听歌频繁切换，仅在收藏列表变化或初次加载时更新）
  const [reportTopSongs, setReportTopSongs] = useState<Song[]>(() => {
    const report = computeReportStats(playHistory);
    if (report.topSongs.length > 0) {
      return report.topSongs.map(t => t.song);
    }
    return favoriteSongs.slice(0, 10);
  });

  const prevFavLengthRef = useRef(favoriteSongs.length);
  useEffect(() => {
    if (favoriteSongs.length !== prevFavLengthRef.current) {
      prevFavLengthRef.current = favoriteSongs.length;
      const report = computeReportStats(playHistory);
      const newTop = report.topSongs.length > 0
        ? report.topSongs.map(t => t.song)
        : favoriteSongs.slice(0, 10);
      setReportTopSongs(newTop);
    }
  }, [favoriteSongs, playHistory]);

  // 基准歌曲候选池：最爱歌曲前 3 首做基准
  const baseCandidates = useMemo(() => reportTopSongs.slice(0, 3), [reportTopSongs]);
  // 切换基准歌曲候选：最爱歌曲第 4~6 首（不足则为空）
  const switchCandidates = useMemo(() => reportTopSongs.slice(3, 6), [reportTopSongs]);

  // 当前激活的基准歌曲（默认取前 3 首里的第一首）
  const [activeSeedSong, setActiveSeedSong] = useState<Song | null>(() => baseCandidates[0] || reportTopSongs[0] || null);

  useEffect(() => {
    if (!activeSeedSong && reportTopSongs.length > 0) {
      setActiveSeedSong(reportTopSongs[0]);
    }
  }, [reportTopSongs, activeSeedSong]);

  // 二级详情视图：可以是 'daily'（今日推荐列表）、'radar'（相似漫游列表）或某个具体歌单 PlaylistDetail
  const [detailView, setDetailView] = useState<
    | { type: 'daily' }
    | { type: 'radar' }
    | { type: 'playlist'; detail: PlaylistDetail }
    | null
  >(null);

  // 注册屏幕边缘向右滑或全局返回动作拦截
  useEffect(() => {
    if (!detailView) return;
    return registerBackHandler(() => {
      setDetailView(null);
      return true;
    });
  }, [detailView]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastFetchedAtRef = useRef<number>(0);
  const lastSeedIdRef = useRef<string>('');

  const todayInfo = useMemo(() => {
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return { month, day, weekday: weekdays[now.getDay()] };
  }, []);

  // 拉取特定种子歌曲的相似歌曲（一次拉取 24 首，用于分页懒加载）
  const fetchSimiForSeed = useCallback(async (seed: Song | null) => {
    if (!seed) return;
    setSimiLoading(true);
    setVisibleCount(8);
    try {
      const songs = await MusicApiService.getSimiSongs(seed, 24);
      if (songs.length > 0) {
        setSimiSongs(dedupeOnlineSongs(songs));
      }
    } catch (e) {
      console.warn('fetchSimiForSeed error:', e);
    } finally {
      setSimiLoading(false);
    }
  }, []);

  const handleSelectSeed = (seed: Song) => {
    setActiveSeedSong(seed);
    void fetchSimiForSeed(seed);
  };

  // 初始化或刷新推荐数据
  const loadRecommendData = useCallback(
    async (force: boolean = false) => {
      const now = Date.now();
      if (!force && lastFetchedAtRef.current > 0 && now - lastFetchedAtRef.current < RECOMMEND_TTL_MS) {
        return;
      }
      setLoading(true);
      try {
        const seeds = baseCandidates.slice(0, 2);
        const [newSongsRes, personalPlRes, hqPlRes, simiSongs1, simiSongs2, simiPl1] = await Promise.all([
          MusicApiService.getNewSongs().catch(() => [] as OnlineSong[]),
          MusicApiService.getPersonalizedPlaylists(16).catch(() => [] as OnlinePlaylist[]),
          MusicApiService.getNeteaseHighQualityPlaylists({ limit: 24 }).catch(() => ({ playlists: [] as OnlinePlaylist[] })),
          seeds[0] ? MusicApiService.getSimiSongs(seeds[0], 24).catch(() => [] as OnlineSong[]) : Promise.resolve([] as OnlineSong[]),
          seeds[1] ? MusicApiService.getSimiSongs(seeds[1], 15).catch(() => [] as OnlineSong[]) : Promise.resolve([] as OnlineSong[]),
          seeds[0] ? MusicApiService.getSimiPlaylists(seeds[0], 6).catch(() => [] as OnlinePlaylist[]) : Promise.resolve([] as OnlinePlaylist[]),
        ]);

        // 1. 组装「今日推荐」歌曲列表
        let combinedDaily = dedupeOnlineSongs([...simiSongs1, ...simiSongs2, ...newSongsRes]);
        if (combinedDaily.length < 20 && (personalPlRes.length > 0 || hqPlRes.playlists.length > 0)) {
          const topPl = personalPlRes[0] || hqPlRes.playlists[0];
          if (topPl) {
            const plDetail = await MusicApiService.getPlaylistDetails(topPl.id, true, 'netease').catch(() => null);
            if (plDetail?.item) {
              combinedDaily = dedupeOnlineSongs([...combinedDaily, ...plDetail.item]);
            }
          }
        }
        setDailySongs(combinedDaily.slice(0, 30));

        // 2. 设置「可能你还喜欢」推荐池
        if (simiSongs1.length > 0) {
          setSimiSongs(dedupeOnlineSongs(simiSongs1));
        } else {
          setSimiSongs(combinedDaily);
        }

        // 3. 组装「为你精选的歌单」
        const mergedPlaylists = dedupePlaylists([
          ...simiPl1,
          ...personalPlRes,
          ...(hqPlRes.playlists || []),
        ]);
        setPlaylistPool(mergedPlaylists);
        setCuratedPlaylists(mergedPlaylists.slice(0, 12));
        lastFetchedAtRef.current = Date.now();
      } catch (err) {
        console.error('Failed to load recommend panel data:', err);
      } finally {
        setLoading(false);
      }
    },
    [baseCandidates]
  );

  // 滚动触底懒加载
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 160 && !loadingMore && !simiLoading) {
      const totalAvailable = simiSongs.length > 0 ? simiSongs.length : dailySongs.length;
      if (visibleCount < totalAvailable) {
        setLoadingMore(true);
        setTimeout(() => {
          setVisibleCount(prev => Math.min(prev + 8, totalAvailable));
          setLoadingMore(false);
        }, 200);
      }
    }
  };

  useEffect(() => {
    if (!active) return;
    void loadRecommendData(false);
  }, [active, loadRecommendData]);

  // 当用户首次产生听歌记录且原先没有相似歌曲时自动刷新一次
  useEffect(() => {
    if (activeSeedSong && activeSeedSong.id !== lastSeedIdRef.current) {
      lastSeedIdRef.current = activeSeedSong.id;
      if (lastFetchedAtRef.current > 0) {
        void fetchSimiForSeed(activeSeedSong);
      }
    }
  }, [activeSeedSong, fetchSimiForSeed]);

  const handleReshufflePlaylists = () => {
    if (playlistPool.length <= 12) {
      void loadRecommendData(true);
      return;
    }
    const copy = [...playlistPool];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    setCuratedPlaylists(copy.slice(0, 12));
  };

  const handleOpenPlaylist = async (playlistId: string) => {
    setDetailLoading(true);
    try {
      const detail = await MusicApiService.getPlaylistDetails(playlistId, true, 'netease');
      if (detail) {
        setDetailView({ type: 'playlist', detail });
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast.error('未能加载该歌单详情，请稍后重试');
      }
    } catch (err) {
      console.error(err);
      toast.error('加载歌单详情失败，请稍后重试');
    } finally {
      setDetailLoading(false);
    }
  };

  const renderSongList = (songs: OnlineSong[]) => (
    <div className="song-list-container">
      {songs.map((song, index) => {
        const playerSong = toPlayerSong(song);
        const isCurrent = isSameSong(currentSong, playerSong);
        const isFav = isFavorite(playerSong);

        return (
          <div
            key={`${song.source}_${song.id}_${index}`}
            className={`song-row song-row-playable ${isCurrent ? 'active' : ''}`}
            onClick={() => void playSong(playerSong)}
            title="点击播放"
          >
            <div className="song-col-index">
              {isCurrent ? (
                <Play size={14} fill="var(--primary-color)" stroke="var(--primary-color)" />
              ) : (
                (index + 1).toString().padStart(2, '0')
              )}
            </div>
            <CoverImage
              src={song.pic || ''}
              alt=""
              className="discovery-song-cover"
              style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, marginRight: 4 }}
            />
            <div className="song-col-info">
              <div className="song-title-row">
                <span className="song-name" style={{ color: isCurrent ? 'var(--primary-hover)' : 'inherit' }}>
                  {song.name}
                </span>
                {song.has_hires && <span className="tag-hires">Hi-Res</span>}
                <span className="tag-source">{sourceName(song.source)}</span>
              </div>
              <div className="song-subtitle-row" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 2, flexWrap: 'wrap' }}>
                <span
                  className="song-artist clickable-artist"
                  onClick={e => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent('globalSearch', { detail: song.artist }));
                  }}
                  title={`搜索歌手: ${song.artist}`}
                >
                  {song.artist || '未知歌手'}
                </span>
                {song.album && song.album !== '未知专辑' && song.album !== '-' && (
                  <span
                    className="clickable-artist song-album-inline"
                    onClick={e => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('openAlbum', {
                          detail: {
                            albumId: song.albumId,
                            albumName: song.album,
                            artistName: song.artist,
                            source: song.source,
                          },
                        })
                      );
                    }}
                    style={{
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                    title={`查看专辑: ${song.album}`}
                  >
                    · {song.album}
                  </span>
                )}
              </div>
            </div>
            <div className="song-col-album">
              {song.album && song.album !== '未知专辑' && song.album !== '-' ? (
                <span
                  className="clickable-artist"
                  onClick={e => {
                    e.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent('openAlbum', {
                        detail: {
                          albumId: song.albumId,
                          albumName: song.album,
                          artistName: song.artist,
                          source: song.source,
                        },
                      })
                    );
                  }}
                  style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {song.album}
                </span>
              ) : (
                song.album || '-'
              )}
            </div>
            <div className="song-col-duration">{formatSecs(song.duration || 0)}</div>
            <div className="song-row-actions" onClick={e => e.stopPropagation()}>
              <button className="song-row-action-btn" onClick={() => void playSong(playerSong)} title="立即播放">
                <Play size={14} fill="currentColor" />
              </button>
              <button className="song-row-action-btn" onClick={() => addToPlaylist(playerSong)} title="设作下一首播放">
                <Plus size={14} />
              </button>
              <button
                className={`song-row-action-btn ${isFav ? 'active' : ''}`}
                onClick={() => void toggleFavorite(playerSong)}
                title={isFav ? '取消收藏' : '收藏歌曲'}
                style={isFav ? { color: '#ef4444' } : undefined}
              >
                <Heart size={14} fill={isFav ? '#ef4444' : 'none'} color={isFav ? '#ef4444' : 'currentColor'} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  // 如果打开了今日推荐/相似雷达/歌单详情页
  if (detailView) {
    const isDaily = detailView.type === 'daily';
    const isRadar = detailView.type === 'radar';
    const listSongs = isDaily
      ? dailySongs
      : isRadar
      ? simiSongs
      : detailView.detail.item;
    const title = isDaily
      ? `今日推荐 · ${todayInfo.month}/${todayInfo.day}`
      : isRadar
      ? `私人相似漫游${activeSeedSong ? ` · 源自《${activeSeedSong.name}》` : ''}`
      : detailView.detail.name;
    const subtitle = isDaily
      ? `${todayInfo.weekday}专属定制 · 根据你的听歌口味每日更新 (${listSongs.length} 首)`
      : isRadar
      ? `为你搜罗曲风与意境相似的精选单曲 (${listSongs.length} 首)`
      : `创建者: ${detailView.detail.creatorName || '官方'} · 共 ${listSongs.length} 首`;
    const coverImg = isDaily
      ? dailySongs[0]?.pic || ''
      : isRadar
      ? simiSongs[0]?.pic || activeSeedSong?.pic || ''
      : detailView.detail.cover;

    return (
      <div ref={scrollRef} style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <button className="back-btn" onClick={() => setDetailView(null)} title="返回推荐首页">
            <ArrowLeft size={16} />
            <span>返回推荐</span>
          </button>

          <div className="detail-header">
            <CoverImage src={coverImg} alt="" className="detail-cover" />
            <div className="detail-info">
              <div className="detail-title-row" style={{ display: 'block', marginBottom: 4 }}>
                <h2 className="detail-title" style={{ display: 'inline', fontSize: 18, lineHeight: 1.4, margin: 0 }}>
                  {title}
                </h2>
              </div>
              <span className="detail-author">{subtitle}</span>
              <div className="detail-action-btns">
                <button
                  className="primary-btn playlist-action-btn"
                  onClick={() => playAll(listSongs.map(toPlayerSong))}
                  title="播放全部"
                >
                  <Play size={16} fill="currentColor" />
                  <span className="btn-text">播放全部</span>
                </button>
                <button
                  className="icon-btn playlist-action-btn"
                  onClick={() => addAllToPlaylist(listSongs.map(toPlayerSong))}
                  title="全部添加到队列"
                >
                  <Plus size={16} />
                  <span className="btn-text">添加全部</span>
                </button>
                {detailView.type === 'playlist' && (
                  <button
                    className="icon-btn playlist-action-btn"
                    onClick={() =>
                      toggleFavoritePlaylist({
                        id: detailView.detail.id,
                        name: detailView.detail.name,
                        coverImgUrl: detailView.detail.cover || '',
                        trackCount: detailView.detail.item.length,
                        source: 'netease',
                        creatorName: detailView.detail.creatorName,
                      })
                    }
                    title={isFavoritePlaylist(detailView.detail.id) ? '取消收藏' : '收藏歌单'}
                    style={{ color: isFavoritePlaylist(detailView.detail.id) ? '#ef4444' : undefined }}
                  >
                    <Heart size={16} fill={isFavoritePlaylist(detailView.detail.id) ? '#ef4444' : 'none'} />
                    <span className="btn-text">{isFavoritePlaylist(detailView.detail.id) ? '已收藏' : '收藏'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {renderSongList(listSongs)}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="recommend-panel-root"
      style={{ width: '100%', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}
    >
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px 0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={20} style={{ color: 'var(--primary-color)' }} />
          <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>为你推荐</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {todayInfo.month}月{todayInfo.day}日 · {todayInfo.weekday}
          </span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={handleToggleTheme}
          title={currentTheme === 'dark' ? '切换为白天模式' : '切换为黑夜模式'}
          style={{
            height: 28,
            padding: '0 12px',
            borderRadius: 14,
            background: 'var(--glass-bg-hover)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-main)',
            fontSize: 12,
            gap: 6,
            display: 'inline-flex',
            alignItems: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {currentTheme === 'dark' ? (
            <>
              <Sun size={14} color="#f59e0b" />
              <span>白天</span>
            </>
          ) : (
            <>
              <Moon size={14} color="#a855f7" />
              <span>黑夜</span>
            </>
          )}
        </button>
      </div>

      {detailLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c084fc', fontSize: 13 }}>
          <Loader2 size={16} className="animate-spin" />
          <span>正在加载歌单曲目列表...</span>
        </div>
      )}

      {/* 1. 顶部双核心推荐大卡：今日推荐 + 私人相似漫游 */}
      <div className="recommend-hero-grid">
        {/* 卡片 A：今日推荐 */}
        <div
          className="recommend-hero-card daily-card"
          onClick={() => {
            if (dailySongs.length > 0) setDetailView({ type: 'daily' });
          }}
          title="点击查看今日推荐完整歌曲列表"
        >
          {dailySongs[0]?.pic && (
            <div
              className="recommend-hero-bg"
              style={{ backgroundImage: `url(${dailySongs[0].pic})` }}
            />
          )}
          <div className="recommend-hero-content">
            <div className="recommend-calendar-badge">
              <span className="cal-month">{todayInfo.month}月</span>
              <span className="cal-day">{todayInfo.day}</span>
            </div>
            <div className="recommend-hero-text">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={14} style={{ color: '#f59e0b' }} />
                <span className="recommend-hero-tag">每日专属定制</span>
              </div>
              <h3>今日推荐</h3>
              <p>
                {dailySongs.length > 0
                  ? `含《${dailySongs[0].name}》等 ${dailySongs.length} 首精选好歌`
                  : '正在为你生成今日专属歌单...'}
              </p>
            </div>
            <button
              type="button"
              className="recommend-hero-play-btn"
              onClick={e => {
                e.stopPropagation();
                if (dailySongs.length > 0) {
                  playAll(dailySongs.map(toPlayerSong));
                }
              }}
              title="立即播放全部今日推荐"
            >
              <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
            </button>
          </div>
        </div>

        {/* 卡片 B：私人相似漫游 */}
        <div
          className="recommend-hero-card radar-card"
          onClick={() => {
            if (simiSongs.length > 0) setDetailView({ type: 'radar' });
          }}
          title="点击查看相似漫游曲目列表"
        >
          {(simiSongs[0]?.pic || activeSeedSong?.pic) && (
            <div
              className="recommend-hero-bg"
              style={{ backgroundImage: `url(${simiSongs[0]?.pic || activeSeedSong?.pic})` }}
            />
          )}
          <div className="recommend-hero-content">
            <div className="recommend-radar-icon">
              <Radio size={26} style={{ color: '#c084fc' }} />
            </div>
            <div className="recommend-hero-text">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Compass size={14} style={{ color: '#38bdf8' }} />
                <span className="recommend-hero-tag">相似歌曲电台</span>
              </div>
              <h3>私人相似漫游</h3>
              <p>
                {activeSeedSong
                  ? `从你听过的《${activeSeedSong.name}》漫游相似旋律`
                  : '根据热门曲风为你漫游相似好歌'}
              </p>
            </div>
            <button
              type="button"
              className="recommend-hero-play-btn"
              onClick={e => {
                e.stopPropagation();
                const list = simiSongs.length > 0 ? simiSongs : dailySongs;
                if (list.length > 0) {
                  playAll(list.map(toPlayerSong));
                }
              }}
              title="立即开启相似漫游播放"
            >
              <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. 为你精选的歌单（相似歌单 + 官方精选） */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} style={{ color: '#a855f7' }} />
            <h3 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>为你精选的歌单</h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={handleReshufflePlaylists}
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 13,
              background: 'rgba(255,255,255,0.05)',
              fontSize: 12,
              gap: 5,
            }}
          >
            <RefreshCw size={12} />
            <span>换一批</span>
          </button>
        </div>

        {loading && curatedPlaylists.length === 0 ? (
          <div className="playlist-grid">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton-box" style={{ aspectRatio: '1/1', borderRadius: 12 }} />
            ))}
          </div>
        ) : (
          <div className="playlist-grid">
            {curatedPlaylists.map(pl => (
              <div key={pl.id} className="playlist-card" onClick={() => void handleOpenPlaylist(pl.id)}>
                <div className="playlist-cover-wrapper">
                  <CoverImage src={pl.cover} alt="" className="playlist-card-cover" />
                  {pl.playCount ? (
                    <div className="playlist-stats">
                      <div className="playlist-stat-item">
                        <Play size={10} fill="currentColor" />
                        <span>{formatCount(pl.playCount)}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
                <span className="playlist-card-name" title={pl.name}>
                  {pl.name}
                </span>
                <span className="playlist-card-author">{pl.creatorName || '精选推荐'}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. 可能你还喜欢 · 推荐歌曲 */}
      <section style={{ paddingBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Music size={18} style={{ color: '#10b981' }} />
            <h3 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>可能你还喜欢</h3>
            {activeSeedSong && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                基于《{activeSeedSong.name}》
              </span>
            )}
          </div>
          {(simiSongs.length > 0 || dailySongs.length > 0) && (
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                const list = (simiSongs.length > 0 ? simiSongs : dailySongs).slice(0, visibleCount);
                playAll(list.map(toPlayerSong));
              }}
              style={{ height: 28, padding: '0 12px', borderRadius: 14, fontSize: 12, gap: 4 }}
            >
              <Play size={12} fill="currentColor" />
              <span>播放全部</span>
            </button>
          )}
        </div>

        {/* 切换基准歌曲：展示年报中最爱歌曲的第 4-6 首，如无则无需展示 */}
        {switchCandidates.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>切换基准歌曲:</span>
            {switchCandidates.map((seed, idx) => {
              const isSelected = activeSeedSong?.id === seed.id;
              return (
                <button
                  key={`${seed.id}_${idx}`}
                  type="button"
                  onClick={() => handleSelectSeed(seed)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 14,
                    fontSize: 12,
                    border: isSelected ? '1px solid var(--primary-color)' : '1px solid rgba(255,255,255,0.08)',
                    background: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.04)',
                    color: isSelected ? '#e9d5ff' : 'var(--text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {seed.name}
                </button>
              );
            })}
          </div>
        )}

        {simiLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={16} className="animate-spin" />
            <span>正在根据《{activeSeedSong?.name}》分析推荐歌曲...</span>
          </div>
        ) : (
          <>
            {renderSongList((simiSongs.length > 0 ? simiSongs : dailySongs).slice(0, visibleCount))}
            {(simiSongs.length > 0 ? simiSongs : dailySongs).length > visibleCount && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '14px 0',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const total = (simiSongs.length > 0 ? simiSongs : dailySongs).length;
                  setVisibleCount(prev => Math.min(prev + 8, total));
                }}
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>正在加载更多...</span>
                  </>
                ) : (
                  <span>向上滑动自动加载更多推荐（已展示 {Math.min(visibleCount, (simiSongs.length > 0 ? simiSongs : dailySongs).length)} / {(simiSongs.length > 0 ? simiSongs : dailySongs).length}）</span>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
