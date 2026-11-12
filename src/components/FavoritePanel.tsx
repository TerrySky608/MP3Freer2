import React, { useState, useRef, useMemo } from 'react';
import { Heart, Play, Plus, Music, ArrowUp, Download, Upload, RefreshCw, Key, Edit3, X, ArrowUpCircle, ArrowDownCircle, Search } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { CoverImage } from './CoverImage';
import { SongDownloadButton } from './SongDownloadButton';
import { MUSIC_SOURCES } from '../settings';
import { DEFAULT_SYNC_CODE, generateRandomSyncCode } from '../services/syncService';
import { isSameSong } from '../utils/songUtils';

export const FavoritePanel: React.FC = () => {
  const {
    currentSong,
    favoriteSongs,
    favoritePlaylists,
    favoriteArtists,
    playSong,
    addToPlaylist,
    playAll,
    addAllToPlaylist,
    toggleFavorite,
    exportFavorites,
    importFavorites,
    syncFavoritesNow,
    uploadFavoritesNow,
    restoreFavoritesNow,
    syncCode,
    updateSyncCode,
  } = usePlayer();
  const [activeTab, setActiveTab] = useState<'songs' | 'artists' | 'playlists'>('songs');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [showBackTop, setShowBackTop] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [tempCode, setTempCode] = useState(syncCode);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSongs = useMemo(() => {
    const q = filterKeyword.trim().toLowerCase();
    if (!q) return favoriteSongs;
    return favoriteSongs.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.album && s.album.toLowerCase().includes(q))
    );
  }, [favoriteSongs, filterKeyword]);

  const filteredArtists = useMemo(() => {
    const q = filterKeyword.trim().toLowerCase();
    if (!q) return favoriteArtists;
    return favoriteArtists.filter(a => a.name.toLowerCase().includes(q));
  }, [favoriteArtists, filterKeyword]);

  const filteredPlaylists = useMemo(() => {
    const q = filterKeyword.trim().toLowerCase();
    if (!q) return favoritePlaylists;
    return favoritePlaylists.filter(
      p => p.name.toLowerCase().includes(q) || (p.creatorName && p.creatorName.toLowerCase().includes(q))
    );
  }, [favoritePlaylists, filterKeyword]);

  const handleSyncClick = async () => {
    setIsSyncing(true);
    try {
      await syncFavoritesNow();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void importFavorites(file);
      e.target.value = '';
    }
  };

  const handleSaveSyncCode = async (pullCloud = true) => {
    const trimmed = tempCode.trim();
    if (!trimmed) return;
    setShowCodeModal(false);
    await updateSyncCode(trimmed, pullCloud);
  };

  const formatSecs = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handlePlaylistClick = (id: string, source = 'netease') => {
    window.dispatchEvent(new CustomEvent('openPlaylist', {
      detail: { id, isNeteaseDirect: source === 'netease', source },
    }));
    window.dispatchEvent(new CustomEvent('globalSearch', { detail: '' }));
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json"
        style={{ display: 'none' }}
      />
      <div className="glass-card panel-header-card" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {showBackTop && (
              <button className="back-to-top-btn" onClick={scrollToTop} title="回到顶部">
                <ArrowUp size={18} />
              </button>
            )}
            <Heart size={24} fill="#ef4444" stroke="#ef4444" />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>我的收藏</h2>
                <button
                  type="button"
                  onClick={() => {
                    setTempCode(syncCode);
                    setShowCodeModal(true);
                  }}
                  title="点击修改同步暗号，多端输入相同暗号即可互通"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    padding: '3px 10px',
                    borderRadius: 14,
                    background: 'rgba(168, 85, 247, 0.18)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <Key size={13} />
                  <span>暗号: <strong>{syncCode}</strong></span>
                  <Edit3 size={11} style={{ opacity: 0.7 }} />
                </button>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                安卓手机、车机与电脑端输入相同暗号即可实时双向互通；新增收藏自动云端静默同步。
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleSyncClick}
              disabled={isSyncing}
              title="立即与云端双向智能合并"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: 'rgba(168, 85, 247, 0.2)',
                color: '#d8b4fe',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
              <span>{isSyncing ? '同步中...' : '同步'}</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="从备份的 JSON 文件导入收藏"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-main)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer',
              }}
            >
              <Upload size={13} />
              <span>导入</span>
            </button>
            <button
              onClick={exportFavorites}
              title="将当前收藏导出为 JSON 备份文件"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-main)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer',
              }}
            >
              <Download size={13} />
              <span>导出</span>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <div className="type-selectors" style={{ margin: 0 }}>
            <label className={`type-radio ${activeTab === 'songs' ? 'active' : ''}`}>
              <input
                type="radio"
                name="favType"
                checked={activeTab === 'songs'}
                onChange={() => setActiveTab('songs')}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: '1.05em', fontWeight: activeTab === 'songs' ? 700 : 500 }}>歌曲 ({favoriteSongs.length})</span>
            </label>
            <label className={`type-radio ${activeTab === 'artists' ? 'active' : ''}`}>
              <input
                type="radio"
                name="favType"
                checked={activeTab === 'artists'}
                onChange={() => setActiveTab('artists')}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: '1.05em', fontWeight: activeTab === 'artists' ? 700 : 500 }}>歌手 ({favoriteArtists.length})</span>
            </label>
            <label className={`type-radio ${activeTab === 'playlists' ? 'active' : ''}`}>
              <input
                type="radio"
                name="favType"
                checked={activeTab === 'playlists'}
                onChange={() => setActiveTab('playlists')}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: '1.05em', fontWeight: activeTab === 'playlists' ? 700 : 500 }}>歌单 ({favoritePlaylists.length})</span>
            </label>
          </div>

          <div style={{ position: 'relative', minWidth: 150, flex: '1 1 180px', maxWidth: 260 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={filterKeyword}
              onChange={e => setFilterKeyword(e.target.value)}
              placeholder="在收藏中筛选..."
              style={{
                width: '100%',
                height: 32,
                padding: '0 28px 0 30px',
                borderRadius: 16,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-main)',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {filterKeyword && (
              <button
                type="button"
                onClick={() => setFilterKeyword('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                }}
                title="清除筛选"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="panel-scroll-area"
        onScroll={(e) => setShowBackTop(e.currentTarget.scrollTop > 200)}
        style={{ flex: 1, overflowY: 'auto', marginTop: 16 }}
      >
        <div className="glass-card" style={{ minHeight: '100%' }}>
          {activeTab === 'songs' ? (
            filteredSongs.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 0',
              color: 'var(--text-muted)',
              gap: 12
            }}>
              <Heart size={48} strokeWidth={1} style={{ color: '#ef4444' }} />
              <p style={{ fontSize: 15 }}>{filterKeyword ? '未找到匹配的收藏歌曲' : '暂无收藏歌曲'}</p>
              <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>
                {filterKeyword ? '请尝试更换筛选关键词' : '点击播放栏或列表的心形图标收藏喜欢的歌曲'}
              </span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3>{filterKeyword ? `筛选结果 (${filteredSongs.length})` : `全部收藏 (${filteredSongs.length})`}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className="song-row-action-btn"
                    onClick={() => playAll(filteredSongs)}
                    title="全部播放"
                  >
                    <Play size={14} fill="currentColor" />
                  </button>
                  <button
                    className="song-row-action-btn"
                    onClick={() => addAllToPlaylist(filteredSongs)}
                    title="全部加入播放列表"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="song-list-container">
                {filteredSongs.map((song, index) => {
                  const isCurrent = isSameSong(currentSong, song);
                  return (
                    <div
                      key={song.id}
                      className={`song-row song-row-playable ${isCurrent ? 'active' : ''}`}
                      onClick={() => void playSong(song)}
                      title="点击播放"
                    >
                      <div className="song-col-index">
                        {isCurrent ? (
                          <Play size={14} fill="var(--primary-color)" stroke="var(--primary-color)" />
                        ) : (
                          (index + 1).toString().padStart(2, '0')
                        )}
                      </div>
                      <div className="song-col-info">
                        <div className="song-title-row">
                          <span className="song-name" style={{ color: isCurrent ? 'var(--primary-hover)' : 'inherit' }}>{song.name}</span>
                          <span className="tag-source">
                            {song.isLocal ? '本地' : MUSIC_SOURCES.find(item => item.id === song.source)?.name || song.source}
                          </span>
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
                        {song.album && song.album !== '未知专辑' && song.album !== '-' ? (
                          <span
                            className="clickable-artist"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.dispatchEvent(new CustomEvent('openAlbum', {
                                detail: {
                                  albumId: '',
                                  albumName: song.album,
                                  artistName: song.artist,
                                  source: song.source || 'netease',
                                },
                              }));
                            }}
                            title={`查看专辑: ${song.album}`}
                            style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {song.album}
                          </span>
                        ) : (
                          song.album || '-'
                        )}
                      </div>
                      <div className="song-col-duration">{formatSecs(song.duration)}</div>

                      <div className="song-row-actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="song-row-action-btn"
                          onClick={() => void playSong(song)}
                          title="立即播放"
                        >
                          <Play size={14} fill="currentColor" />
                        </button>
                        <button
                          className="song-row-action-btn"
                          onClick={() => addToPlaylist(song)}
                          title="设作下一首播放"
                        >
                          <Plus size={14} />
                        </button>
                        <SongDownloadButton song={song} />
                        <button
                          className="song-row-action-btn active"
                          onClick={() => void toggleFavorite(song)}
                          title="取消收藏"
                          style={{ color: '#ef4444' }}
                        >
                          <Heart size={14} fill="#ef4444" color="#ef4444" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )) : activeTab === 'artists' ? (
            filteredArtists.length === 0 ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 0',
                color: 'var(--text-muted)',
                gap: 12
              }}>
                <Heart size={48} strokeWidth={1} style={{ color: '#ef4444' }} />
                <p style={{ fontSize: 15 }}>{filterKeyword ? '未找到匹配的歌手' : '暂无收藏歌手'}</p>
                <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>搜索喜欢的歌手并收藏他们吧</span>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3>全部歌手 ({filteredArtists.length})</h3>
                </div>
                <div className="playlist-grid">
                  {filteredArtists.map(artist => (
                    <div key={artist.id} className="playlist-card" onClick={() => {
                      window.dispatchEvent(new CustomEvent('globalSearch', { detail: artist.name }));
                    }}>
                      <div className="playlist-cover-wrapper" style={{ borderRadius: '50%', overflow: 'hidden', aspectRatio: '1/1' }}>
                        <CoverImage src={artist.picUrl} alt="" className="playlist-card-cover" style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                      </div>
                      <span className="playlist-card-name" title={artist.name} style={{ textAlign: 'center', marginTop: 12 }}>{artist.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : (
            filteredPlaylists.length === 0 ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 0',
                color: 'var(--text-muted)',
                gap: 12
              }}>
                <Heart size={48} strokeWidth={1} style={{ color: '#ef4444' }} />
                <p style={{ fontSize: 15 }}>{filterKeyword ? '未找到匹配的歌单' : '暂无收藏歌单'}</p>
                <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>去在线音乐页面收藏一些歌单吧</span>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3>全部歌单 ({filteredPlaylists.length})</h3>
                </div>
                <div className="playlist-grid">
                  {filteredPlaylists.map(pl => (
                    <div key={pl.id} className="playlist-card" onClick={() => handlePlaylistClick(pl.id, pl.source)}>
                      <div className="playlist-cover-wrapper">
                        <CoverImage src={pl.coverImgUrl} alt="" className="playlist-card-cover" />
                        <div className="playlist-stats">
                          <div className="playlist-stat-item">
                            <Music size={10} />
                            <span>{pl.trackCount || 0}</span>
                          </div>
                        </div>
                      </div>
                      <span className="playlist-card-name" title={pl.name}>{pl.name}</span>
                      <span className="playlist-card-author">{pl.creatorName || '未知'}</span>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>

      {/* 修改同步暗号模态弹窗 */}
      {showCodeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowCodeModal(false)}
        >
          <div
            style={{
              background: '#1e1e24',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 14,
              padding: 20,
              maxWidth: 420,
              width: '100%',
              boxSizing: 'border-box',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Key size={18} style={{ color: '#c084fc' }} />
                <h3 style={{ margin: 0, fontSize: 16 }}>设置云端同步暗号</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCodeModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5, margin: '0 0 16px 0' }}>
              暗号规则：<code>SKY-字母+三位数字</code>（如 <code>SKY-A128</code>）。多台设备（手机、车机、电脑）只需输入<strong>完全相同的暗号</strong>即可双向互通，不同用户使用独立暗号避免串台。
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10, width: '100%', boxSizing: 'border-box' }}>
              <input
                type="text"
                value={tempCode}
                onChange={e => setTempCode(e.target.value)}
                placeholder="如: SKY-R608"
                style={{
                  flex: '1 1 110px',
                  minWidth: 0,
                  width: 0,
                  height: 36,
                  boxSizing: 'border-box',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 8,
                  padding: '0 10px',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  outline: 'none',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleSaveSyncCode();
                }}
              />
              <button
                type="button"
                onClick={() => setTempCode(generateRandomSyncCode())}
                title="按规则随机生成新暗号"
                style={{
                  height: 36,
                  padding: '0 8px',
                  fontSize: 12,
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                随机换一个
              </button>
              <button
                type="button"
                onClick={() => setTempCode(DEFAULT_SYNC_CODE)}
                title="填入常用预设暗号 SKY-R608"
                style={{
                  height: 36,
                  padding: '0 8px',
                  fontSize: 12,
                  background: 'rgba(255,255,255,0.08)',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                SKY-R608
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setShowCodeModal(false)}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSyncCode(false)}
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  background: 'rgba(255,255,255,0.1)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.15)',
                  cursor: 'pointer',
                }}
              >
                仅存暗号
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSyncCode(true)}
                title="保存暗号并自动拉取云端收藏进行同步"
                style={{
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#9333ea',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                保存并拉取云端
              </button>
            </div>

            <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <button
                type="button"
                onClick={async () => {
                  setShowCodeModal(false);
                  await uploadFavoritesNow();
                }}
                title="用本地当前收藏直接覆盖云端该暗号对应的数据"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                }}
              >
                <ArrowUpCircle size={12} />
                <span>仅备份到云端</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowCodeModal(false);
                  await restoreFavoritesNow();
                }}
                title="直接拉取云端该暗号数据覆盖/恢复本地收藏"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                }}
              >
                <ArrowDownCircle size={12} />
                <span>从云端强制恢复</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
