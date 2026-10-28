import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Lock,
  Unlock,
  X,
  Minus,
  Plus,
  Rows2,
  Rows3,
} from 'lucide-react';
import {
  ACCENT_OPTIONS,
  DesktopLyricSettings,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  estimateOverlayHeight,
  loadDesktopLyricSettings,
  saveDesktopLyricSettings,
} from '../utils/desktopLyricSettings';

interface LyricPayload {
  current: string;
  prev: string;
  next: string;
  songName: string;
  artist: string;
  isPlaying: boolean;
}

const EMPTY: LyricPayload = {
  current: '♪ 暂无歌词',
  prev: '',
  next: '',
  songName: '',
  artist: '',
  isPlaying: false,
};

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
}

export function LyricOverlayApp() {
  const [payload, setPayload] = useState<LyricPayload>(EMPTY);
  const [locked, setLocked] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const tipTimerRef = useRef<any>(null);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const [settings, setSettings] = useState<DesktopLyricSettings>(() => loadDesktopLyricSettings());
  const [lineAnimKey, setLineAnimKey] = useState(0);
  const dragTriggeredRef = useRef(false);
  const lastCurrentRef = useRef('');

  const showToast = useCallback((text: string) => {
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    setTip(text);
    tipTimerRef.current = setTimeout(() => setTip(null), 2500);
  }, []);

  const toggleLock = useCallback(async (targetState?: boolean) => {
    const next = targetState !== undefined ? targetState : !locked;
    setLocked(next);
    showToast(next ? '🔒 歌词已锁定穿透 · 托盘图标或 Ctrl+Alt+L 解锁' : '🔓 歌词已解锁 · 可自由拖动定位');
    try {
      await invoke('set_lyric_overlay_lock', { locked: next });
    } catch (err) {
      console.warn('切换歌词穿透锁定状态失败:', err);
    }
  }, [locked, showToast]);

  useEffect(() => {
    const unlistenLock = listen<boolean>('overlay-lock-state', (event) => {
      const isLocked = !!event.payload;
      setLocked(isLocked);
      showToast(isLocked ? '🔒 歌词已锁定穿透 · 托盘图标或 Ctrl+Alt+L 解锁' : '🔓 歌词已解锁 · 可自由拖动定位');
    });
    return () => {
      unlistenLock.then(fn => fn());
    };
  }, [showToast]);


  const accentMeta = useMemo(
    () => ACCENT_OPTIONS.find(a => a.id === settings.accent) || ACCENT_OPTIONS[0],
    [settings.accent],
  );

  const applyWindowHeight = useCallback(async (next: DesktopLyricSettings) => {
    try {
      const height = estimateOverlayHeight(next);
      await getCurrentWindow().setSize(new LogicalSize(720, height));
    } catch (err) {
      console.warn('调整桌面歌词窗口高度失败:', err);
    }
  }, []);

  const updateSettings = useCallback((patch: Partial<DesktopLyricSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveDesktopLyricSettings(next);
      void applyWindowHeight(next);
      return next;
    });
  }, [applyWindowHeight]);

  useEffect(() => {
    void applyWindowHeight(settings);
    // 仅挂载时按已存设置校正一次高度
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlisten = listen<LyricPayload>('overlay-lyric', (event) => {
      const next = event.payload;
      if (next.current !== lastCurrentRef.current) {
        lastCurrentRef.current = next.current;
        setLineAnimKey(k => k + 1);
      }
      setPayload(next);
    });
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (!menu.visible) return;
    const close = () => setMenu({ visible: false, x: 0, y: 0 });
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu.visible]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (locked) return;
    dragTriggeredRef.current = false;
    const startX = e.screenX;
    const startY = e.screenY;
    const onMove = (ev: MouseEvent) => {
      if (dragTriggeredRef.current) return;
      if (Math.abs(ev.screenX - startX) > 3 || Math.abs(ev.screenY - startY) > 3) {
        dragTriggeredRef.current = true;
        // startDragging 后 OS 接管鼠标事件，onUp 不会触发，
        // 必须在此处主动移除监听器，否则每次拖动后都会堆积一对 stale listener
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        getCurrentWindow().startDragging().catch(console.error);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDoubleClick = () => {
    if (dragTriggeredRef.current) {
      dragTriggeredRef.current = false;
      return;
    }
    void toggleLock();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 避免菜单贴边被裁切
    const x = Math.min(e.clientX, window.innerWidth - 320);
    const y = Math.min(e.clientY, window.innerHeight - 48);
    setMenu({ visible: true, x: Math.max(4, x), y: Math.max(4, y) });
  };

  const sendAction = (action: string) => {
    emit('system-action', action).catch(() => {});
    setMenu({ visible: false, x: 0, y: 0 });
  };

  const cycleAccent = () => {
    const idx = ACCENT_OPTIONS.findIndex(a => a.id === settings.accent);
    const next = ACCENT_OPTIONS[(idx + 1) % ACCENT_OPTIONS.length];
    updateSettings({ accent: next.id });
  };

  const rootStyle = {
    '--lyric-font-size': `${settings.fontSize}px`,
    '--lyric-accent': accentMeta.color,
    '--lyric-accent-rgb': hexToRgbTriplet(accentMeta.color),
  } as React.CSSProperties;

  return (
    <div
      className={`overlay-root ${locked ? 'locked' : 'unlocked'}`}
      style={rootStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      title={locked ? '已锁定鼠标穿透 · 托盘或 Ctrl+Alt+L 解锁' : '双击锁定穿透 · 拖动移动 · 右键菜单'}
    >
      <div className={`overlay-controls ${hovered ? 'show' : ''}`}>
        <span className="overlay-song-label">
          {payload.songName}
          {payload.artist && <span className="overlay-artist-label"> — {payload.artist}</span>}
        </span>
        <span className="overlay-lock-label" onClick={(e) => { e.stopPropagation(); void toggleLock(); }} title={locked ? "点击解锁" : "点击锁定穿透"}>
          {locked ? <Lock size={10} /> : <Unlock size={10} />}
        </span>
      </div>

      <div className={`overlay-lyric-text ${settings.showPrev ? 'three-line' : 'two-line'}`}>
        {settings.showPrev && (
          <div className="lyric-side lyric-prev">
            {payload.prev || '\u00A0'}
          </div>
        )}
        <div
          key={lineAnimKey}
          className={`lyric-current lyric-swap ${payload.isPlaying ? 'playing' : ''}`}
        >
          {payload.current || '♪'}
        </div>
        <div className="lyric-side lyric-next">
          {payload.next || '\u00A0'}
        </div>
      </div>

      {tip && (
        <div className="overlay-toast-tip">
          {tip}
        </div>
      )}

      {menu.visible && (
        <div
          className="ctx-menu-bar"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <button
            className="ctx-icon-btn"
            title={payload.isPlaying ? '暂停' : '播放'}
            onClick={() => sendAction('play-pause')}
          >
            {payload.isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button className="ctx-icon-btn" title="上一首" onClick={() => sendAction('prev')}>
            <SkipBack size={14} />
          </button>
          <button className="ctx-icon-btn" title="下一首" onClick={() => sendAction('next')}>
            <SkipForward size={14} />
          </button>

          <span className="ctx-sep" />

          <button
            className="ctx-icon-btn"
            title={locked ? '解锁（恢复鼠标控制）' : '锁定（开启鼠标穿透）'}
            onClick={() => {
              void toggleLock();
              setMenu({ visible: false, x: 0, y: 0 });
            }}
          >
            {locked ? <Unlock size={14} /> : <Lock size={14} />}
          </button>

          <span className="ctx-sep" />

          <button
            className="ctx-icon-btn"
            title="缩小字号"
            disabled={settings.fontSize <= FONT_SIZE_MIN}
            onClick={() => updateSettings({ fontSize: settings.fontSize - FONT_SIZE_STEP })}
          >
            <Minus size={14} />
          </button>
          <span className="ctx-size-label">{settings.fontSize}</span>
          <button
            className="ctx-icon-btn"
            title="放大字号"
            disabled={settings.fontSize >= FONT_SIZE_MAX}
            onClick={() => updateSettings({ fontSize: settings.fontSize + FONT_SIZE_STEP })}
          >
            <Plus size={14} />
          </button>

          <button
            className="ctx-icon-btn ctx-swatch"
            title={`高亮颜色：${accentMeta.name}（点击切换）`}
            onClick={cycleAccent}
            style={{ color: accentMeta.color }}
          >
            <span className="ctx-swatch-dot" style={{ background: accentMeta.color }} />
          </button>

          <button
            className="ctx-icon-btn"
            title={settings.showPrev ? '切换为双行' : '切换为三行（含上一句）'}
            onClick={() => updateSettings({ showPrev: !settings.showPrev })}
          >
            {settings.showPrev ? <Rows3 size={14} /> : <Rows2 size={14} />}
          </button>

          <span className="ctx-sep" />

          <button
            className="ctx-icon-btn danger"
            title="关闭桌面歌词"
            onClick={() => {
              getCurrentWindow().hide().catch(console.error);
              setMenu({ visible: false, x: 0, y: 0 });
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function hexToRgbTriplet(hex: string): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return '192, 132, 252';
  const n = Number.parseInt(raw, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r}, ${g}, ${b}`;
}
