import { useState, useEffect } from 'react';
import { PlayerProvider } from './context/PlayerContext';
import { ToastProvider } from './context/ToastContext';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { LyricView } from './components/LyricView';
import { LocalMusicPanel } from './components/LocalMusicPanel';
import { SearchPanel } from './components/SearchPanel';
import { PlaylistPanel } from './components/PlaylistPanel';
import { FavoritePanel } from './components/FavoritePanel';
import { AboutPanel } from './components/AboutPanel';
import { ShortcutHelpModal } from './components/ShortcutHelpModal';
import { HistoryPanel } from './components/HistoryPanel';
import { YearlyReport } from './components/YearlyReport';
import { SmartPlaylistsPanel } from './components/SmartPlaylistsPanel';
import { MyMusicMobilePanel } from './components/MyMusicMobilePanel';
import { useShortcuts } from './hooks/useShortcuts';
import { isAndroid } from './utils/platform';
import './App.css';

function MainLayout() {
  const panelDisplay = (tab: string, active: string) => {
    if (active !== tab) return 'none' as const;
    // 旧 WebView 对 display:contents 支持差，Android 用 block
    return isAndroid() ? ('block' as const) : ('contents' as const);
  };

  const [activeTab, setActiveTab] = useState<string>('search');
  const [isLyricOpen, setIsLyricOpen] = useState<boolean>(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState<boolean>(false);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);

  useShortcuts({
    onTogglePlaylist: () => setActiveTab('playlist'),
    onFocusSearch: () => {
      setActiveTab('search');
      setTimeout(() => window.dispatchEvent(new Event('focusSearchInput')), 50);
    },
    onShowHelp: () => setIsShortcutHelpOpen(true),
    onToggleLyric: () => setIsLyricOpen(prev => !prev),
  });

  useEffect(() => {
    const handleGlobalSearch = () => {
      setActiveTab('search');
    };
    window.addEventListener('globalSearch', handleGlobalSearch);
    return () => window.removeEventListener('globalSearch', handleGlobalSearch);
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
        setActiveTab={setActiveTab}
        onOpenReport={() => setIsReportOpen(true)}
      />

      <main className="main-content">
        <div style={{ display: panelDisplay('search', activeTab), height: '100%' }}><SearchPanel active={activeTab === 'search'} /></div>
        <div style={{ display: panelDisplay('my', activeTab), height: '100%' }}><MyMusicMobilePanel onOpenReport={() => setIsReportOpen(true)} /></div>
        <div style={{ display: panelDisplay('local', activeTab), height: '100%' }}><LocalMusicPanel /></div>
        <div style={{ display: panelDisplay('smart', activeTab), height: '100%' }}><SmartPlaylistsPanel /></div>
        <div style={{ display: panelDisplay('playlist', activeTab), height: '100%' }}><PlaylistPanel /></div>
        <div style={{ display: panelDisplay('favorites', activeTab), height: '100%' }}><FavoritePanel /></div>
        <div style={{ display: panelDisplay('history', activeTab), height: '100%' }}><HistoryPanel /></div>
        <div style={{ display: panelDisplay('about', activeTab), height: '100%' }}><AboutPanel /></div>
      </main>

      <PlayerBar
        onToggleFullscreen={() => setIsLyricOpen(prev => !prev)}
        isLyricOpen={isLyricOpen}
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
