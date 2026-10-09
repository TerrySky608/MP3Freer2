import React, { useMemo, useRef, useState } from 'react';
import { Play, Plus, Trash2, ArrowUp, Flame, Clock, ListPlus } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import type { Song } from '../types/music';
import { MUSIC_SOURCES } from '../settings';

interface RecentItem {
  song: Song;
  playedAt: number;
}

interface TopItem {
  song: Song;
  playedAt: number;
  count: number;
}

const sourceLabel = (song: Song) => {
  if (song.isLocal) return '本地';
  return MUSIC_SOURCES.find(item => item.id === song.source)?.name || song.source;
};

export const HistoryPanel: React.FC = () => {
  const {
    playHistory,
    playSong,
    playAll,
    addToPlaylist,
    addAllToPlaylist,
    clearPlayHistory,
  } = usePlayer();

  const [activeTab, setActiveTab] = useState<'recent' | 'top'>('recent');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /** 最近播放：按歌曲去重，保留最新一次播放时间（原始流水仍留给智能歌单/年报） */
  const recentItems = useMemo<RecentItem[]>(() => {
    const map = new Map<string, RecentItem>();
    for (const entry of playHistory) {
      if (!map.has(entry.song.id)) {
        map.set(entry.song.id, { song: entry.song, playedAt: entry.playedAt });
      }
    }
    return Array.from(map.values());
  }, [playHistory]);

  /** 本周最爱：近 7 天按播放次数排序，附带次数 */
  const topItems = useMemo<TopItem[]>(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const countMap = new Map<string, TopItem>();
    for (const entry of playHistory) {
      if (entry.playedAt < weekAgo) continue;
      const existing = countMap.get(entry.song.id);
      if (existing) {
        existing.count += 1;
        // playedAt 保持最新（history 新在前，首次写入即为最新）
      } else {
        countMap.set(entry.song.id, {
          song: entry.song,
          playedAt: entry.playedAt,
          count: 1,
        });
      }
    }
    return Array.from(countMap.values())
      .sort((a, b) => b.count - a.count || b.playedAt - a.playedAt)
      .slice(0, 50);
  }, [playHistory]);

  const visibleSongs = activeTab === 'recent'
    ? recentItems.map(i => i.song)
    : topItems.map(i => i.song);

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatTime = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    if (d.toDateString() === today.toDateString()) return `今天 ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${time}`;
  };

  const handlePlayAll = () => {
    if (visibleSongs.length === 0) return;
    playAll(visibleSongs);
  };

  const handleAddAll = () => {
    if (visibleSongs.length === 0) return;
    addAllToPlaylist(visibleSongs);
  };

  const renderSongRow = (
    song: Song,
    index: number,
    meta: { playedAt?: number; count?: number; rank?: number },
  ) => (
    <div
      key={song.id}
      className="song-row"
      role="button"
      tabIndex={0}
      onClick={() => void playSong(song)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void playSong(song);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      <div
        className="song-col-index"
        style={
          activeTab === 'recent'
            ? { fontSize: 11, color: 'var(--text-dark)', width: 70 }
            : {
                color: (meta.rank ?? index) < 3 ? '#ef4444' : 'var(--text-muted)',
                fontWeight: (meta.rank ?? index) < 3 ? 700 : 400,
              }
        }
      >
        {activeTab === 'recent'
          ? formatDate(meta.playedAt || 0)
          : ((meta.rank ?? index) + 1).toString().padStart(2, '0')}
      </div>
      <div className="song-col-info" style={{ flex: 1, minWidth: 0 }}>
        <div className="song-title-row">
          <span className="song-name">{song.name}</span>
          <span className="tag-source">{sourceLabel(song)}</span>
        </div>
        <span className="song-artist">{song.artist}</span>
      </div>
      <div className="song-col-album">
        {activeTab === 'top' && meta.count != null ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            本周 {meta.count} 次
          </span>
        ) : (
          song.album
        )}
      </div>
      <div className="song-col-duration">{formatTime(song.duration)}</div>
      <div className="song-row-actions" onClick={(e) => e.stopPropagation()}>
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
          title="添加到播放列表"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="glass-card" style={{ flexShrink: 0, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <button className="back-to-top-btn" onClick={scrollToTop} title="回到顶部">
              <ArrowUp size={18} />
            </button>
            <Clock size={22} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>播放历史</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeTab === 'recent'
                  ? `最近听过 ${recentItems.length} 首 · 共 ${playHistory.length} 次播放`
                  : `本周最爱 Top ${topItems.length}`}
              </p>
            </div>
          </div>
          {playHistory.length > 0 && (
            <button
              className="icon-btn"
              onClick={clearPlayHistory}
              title="清空历史"
              style={{ color: '#f87171', width: 32, height: 32, padding: 0, flexShrink: 0, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <div className="type-selectors" style={{ margin: 0 }}>
            <label className={`type-radio ${activeTab === 'recent' ? 'active' : ''}`}>
              <input
                type="radio"
                name="historyTab"
                checked={activeTab === 'recent'}
                onChange={() => setActiveTab('recent')}
                style={{ display: 'none' }}
              />
              <span>最近播放</span>
            </label>
            <label className={`type-radio ${activeTab === 'top' ? 'active' : ''}`}>
              <input
                type="radio"
                name="historyTab"
                checked={activeTab === 'top'}
                onChange={() => setActiveTab('top')}
                style={{ display: 'none' }}
              />
              <span>本周最爱</span>
            </label>
          </div>

          {visibleSongs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="primary-btn"
                onClick={handlePlayAll}
                title={activeTab === 'recent' ? '按最近顺序播放全部' : '按本周最爱顺序播放'}
                style={{ borderRadius: 20, padding: '0 12px', height: 30, fontSize: 12, gap: 5 }}
              >
                <Play size={13} fill="currentColor" />
                <span>{activeTab === 'recent' ? '继续听' : '播放全部'}</span>
              </button>
              <button
                className="icon-btn"
                onClick={handleAddAll}
                title="全部加入播放队列"
                style={{
                  borderRadius: 20,
                  padding: '0 10px',
                  height: 30,
                  width: 'auto',
                  gap: 5,
                  background: 'rgba(255,255,255,0.06)',
                  fontSize: 12,
                }}
              >
                <ListPlus size={13} />
                <span>加入队列</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', marginTop: 12 }}>
        <div className="glass-card" style={{ minHeight: '100%' }}>
          {activeTab === 'recent' ? (
            recentItems.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '60px 0', color: 'var(--text-muted)', gap: 12,
              }}>
                <Clock size={48} strokeWidth={1} style={{ color: 'var(--primary-color)' }} />
                <p style={{ fontSize: 15 }}>还没有播放记录</p>
                <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>开始播放后，点这里就能接着听</span>
              </div>
            ) : (
              <div className="song-list-container">
                {recentItems.map((item, index) =>
                  renderSongRow(item.song, index, { playedAt: item.playedAt }),
                )}
              </div>
            )
          ) : (
            topItems.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '60px 0', color: 'var(--text-muted)', gap: 12,
              }}>
                <Flame size={48} strokeWidth={1} style={{ color: '#ef4444' }} />
                <p style={{ fontSize: 15 }}>本周最爱暂无数据</p>
                <span style={{ fontSize: 11, color: 'var(--text-dark)' }}>多听几首歌就会出现你的最爱榜单</span>
              </div>
            ) : (
              <div className="song-list-container">
                {topItems.map((item, index) =>
                  renderSongRow(item.song, index, {
                    playedAt: item.playedAt,
                    count: item.count,
                    rank: index,
                  }),
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
