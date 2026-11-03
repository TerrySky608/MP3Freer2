import { useEffect, useRef } from 'react';

const MAIN_TABS = ['recommend', 'search', 'my', 'about'] as const;
type MainTab = typeof MAIN_TABS[number];

interface UseTabSwipeOptions {
  activeTab: string;
  onTabChange: (tab: string) => void;
  disabled?: boolean;
}

/**
 * 4 个核心菜单页面左右滑动手势切换 Hook
 * 1. 严格避开屏幕最左侧边缘（clientX <= 40px），确保与“边缘向右滑返回上一页”互不干扰；
 * 2. 严格判定水平滑动倾角，上下滚动内容时不发生误切；
 * 3. 输入框聚焦或处于弹窗/详情时自动挂起。
 */
export function useTabSwipe({ activeTab, onTabChange, disabled = false }: UseTabSwipeOptions) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isValidSwipeStartRef = useRef<boolean>(false);
  const isHorizontalMoveRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTouchStart = (e: TouchEvent) => {
      if (disabled || e.touches.length !== 1) return;

      // 如果当前聚焦在输入框上，不触发 Tab 切换
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        isValidSwipeStartRef.current = false;
        return;
      }

      const touch = e.touches[0];
      // 必须在 clientX > 42px 的屏幕主体区域启动，留出最左侧 42px 专属用于“返回上一页”
      if (touch.clientX > 42) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        isValidSwipeStartRef.current = true;
        isHorizontalMoveRef.current = false;
      } else {
        isValidSwipeStartRef.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isValidSwipeStartRef.current || !touchStartRef.current || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const diffX = touch.clientX - touchStartRef.current.x;
      const diffY = touch.clientY - touchStartRef.current.y;

      if (!isHorizontalMoveRef.current) {
        if (Math.abs(diffX) > 12 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
          isHorizontalMoveRef.current = true;
        } else if (Math.abs(diffY) > 12 && Math.abs(diffY) >= Math.abs(diffX)) {
          // 上下滚动网页，放弃手势
          isValidSwipeStartRef.current = false;
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isValidSwipeStartRef.current && isHorizontalMoveRef.current && touchStartRef.current) {
        const touch = e.changedTouches[0];
        const diffX = touch.clientX - touchStartRef.current.x;
        const diffY = touch.clientY - touchStartRef.current.y;

        // 水平滑动位移超过 50px 且明确为横向意图
        if (Math.abs(diffX) >= 50 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
          const currentIdx = MAIN_TABS.indexOf(activeTab as MainTab);
          if (currentIdx !== -1) {
            if (diffX < 0 && currentIdx < MAIN_TABS.length - 1) {
              // 向左滑 -> 切换到下一个 Tab
              onTabChange(MAIN_TABS[currentIdx + 1]);
            } else if (diffX > 0 && currentIdx > 0) {
              // 向右滑 -> 切换到上一个 Tab
              onTabChange(MAIN_TABS[currentIdx - 1]);
            }
          }
        }
      }

      touchStartRef.current = null;
      isValidSwipeStartRef.current = false;
      isHorizontalMoveRef.current = false;
    };

    const handleTouchCancel = () => {
      touchStartRef.current = null;
      isValidSwipeStartRef.current = false;
      isHorizontalMoveRef.current = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [activeTab, onTabChange, disabled]);
}
