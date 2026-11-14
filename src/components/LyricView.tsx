import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ListMusic, SkipBack, SkipForward, Play, Pause, ArrowLeftRight, Trash2, Heart, Repeat, Repeat1, Shuffle } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { usePlaybackProgress } from '../services/playbackProgress';
import { isMobileShell } from '../utils/platform';
import defaultCoverIcon from '../assets/default-cover.png';

interface LyricViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LyricView: React.FC<LyricViewProps> = ({ isOpen, onClose }) => {
  const {
    currentSong, lyrics, currentLyricIndex, seekTo,
    playlist, playIndex, playSong, togglePlay, prevSong, nextSong,
    showTranslation, removeFromPlaylist, isLoading,
    isFavorite, toggleFavorite, playMode, changePlayMode,
  } = usePlayer();
  // 播放进度/状态走独立 store，避免随 usePlayer 的其它字段一起重渲染
  const { currentTime, duration, isPlaying } = usePlaybackProgress();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const playlistSheetListRef = useRef<HTMLDivElement | null>(null);
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);

  const isCurrentFav = Boolean(currentSong && isFavorite(currentSong));

  const getPlayModeTitle = () => {
    switch (playMode) {
      case 'single-loop':
        return '单曲循环';
      case 'random':
        return '随机播放';
      case 'list-loop':
      default:
        return '列表循环';
    }
  };

  const renderPlayModeIcon = (size = 20) => {
    if (playMode === 'single-loop') return <Repeat1 size={size} style={{ color: 'var(--primary-color)' }} />;
    if (playMode === 'random') return <Shuffle size={size} style={{ color: 'var(--primary-color)' }} />;
    return <Repeat size={size} />;
  };

  // 歌词界面工具按钮对齐位置（'left' | 'right'），带 localStorage 持久化记忆
  const [buttonAlign, setButtonAlign] = useState<'left' | 'right'>(() => {
    try {
      return (localStorage.getItem('mp3freer_lyric_buttons_align') as 'left' | 'right') || 'left';
    } catch {
      return 'left';
    }
  });

  const toggleButtonAlign = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = buttonAlign === 'left' ? 'right' : 'left';
    setButtonAlign(next);
    try {
      localStorage.setItem('mp3freer_lyric_buttons_align', next);
    } catch (err) {
      console.error(err);
    }
  };

  // 抽屉列表打开时自动定位到当前播放歌曲（前留最多 3 首）
  useEffect(() => {
    if (isPlaylistOpen && playlistSheetListRef.current) {
      const timer = setTimeout(() => {
        const container = playlistSheetListRef.current;
        if (!container) return;
        const targetIndex = Math.max(0, playIndex - 3);
        const itemEl = container.children[targetIndex] as HTMLElement;
        if (itemEl) {
          container.scrollTo({ top: itemEl.offsetTop, behavior: 'smooth' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isPlaylistOpen, playIndex]);

  // 左滑删除歌曲手势与淡出动效状态
  const [swipedSongId, setSwipedSongId] = useState<string | null>(null);
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchMove = (e: React.TouchEvent, songId: string) => {
    if (!touchStartRef.current) return;
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 25) {
      if (deltaX < -25) {
        setSwipedSongId(songId);
      } else if (deltaX > 25 && swipedSongId === songId) {
        setSwipedSongId(null);
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  const handleDeleteSong = (e: React.MouseEvent, songId: string) => {
    e.stopPropagation();
    setDeletingSongId(songId);
    setTimeout(() => {
      removeFromPlaylist(songId);
      setDeletingSongId(null);
      if (swipedSongId === songId) {
        setSwipedSongId(null);
      }
    }, 280);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // 仅在 PC 桌面端浮窗展开时生效，避免拦截移动端底部抽屉的点击事件
      if (
        isPlaylistOpen && 
        popupRef.current && 
        btnRef.current && 
        !popupRef.current.contains(e.target as Node) && 
        !btnRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement)?.closest('.mobile-playlist-sheet')
      ) {
        setIsPlaylistOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPlaylistOpen) {
          setIsPlaylistOpen(false);
        } else if (isOpen) {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlaylistOpen, isOpen, onClose]);

  // 当歌词行改变时，平滑滚动让当前行保持在容器中央（后台时跳过以省电防卡顿）
  useEffect(() => {
    if (!isOpen || !containerRef.current || currentLyricIndex < 0) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const activeEl = container.querySelector('.lyric-line.active') as HTMLElement;
      if (!activeEl) return;
      const targetTop = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [currentLyricIndex, isOpen, lyrics]);

  // 当面板第一次打开或从后台切换回前台时，滚动到正确位置
  useEffect(() => {
    if (!isOpen) return;

    const scrollToActive = () => {
      if (!containerRef.current || currentLyricIndex < 0) return;
      const activeEl = containerRef.current.querySelector('.lyric-line.active') as HTMLElement;
      if (!activeEl) return;
      const targetTop = activeEl.offsetTop - containerRef.current.clientHeight / 2 + activeEl.clientHeight / 2;
      containerRef.current.scrollTo({ top: targetTop, behavior: 'smooth' });
    };

    const timer = setTimeout(scrollToActive, 300);

    const handleVisibilityChange = () => {
      if (!document.hidden && isOpen) {
        scrollToActive();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen, currentLyricIndex]);

  const defaultCover = defaultCoverIcon;

  const songCover = currentSong?.pic || defaultCover;

  const formatSecs = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(Number(e.target.value));
  };

  return (
    <div className={`lyric-view-fullscreen ${isOpen ? 'open' : ''}`}>
      {/* 虚化的大封面作为背景 */}
      <div 
        className="lyric-bg-blur" 
        style={{ backgroundImage: `url(${songCover})` }}
      ></div>

      {/* 移动端顶部标题栏（纯居中歌名/歌手信息）- 仅移动端环境渲染 */}
      {isMobileShell() && (
        <div className="mobile-lyric-header">
          <div className="mobile-lyric-title-info">
            <div className="mobile-lyric-song-name">{currentSong?.name || '未知曲目'}</div>
            <div className="mobile-lyric-song-artist">{currentSong?.artist || '未知歌手'}</div>
          </div>
        </div>
      )}

      {/* PC 端传统关闭按钮 */}
      <button className="close-lyric-btn desktop-only-btn" onClick={onClose} title="收起歌词">
        <ChevronDown size={24} />
      </button>

      {/* 左半：黑胶唱片旋转 */}
      <div className="lyric-left-half">
        <div className="lyric-cover-area">
          <button className="lyric-control-btn" onClick={prevSong} title="上一曲" style={{ width: 48, height: 48 }}>
            <SkipBack size={28} />
          </button>
          
          <div 
            className={`vinyl-record ${isPlaying ? 'spinning' : ''}`} 
            onClick={togglePlay}
            title={isPlaying ? "点击暂停" : "点击播放"}
            style={{ cursor: 'pointer' }}
          >
            <img 
              src={songCover} 
              alt="cover" 
              className="vinyl-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = defaultCover;
              }}
            />
          </div>
          
          <button className="lyric-control-btn" onClick={nextSong} title="下一曲" style={{ width: 48, height: 48 }}>
            <SkipForward size={28} />
          </button>
        </div>

        <div className="lyric-progress-wrapper" style={{ margin: '16px 15% 0 15%', width: '70%', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatSecs(isLoading || duration <= 0 ? 0 : currentTime)}</span>
          <div className="slider-bar" style={{ flex: 1 }}>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={isLoading || duration <= 0 ? 0 : currentTime}
              onChange={handleSeek}
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
                left: 0,
                top: 0,
                zIndex: 2
              }}
            />
            <div
              className="slider-fill"
              style={{ width: `${(!isLoading && duration > 0) ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%` }}
            ></div>
            <div
              className="slider-thumb"
              style={{ left: `${(!isLoading && duration > 0) ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%` }}
            ></div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatSecs(duration)}</span>
        </div>
        
        <div className="lyric-song-info" style={{ marginTop: 24 }}>
          <h2 className="lyric-song-name">{currentSong?.name || '未知曲目'}</h2>
          <span className="lyric-song-artist">{currentSong?.artist || '未知歌手'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
          <button
            className="lyric-playlist-btn"
            style={{ marginTop: 0, color: isCurrentFav ? '#ef4444' : undefined }}
            onClick={() => currentSong && void toggleFavorite(currentSong)}
            title={isCurrentFav ? '取消收藏' : '收藏歌曲'}
          >
            <Heart size={20} fill={isCurrentFav ? '#ef4444' : 'none'} />
          </button>

          <button
            className="lyric-playlist-btn"
            style={{ marginTop: 0 }}
            onClick={changePlayMode}
            title={getPlayModeTitle()}
          >
            {renderPlayModeIcon(20)}
          </button>

          <button 
            ref={btnRef}
            className="lyric-playlist-btn"
            style={{ marginTop: 0 }}
            onClick={() => setIsPlaylistOpen(!isPlaylistOpen)}
            title="当前播放列表"
          >
            <ListMusic size={20} />
          </button>
        </div>

        {isPlaylistOpen && (
          <div className="lyric-playlist-popup" ref={popupRef}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, color: 'var(--text-main)' }}>当前播放列表 ({playlist.length})</h3>
            <div className="lyric-playlist-scroll">
              {playlist.map((song, i) => (
                <div 
                  key={`${song.id}_${i}`}
                  className={`lyric-playlist-item ${i === playIndex ? 'playing' : ''}`}
                  onClick={() => {
                    void playSong(song);
                    setIsPlaylistOpen(false);
                  }}
                >
                  <div className="song-name" style={{ color: i === playIndex ? 'var(--primary-hover)' : 'var(--text-main)' }}>{song.name}</div>
                  <div className="song-artist">- {song.artist}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右半：平滑滚动的歌词列表 */}
      <div className="lyric-right-half">
        {!isMobileShell() && (
          <div className="desktop-narrow-lyric-header">
            <div className="desktop-narrow-lyric-name">{currentSong?.name || '未知曲目'}</div>
            <div className="desktop-narrow-lyric-artist">{currentSong?.artist || '未知歌手'}</div>
          </div>
        )}
        <div className="lyric-list-container" ref={containerRef}>
          {lyrics.length === 0 ? (
            <div className="lyric-line" style={{ color: 'var(--text-muted)', fontSize: 16, marginTop: '20%' }}>
              {currentSong ? '暂无歌词，尽情享受音乐吧~' : '未在播放歌曲'}
            </div>
          ) : (
            lyrics.map((line, index) => (
              <div
                key={index}
                className={`lyric-line ${index === currentLyricIndex ? 'active' : ''}`}
                onClick={() => seekTo(line.time)}
              >
                {line.text}
                {showTranslation && line.translation && (
                  <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>{line.translation}</div>
                )}
                {showTranslation && line.romanization && (
                  <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2, fontStyle: 'italic' }}>{line.romanization}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 移动端专属底部控制栏（含播放模式、上一首、播放/暂停、下一首、红心收藏）- 仅移动端环境渲染 */}
        {isMobileShell() && (
          <div className="mobile-lyric-bottom-bar">
            <div className="mobile-lyric-btns">
              <button className="mobile-lyric-ctrl-btn" onClick={changePlayMode} title={getPlayModeTitle()}>
                {renderPlayModeIcon(22)}
              </button>
              <button className="mobile-lyric-ctrl-btn" onClick={prevSong} title="上一首">
                <SkipBack size={24} />
              </button>
              <button className="mobile-lyric-play-btn" onClick={togglePlay} title={isPlaying ? '暂停' : '播放'}>
                {isPlaying ? <Pause size={28} /> : <Play size={28} style={{ marginLeft: 2 }} />}
              </button>
              <button className="mobile-lyric-ctrl-btn" onClick={nextSong} title="下一首">
                <SkipForward size={24} />
              </button>
              <button
                className="mobile-lyric-ctrl-btn"
                onClick={() => currentSong && void toggleFavorite(currentSong)}
                title={isCurrentFav ? '取消收藏' : '收藏'}
                style={{ color: isCurrentFav ? '#ef4444' : undefined }}
              >
                <Heart size={22} fill={isCurrentFav ? '#ef4444' : 'none'} />
              </button>
            </div>
          </div>
        )}

        {/* 移动端左下/右下角浮动工具按钮组（默认竖向一列排布于左下角）- 仅移动端环境渲染 */}
        {isMobileShell() && (
          <div className={`mobile-lyric-corner-tools align-${buttonAlign}`}>
            <button className="mobile-lyric-tool-btn" onClick={onClose} title="收起歌词">
              <ChevronDown size={22} />
            </button>
            <button className="mobile-lyric-tool-btn" onClick={() => setIsPlaylistOpen(prev => !prev)} title="播放队列">
              <ListMusic size={20} />
            </button>
            <button className="mobile-lyric-tool-btn" onClick={toggleButtonAlign} title={buttonAlign === 'left' ? '切换到右侧' : '切换到左侧'}>
              <ArrowLeftRight size={18} />
            </button>
          </div>
        )}

        {/* 移动端底部抽屉播放列表 - 仅移动端环境渲染 */}
        {isMobileShell() && isPlaylistOpen && (
          <div className="mobile-playlist-sheet-overlay" onClick={() => setIsPlaylistOpen(false)}>
            <div className="mobile-playlist-sheet" onClick={e => e.stopPropagation()}>
              <div className="mobile-playlist-sheet-header">
                <h3>播放队列 ({playlist.length})</h3>
                <button className="mobile-playlist-sheet-close" onClick={() => setIsPlaylistOpen(false)}>
                  <ChevronDown size={22} />
                </button>
              </div>
              <div className="mobile-playlist-sheet-list" ref={playlistSheetListRef}>
                {playlist.map((song, i) => {
                  const isCurrent = i === playIndex;
                  const isSwiped = swipedSongId === song.id;
                  const isDeleting = deletingSongId === song.id;

                  return (
                    <div
                      key={`${song.id}_${i}`}
                      className={`mobile-playlist-sheet-item-wrapper ${isDeleting ? 'deleting' : ''}`}
                    >
                      <div
                        className={`mobile-playlist-sheet-item ${isCurrent ? 'playing' : ''} ${isSwiped ? 'swiped' : ''}`}
                        onTouchStart={handleTouchStart}
                        onTouchMove={e => handleTouchMove(e, song.id)}
                        onTouchEnd={handleTouchEnd}
                        onClick={() => {
                          void playSong(song);
                          setIsPlaylistOpen(false);
                        }}
                      >
                        <div className="mobile-sheet-song-name" title={song.name}>{song.name}</div>
                        <div className="mobile-sheet-song-artist" title={song.artist}>{song.artist}</div>
                      </div>
                      {isSwiped && (
                        <button
                          className="mobile-sheet-delete-btn"
                          onClick={e => handleDeleteSong(e, song.id)}
                          title="从队列中删除"
                        >
                          <Trash2 size={16} />
                          <span>删除</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
