//! 本机回环 HTTP Range 本地音频流媒体服务（纯 Rust 标准库，零外部依赖）。
//!
//! 解决的问题：
//! 1. Tauri `asset://` 协议单次 Range 上限仅约 1MB，会导致长音频播放中断及无法拖动进度条。
//! 2. 通过 IPC 全量读取再转 JS Blob 在 Android 端会经历 Rust -> JVM -> JS 多份内存拷贝，且易受系统内存限制。
//! 本模块在 `127.0.0.1:0` 上按需启动轻量 HTTP/1.1 服务，通过随机令牌 + 显式注册文件 ID 提供 `200`/`206 Partial Content` 分块流式读取。

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, ErrorKind, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CHUNK_SIZE: usize = 64 * 1024;
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HEADER_LINES: usize = 64;

struct StreamServerState {
    port: u16,
    token: String,
    id_to_path: Mutex<HashMap<u64, PathBuf>>,
    path_to_id: Mutex<HashMap<PathBuf, u64>>,
    next_id: AtomicU64,
}

static SERVER_STATE: OnceLock<Result<StreamServerState, String>> = OnceLock::new();

/// 生成不依赖第三方 crate 的高熵随机十六进制令牌。
fn generate_access_token() -> String {
    let mut parts = [0u64; 2];
    for slot in &mut parts {
        let mut hasher = RandomState::new().build_hasher();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        hasher.write_u128(nanos);
        hasher.write_u32(std::process::id());
        hasher.write_usize(slot as *const u64 as usize);
        *slot = hasher.finish();
    }
    format!("{:016x}{:016x}", parts[0], parts[1])
}

/// 根据文件扩展名识别音频 MIME 类型；仅放行已知音频格式。
pub fn audio_mime_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => Some("audio/mpeg"),
        "flac" => Some("audio/flac"),
        "wav" => Some("audio/wav"),
        "ogg" | "oga" => Some("audio/ogg"),
        "opus" => Some("audio/opus"),
        "m4a" | "mp4" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "webm" => Some("audio/webm"),
        "wma" => Some("audio/x-ms-wma"),
        "ape" => Some("audio/ape"),
        "aiff" | "aif" => Some("audio/aiff"),
        _ => None,
    }
}

/// 解析 HTTP `Range` 请求头，仅支持 `bytes=...` 单区间及前缀/后缀语法。
pub fn parse_range_header(range_header: &str, total_len: u64) -> Result<(u64, u64), ()> {
    if total_len == 0 {
        return Err(());
    }
    let trimmed = range_header.trim();
    let spec = trimmed
        .strip_prefix("bytes=")
        .or_else(|| trimmed.strip_prefix("BYTES="))
        .ok_or(())?;

    // HTML5 <audio> 只请求单一字节段；若出现逗号分隔的多段请求则取首段
    let first_range = spec.split(',').next().ok_or(())?.trim();
    let (start_str, end_str) = first_range.split_once('-').ok_or(())?;
    let start_str = start_str.trim();
    let end_str = end_str.trim();

    if start_str.is_empty() {
        // 后缀范围: bytes=-N
        let suffix_len: u64 = end_str.parse().map_err(|_| ())?;
        if suffix_len == 0 {
            return Err(());
        }
        let start = total_len.saturating_sub(suffix_len);
        Ok((start, total_len - 1))
    } else {
        let start: u64 = start_str.parse().map_err(|_| ())?;
        if start >= total_len {
            return Err(());
        }
        let end = if end_str.is_empty() {
            total_len - 1
        } else {
            let parsed_end: u64 = end_str.parse().map_err(|_| ())?;
            if parsed_end < start {
                return Err(());
            }
            parsed_end.min(total_len - 1)
        };
        Ok((start, end))
    }
}

fn ensure_server() -> Result<&'static StreamServerState, String> {
    let result = SERVER_STATE.get_or_init(|| {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("无法绑定本机流媒体端口: {}", e))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("获取本机流媒体端口失败: {}", e))?
            .port();
        let token = generate_access_token();

        let state = StreamServerState {
            port,
            token,
            id_to_path: Mutex::new(HashMap::new()),
            path_to_id: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        };

        thread::Builder::new()
            .name("mp3tao-local-audio-stream".to_string())
            .spawn(move || accept_loop(listener))
            .map_err(|e| format!("无法启动流媒体线程: {}", e))?;

        Ok(state)
    });

    match result {
        Ok(state) => Ok(state),
        Err(err) => Err(err.clone()),
    }
}

fn accept_loop(listener: TcpListener) {
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                // 每条连接独立线程：Chromium 媒体引擎会并发开多条连接探测文件头尾
                let _ = thread::Builder::new()
                    .name("mp3tao-audio-conn".to_string())
                    .spawn(move || {
                        let _ = handle_connection(stream);
                    });
            }
            Err(err) => {
                eprintln!("[local_stream] accept error: {}", err);
                thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

fn send_simple_response(stream: &mut TcpStream, status: &str, body: &str) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        status,
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    if !body.is_empty() {
        stream.write_all(body.as_bytes())?;
    }
    stream.flush()
}

fn handle_connection(mut stream: TcpStream) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(HEADER_READ_TIMEOUT));
    let _ = stream.set_nodelay(true);

    let cloned = stream.try_clone()?;
    let mut reader = BufReader::new(cloned);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    let mut range_header: Option<String> = None;
    for _ in 0..MAX_HEADER_LINES {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range_header = Some(val.trim().to_string());
            }
        }
    }

    // 处理可能的 CORS 预检请求
    if method.eq_ignore_ascii_case("OPTIONS") {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\nConnection: close\r\n\r\n";
        stream.write_all(resp.as_bytes())?;
        return stream.flush();
    }

    let is_head = method.eq_ignore_ascii_case("HEAD");
    if !method.eq_ignore_ascii_case("GET") && !is_head {
        return send_simple_response(&mut stream, "405 Method Not Allowed", "Method Not Allowed");
    }

    let Ok(state) = ensure_server() else {
        return send_simple_response(&mut stream, "500 Internal Server Error", "Server unavailable");
    };

    // 期望路由: /audio?token=<token>&id=<id>
    let Some((path_part, query_part)) = target.split_once('?') else {
        return send_simple_response(&mut stream, "404 Not Found", "Not Found");
    };
    if path_part != "/audio" {
        return send_simple_response(&mut stream, "404 Not Found", "Not Found");
    }

    let mut req_token = "";
    let mut req_id: Option<u64> = None;
    for kv in query_part.split('&') {
        if let Some((k, v)) = kv.split_once('=') {
            match k {
                "token" => req_token = v,
                "id" => req_id = v.parse::<u64>().ok(),
                _ => {}
            }
        }
    }

    if req_token != state.token {
        return send_simple_response(&mut stream, "403 Forbidden", "Forbidden");
    }

    let Some(file_id) = req_id else {
        return send_simple_response(&mut stream, "400 Bad Request", "Invalid id");
    };

    let file_path = {
        let map = state
            .id_to_path
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.get(&file_id).cloned()
    };

    let Some(path) = file_path else {
        return send_simple_response(&mut stream, "404 Not Found", "Audio entry not found");
    };

    let Some(mime) = audio_mime_type(&path) else {
        return send_simple_response(&mut stream, "403 Forbidden", "Unsupported audio type");
    };

    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(_) => return send_simple_response(&mut stream, "404 Not Found", "File missing"),
    };

    let total_len = file.metadata()?.len();

    if let Some(raw_range) = range_header {
        let Ok((start, end)) = parse_range_header(&raw_range, total_len) else {
            let header = format!(
                "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                total_len
            );
            stream.write_all(header.as_bytes())?;
            return stream.flush();
        };

        let content_len = end - start + 1;
        let header = format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\nConnection: close\r\n\r\n",
            mime, content_len, start, end, total_len
        );
        stream.write_all(header.as_bytes())?;
        if is_head {
            return stream.flush();
        }

        stream_file_range(&mut file, &mut stream, start, content_len)
    } else {
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\nConnection: close\r\n\r\n",
            mime, total_len
        );
        stream.write_all(header.as_bytes())?;
        if is_head || total_len == 0 {
            return stream.flush();
        }

        stream_file_range(&mut file, &mut stream, 0, total_len)
    }
}

fn stream_file_range(
    file: &mut File,
    stream: &mut TcpStream,
    start: u64,
    mut remaining: u64,
) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(start))?;
    let mut buf = [0u8; CHUNK_SIZE];

    while remaining > 0 {
        let to_read = (remaining as usize).min(CHUNK_SIZE);
        let read_bytes = file.read(&mut buf[..to_read])?;
        if read_bytes == 0 {
            break;
        }
        if let Err(err) = stream.write_all(&buf[..read_bytes]) {
            // 客户端拖拽进度条或切歌时会主动断开旧连接，属于正常行为
            if matches!(
                err.kind(),
                ErrorKind::BrokenPipe | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted
            ) {
                return Ok(());
            }
            return Err(err);
        }
        remaining -= read_bytes as u64;
    }

    let _ = stream.flush();
    Ok(())
}

/// 注册本地音频文件路径并返回本机回环 HTTP Range 流媒体播放地址。
#[tauri::command]
pub fn get_local_audio_stream_url(file_path: String) -> Result<String, String> {
    let raw = PathBuf::from(file_path.trim());
    let path = std::fs::canonicalize(&raw).unwrap_or(raw);

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("无法访问本地音频文件 {}: {}", path.display(), e))?;
    if !metadata.is_file() {
        return Err("目标路径不是有效文件".to_string());
    }

    if audio_mime_type(&path).is_none() {
        return Err(format!("不支持的音频文件类型: {}", path.display()));
    }

    let state = ensure_server()?;
    let id = {
        let mut path_map = state
            .path_to_id
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(&existing_id) = path_map.get(&path) {
            existing_id
        } else {
            let new_id = state.next_id.fetch_add(1, Ordering::Relaxed);
            let mut id_map = state
                .id_to_path
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            id_map.insert(new_id, path.clone());
            path_map.insert(path, new_id);
            new_id
        }
    };

    Ok(format!(
        "http://127.0.0.1:{}/audio?token={}&id={}",
        state.port, state.token, id
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_range_header_variants() {
        assert_eq!(parse_range_header("bytes=0-", 1000), Ok((0, 999)));
        assert_eq!(parse_range_header("bytes=100-199", 1000), Ok((100, 199)));
        assert_eq!(parse_range_header("bytes=500-5000", 1000), Ok((500, 999)));
        assert_eq!(parse_range_header("bytes=-250", 1000), Ok((750, 999)));
        assert_eq!(parse_range_header("bytes=-2000", 1000), Ok((0, 999)));
        assert_eq!(parse_range_header("bytes=1000-", 1000), Err(()));
        assert_eq!(parse_range_header("bytes=200-100", 1000), Err(()));
        assert_eq!(parse_range_header("bytes=-0", 1000), Err(()));
        assert_eq!(parse_range_header("bytes=0-", 0), Err(()));
        assert_eq!(parse_range_header("items=0-5", 1000), Err(()));
    }

    #[test]
    fn test_audio_mime_type() {
        assert_eq!(audio_mime_type(Path::new("song.MP3")), Some("audio/mpeg"));
        assert_eq!(audio_mime_type(Path::new("/a/b/c.flac")), Some("audio/flac"));
        assert_eq!(audio_mime_type(Path::new("x.m4a")), Some("audio/mp4"));
        assert_eq!(audio_mime_type(Path::new("secret.txt")), None);
        assert_eq!(audio_mime_type(Path::new("noext")), None);
    }

    #[test]
    fn test_http_range_server_end_to_end() {
        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join(format!("mp3tao_stream_test_{}.mp3", std::process::id()));
        let payload: Vec<u8> = (0u8..=255).cycle().take(2048).collect();
        std::fs::write(&test_file, &payload).expect("write test audio file");

        let url = get_local_audio_stream_url(test_file.to_string_lossy().into_owned())
            .expect("register stream url");
        assert!(url.starts_with("http://127.0.0.1:"));

        let without_scheme = url.strip_prefix("http://").unwrap();
        let (addr, path_and_query) = without_scheme.split_once('/').unwrap();
        let request_target = format!("/{}", path_and_query);

        // 1. 验证 206 Partial Content 请求（支持拖拽与任意大小范围）
        let mut conn = TcpStream::connect(addr).expect("connect to local stream server");
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: {}\r\nRange: bytes=100-355\r\nConnection: close\r\n\r\n",
            request_target, addr
        );
        conn.write_all(req.as_bytes()).unwrap();
        let mut resp = Vec::new();
        conn.read_to_end(&mut resp).unwrap();

        let header_end = resp
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .expect("http response header terminator");
        let header_str = std::str::from_utf8(&resp[..header_end]).unwrap();
        let body = &resp[header_end + 4..];

        assert!(header_str.starts_with("HTTP/1.1 206 Partial Content"));
        assert!(header_str.contains("Content-Range: bytes 100-355/2048"));
        assert!(header_str.contains("Content-Length: 256"));
        assert!(header_str.contains("Content-Type: audio/mpeg"));
        assert_eq!(body, &payload[100..=355]);

        // 2. 验证错误 token 返回 403
        let mut bad_conn = TcpStream::connect(addr).expect("connect for 403 check");
        let bad_req = "GET /audio?token=wrongtoken&id=1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
        bad_conn.write_all(bad_req.as_bytes()).unwrap();
        let mut bad_resp = String::new();
        bad_conn.read_to_string(&mut bad_resp).unwrap();
        assert!(bad_resp.starts_with("HTTP/1.1 403 Forbidden"));

        let _ = std::fs::remove_file(&test_file);
    }
}
