/**
 * 全局导航与返回手势/物理按键调度栈管理器
 * 采用 LIFO（后进先出）责任链机制：
 * 最顶层的弹窗/详情页优先消费返回动作；若未消费则回退至上一级或上一个 Tab。
 */

export type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];

/**
 * 注册一个返回动作拦截器
 * @param handler 返回 true 表示已成功消费返回动作；返回 false 表示放行给下层
 * @returns 取消注册的清理函数
 */
export function registerBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const idx = backHandlers.indexOf(handler);
    if (idx !== -1) {
      backHandlers.splice(idx, 1);
    }
  };
}

/**
 * 触发全局返回动作
 * @returns 是否有组件成功消费了该返回动作
 */
export function triggerGlobalBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    try {
      const isHandled = backHandlers[i]();
      if (isHandled) {
        return true;
      }
    } catch (err) {
      console.warn('Execute back handler failed:', err);
    }
  }
  return false;
}

// 注入到全局 window，供 Android 原生 onBackPressed 桥接调用
if (typeof window !== 'undefined') {
  (window as any).__handleAppBack = triggerGlobalBack;
}
