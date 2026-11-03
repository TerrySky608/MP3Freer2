import { useEffect, useRef, useState } from 'react';
import { triggerGlobalBack } from '../utils/navigationManager';

interface EdgeSwipeBackOptions {
  edgeWidth?: number; // 触发区域宽度（从屏幕最左侧开始算，默认 36px）
  threshold?: number; // 判定返回的水平滑动位移阈值，默认 55px
}

/**
 * 屏幕左侧向右滑返回上一页手势 Hook
 * 严格限制起始点在屏幕左侧边缘，完全避免与页面内部的横向滚动（歌词、轮播等）冲突。
 */
export function useEdgeSwipeBack(options: EdgeSwipeBackOptions = {}) {
  const { edgeWidth = 36, threshold = 55 } = options;
  const [indicatorOffset, setIndicatorOffset] = useState<number | null>(null);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isValidEdgeStartRef = useRef<boolean>(false);
  const isHorizontalSwipeRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];

      // 仅当触摸起始位置在屏幕左侧边缘区域内时生效
      if (touch.clientX <= edgeWidth) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        isValidEdgeStartRef.current = true;
        isHorizontalSwipeRef.current = false;
      } else {
        isValidEdgeStartRef.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isValidEdgeStartRef.current || !touchStartRef.current || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const diffX = touch.clientX - touchStartRef.current.x;
      const diffY = touch.clientY - touchStartRef.current.y;

      // 尚未确认方向时：判断是向右水平滑动还是上下滚动网页
      if (!isHorizontalSwipeRef.current) {
        if (diffX > 10 && diffX > Math.abs(diffY) * 1.3) {
          // 确认为向右滑动返回手势
          isHorizontalSwipeRef.current = true;
        } else if (Math.abs(diffY) > 10 && Math.abs(diffY) >= diffX) {
          // 确认为上下滚动页面，立即失效本手势并放行浏览器默认滚动
          isValidEdgeStartRef.current = false;
          setIndicatorOffset(null);
          return;
        }
      }

      // 如果已确认为水平向右滑动返回
      if (isHorizontalSwipeRef.current && diffX > 0) {
        if (e.cancelable) {
          e.preventDefault(); // 阻止边缘手势期间页面横向滚动
        }
        // 更新边缘指示器位移（施加阻尼感）
        const clamped = Math.min(diffX * 0.75, 80);
        setIndicatorOffset(clamped);
      }
    };

    const handleTouchEnd = () => {
      if (isValidEdgeStartRef.current && isHorizontalSwipeRef.current && indicatorOffset !== null) {
        if (indicatorOffset >= threshold * 0.75) {
          // 达到阈值，触发返回
          const handled = triggerGlobalBack();
          if (handled && typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate(15); // 轻微触感震动反馈
            } catch (_) {}
          }
        }
      }

      // 重置状态
      touchStartRef.current = null;
      isValidEdgeStartRef.current = false;
      isHorizontalSwipeRef.current = false;
      setIndicatorOffset(null);
    };

    const handleTouchCancel = () => {
      touchStartRef.current = null;
      isValidEdgeStartRef.current = false;
      isHorizontalSwipeRef.current = false;
      setIndicatorOffset(null);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [edgeWidth, threshold, indicatorOffset]);

  return { indicatorOffset };
}
