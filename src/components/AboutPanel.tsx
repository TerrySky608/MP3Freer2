import React, { useEffect, useState, useRef } from 'react';
import { AlertCircle, Disc, Cloud, Download, Upload, RefreshCw, Sparkles, Key, Server, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import {
  API_ENDPOINT_INFOS,
  APP_VERSION,
  getDefaultSearchSource,
  getEnabledApiEndpoints,
  getPreferredQuality,
  getPreloadNextSong,
  MUSIC_SOURCES,
  MusicSource,
  QUALITY_OPTIONS,
  AudioQuality,
  setDefaultSearchSource,
  setEnabledApiEndpoints,
  setPreferredQuality,
  setPreloadNextSong,
} from '../settings';
import { usePlayer } from '../context/PlayerContext';
import { resourceCache } from '../services/cache';
import { getSyncServerUrl, setSyncServerUrl, DEFAULT_SYNC_CODE, generateRandomSyncCode } from '../services/syncService';

export const AboutPanel: React.FC = () => {
  const {
    reloadCurrentSong,
    exportFavorites,
    importFavorites,
    syncFavoritesNow,
    uploadFavoritesNow,
    restoreFavoritesNow,
    syncCode,
    updateSyncCode,
  } = usePlayer();
  const [searchSource, setSearchSource] = useState<MusicSource>('netease');
  const [enabledEndpoints, setEnabledEndpointsState] = useState<string[]>([]);
  const [preferredQuality, setPreferredQualityState] = useState<AudioQuality>('high');
  const [preloadNextSong, setPreloadNextSongState] = useState<boolean>(() => getPreloadNextSong());
  const [isSyncing, setIsSyncing] = useState(false);
  const [inputCode, setInputCode] = useState(syncCode);
  const [serverUrl, setServerUrlState] = useState(() => getSyncServerUrl());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputCode(syncCode);
  }, [syncCode]);

  useEffect(() => {
    const savedSource = getDefaultSearchSource();
    setSearchSource(savedSource);
    setDefaultSearchSource(savedSource);

    setPreferredQualityState(getPreferredQuality());
    setEnabledEndpointsState(getEnabledApiEndpoints());
    setPreloadNextSongState(getPreloadNextSong());
  }, []);

  const handlePreloadToggle = (enabled: boolean) => {
    setPreloadNextSongState(enabled);
    setPreloadNextSong(enabled);
  };

  const handleQualityChange = (quality: AudioQuality) => {
    setPreferredQualityState(quality);
    setPreferredQuality(quality);
    resourceCache.clear();
    reloadCurrentSong();
  };

  const handleClearCache = () => {
    if (confirm('确定要清空导入的本地音乐和收藏索引吗？该操作不会删除磁盘上的音乐文件。')) {
      localStorage.removeItem('mp3freer_local_songs');
      localStorage.removeItem('mp3freer_favorite_songs');
      resourceCache.clear();
      window.location.reload();
    }
  };

  const handleSourceChange = (source: MusicSource) => {
    setSearchSource(source);
    setDefaultSearchSource(source);
  };

  const handleEndpointToggle = (endpoint: string) => {
    setEnabledEndpointsState(prev => {
      const next = prev.includes(endpoint)
        ? prev.filter(ep => ep !== endpoint)
        : [...prev, endpoint];
      setEnabledApiEndpoints(next);
      return next;
    });
  };

  return (
    <div className="about-panel-root" style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>
      <div className="glass-card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div className="about-logo-wrapper">
          <Disc size={32} className="spinning" style={{ color: 'white' }} />
        </div>
        <div>
          <h2>MP3Terry</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            版本：v{APP_VERSION} | 基于 Tauri v2 的本地与在线音乐播放器。
          </p>
        </div>
      </div>

      <div className="glass-card">
        <h3>系统设置</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>默认搜索平台</span>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                在线音乐搜索和本地歌曲自动匹配歌词时会优先使用该平台。默认是网易云音乐。
              </p>
              <div className="source-selectors" style={{ marginTop: 10 }}>
                {MUSIC_SOURCES.map(source => (
                  <button
                    key={source.id}
                    className={`source-tab ${searchSource === source.id ? 'active' : ''}`}
                    onClick={() => handleSourceChange(source.id)}
                    type="button"
                  >
                    {source.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>播放音质</span>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                在线播放与下载时优先请求的音质档位。无损/Hi-Res 取决于歌曲本身是否拥有高品质源。
              </p>
              <div className="source-selectors" style={{ marginTop: 10 }}>
                {QUALITY_OPTIONS.map(q => (
                  <button
                    key={q.id}
                    className={`source-tab ${preferredQuality === q.id ? 'active' : ''}`}
                    onClick={() => handleQualityChange(q.id)}
                    type="button"
                  >
                    {q.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>自动预加载下一首歌曲</span>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                  当前歌曲稳定播放后，自动在后台提前预缓冲下一首歌曲的音频数据，切歌秒开无缝衔接。
                </p>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={preloadNextSong}
                  onChange={e => handlePreloadToggle(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#10b981', cursor: 'pointer' }}
                />
              </label>
            </div>
          </div>



          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>多音源与 API 接口节点（智能故障转移）</span>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                勾选可用节点，系统在播放解析或音频流加载失败时会自动毫秒级顺延重试下一个备选音源。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {API_ENDPOINT_INFOS.map(info => (
                  <label
                    key={info.url}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--text-main)',
                      padding: '8px 12px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderRadius: 8,
                      border: '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enabledEndpoints.includes(info.url)}
                      onChange={() => handleEndpointToggle(info.url)}
                      style={{ accentColor: '#10b981', width: 16, height: 16, marginTop: 2 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>{info.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{info.url}</span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{info.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} style={{ color: '#ec4899' }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>内置扩展音源引擎（洛雪自定义源沙箱）</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                系统已自动挂载内置的沙箱音源引擎，当第三方 API 节点受限或无版权时自动激活多平台备用直链解析。
              </p>
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 14px',
                  background: 'rgba(236, 72, 153, 0.08)',
                  borderRadius: 8,
                  border: '1px solid rgba(236, 72, 153, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#f472b6' }}>墨澜聚合音源 v4.5.1</span>
                    <span style={{ fontSize: 10, background: '#10b981', color: '#fff', padding: '1px 5px', borderRadius: 4 }}>已就绪</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                    全平台支持 FLAC 无损；酷我 / QQ / 网易 / 酷狗 / 咪咕多平台自动故障转移轮询
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cloud size={16} style={{ color: '#a855f7' }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>跨设备云端同步与数据迁移</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                已启用 <strong>Cloudflare KV 永久云端中继</strong>，不同设备（手机、车机、电脑）输入<strong>相同暗号</strong>即可双向互通，数据永久持久化不丢失。
              </p>

              {/* 同步暗号配置项 */}
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, minWidth: 70, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Key size={13} style={{ color: '#c084fc' }} /> 同步暗号:
                  </span>
                  <input
                    type="text"
                    value={inputCode}
                    onChange={e => setInputCode(e.target.value)}
                    placeholder="输入暗号，如 SKY-R608"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      width: 160,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      updateSyncCode(inputCode);
                      alert(`✅ 同步暗号已保存：${inputCode}`);
                    }}
                    style={{ height: 30, padding: '0 10px', fontSize: 12, borderRadius: 6 }}
                  >
                    保存暗号
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newCode = generateRandomSyncCode();
                      setInputCode(newCode);
                      updateSyncCode(newCode);
                    }}
                    style={{
                      height: 30,
                      padding: '0 8px',
                      fontSize: 11,
                      background: 'rgba(168, 85, 247, 0.15)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      borderRadius: 6,
                      color: '#c084fc',
                      cursor: 'pointer',
                    }}
                  >
                    随机换一个
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputCode(DEFAULT_SYNC_CODE);
                      updateSyncCode(DEFAULT_SYNC_CODE);
                    }}
                    style={{
                      height: 30,
                      padding: '0 8px',
                      fontSize: 11,
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 6,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    SKY-R608
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, minWidth: 70, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Server size={13} style={{ color: '#38bdf8' }} /> 自建节点:
                  </span>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={e => setServerUrlState(e.target.value)}
                    onBlur={() => setSyncServerUrl(serverUrl)}
                    placeholder="选填，留空即默认使用专属永久云 (music.terrysky.fun)"
                    style={{
                      flex: 1,
                      maxWidth: 280,
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      if (serverUrl && serverUrl.includes('workers.dev')) {
                        alert('⚠️ 提示：workers.dev 域名在国内易连接超时。建议清空此处直接使用内置国内极速域名 (music.terrysky.fun)；若继续保存，请确保处于代理网络。');
                      }
                      setSyncServerUrl(serverUrl);
                      alert(serverUrl ? `✅ 自建节点已保存：\n${serverUrl}` : '✅ 已清除自建节点，将默认使用国内极速永久云 (music.terrysky.fun)');
                    }}
                    style={{ height: 30, padding: '0 10px', fontSize: 12, borderRadius: 6, background: 'rgba(255,255,255,0.08)' }}
                  >
                    保存节点
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void importFavorites(file);
                      e.target.value = '';
                    }
                  }}
                  accept=".json"
                  style={{ display: 'none' }}
                />
                <button
                  className="primary-btn"
                  onClick={async () => {
                    setIsSyncing(true);
                    try {
                      await syncFavoritesNow();
                    } finally {
                      setIsSyncing(false);
                    }
                  }}
                  disabled={isSyncing}
                  style={{ height: 32, padding: '0 12px', fontSize: 12, borderRadius: 6, gap: 4 }}
                >
                  <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
                  <span>{isSyncing ? '同步中' : '立即双向同步'}</span>
                </button>
                <button
                  className="primary-btn"
                  onClick={async () => {
                    await uploadFavoritesNow();
                  }}
                  style={{ height: 32, padding: '0 12px', fontSize: 12, borderRadius: 6, gap: 4, background: 'rgba(255,255,255,0.08)' }}
                  title="仅上传当前本地收藏覆盖云端"
                >
                  <ArrowUpCircle size={13} />
                  <span>仅备份到云端</span>
                </button>
                <button
                  className="primary-btn"
                  onClick={async () => {
                    await restoreFavoritesNow();
                  }}
                  style={{ height: 32, padding: '0 12px', fontSize: 12, borderRadius: 6, gap: 4, background: 'rgba(255,255,255,0.08)' }}
                  title="仅从云端拉取覆盖本地收藏"
                >
                  <ArrowDownCircle size={13} />
                  <span>从云端强制恢复</span>
                </button>
                <button
                  className="primary-btn"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ height: 32, padding: '0 12px', fontSize: 12, borderRadius: 6, gap: 4, background: 'rgba(255,255,255,0.08)' }}
                >
                  <Upload size={13} />
                  <span>从文件导入</span>
                </button>
                <button
                  className="primary-btn"
                  onClick={exportFavorites}
                  style={{ height: 32, padding: '0 12px', fontSize: 12, borderRadius: 6, gap: 4, background: 'rgba(255,255,255,0.08)' }}
                >
                  <Download size={13} />
                  <span>导出备份文件</span>
                </button>
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>清理数据索引</span>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                清除本地导入和收藏记录，不会删除任何磁盘上的音乐或歌词文件。
              </p>
            </div>
            <button
              className="primary-btn"
              onClick={handleClearCache}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                boxShadow: 'none',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                height: 36,
                padding: '0 16px',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>清除索引</span>
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid #f59e0b', background: 'rgba(245, 158, 11, 0.03)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={18} style={{ color: '#f59e0b', flex: 'none' }} />
          <h4 style={{ color: '#f59e0b', margin: 0, fontSize: 14 }}>免责声明与服务说明</h4>
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)', margin: 0 }}>
          在线解析数据来自第三方公开网络服务（GD音乐台、星之阁等），仅用于个人学习交流演示。本软件不存储或传播任何在线音频，资源版权归原作者所有。
        </p>
      </div>
    </div>
  );
};
