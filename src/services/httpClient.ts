import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

export const DEFAULT_HTTP_TIMEOUT_MS = 10000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export interface UniversalFetchOptions extends RequestInit {
  timeoutMs?: number;
  connectTimeout?: number;
  proxy?: { all?: string; http?: string; https?: string };
}

/**
 * 跨平台通用 HTTP 请求封装。
 * 桌面/Android 走 Tauri Rust HTTP，Web 预览走本地代理；
 * 统一挂载 AbortController 超时与 connectTimeout，确保超时主动触发 fetch_cancel 释放底层连接。
 */
export async function universalFetch(
  url: string,
  options: UniversalFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    connectTimeout = DEFAULT_CONNECT_TIMEOUT_MS,
    signal: externalSignal,
    proxy,
    ...restOptions
  } = options;

  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    if (isTauri) {
      const tauriOptions: Record<string, any> = {
        ...restOptions,
        signal: controller.signal,
        connectTimeout,
      };
      if (proxy) {
        tauriOptions.proxy = proxy;
      }
      return await tauriFetch(url, tauriOptions);
    }

    const proxyUrl = "/api/proxy?url=" + encodeURIComponent(url);
    return await fetch(proxyUrl, {
      ...restOptions,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err: any) {
    if (timedOut && err?.name === "AbortError") {
      throw new Error(`HTTP request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}
