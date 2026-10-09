import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Play, Plus, Search, Music, Heart, ArrowUp, X } from 'lucide-react';
import { MusicApiService, OnlinePlaylist, OnlineSong, PlaylistDetail } from '../services/musicApi';
import { usePlayer, FavoriteArtist } from '../context/PlayerContext';
import { useToast } from '../context/ToastContext';
import { getDefaultSearchSource, setDefaultSearchSource, MUSIC_SOURCES, MusicSource } from '../settings';
import { toPlayerSong } from '../utils/songUtils';
import { ArtistBanner } from './ArtistBanner';
import { DiscoveryView } from './DiscoveryView';
import { CoverImage } from './CoverImage';

const PAGE_SIZE = 30;

const TEXT = {
  unknown: '\u672a\u77e5',
  unknownError: '\u672a\u77e5\u9519\u8bef',
  unknownCreator: '\u672a\u77e5\u521b\u5efa\u8005',
  search: '\u641c\u7d22',
  searchPlaceholder: '\u641c\u7d22\u6b4c\u66f2\u3001\u6b4c\u5355\u6216\u6b4c\u624b...',
  searchError: '\u641c\u7d22\u51fa\u9519\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u914d\u7f6e\u3002',
  tracks: '\u5355\u66f2 / \u6b4c\u624b',
  playlists: '\u7cbe\u54c1\u6b4c\u5355',
  result: '\u641c\u7d22\u7ed3\u679c',
  loadingPlaylist: '\u6b63\u5728\u8f7d\u5165\u5728\u7ebf\u6b4c\u5355\u8be6\u60c5...',
  loadingMore: '\u6b63\u5728\u52a0\u8f7d\u66f4\u591a\u6b4c\u66f2...',
  playlistLoadError: '\u6b4c\u5355\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
  back: '\u8fd4\u56de',
  playlistTag: '\u7f51\u6613\u4e91\u6b4c\u5355',
  creator: '\u521b\u5efa\u8005',
  playNow: '\u7acb\u5373\u64ad\u653e',
  addQueue: '\u6dfb\u52a0\u5230\u64ad\u653e\u961f\u5217',
};

const formatCount = (count?: number) => {
  if (!count) return '0';
  if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
  if (count > 10000) return (count / 10000).toFixed(1) + '万';
  return count.toString();
};

export const SearchPanel: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const { playSong, addToPlaylist, playAll, addAllToPlaylist, isFavoritePlaylist, toggleFavoritePlaylist } = usePlayer();
  const toast = useToast();
  const [keyword, setKeyword] = useState<string>('');
  const [activeKeyword, setActiveKeyword] = useState<string>('');
  const [searchType, setSearchType] = useState<'track' | 'playlist'>('track');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [songResults, setSongResults] = useState<OnlineSong[]>([]);
  const [playlistResults, setPlaylistResults] = useState<OnlinePlaylist[]>([]);
  const [playlistPage, setPlaylistPage] = useState<number>(1);
  const [playlistHasMore, setPlaylistHasMore] = useState<boolean>(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [detailPage, setDetailPage] = useState<number>(1);
  const [playlistLoading, setPlaylistLoading] = useState<boolean>(false);
  
  const [matchedArtist, setMatchedArtist] = useState<FavoriteArtist | null>(null);
  const [currentSource, setCurrentSource] = useState<MusicSource>(getDefaultSearchSource);
  
  const loadingMoreRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleFocusSearch = () => {
      searchInputRef.current?.focus();
    };
    window.addEventListener('focusSearchInput', handleFocusSearch);
    return () => {
      window.removeEventListener('focusSearchInput', handleFocusSearch);
    };
  }, []);

  useEffect(() => {
    const handleGlobalSearch = ((e: CustomEvent) => {
      const term = e.detail;
      if (!term) return;
      setKeyword(term);
      setSearchType('track');
      setLoading(true);
      setSelectedPlaylist(null);
      setActiveKeyword(term);
      setPage(1);
      setHasMore(false);
      setPlaylistPage(1);
      setPlaylistHasMore(false);
      setDetailPage(1);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }

      searchTracks(term, 1, false)
        .catch((err: any) => {
          console.error(err);
          toast.error(`${TEXT.searchError}\n${err instanceof Error ? err.message : TEXT.unknownError}`);
        })
        .finally(() => {
          setLoading(false);
        });
    }) as EventListener;

    const handleOpenPlaylist = ((e: CustomEvent) => {
      const detail = e.detail;
      const id = typeof detail === 'string' ? detail : detail?.id;
      const isNeteaseDirect = typeof detail === 'object' && detail ? !!detail.isNeteaseDirect : false;
      const source = typeof detail === 'object' && detail?.source ? String(detail.source) : undefined;
      if (id) {
        void handlePlaylistClick(id, isNeteaseDirect, source);
      }
    }) as EventListener;

    // 点击歌曲行里的"专辑名"进入专辑详情，detail = { albumId, source }
    const handleOpenAlbum = ((e: CustomEvent) => {
      const detail = e.detail || {};
      if (detail.albumId) {
        void handleAlbumClick(detail.albumId, detail.source || 'netease');
      }
    }) as EventListener;

    window.addEventListener('globalSearch', handleGlobalSearch);
    window.addEventListener('openPlaylist', handleOpenPlaylist);
    window.addEventListener('openAlbum', handleOpenAlbum);
    return () => {
      window.removeEventListener('globalSearch', handleGlobalSearch);
      window.removeEventListener('openPlaylist', handleOpenPlaylist);
      window.removeEventListener('openAlbum', handleOpenAlbum);
    };
  }, []);


  const sourceName = (source: string) => MUSIC_SOURCES.find(item => item.id === source)?.name || source;

  const mergeSongs = (existing: OnlineSong[], incoming: OnlineSong[]) => {
    const seen = new Set(existing.map(song => `${song.source}_${song.id}`));
    const merged = [...existing];
    for (const song of incoming) {
      const key = `${song.source}_${song.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(song);
      }
    }
    return merged;
  };

  const searchTracks = async (term: string, targetPage: number, append: boolean, sourceOverride?: MusicSource) => {
    const source = sourceOverride || currentSource;
    const [results, artistResult] = await Promise.all([
      MusicApiService.searchSongs(term, source, targetPage),
      !append ? MusicApiService.searchArtist(term) : Promise.resolve(null)
    ]);
    
    if (!append) {
      setMatchedArtist(artistResult);
    }
    
    setSongResults(prev => append ? mergeSongs(prev, results) : results);
    setPlaylistResults([]);
    setPage(targetPage);
    setHasMore(results.length >= PAGE_SIZE);
  };

  const handleSourceChange = (newSource: MusicSource) => {
    setCurrentSource(newSource);
    setDefaultSearchSource(newSource);
    const term = (activeKeyword || keyword).trim();
    if (term) {
      setActiveKeyword(term);
      setLoading(true);
      setPage(1);
      setHasMore(false);
      searchTracks(term, 1, false, newSource)
        .catch((err: any) => {
          console.error(err);
          toast.error(`${TEXT.searchError}\n${err instanceof Error ? err.message : TEXT.unknownError}`);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  };

  const searchPlaylistsPage = async (term: string, targetPage: number, append: boolean) => {
    const results = await MusicApiService.searchPlaylists(term, targetPage);
    setPlaylistResults(prev => append ? [...prev, ...results] : results);
    setSongResults([]);
    setPlaylistPage(targetPage);
    setPlaylistHasMore(results.length >= 30);
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const term = keyword.trim();
    if (!term) return;

    setLoading(true);
    setSelectedPlaylist(null);
    setActiveKeyword(term);
    setPage(1);
    setHasMore(false);
    setPlaylistPage(1);
    setPlaylistHasMore(false);
    setDetailPage(1);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }

    try {
      if (searchType === 'track') {
        await searchTracks(term, 1, false);
      } else {
        await searchPlaylistsPage(term, 1, false);
      }
    } catch (err) {
      console.error(err);
      toast.error(`${TEXT.searchError}\n${err instanceof Error ? err.message : TEXT.unknownError}`);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreTracks = async () => {
    if (searchType !== 'track' || loading || loadingMoreRef.current || !hasMore || !activeKeyword) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await searchTracks(activeKeyword, page + 1, true);
    } catch (err) {
      console.error(err);
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const loadMorePlaylists = async () => {
    if (searchType !== 'playlist' || loading || loadingMoreRef.current || !playlistHasMore || !activeKeyword) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await searchPlaylistsPage(activeKeyword, playlistPage + 1, true);
    } catch (err) {
      console.error(err);
      setPlaylistHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const handleResultsScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 160) {
      if (selectedPlaylist) {
        if (detailPage * PAGE_SIZE < selectedPlaylist.item.length) {
          setDetailPage(prev => prev + 1);
        }
      } else {
        if (searchType === 'track') void loadMoreTracks();
        else if (searchType === 'playlist') void loadMorePlaylists();
      }
    }
  };

  const openDetailScrollTop = () => {
    // 进详情视图时把外层滚动容器滚回顶部，避免停留在点击的那一行位置
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    });
  };

  const handlePlaylistClick = async (
    playlistId: string,
    isNeteaseDirect: boolean = false,
    source?: string,
  ) => {
    setPlaylistLoading(true);
    openDetailScrollTop();
    try {
      const details = await MusicApiService.getPlaylistDetails(
        playlistId,
        isNeteaseDirect,
        source || getDefaultSearchSource(),
      );
      setSelectedPlaylist(details);
      setDetailPage(1);
    } catch (err) {
      console.error(err);
      toast.error(`${TEXT.playlistLoadError}\n\n建议：如果一直失败，请尝试在“关于与设置”中配置代理，或者更换其他的第三方接口节点。`);
    } finally {
      setPlaylistLoading(false);
    }
  };

  // 点击专辑名进入专辑详情：复用 selectedPlaylist 详情视图
  const handleAlbumClick = async (albumId: string, source: string) => {
    setPlaylistLoading(true);
    openDetailScrollTop();
    try {
      const details = await MusicApiService.getAlbumDetail(albumId, source);
      if (!details) {
        toast.error('无法获取该专辑详情。\n\n该歌曲可能来自第三方接口，未提供专辑信息；或专辑已下架。');
        return;
      }
      setSelectedPlaylist(details);
      setDetailPage(1);
    } catch (err) {
      console.error(err);
      toast.error(`${TEXT.playlistLoadError}\n\n可能是专辑接口异常，请稍后重试。`);
    } finally {
      setPlaylistLoading(false);
    }
  };


  const formatSecs = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const renderSongList = (songs: OnlineSong[]) => (
    <div className="song-list-container">
      {songs.map((song, index) => (
        <div
          key={`${song.source}_${song.id}`}
          className="song-row song-row-playable"
          onClick={() => playSong(toPlayerSong(song))}
          title="点击播放"
        >
          <div className="song-col-index">{(index + 1).toString().padStart(2, '0')}</div>
          <div className="song-col-info">
            <div className="song-title-row">
              <span className="song-name">{song.name}</span>
              {song.has_hires && <span className="tag-hires">Hi-Res</span>}
              <span className="tag-source">{sourceName(song.source)}</span>
            </div>
            <span
              className="song-artist clickable-artist"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('globalSearch', { detail: song.artist }));
              }}
              title={`搜索歌手: ${song.artist}`}
            >
              {song.artist}
            </span>
          </div>
          <div className="song-col-album">
            {song.albumId ? (
              <span
                className="clickable-artist"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('openAlbum', { detail: { albumId: song.albumId, source: song.source } }));
                }}
                title={`查看专辑: ${song.album}`}
                style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {song.album}
              </span>
            ) : (
              song.album
            )}
          </div>
          <div className="song-col-duration">{formatSecs(song.duration || 0)}</div>
          <div className="song-row-actions" onClick={(e) => e.stopPropagation()}>
            <button className="song-row-action-btn" onClick={() => playSong(toPlayerSong(song))} title={TEXT.playNow}>
              <Play size={14} fill="currentColor" />
            </button>
            <button className="song-row-action-btn" onClick={() => addToPlaylist(toPlayerSong(song))} title={TEXT.addQueue}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="glass-card" style={{ flexShrink: 0 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="search-bar-row">
            <button type="button" className="back-to-top-btn" onClick={scrollToTop} title="回到顶部">
              <ArrowUp size={18} />
            </button>
            <div className="search-input-wrap">
              <input
                ref={searchInputRef}
                type="text"
                className="input-field"
                placeholder={TEXT.searchPlaceholder}
                value={keyword}
                onChange={(e) => {
                  const val = e.target.value;
                  setKeyword(val);
                  if (!val.trim()) {
                    setSongResults([]);
                    setPlaylistResults([]);
                    setSelectedPlaylist(null);
                    setActiveKeyword('');
                  }
                }}
              />
              {keyword.length > 0 && (
                <button
                  type="button"
                  className="search-clear-btn"
                  title="清除"
                  aria-label="清除搜索内容"
                  onClick={() => {
                    setKeyword('');
                    setSongResults([]);
                    setPlaylistResults([]);
                    setSelectedPlaylist(null);
                    setActiveKeyword('');
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button type="submit" className="primary-btn search-submit-btn" disabled={loading} title={TEXT.search} aria-label={TEXT.search}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div className="type-selectors" style={{ margin: 0 }}>
              <label className={`type-radio ${searchType === 'track' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="searchType"
                  checked={searchType === 'track'}
                  onChange={() => setSearchType('track')}
                  style={{ display: 'none' }}
                />
                <span>{TEXT.tracks}</span>
              </label>
              <label className={`type-radio ${searchType === 'playlist' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="searchType"
                  checked={searchType === 'playlist'}
                  onChange={() => setSearchType('playlist')}
                  style={{ display: 'none' }}
                />
                <span>{TEXT.playlists}</span>
              </label>
            </div>

            {searchType === 'track' && (
              <div className="source-selectors" style={{ margin: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MUSIC_SOURCES.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className={`source-tab ${currentSource === source.id ? 'active' : ''}`}
                    onClick={() => handleSourceChange(source.id)}
                    style={{ padding: '4px 10px', fontSize: 12, borderRadius: 16 }}
                    title={`切换搜索平台: ${source.name}`}
                  >
                    {source.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </form>
      </div>

      <div className="search-panel-content-scroll" style={{ flex: 1, overflowY: 'auto' }} onScroll={handleResultsScroll} ref={scrollContainerRef}>
        {selectedPlaylist ? (
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <button className="back-btn" onClick={() => setSelectedPlaylist(null)} title={TEXT.back}>
              <ArrowLeft size={16} />
            </button>

            <div className="detail-header">
              <CoverImage src={selectedPlaylist.cover} alt="" className="detail-cover" />
              <div className="detail-info">
                <div className="detail-title-row" style={{ display: 'block', marginBottom: 4 }}>
                  <h2 className="detail-title" style={{ display: 'inline', fontSize: 16, lineHeight: 1.4, margin: 0 }}>
                    {selectedPlaylist.name}
                    <span
                      className="detail-tag"
                      style={{
                        display: 'inline-block',
                        marginLeft: 6,
                        verticalAlign: 'middle',
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(168, 85, 247, 0.15)',
                        color: '#c084fc',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                      }}
                    >
                      {selectedPlaylist.item[0]?.source === 'tencent' ? 'QQ' : '网易云'}
                    </span>
                  </h2>
                </div>
                <span className="detail-author">{TEXT.creator} {selectedPlaylist.creatorName || TEXT.unknown}</span>
                <div className="detail-action-btns">
                  <button className="primary-btn playlist-action-btn" onClick={() => playAll(selectedPlaylist.item.map(toPlayerSong))} title="播放全部">
                    <Play size={16} fill="currentColor" />
                    <span className="btn-text">播放全部</span>
                  </button>
                  <button className="icon-btn playlist-action-btn" onClick={() => addAllToPlaylist(selectedPlaylist.item.map(toPlayerSong))} title="全部添加到队列">
                    <Plus size={16} />
                    <span className="btn-text">添加全部</span>
                  </button>
                  <button 
                    className="icon-btn playlist-action-btn" 
                    onClick={() => toggleFavoritePlaylist({
                      id: selectedPlaylist.id,
                      name: selectedPlaylist.name,
                      coverImgUrl: selectedPlaylist.cover || '',
                      trackCount: selectedPlaylist.item.length,
                      source: selectedPlaylist.item[0]?.source || 'netease',
                      creatorName: selectedPlaylist.creatorName,
                    })} 
                    title={isFavoritePlaylist(selectedPlaylist.id) ? "取消收藏" : "收藏歌单"} 
                    style={{ 
                      color: isFavoritePlaylist(selectedPlaylist.id) ? '#ef4444' : undefined 
                    }}
                  >
                    <Heart size={16} fill={isFavoritePlaylist(selectedPlaylist.id) ? '#ef4444' : 'none'} />
                    <span className="btn-text">{isFavoritePlaylist(selectedPlaylist.id) ? "已收藏" : "收藏"}</span>
                  </button>
                </div>
              </div>
            </div>

            {renderSongList(selectedPlaylist.item.slice(0, detailPage * PAGE_SIZE))}
            {detailPage * PAGE_SIZE < selectedPlaylist.item.length && (
              <div className="list-loading-more">
                <Loader2 size={16} className="animate-spin" />
                <span>{TEXT.loadingMore}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {(songResults.length > 0 || playlistResults.length > 0) && (
              <div className="glass-card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3
                    onClick={() => {
                      if (searchType === 'track') void loadMoreTracks();
                      else if (searchType === 'playlist') void loadMorePlaylists();
                    }}
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      margin: 0,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      userSelect: 'none',
                    }}
                    title="点击在末尾加载更多"
                  >
                    <span>{TEXT.result}</span>
                    {searchType === 'track' && (
                      <span style={{ color: 'var(--primary-color)', fontSize: 13, fontWeight: 500 }}>
                        ({songResults.length}+)
                      </span>
                    )}
                    {searchType === 'playlist' && (
                      <span style={{ color: 'var(--primary-color)', fontSize: 13, fontWeight: 500 }}>
                        ({playlistResults.length}+)
                      </span>
                    )}
                  </h3>
                  {searchType === 'track' && songResults.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        className="primary-btn"
                        onClick={() => playAll(songResults.map(toPlayerSong))}
                        style={{ borderRadius: '50%', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="播放全部"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => addAllToPlaylist(songResults.map(toPlayerSong))}
                        title="全部添加到队列"
                        style={{
                          borderRadius: '50%',
                          width: 32,
                          height: 32,
                          padding: 0,
                          background: 'rgba(255,255,255,0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {playlistLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: '#c084fc' }}>
                    <Loader2 size={16} className="animate-spin" />
                    <span>{TEXT.loadingPlaylist}</span>
                  </div>
                )}

                {searchType === 'track' && songResults.length > 0 && (
                  <>
                    {matchedArtist && <ArtistBanner artist={matchedArtist} />}
                    {renderSongList(songResults)}
                    {loadingMore && (
                      <div className="list-loading-more">
                        <Loader2 size={16} className="animate-spin" />
                        <span>{TEXT.loadingMore}</span>
                      </div>
                    )}
                  </>
                )}

                {searchType === 'playlist' && playlistResults.length > 0 && (
                  <>
                    <div className="playlist-grid">
                      {playlistResults.map(pl => (
                        <div key={pl.id} className="playlist-card" onClick={() => handlePlaylistClick(pl.id, true)}>
                          <div className="playlist-cover-wrapper">
                            <CoverImage src={pl.cover} alt="" className="playlist-card-cover" />
                            <div className="playlist-stats">
                              <div className="playlist-stat-item">
                                <Play size={10} fill="currentColor" />
                                <span>{formatCount(pl.playCount)}</span>
                              </div>
                              <div className="playlist-stat-item" style={{ marginLeft: 4 }}>
                                <Music size={10} />
                                <span>{pl.trackCount || pl.count || 0}</span>
                              </div>
                            </div>
                          </div>
                          <span className="playlist-card-name" title={pl.name}>{pl.name}</span>
                          <span className="playlist-card-author">{pl.creatorName || TEXT.unknownCreator}</span>
                        </div>
                      ))}
                    </div>
                    {loadingMore && (
                      <div className="list-loading-more">
                        <Loader2 size={16} className="animate-spin" />
                        <span>正在加载更多歌单...</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {/* 探索发现模块 */}
            {!keyword && songResults.length === 0 && playlistResults.length === 0 && (
              <DiscoveryView active={active} />
            )}
            
          </div>
        )}
      </div>
    </div>
  );
};
