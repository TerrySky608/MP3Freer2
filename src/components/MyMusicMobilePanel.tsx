import React, { useState } from 'react';
import { Heart, History, Music, BarChart3 } from 'lucide-react';
import { FavoritePanel } from './FavoritePanel';
import { HistoryPanel } from './HistoryPanel';
import { LocalMusicPanel } from './LocalMusicPanel';

interface MyMusicMobilePanelProps {
  onOpenReport: () => void;
}

export const MyMusicMobilePanel: React.FC<MyMusicMobilePanelProps> = ({ onOpenReport }) => {
  const [subTab, setSubTab] = useState<'favorites' | 'history' | 'local'>('favorites');

  const subTabs = [
    { id: 'favorites' as const, label: '我的收藏', icon: Heart },
    { id: 'history' as const, label: '播放历史', icon: History },
    { id: 'local' as const, label: '本地歌曲', icon: Music },
  ];

  return (
    <div className="my-music-mobile-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部轻量分段控制器 */}
      <div className="mobile-subtabs-bar">
        <div className="mobile-subtabs-list">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = subTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`mobile-subtab-btn ${isActive ? 'active' : ''}`}
                onClick={() => setSubTab(tab.id)}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          className="mobile-report-btn"
          onClick={onOpenReport}
          title="听歌年报"
        >
          <BarChart3 size={15} />
          <span>年报</span>
        </button>
      </div>

      {/* 子面板内容区 */}
      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {subTab === 'favorites' && <FavoritePanel />}
        {subTab === 'history' && <HistoryPanel />}
        {subTab === 'local' && <LocalMusicPanel />}
      </div>
    </div>
  );
};
