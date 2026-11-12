import { useEffect, useRef } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { listen } from '@tauri-apps/api/event';

interface UseShortcutsProps {
  onTogglePlaylist?: () => void;
  onFocusSearch?: () => void;
  onShowHelp?: () => void;
  onToggleLyric?: () => void;
}

/**
 * 快捷键钩子：两路来源
 * 1. 应用内 window keydown（L 切歌单、F 搜索、空格播放等，仅应用聚焦时生效）
 * 2. Tauri 全局媒体键 + 托盘菜单事件（应用失焦也能用，通过 system-action 事件）
 */
export function useShortcuts({
  onTogglePlaylist,
  onFocusSearch,
  onShowHelp,
  onToggleLyric
}: UseShortcutsProps = {}) {
  const player = usePlayer();
  const lastVolumeRef = useRef<number>(0.5);
  // 用 ref 镜像 player，让 system-action 监听可只挂一次（不随 player 变化重挂），
  // 避免 listen 是异步的、effect 重跑时旧 unlisten 还没就绪导致 listener 累积/重复。
  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; }, [player]);
  // 同一动作短时间重复派发去抖（防止端到端多发导致 play→pause→play 反复横跳）
  const lastActionRef = useRef<{ action: string; ts: number }>({ action: '', ts: 0 });

  // 应用内键盘快捷键（窗口聚焦时生效）
  useEffect(() => {
    if (!player) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // 拦截 F5 / Ctrl+R / Meta+R 硬刷新：防止桌面 WebView2 整页重载导致正在播放的歌曲中断、队列重建
      if (key === 'f5' || ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'r')) {
        e.preventDefault();
        if (!e.repeat) {
          window.dispatchEvent(new CustomEvent('app-soft-refresh'));
        }
        return;
      }

      // 忽略在输入框或可编辑区域的按键，避免冲突
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA' ||
          (document.activeElement as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const hasModifiers = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;

      switch (key) {
        case ' ': // Space
          if (!hasModifiers) {
            e.preventDefault();
            player.togglePlay();
          }
          break;
        case 'arrowleft':
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            player.prevSong();
          }
          break;
        case 'arrowright':
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            player.nextSong();
          }
          break;
        case 'arrowup':
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            const nextVol = Math.min(1, player.volume + 0.05);
            player.setVolumeLevel(nextVol);
          }
          break;
        case 'arrowdown':
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            const nextVol = Math.max(0, player.volume - 0.05);
            player.setVolumeLevel(nextVol);
          }
          break;
        case 'm':
          if (!hasModifiers) {
            e.preventDefault();
            if (player.volume > 0) {
              lastVolumeRef.current = player.volume;
              player.setVolumeLevel(0);
            } else {
              player.setVolumeLevel(lastVolumeRef.current || 0.5);
            }
          }
          break;
        case 'l':
          if (!hasModifiers && onTogglePlaylist) {
            e.preventDefault();
            onTogglePlaylist();
          }
          break;
        case 'f':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (onFocusSearch) onFocusSearch();
          }
          break;
        case 'o':
        case 'r':
        case 'p':
          if (!hasModifiers) {
            e.preventDefault();
            player.changePlayMode();
          }
          break;
        case 'enter':
          if (!hasModifiers && onToggleLyric) {
            e.preventDefault();
            onToggleLyric();
          }
          break;
        case '?':
        case 'f1':
          if (!hasModifiers || key === '?') {
            e.preventDefault();
            if (onShowHelp) onShowHelp();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [player, onTogglePlaylist, onFocusSearch, onShowHelp, onToggleLyric]);

  // 全局媒体键 + 托盘菜单事件（应用失焦也能用）
  // 监听只挂一次（空依赖），通过 playerRef 读最新 player，避免 listener 累积。
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      if (typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__) return;
      try {
        unlisten = await listen<string>('system-action', (event) => {
          const action = event.payload;
          // 去抖：同一动作 400ms 内重复到达只处理第一次。
          // 现象是一次托盘点击端到端收到多次（Rust 多发或前端 listener 多挂的历史问题），
          // 不去重会导致 play→pause→play 反复横跳，表现为"点不准"。
          const now = Date.now();
          const last = lastActionRef.current;
          if (last.action === action && now - last.ts < 400) {
            return;
          }
          lastActionRef.current = { action, ts: now };

          const p = playerRef.current;
          if (!p) return;
          switch (action) {
            case 'play-pause':
              p.togglePlay();
              break;
            case 'next':
              p.nextSong();
              break;
            case 'prev':
              p.prevSong();
              break;
            case 'stop':
              // 暂停并回到开头（不要 toggle，已暂停时 toggle 会误开始播放）
              p.stopPlayback();
              break;
            case 'volume-up':
              p.setVolumeLevel(Math.min(1, p.volume + 0.1));
              break;
            case 'volume-down':
              p.setVolumeLevel(Math.max(0, p.volume - 0.1));
              break;
            case 'volume-mute':
              if (p.volume > 0) {
                lastVolumeRef.current = p.volume;
                p.setVolumeLevel(0);
              } else {
                p.setVolumeLevel(lastVolumeRef.current || 0.5);
              }
              break;
            // show-window / quit 由 Rust 端直接处理，不到前端
          }
        });
      } catch (err) {
        console.warn('[useShortcuts] 监听全局事件失败（可能在浏览器环境）:', err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
