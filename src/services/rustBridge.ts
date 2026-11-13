/**
 * Rust 后端命令桥接层
 * 统一封装所有 @tauri-apps/api/core invoke 调用
 */
import { invoke, Channel } from '@tauri-apps/api/core';

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  durationSecs: number;
  fileName: string;
}

/**
 * 从本地音频文件解析真实 ID3/Vorbis/FLAC 元数据
 * 替代前端从文件名猜测歌名的逻辑
 */
export async function readAudioMetadata(filePath: string): Promise<AudioMetadata> {
  return invoke<AudioMetadata>('read_audio_metadata', { filePath });
}

/**
 * 带进度回调的文件下载（Rust 端执行，不阻塞 UI 线程）
 * @param url 下载地址
 * @param destPath 本地目标路径
 * @param onProgress 进度回调 (0~100)
 * @returns 实际写入的本地文件路径（自动匹配正确音频扩展名）
 */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const channel = new Channel<number>();
  if (onProgress) {
    channel.onmessage = (percent) => {
      onProgress(percent as number);
    };
  }

  return invoke<string>('download_file', {
    url,
    destPath,
    onProgress: channel,
  });
}

/** 获取当前平台默认下载目录（桌面端为用户 Downloads\MP3Terry，Android 为免权限外部音乐/下载目录；不存在自动创建） */
export async function getDefaultDownloadDir(): Promise<string> {
  return invoke<string>('get_default_download_dir');
}

/** 确保目标目录存在（不存在自动递归创建） */
export async function ensureDirectory(dirPath: string): Promise<string> {
  return invoke<string>('ensure_directory', { dirPath });
}

/** 检查本地文件是否存在（兼容自定义磁盘路径与 Android 目录） */
export async function checkFileExists(filePath: string): Promise<boolean> {
  return invoke<boolean>('file_exists', { filePath });
}

/** 列出指定目录中支持的音频文件名列表 */
export async function listAudioFilesInDir(dirPath: string): Promise<string[]> {
  return invoke<string[]>('list_audio_files_in_dir', { dirPath });
}

/** 保存纯文本文件（用于同步写入 .lrc 歌词到任意下载路径） */
export async function saveTextFile(filePath: string, content: string): Promise<void> {
  return invoke('save_text_file', { filePath, content });
}

/** 读取纯文本文件（用于从任意下载/本地路径读取 .lrc 歌词） */
export async function readTextFileFromLocal(filePath: string): Promise<string> {
  return invoke<string>('read_text_file', { filePath });
}

/** 读取二进制文件（用于本地音频全量读取兜底） */
export async function readBinaryFile(filePath: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_binary_file', { filePath });
}

/** 获取本机回环 HTTP Range 流媒体播放地址（支持秒开与任意拖拽进度条，避免全量内存复制） */
export async function getLocalAudioStreamUrl(filePath: string): Promise<string> {
  return invoke<string>('get_local_audio_stream_url', { filePath });
}

/**
 * 切换桌面悬浮歌词窗口的显示/隐藏
 * @returns 切换后是否可见
 */
export async function toggleLyricOverlay(): Promise<boolean> {
  return invoke<boolean>('toggle_lyric_overlay');
}
