/* ============================================================
   db.js —— 浏览器端 SQL 数据层（SQLite-WASM 实现）

   从 DuckDB-WASM 迁移到 sql.js 的原因：
     · DuckDB-WASM ~ 34 MB，编译耗时 30-60 秒；
     · SQLite-WASM (sql.js) ~ 650 KB wasm + 48 KB js，2-3 秒就绪；
     · 33 张表 9000 行数据一次性装进内存（2 MB sqlite 文件），查询更快。

   数据加载流程：
     1. initSqlJs → 加载 wasm（一次）；
     2. fetch('data/knowledge.sqlite') → Uint8Array（2 MB，Brotli 后 ~ 700 KB）；
     3. new SQL.Database(buffer) → 数据库已完全在内存中；
     4. 所有 SQL 查询通过 sqlite3 API 执行。

   API 与旧版本完全兼容，main.js / agent.js / tools.js 无需修改调用方式。
   ============================================================ */

/* sql.js 是 UMD 模块，浏览器里 window.initSqlJs 是主导出。
   这里通过 window.__initSqlJs 显式挂载，再异步取用。 */

let DB = null;
let READY = false;
let TABLE_INFO = [];
let initPromise = null;   // 幂等锁：并发 initDB 调用共享同一次初始化
let initProgress = null;  // 最近一次注册的进度回调

export function isReady() { return READY; }
export function getTableInfo() { return TABLE_INFO; }

/**
 * 返回一个"总是 resolve"的初始化 Promise，用于首次提问时等待 DB 就绪。
 */
export function initReady() {
  if (READY) return Promise.resolve();
  if (!initPromise) {
    initPromise = initDB(initProgress);
    initPromise.catch(() => { initPromise = null; });
  }
  return initPromise;
}

/** 资源路径：基于 db.js 所在目录解析，兼容 GitHub Pages 子路径 */
function assetUrl(relPath) {
  return new URL('../' + relPath, import.meta.url).href;
}

async function loadSqlJs() {
  // 幂等：多次调用只加载一次
  if (window.__initSqlJs) return window.__initSqlJs;
  if (!window.__sqlJsLoading) {
    window.__sqlJsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = assetUrl('lib/sqljs/sql-wasm.js');
      s.onload = () => {
        if (typeof window.initSqlJs !== 'function') {
          reject(new Error('sql.js 加载后未提供 initSqlJs'));
        } else {
          window.__initSqlJs = window.initSqlJs;
          resolve(window.__initSqlJs);
        }
      };
      s.onerror = () => reject(new Error('sql.js 脚本加载失败'));
      document.head.appendChild(s);
    });
  }
  return window.__sqlJsLoading;
}

async function fetchManifest() {
  const res = await fetch(assetUrl('data/manifest.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`数据清单加载失败（HTTP ${res.status}）`);
  return res.json();
}

/**
 * 初始化数据库
 * @param {(msg:string)=>void} onProgress 进度回调
 */
export async function initDB(onProgress) {
  if (READY) return;
  if (initPromise) {
    if (onProgress) initProgress = onProgress;
    return initPromise;
  }
  if (onProgress) initProgress = onProgress;
  initPromise = (async () => {
    try { await runInit(onProgress || initProgress); }
    finally { if (!READY) initPromise = null; }
  })();
  return initPromise;
}

/** 实际的初始化过程 */
async function runInit(onProgress) {
  if (READY) return;
  const log = (m) => { try { onProgress && onProgress(m); } catch (_) {} };

  log('正在初始化 SQLite 引擎（WASM 约 640 KB）…');
  const initSqlJs = await loadSqlJs();
  const SQL = await initSqlJs({
    locateFile: (file) => assetUrl('lib/sqljs/' + file),
  });

  log('正在下载本体数据（约 2 MB SQLite，Brotli 压缩后约 700 KB）…');
  const res = await fetch(assetUrl('data/knowledge.sqlite'), { cache: 'default' });
  if (!res.ok) throw new Error(`knowledge.sqlite 加载失败（HTTP ${res.status}）`);
  const buf = new Uint8Array(await res.arrayBuffer());

  log('正在装载 33 张本体论数据表…');
  DB = new SQL.Database(buf);

  // 启用 WAL-less 高性能模式（sqlite 全在内存，无需持久化）
  DB.exec('PRAGMA query_only = ON');
  DB.exec('PRAGMA temp_store = MEMORY');

  log('正在读取数据清单…');
  const manifest = await fetchManifest();
  TABLE_INFO = [];
  for (const name of Object.keys(manifest)) {
    const c = DB.exec(`SELECT count(*) AS c FROM "${name}"`);
    const rows = c.length && c[0].values.length ? Number(c[0].values[0][0]) : 0;
    TABLE_INFO.push({ name, rows, source: (manifest[name] && manifest[name].source) || '' });
  }

  READY = true;
  log('数据库就绪');
}

/** 值规范化：BigInt → Number，其它直接透传 */
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** 执行 SQL，返回 { columns, rows }；rows 是对象数组 */
export async function query(sql) {
  if (!READY) throw new Error('数据库尚未就绪');
  const stmt = DB.prepare(sql);
  const cols = stmt.getColumnNames();
  const rows = [];
  while (stmt.step()) {
    const obj = stmt.getAsObject();
    // 逐字段规范化（BigInt → Number）
    for (const k of Object.keys(obj)) obj[k] = normalizeValue(obj[k]);
    rows.push(obj);
  }
  stmt.free();
  return { columns: cols, rows };
}

/** 取单值辅助 */
export async function scalar(sql) {
  const r = await query(sql);
  if (!r.rows.length) return null;
  const first = r.rows[0];
  const k = Object.keys(first)[0];
  return first[k];
}

/** 供界面显示的总体统计 */
export async function overview() {
  const one = async (sql) => {
    try { return Number(await scalar(sql)) || 0; } catch (_) { return 0; }
  };
  return {
    persons: await one('SELECT count(*) FROM persons'),
    laureates: await one('SELECT count(*) FROM laureates'),
    core_laureates: await one("SELECT count(*) FROM laureates WHERE in_core_network = '是'"),
    mentorships: await one('SELECT count(*) FROM mentorship'),
    schools: await one('SELECT count(*) FROM schools'),
    papers: await one('SELECT count(*) FROM papers'),
    paradigms: await one('SELECT count(*) FROM paradigms'),
    collaborations: await one('SELECT count(*) FROM collaboration'),
    fields: await one('SELECT count(*) FROM fields'),
    prizes: await one('SELECT count(*) FROM prizes'),
  };
}
