import React, { useState, useMemo } from 'react';
import { FolderOpen, Play, Plus, Music, RefreshCw, ArrowUp, Heart, Search, X } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { openPath } from '@tauri-apps/plugin-opener';
import { isSameSong } from '../utils/songUtils';

export const LocalMusicPanel: React.FC = () => {
  const {
    currentSong,
    localSongs,
    importLocalDirectory,
    playSong,
    playAll,
    addToPlaylist,
    addAllToPlaylist,
    localDirectory,
    refreshLocalDirectory,
    isFavorite,
    toggleFavorite,
  } = usePlayer();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [showBackTop, setShowBackTop] = useState(false);

  const filteredSongs = useMemo(() => {
    const q = filterKeyword.trim().toLowerCase();
    if (!q) return localSongs;
    return localSongs.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.album && s.album.toLowerCase().includes(q))
    );
  }, [localSongs, filterKeyword]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshLocalDirectory();
    setIsRefreshing(false);
  };

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="glass-card" style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {showBackTop && (
              <button className="back-to-top-btn" onClick={scrollToTop} title="回到顶部">
                <ArrowUp size={18} />
              </button>
            )}
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>本地歌曲</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                自动识别默认或设置的下载目录中的 MP3/FLAC 音乐文件，也可手动选择本地文件夹。
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {localSongs.length > 0 && (
              <div style={{ position: 'relative', width: 200 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  value={filterKeyword}
                  onChange={e => setFilterKeyword(e.target.value)}
                  placeholder="筛选本地歌曲..."
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
            )}
            <button className="primary-btn" onClick={importLocalDirectory} style={{ height: 32, padding: '0 16px', fontSize: 13, borderRadius: 16 }}>
              <FolderOpen size={14} />
              <span>选择本地文件夹</span>
            </button>
          </div>
        </div>
        
        {localDirectory && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <span 
              style={{ fontSize: 12, color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => {
                openPath(localDirectory).catch(err => console.warn('openPath unsupported or failed:', err));
              }}
              title="在文件资源管理器中打开"
            >
              {localDirectory}
            </span>
            <button 
              className="icon-btn" 
              onClick={handleRefresh} 
              disabled={isRefreshing}
              title="刷新目录"
              style={{ width: 28, height: 28, padding: 0 }}
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={(e) => setShowBackTop(e.currentTarget.scrollTop > 200)}
        style={{ flex: 1, overflowY: 'auto', marginTop: 16 }}
      >
        <div className="glass-card" style={{ minHeight: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3>{filterKeyword ? `筛选结果 (${filteredSongs.length})` : `全部歌曲 (${localSongs.length})`}</h3>
            {filteredSongs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="song-row-action-btn"
                  onClick={() => playAll(filteredSongs)}
                  title="播放全部"
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
            )}
          </div>

          {filteredSongs.length === 0 ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              padding: '60px 0',
              color: 'var(--text-muted)',
              gap: 12
            }}>
              <Music size={48} strokeWidth={1} style={{ color: 'var(--primary-color)' }} />
              <p style={{ fontSize: 15 }}>{filterKeyword ? '未找到匹配的本地歌曲' : '暂无本地歌曲，点击右上角导入'}</p>
              <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>支持自动解析 "歌手 - 歌名.mp3" 格式的文件名</span>
            </div>
          ) : (
            <div className="song-list-container">
              {filteredSongs.map((song, index) => {
                const isCurrent = isSameSong(currentSong, song);
                const isFav = isFavorite(song);
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
                        <span className="tag-source">本地歌曲</span>
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
                    <div className="song-col-album">{song.album}</div>
                    <div className="song-col-duration" style={{ fontSize: 11, color: 'var(--text-dark)' }}>
                      {song.localPath ? song.localPath.split('\\').pop()?.split('/').pop() : ''}
                    </div>

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
                      <button
                        className={`song-row-action-btn ${isFav ? 'active' : ''}`}
                        onClick={() => void toggleFavorite(song)}
                        title={isFav ? "取消收藏" : "收藏歌曲"}
                        style={isFav ? { color: '#ef4444' } : undefined}
                      >
                        <Heart size={14} fill={isFav ? '#ef4444' : 'none'} color={isFav ? '#ef4444' : 'currentColor'} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
