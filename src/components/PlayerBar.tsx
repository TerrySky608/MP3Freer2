import React, { useState, useEffect } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Repeat, Repeat1, Shuffle, Maximize2, Minimize2, Loader2, Heart, MonitorSpeaker, Disc
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { usePlaybackProgress } from '../services/playbackProgress';
import { triggerGlobalSearch } from '../utils/eventBus';
import { toggleLyricOverlay } from '../services/rustBridge';
import { isAndroid, isMobileShell } from '../utils/platform';

interface PlayerBarProps {
  onToggleFullscreen: () => void;
  isLyricOpen?: boolean;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({ onToggleFullscreen, isLyricOpen = false }) => {
  const {
    currentSong,
    isLoading,
    volume,
    playMode,
    togglePlay,
    nextSong,
    prevSong,
    seekTo,
    setVolumeLevel,
    changePlayMode,
    toggleFavorite,
    isFavorite
  } = usePlayer();
  // 播放进度/状态走独立 store，避免随 usePlayer 的其它字段一起重渲染
  const { currentTime, duration, isPlaying } = usePlaybackProgress();

  const [overlayOn, setOverlayOn] = useState<boolean>(false);

  const handleToggleOverlay = async () => {
    try {
      const visible = await toggleLyricOverlay();
      setOverlayOn(visible);
      if (visible) {
        // 立刻把当前句推给悬浮窗，不必等下一句歌词
        window.dispatchEvent(new Event('desktop-lyric-sync'));
      }
    } catch (err) {
      console.warn('切换桌面歌词失败:', err);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    seekTo(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = Number(e.target.value);
    setVolumeLevel(vol);
  };

  const toggleMute = () => {
    if (volume > 0) {
      setVolumeLevel(0);
    } else {
      setVolumeLevel(0.5);
    }
  };

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

  const handleFavorite = () => {
    if (currentSong) {
      toggleFavorite(currentSong);
    }
  };

  const [imageError, setImageError] = useState(false);

  // 监听 currentSong 变化重置 imageError
  useEffect(() => {
    setImageError(false);
  }, [currentSong]);

  return (
    <div className="player-bar">
      {/* 移动端顶部可拖动进度指示条（带滑轨与滑块）- 仅移动端环境渲染 */}
      {isMobileShell() && (
        <div className="mobile-player-progress-bar">
          <div className="mobile-player-progress-track">
            <div
              className="mobile-player-progress-fill"
              style={{ width: `${duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%` }}
            />
            <div
              className="mobile-player-progress-thumb"
              style={{ left: `${duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleProgressChange}
            className="mobile-player-progress-input"
            title="拖动调整播放进度"
          />
        </div>
      )}

      {/* 左侧：歌曲信息 */}
      <div className="player-left">
        <div className="player-cover-container" onClick={onToggleFullscreen} style={{ cursor: 'pointer' }} title="点击展开全屏歌词">
          {(currentSong?.pic && !imageError) ? (
            <img
              src={currentSong.pic.startsWith('http://')
                ? `https://${currentSong.pic.slice('http://'.length)}`
                : currentSong.pic}
              alt=""
              className={`player-cover ${isPlaying ? 'spinning' : ''}`}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className={`player-cover fallback-cover ${isPlaying ? 'spinning' : ''}`}>
              <Disc size={24} color="var(--primary-color)" />
            </div>
          )}
        </div>
        <div className="player-info" onClick={e => e.stopPropagation()}>
          <div className="player-title-wrap">
            <span
              className={`player-title ${currentSong?.name && currentSong.name.length > 10 ? 'marquee-scroll' : ''}`}
              title={currentSong?.name || '未在播放'}
              onClick={() => {
                if (currentSong?.artist) {
                  const firstArtist = currentSong.artist.split(/[/,&，、]/)[0].trim();
                  if (firstArtist) triggerGlobalSearch(firstArtist);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              {currentSong?.name || '听你想听的歌'}
            </span>
          </div>
          <span className="player-artist" title={currentSong?.artist || 'MP3韬'}>
            {currentSong?.artist ? (
              currentSong.artist.split(/[/,&，、]/).map((a, i, arr) => {
                const artistName = a.trim();
                return artistName ? (
                  <React.Fragment key={i}>
                    <span className="clickable-artist" onClick={() => triggerGlobalSearch(artistName)}>
                      {artistName}
                    </span>
                    {i < arr.length - 1 && ' / '}
                  </React.Fragment>
                ) : null;
              })
            ) : '开始探索音乐吧'}
          </span>
        </div>
      </div>

      {/* 中间：播放控制与进度条 */}
      <div className="player-center">
        <div className="player-controls">
          <button className="control-btn mobile-keep-btn" onClick={prevSong} title="上一首">
            <SkipBack size={18} fill="currentColor" />
          </button>

          <button className="control-btn play-pause mobile-keep-btn" onClick={togglePlay} title={isLoading ? '加载中' : isPlaying ? '暂停' : '播放'} disabled={isLoading}>
            {isLoading
              ? <Loader2 size={18} className="animate-spin" />
              : isPlaying
                ? <Pause size={18} fill="currentColor" />
                : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
            }
          </button>

          <button className="control-btn mobile-keep-btn" onClick={nextSong} title="下一首">
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>

        <div className="progress-container">
          <span className="time-text">{formatTime(currentTime)}</span>
          <div className="slider-bar">
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleProgressChange}
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
              style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
            ></div>
            <div
              className="slider-thumb"
              style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
            ></div>
          </div>
          <span className="time-text right">{formatTime(duration)}</span>
        </div>
      </div>

      {/* 右侧：音量与功能 */}
      <div className="player-right">
        <button
          className={`control-btn mobile-keep-btn ${currentSong && isFavorite(currentSong.id) ? 'favorited' : ''}`}
          onClick={handleFavorite}
          title="收藏"
          style={{ color: currentSong && isFavorite(currentSong.id) ? '#ef4444' : undefined }}
        >
          <Heart size={16} fill={currentSong && isFavorite(currentSong.id) ? '#ef4444' : 'none'} />
        </button>

        <button className="control-btn mobile-keep-btn" onClick={changePlayMode} title={getPlayModeTitle()}>
          {playMode === 'single-loop' && <Repeat1 size={16} style={{ color: 'var(--primary-color)' }} />}
          {playMode === 'random' && <Shuffle size={16} style={{ color: 'var(--primary-color)' }} />}
          {playMode === 'list-loop' && <Repeat size={16} />}
        </button>

        {/* 桌面歌词第二窗仅 Windows/macOS；Android 车机改用应用内全屏歌词 */}
        {!isAndroid() && (
          <button
            className={`control-btn ${overlayOn ? 'favorited' : ''}`}
            onClick={handleToggleOverlay}
            title={overlayOn ? '关闭桌面歌词' : '开启桌面歌词'}
            style={{ color: overlayOn ? '#a855f7' : undefined }}
          >
            <MonitorSpeaker size={16} />
          </button>
        )}

        <button
          className="control-btn mobile-hide-btn"
          onClick={onToggleFullscreen}
          title={isLyricOpen ? "收起全屏歌词" : "展开全屏歌词"}
          style={{ color: isLyricOpen ? 'var(--primary-hover)' : undefined }}
        >
          {isLyricOpen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        <div className="volume-container mobile-hide-btn">
          <button className="control-btn" onClick={toggleMute} title="静音切换">
            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <div className="slider-bar" style={{ width: 60, flex: 'none' }}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={handleVolumeChange}
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
              style={{ width: `${volume * 100}%` }}
            ></div>
            <div
              className="slider-thumb"
              style={{ left: `${volume * 100}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};