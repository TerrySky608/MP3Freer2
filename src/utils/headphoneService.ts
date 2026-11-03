/**
 * 耳机与音频输出设备智能联动服务
 * 1. 监听耳机/蓝牙设备拔出/断开 -> 自动暂停播放（防外放社死保护）
 * 2. 监听耳机接入 -> 灵动岛弹性提示
 * 3. 灵动岛自定义事件派发
 */

export interface IslandAlertDetail {
  text: string;
  icon?: string;
  durationMs?: number;
}

/** 触发灵动岛临时通知广播 */
export function triggerIslandAlert(text: string, icon: string = '🎧', durationMs: number = 2800): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<IslandAlertDetail>('islandAlert', {
      detail: { text, icon, durationMs },
    })
  );
}

/** 初始化耳机状态监听器 */
export function setupHeadphoneListener(options: {
  onDisconnect?: () => void;
  onConnect?: () => void;
}): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return () => {};
  }

  let prevAudioOutputCount = -1;
  let isInitialized = false;

  const checkAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(
        d => d.kind === 'audiooutput' || d.kind === 'audioinput'
      );
      const currentCount = audioOutputs.length;

      if (!isInitialized) {
        prevAudioOutputCount = currentCount;
        isInitialized = true;
        return;
      }

      if (prevAudioOutputCount > 0) {
        if (currentCount < prevAudioOutputCount) {
          // 设备减少 -> 耳机拔出 / 蓝牙断开
          triggerIslandAlert('🎧 耳机已断开 · 已自动暂停', '⏸️');
          if (options.onDisconnect) {
            options.onDisconnect();
          }
        } else if (currentCount > prevAudioOutputCount) {
          // 设备增加 -> 插入有线耳机 / 连接蓝牙耳机
          triggerIslandAlert('🎧 耳机已连接 · 开启纯净音质', '🎧');
          if (options.onConnect) {
            options.onConnect();
          }
        }
      }

      prevAudioOutputCount = currentCount;
    } catch (err) {
      console.warn('Check audio devices failed:', err);
    }
  };

  void checkAudioDevices();

  const handleDeviceChange = () => {
    void checkAudioDevices();
  };

  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

  return () => {
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  };
}
