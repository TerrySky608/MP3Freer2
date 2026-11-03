import { useState, useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { PlayerProvider } from './context/PlayerContext';
import { ToastProvider } from './context/ToastContext';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { LyricView } from './components/LyricView';
import { LocalMusicPanel } from './components/LocalMusicPanel';
import { SearchPanel } from './components/SearchPanel';
import { RecommendPanel } from './components/RecommendPanel';
import { PlaylistPanel } from './components/PlaylistPanel';
import { FavoritePanel } from './components/FavoritePanel';
import { AboutPanel } from './components/AboutPanel';
import { ShortcutHelpModal } from './components/ShortcutHelpModal';
import { HistoryPanel } from './components/HistoryPanel';
import { YearlyReport } from './components/YearlyReport';
import { MyMusicMobilePanel } from './components/MyMusicMobilePanel';
import { useShortcuts } from './hooks/useShortcuts';
import { useEdgeSwipeBack } from './hooks/useEdgeSwipeBack';
import { registerBackHandler } from './utils/navigationManager';
import { isAndroid } from './utils/platform';
import './App.css';

function MainLayout() {
  const panelDisplay = (tab: string, active: string) => {
    if (active !== tab) return 'none' as const;
    // 旧 WebView 对 display:contents 支持差，Android 用 block
    return isAndroid() ? ('block' as const) : ('contents' as const);
  };

  const [activeTab, setActiveTab] = useState<string>('recommend');
  const prevTabRef = useRef<string>('recommend');
  const tabHistoryRef = useRef<string[]>(['recommend']);
  const [isLyricOpen, setIsLyricOpen] = useState<boolean>(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState<boolean>(false);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);

  // 屏幕左侧向右滑返回上一页手势
  const { indicatorOffset } = useEdgeSwipeBack({ edgeWidth: 40, threshold: 55 });

  const handleSelectTab = (tab: string) => {
    if (tab !== 'playlist') {
      prevTabRef.current = tab;
    }
    setActiveTab(tab);
    if (tabHistoryRef.current[tabHistoryRef.current.length - 1] !== tab) {
      tabHistoryRef.current.push(tab);
      if (tabHistoryRef.current.length > 20) {
        tabHistoryRef.current.shift();
      }
    }
    if (isLyricOpen) {
      setIsLyricOpen(false);
    }
  };

  // 注册顶层全局返回动作（支持左侧边缘右滑与 Android 物理返回键）
  useEffect(() => {
    return registerBackHandler(() => {
      // 1. 全屏歌词浮层优先返回
      if (isLyricOpen) {
        setIsLyricOpen(false);
        return true;
      }
      // 2. 年报弹窗
      if (isReportOpen) {
        setIsReportOpen(false);
        return true;
      }
      // 3. 快捷键帮助弹窗
      if (isShortcutHelpOpen) {
        setIsShortcutHelpOpen(false);
        return true;
      }
      // 4. Tab 导航历史栈回退
      if (tabHistoryRef.current.length > 1) {
        tabHistoryRef.current.pop(); // 弹出当前 Tab
        const prevTab = tabHistoryRef.current[tabHistoryRef.current.length - 1] || 'recommend';
        setActiveTab(prevTab);
        return true;
      }
      // 5. 若已在顶层但非 recommend，回退到主推荐页
      if (activeTab !== 'recommend') {
        setActiveTab('recommend');
        tabHistoryRef.current = ['recommend'];
        return true;
      }
      return false;
    });
  }, [isLyricOpen, isReportOpen, isShortcutHelpOpen, activeTab]);

  const handleTogglePlaylist = () => {
    if (isLyricOpen) {
      setIsLyricOpen(false);
      setActiveTab('playlist');
      return;
    }
    if (activeTab === 'playlist') {
      setActiveTab(prevTabRef.current || 'recommend');
    } else {
      prevTabRef.current = activeTab;
      setActiveTab('playlist');
    }
  };

  useShortcuts({
    onTogglePlaylist: handleTogglePlaylist,
    onFocusSearch: () => {
      handleSelectTab('search');
      setTimeout(() => window.dispatchEvent(new Event('focusSearchInput')), 50);
    },
    onShowHelp: () => setIsShortcutHelpOpen(true),
    onToggleLyric: () => setIsLyricOpen(prev => !prev),
  });

  useEffect(() => {
    const switchToSearch = () => {
      prevTabRef.current = 'search';
      setActiveTab('search');
    };
    window.addEventListener('globalSearch', switchToSearch);
    window.addEventListener('openAlbum', switchToSearch);
    window.addEventListener('openPlaylist', switchToSearch);
    return () => {
      window.removeEventListener('globalSearch', switchToSearch);
      window.removeEventListener('openAlbum', switchToSearch);
      window.removeEventListener('openPlaylist', switchToSearch);
    };
  }, []);

  useEffect(() => {
    if (isLyricOpen) {
      document.body.classList.add('is-lyric-open');
      document.documentElement.classList.add('is-lyric-open');
    } else {
      document.body.classList.remove('is-lyric-open');
      document.documentElement.classList.remove('is-lyric-open');
    }
  }, [isLyricOpen]);

  return (
    <div className="app-container">
      <div
        className="title-drag-region"
        data-tauri-drag-region
      />

      <div className="aurora-bg aurora-1" />
      <div className="aurora-bg aurora-2" />

      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        onOpenReport={() => setIsReportOpen(true)}
      />

      <main className="main-content">
        <div style={{ display: panelDisplay('recommend', activeTab), height: '100%' }}>
          <RecommendPanel active={activeTab === 'recommend'} />
        </div>
        <div style={{ display: panelDisplay('search', activeTab), height: '100%' }}>
          <SearchPanel active={activeTab === 'search'} />
        </div>
        <div style={{ display: panelDisplay('my', activeTab), height: '100%' }}>
          <MyMusicMobilePanel onOpenReport={() => setIsReportOpen(true)} />
        </div>
        <div style={{ display: panelDisplay('local', activeTab), height: '100%' }}><LocalMusicPanel /></div>
        <div style={{ display: panelDisplay('playlist', activeTab), height: '100%' }}><PlaylistPanel /></div>
        <div style={{ display: panelDisplay('favorites', activeTab), height: '100%' }}><FavoritePanel /></div>
        <div style={{ display: panelDisplay('history', activeTab), height: '100%' }}><HistoryPanel /></div>
        <div style={{ display: panelDisplay('about', activeTab), height: '100%' }}><AboutPanel /></div>
      </main>

      <PlayerBar
        onToggleFullscreen={() => setIsLyricOpen(prev => !prev)}
        isLyricOpen={isLyricOpen}
        onTogglePlaylist={handleTogglePlaylist}
        isPlaylistOpen={activeTab === 'playlist' && !isLyricOpen}
      />
      <LyricView isOpen={isLyricOpen} onClose={() => setIsLyricOpen(false)} />

      <ShortcutHelpModal
        isOpen={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
      />
      <YearlyReport
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
      />

      {/* 屏幕左边缘向右滑返回视觉指示器 */}
      {indicatorOffset !== null && (
        <div
          className="edge-swipe-indicator"
          style={{
            transform: `translate(${indicatorOffset - 42}px, -50%)`,
            opacity: Math.min(indicatorOffset / 35, 1),
          }}
        >
          <ChevronLeft size={22} />
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <PlayerProvider>
        <MainLayout />
      </PlayerProvider>
    </ToastProvider>
  );
}

export default App;
