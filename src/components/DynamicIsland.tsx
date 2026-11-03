import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Heart, ChevronUp } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { usePlaybackProgress } from '../services/playbackProgress';
import { CoverImage } from './CoverImage';
import { setupHeadphoneListener, IslandAlertDetail } from '../utils/headphoneService';

export const DynamicIsland: React.FC = () => {
  const {
    currentSong,
    togglePlay,
    nextSong,
    prevSong,
    seekTo,
    isFavorite,
    toggleFavorite,
  } = usePlayer();

  const { currentTime, duration, isPlaying } = usePlaybackProgress();

  const [mode, setMode] = useState<'compact' | 'expanded' | 'alert'>('compact');
  const [alertInfo, setAlertInfo] = useState<IslandAlertDetail | null>(null);
  const alertTimerRef = useRef<any>(null);
  const islandRef = useRef<HTMLDivElement>(null);

  // 格式化时间
  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 监听耳机插拔与断开事件
  useEffect(() => {
    const cleanup = setupHeadphoneListener({
      onDisconnect: () => {
        if (isPlaying) {
          togglePlay();
        }
      },
      onConnect: () => {
        // 可选：耳机接入
      },
    });
    return cleanup;
  }, [isPlaying, togglePlay]);

  // 监听灵动岛通知广播 (islandAlert)
  useEffect(() => {
    const handleIslandAlert = (e: Event) => {
      const customEvent = e as CustomEvent<IslandAlertDetail>;
      if (!customEvent.detail?.text) return;

      setAlertInfo(customEvent.detail);
      setMode('alert');

      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      alertTimerRef.current = setTimeout(() => {
        setAlertInfo(null);
        setMode('compact');
      }, customEvent.detail.durationMs || 2800);
    };

    window.addEventListener('islandAlert', handleIslandAlert);
    return () => {
      window.removeEventListener('islandAlert', handleIslandAlert);
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    };
  }, []);

  // 点击外部区域自动收起展开态
  useEffect(() => {
    if (mode !== 'expanded') return;
    const handleClickOutside = (e: MouseEvent) => {
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        setMode('compact');
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [mode]);

  // 如果没有当前播放歌曲且没有临时通知，则不展示灵动岛
  if (!currentSong && !alertInfo) {
    return null;
  }

  const isFav = currentSong ? isFavorite(currentSong) : false;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      {/* 展开态下的半透明背景遮罩（点击收起） */}
      {mode === 'expanded' && (
        <div
          className="dynamic-island-backdrop"
          onClick={() => setMode('compact')}
        />
      )}

      <div
        ref={islandRef}
        className={`dynamic-island-root ${mode}`}
        onClick={() => {
          if (mode === 'compact') {
            setMode('expanded');
          }
        }}
      >
        {/* ================= 1. 通知态 (Alert) ================= */}
        {mode === 'alert' && alertInfo && (
          <div className="island-alert-content">
            <span className="island-alert-icon">{alertInfo.icon || '🎧'}</span>
            <span className="island-alert-text">{alertInfo.text}</span>
          </div>
        )}

        {/* ================= 2. 收起微型药丸态 (Compact) ================= */}
        {mode === 'compact' && currentSong && (
          <div className="island-compact-content">
            {/* 左侧：旋转微型黑胶封面 */}
            <div className={`island-compact-cover ${isPlaying ? 'rotating' : ''}`}>
              <CoverImage src={currentSong.pic || ''} alt="" className="island-vinyl-img" />
              <div className="island-vinyl-center-hole" />
            </div>

            {/* 中间：歌名 */}
            <span className="island-compact-title" title={currentSong.name}>
              {currentSong.name}
            </span>

            {/* 右侧：律动波形 */}
            <div className={`island-visualizer-bars ${isPlaying ? 'playing' : ''}`}>
              <span className="bar bar-1" />
              <span className="bar bar-2" />
              <span className="bar bar-3" />
            </div>
          </div>
        )}

        {/* ================= 3. 流体展开卡片态 (Expanded) ================= */}
        {mode === 'expanded' && currentSong && (
          <div className="island-expanded-content" onClick={e => e.stopPropagation()}>
            {/* 顶部：封面 + 信息 + 收起按钮 */}
            <div className="island-expanded-header">
              <div className="island-expanded-cover-wrap">
                <CoverImage src={currentSong.pic || ''} alt="" className="island-expanded-cover" />
              </div>
              <div className="island-expanded-info">
                <span className="island-expanded-name">{currentSong.name}</span>
                <span className="island-expanded-artist">{currentSong.artist}</span>
              </div>
              <button
                type="button"
                className="island-collapse-btn"
                onClick={() => setMode('compact')}
                title="收起为灵动岛胶囊"
              >
                <ChevronUp size={16} />
              </button>
            </div>

            {/* 中部：滑动进度条与时间 */}
            <div className="island-expanded-progress">
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime || 0}
                onChange={e => seekTo(Number(e.target.value))}
                className="island-progress-slider"
                style={{
                  background: `linear-gradient(to right, #ec4899 0%, #a855f7 ${progressPercent}%, rgba(255,255,255,0.15) ${progressPercent}%, rgba(255,255,255,0.15) 100%)`,
                }}
              />
              <div className="island-progress-times">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* 底部：控制按钮组 */}
            <div className="island-expanded-controls">
              <button
                type="button"
                className={`island-ctrl-btn ${isFav ? 'fav' : ''}`}
                onClick={() => toggleFavorite(currentSong)}
                title={isFav ? '取消收藏' : '收藏歌曲'}
              >
                <Heart size={18} fill={isFav ? '#ef4444' : 'none'} color={isFav ? '#ef4444' : 'currentColor'} />
              </button>
              <div className="island-main-ctrls">
                <button
                  type="button"
                  className="island-ctrl-btn"
                  onClick={prevSong}
                  title="上一首"
                >
                  <SkipBack size={18} fill="currentColor" />
                </button>
                <button
                  type="button"
                  className="island-play-btn"
                  onClick={togglePlay}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? (
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
                  )}
                </button>
                <button
                  type="button"
                  className="island-ctrl-btn"
                  onClick={nextSong}
                  title="下一首"
                >
                  <SkipForward size={18} fill="currentColor" />
                </button>
              </div>
              <div style={{ width: 28 }} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
