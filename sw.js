/* ============================================================
   sw.js —— Service Worker 缓存层
   目标：让 34 MB 的 DuckDB-WASM 引擎 + 34 张 parquet 数据表在
         第二次访问时几乎零下载（Cache API 命中）。
   策略：
     · wasm / worker / parquet / html / js / css / json / png →
       Cache-First（静态资源，不变化，命中缓存最快）
     · 其它跨源资源 → 网络直通
   缓存键：URL（同版本内容）；版本切换通过 SW_VERSION 手动清空。
   ============================================================ */

const SW_VERSION = 'v11-lit-peace-backfill';
const CACHE_NAME = 'nobel-kg-' + SW_VERSION;

// 需要缓存的静态资源前缀（本站同源）
const STATIC_PREFIXES = [
  'lib/duckdb/',       // wasm + worker（34 MB）
  'lib/',              // 其它 js bundle
  'data/',             // parquet + manifest.json（0.5 MB）
  'js/',               // 前端 ES 模块
  'css/',
  'viz/',              // 独立可视化页面
  'fonts/',
];
const BINARY_EXTS = ['.wasm', '.wasm.br', '.worker.js', '.parquet', '.json', '.png', '.jpg', '.svg', '.ico', '.woff2', '.woff', '.ttf'];

/** 是否要缓存这个请求 */
function shouldCache(req) {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname.replace(/^\//, '');
  // index.html 自身
  if (path === '' || path === 'index.html') return true;
  // 命中静态资源前缀
  return STATIC_PREFIXES.some(p => path.startsWith(p));
}

/** 大文件写入缓存失败时（如 wasm 34MB 超出 SW quota）静默降级，
 *  不缓存但不阻断响应 —— 二次访问会退化到浏览器 HTTP 缓存 */
async function tryCachePut(cache, req, resp) {
  try { await cache.put(req, resp); } catch (_) { /* 超配额时忽略 */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll([
      './',
      './index.html',
      './data/manifest.json',
      './data/knowledge.sqlite',
      './lib/sqljs/sql-wasm.js',
      './lib/sqljs/sql-wasm.wasm',
      './lib/langgraph.bundle.js',
    ]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('nobel-kg-') && k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (!shouldCache(req)) return;  // 其它请求走默认网络

  // Cache-First：命中就用缓存，未命中则拉网络并写入缓存
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        // 只缓存 2xx 且内容非空
        if (resp && resp.ok && resp.status === 200 && resp.body) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);  // 网络失败回退到旧的缓存（若有）
    })
  );
});
