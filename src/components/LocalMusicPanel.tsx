import React, { useState } from 'react';
import { FolderOpen, Play, Plus, Music, RefreshCw, ArrowUp, Heart } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { openPath } from '@tauri-apps/plugin-opener';

export const LocalMusicPanel: React.FC = () => {
  const { localSongs, importLocalDirectory, playSong, addToPlaylist, localDirectory, refreshLocalDirectory, isFavorite, toggleFavorite } = usePlayer();
  const [isRefreshing, setIsRefreshing] = useState(false);

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="back-to-top-btn" onClick={scrollToTop} title="回到顶部">
              <ArrowUp size={18} />
            </button>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>本地歌曲</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                导入本地文件夹下的 MP3/FLAC 音乐文件，随时离线播放。
              </p>
            </div>
          </div>
          <button className="primary-btn" onClick={importLocalDirectory} style={{ height: 32, padding: '0 16px', fontSize: 13, borderRadius: 16 }}>
            <FolderOpen size={14} />
            <span>选择本地文件夹</span>
          </button>
        </div>
        
        {localDirectory && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <span 
              style={{ fontSize: 12, color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => openPath(localDirectory)}
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

      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', marginTop: 24 }}>
        <div className="glass-card" style={{ minHeight: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3>全部歌曲 ({localSongs.length})</h3>
          </div>

          {localSongs.length === 0 ? (
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
              <p style={{ fontSize: 15 }}>暂无本地歌曲，点击右上角导入</p>
              <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>支持自动解析 "歌手 - 歌名.mp3" 格式的文件名</span>
            </div>
          ) : (
            <div className="song-list-container">
              {localSongs.map((song, index) => (
                <div 
                  key={song.id} 
                  className="song-row song-row-playable"
                  onClick={() => playSong(song)}
                  title="点击播放"
                >
                  <div className="song-col-index">{(index + 1).toString().padStart(2, '0')}</div>
                  <div className="song-col-info">
                    <div className="song-title-row">
                      <span className="song-name">{song.name}</span>
                      <span className="tag-source">本地歌曲</span>
                    </div>
                    <span className="song-artist">{song.artist}</span>
                  </div>
                  <div className="song-col-album">{song.album}</div>
                  <div className="song-col-duration" style={{ fontSize: 11, color: 'var(--text-dark)' }}>
                    {song.localPath ? song.localPath.split('\\').pop()?.split('/').pop() : ''}
                  </div>

                    <div className="song-row-actions">
                      <button 
                        className="song-row-action-btn"
                        onClick={() => playSong(song)}
                        title="立即播放"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                      <button 
                        className="song-row-action-btn"
                        onClick={() => addToPlaylist(song)}
                        title="添加到播放列表"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        className={`song-row-action-btn ${isFavorite(song) ? 'active' : ''}`}
                        onClick={() => void toggleFavorite(song)}
                        title={isFavorite(song) ? "取消收藏" : "收藏歌曲"}
                        style={isFavorite(song) ? { color: '#ef4444' } : undefined}
                      >
                        <Heart size={14} fill={isFavorite(song) ? '#ef4444' : 'none'} color={isFavorite(song) ? '#ef4444' : 'currentColor'} />
                      </button>
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
