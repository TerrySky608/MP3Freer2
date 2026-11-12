import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import type { Song } from '../types/music';

interface SongDownloadButtonProps {
  song: Song;
}

/**
 * 统一的歌曲行下载按钮：紧邻“添加（+）”按钮右侧，展示未下载/下载中/已本地化三种状态。
 */
export const SongDownloadButton: React.FC<SongDownloadButtonProps> = ({ song }) => {
  const { downloadSong, isDownloadingSong, isSongDownloaded } = usePlayer();
  const downloading = isDownloadingSong(song);
  const downloaded = isSongDownloaded(song);

  return (
    <button
      type="button"
      className="song-row-action-btn"
      onClick={() => void downloadSong(song)}
      disabled={downloading}
      title={
        downloading
          ? '正在下载...'
          : downloaded
            ? '已存在于本地歌曲目录'
            : '下载歌曲到本地（自动换源兜底）'
      }
      style={downloaded && !downloading ? { color: '#10b981' } : undefined}
    >
      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
    </button>
  );
};
