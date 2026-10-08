import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { MOLAN_SOURCE_SCRIPT } from "../sources/molanSource";

const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

/**
 * 跨平台通用 HTTP 请求实现（与 musicApi 保持一致，桌面/移动端直连，Web端走代理）
 */
async function universalFetch(url: string, options?: any): Promise<Response> {
  if (isTauri) {
    return await tauriFetch(url, options);
  } else {
    const proxyUrl = "/api/proxy?url=" + encodeURIComponent(url);
    return await fetch(proxyUrl, options);
  }
}

type LxRequestHandler = (params: {
  source: string;
  action: string;
  info: {
    type: string;
    musicInfo: {
      songmid: string;
      id: string;
      name: string;
      singer: string;
      hash?: string;
      [key: string]: any;
    };
  };
}) => Promise<string | { url: string; [key: string]: any }>;

class LxSourceEngine {
  private initialized = false;
  private requestHandler: LxRequestHandler | null = null;
  public sourceName = "墨澜聚合音源 v4.5.1";
  public sourceStatus = "就绪 (支持酷我/QQ/网易/酷狗/咪咕)";

  /**
   * 初始化并启动洛雪沙箱运行环境
   */
  public init() {
    if (this.initialized) return;

    try {
      const mockLx = {
        EVENT_NAMES: {
          request: "request",
        },
        request: (url: string, options: any, callback: (err: any, resp?: any) => void) => {
          const method = (options?.method || "GET").toUpperCase();
          const headers = { ...(options?.headers || {}) };
          if (!headers["User-Agent"]) {
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
          }

          const fetchOptions: any = {
            method,
            headers,
          };

          if (options?.body) {
            fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
          }

          universalFetch(url, fetchOptions)
            .then(async (resp) => {
              const text = await resp.text();
              const headerObj: Record<string, string> = {};
              resp.headers.forEach((val, key) => {
                headerObj[key] = val;
              });

              callback(null, {
                statusCode: resp.status,
                headers: headerObj,
                body: text,
              });
            })
            .catch((err) => {
              callback(err);
            });
        },
        on: (event: string, handler: any) => {
          if (event === "request") {
            this.requestHandler = handler;
          }
        },
        send: () => {},
        utils: {
          buffer: {
            from: (data: any, enc?: any) => {
              const nodeBuf = (globalThis as any).Buffer;
              if (nodeBuf && typeof nodeBuf.from === "function") {
                return nodeBuf.from(data, enc);
              }
              // 浏览器端轻量 Uint8Array 兼容
              if (typeof data === "string") {
                return new TextEncoder().encode(data);
              }
              return new Uint8Array(data);
            },
          },
        },
        env: isTauri ? "desktop" : "mobile",
        version: "2.0.0",
        currentScriptInfo: {
          rawScript: MOLAN_SOURCE_SCRIPT,
        },
      };

      // 挂载到全局 globalThis
      (globalThis as any).lx = mockLx;

      // 在安全沙箱作用域内运行脚本
      const runner = new Function("globalThis", "lx", MOLAN_SOURCE_SCRIPT);
      runner(globalThis, mockLx);

      this.initialized = true;
      console.log(`[LXEngine] ${this.sourceName} 初始化成功！`);
    } catch (err: any) {
      console.warn(`[LXEngine] 初始化失败:`, err);
      this.sourceStatus = `加载失败: ${err.message || err}`;
    }
  }

  /**
   * 将系统音质映射为洛雪音源档位
   */
  private mapQuality(quality: string): string[] {
    switch (quality) {
      case "hires":
        return ["flac24bit", "flac", "320k", "128k"];
      case "lossless":
        return ["flac", "320k", "128k"];
      case "high":
        return ["320k", "128k"];
      case "standard":
      default:
        return ["128k", "320k"];
    }
  }

  /**
   * 将系统平台名转换为洛雪平台代码
   */
  private mapPlatform(platform: string): string {
    switch (platform) {
      case "kuwo":
        return "kw";
      case "netease":
        return "wy";
      case "tencent":
        return "tx";
      case "kugou":
        return "kg";
      case "migu":
        return "mg";
      default:
        return platform;
    }
  }

  /**
   * 通过洛雪音源解析真实音频直链
   * @param platform 歌曲来源 (kuwo, netease, tencent, kugou, migu)
   * @param song 歌曲信息
   * @param quality 音质 (standard, high, lossless, hires)
   */
  public async getSongUrl(
    platform: string,
    song: { id: string; url_id?: string; name: string; artist: string; [key: string]: any },
    quality: string = "high"
  ): Promise<string | null> {
    if (!this.initialized) {
      this.init();
    }

    if (!this.requestHandler) {
      return null;
    }

    const lxPlatform = this.mapPlatform(platform);
    const qualityTiers = this.mapQuality(quality);
    const songId = song.url_id || song.id;

    for (const q of qualityTiers) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 8000)
        );

        const parsePromise = this.requestHandler({
          source: lxPlatform,
          action: "musicUrl",
          info: {
            type: q,
            musicInfo: {
              songmid: songId,
              id: songId,
              name: song.name,
              singer: song.artist,
              hash: songId, // 酷狗音乐 hash
            },
          },
        });

        const res = await Promise.race([parsePromise, timeoutPromise]);
        let finalUrl: string | null = null;
        if (typeof res === "string") {
          finalUrl = res;
        } else if (res && typeof res.url === "string") {
          finalUrl = res.url;
        }

        if (finalUrl && finalUrl.startsWith("http")) {
          console.log(`[LXEngine] 成功为 [${song.name}] (${platform}) 解析出直链 (${q})`);
          return finalUrl;
        }
      } catch (err: any) {
        // 继续尝试下一个降级音质档位
      }
    }

    return null;
  }
}

export const lxSourceEngine = new LxSourceEngine();
