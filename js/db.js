/* ============================================================
   db.js —— DuckDB-WASM 数据层
   在浏览器本地加载本体论 Parquet 数据并执行 SQL。
   所有路径基于 document.baseURI 解析，因此在
   https://<user>.github.io/<repo>/ 这类子路径下同样可用。
   ============================================================ */

import * as duckdb from '../lib/duckdb.bundle.js';

let DB = null;
let CONN = null;
let READY = false;
let TABLE_INFO = [];
let initPromise = null;   // 幂等锁：并发调用共享同一次初始化

export function isReady() { return READY; }
export function getTableInfo() { return TABLE_INFO; }

/** 初始化进行中/已完成的 Promise，供调用方在需要时 await */
export function initReady() { return initPromise || Promise.resolve(); }

/** 基于本模块 URL 解析资源地址（db.js 位于 js/ 下，资源在项目根）；
 *  用 import.meta.url 而非 document.baseURI，保证 viz/ 等子目录页面调用时
 *  data/ 与 lib/duckdb/ 路径仍然解析到站点根，兼容 GitHub Pages 子路径 */
function assetUrl(relPath) {
  return new URL('../' + relPath, import.meta.url).href;
}

/** Cache Storage 包装：把重复访问的 WASM/Parquet 字节写入浏览器缓存。
 *  失败静默降级——不能因为缓存 API 不可用而影响主流程。 */
async function cachedFetch(url, opts = {}) {
  try {
    if (window.caches) {
      const cache = await caches.open('nobel-kg-v1');
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await fetch(url, opts);
      if (res && res.ok) {
        try { await cache.put(url, res.clone()); } catch (_) {}
      }
      return res;
    }
  } catch (_) { /* 缓存读写失败则回退到普通 fetch */ }
  return fetch(url, opts);
}

/** 读取数据清单 */
async function fetchManifest() {
  const res = await cachedFetch(assetUrl('data/manifest.json'), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`数据清单 data/manifest.json 加载失败（HTTP ${res.status}）`);
  return res.json();
}

/** 把 Arrow 值转成可安全序列化的普通值 */
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (typeof v.toString === 'function' && v.constructor && v.constructor.name === 'Decimal') return Number(v.toString());
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  return v;
}

/**
 * 初始化数据库（幂等）
 * 并发调用共享同一次初始化；已就绪时立即 resolve。
 * @param {(msg:string)=>void} onProgress 进度回调（用于界面提示）
 */
export function initDB(onProgress) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (READY) return;
    const log = (m) => { try { onProgress && onProgress(m); } catch (_) {} };

    log('正在读取数据清单…');
    const manifest = await fetchManifest();
    const names = Object.keys(manifest);

    log('正在初始化浏览器内数据库引擎（WASM 约 40MB，首次下载后由浏览器缓存）…');
  // 使用本地 WASM/Worker 资源，避免依赖 CDN 与跨域问题
  const bundles = duckdb.getJsDelivrBundles();
  // 覆盖为本地路径
  const mvpWasm = assetUrl('lib/duckdb/duckdb-mvp.wasm');
  const mvpWorker = assetUrl('lib/duckdb/duckdb-browser-mvp.worker.js');
  const ehWasm = assetUrl('lib/duckdb/duckdb-eh.wasm');
  const ehWorker = assetUrl('lib/duckdb/duckdb-browser-eh.worker.js');
  const localBundles = {
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
    // 兜底：若运行环境被判定为跨源隔离（COI），同样指向已本地化的资源，
    // 避免取到不存在的文件而初始化失败
    coi: { mainModule: ehWasm, mainWorker: ehWorker },
  };
  let bundle = await duckdb.selectBundle(localBundles);
  if (!bundle || !bundle.mainModule) bundle = localBundles.eh;

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(workerUrl);

  let logger = null;
  try {
    logger = new duckdb.ConsoleLogger();
  } catch (_) {
    logger = null;
  }

  DB = new duckdb.AsyncDuckDB(logger, worker);
  await DB.instantiate(bundle.mainModule, bundle.prelude);

  log('正在装载本体论数据表…');
  CONN = await DB.connect();

  // 注册全部 Parquet 文件
  for (const name of names) {
    const url = assetUrl(`data/${name}.parquet`);
    await DB.registerFileURL(`${name}.parquet`, url, duckdb.DuckDBDataProtocol.HTTP, false);
  }

  // 物化为本地表（数据量小，物化后查询更快、SQL 更简洁）
  for (const name of names) {
    await CONN.query(`CREATE OR REPLACE TABLE "${name}" AS SELECT * FROM "${name}.parquet"`);
  }

  // 记录行数，供界面展示
  TABLE_INFO = [];
  for (const name of names) {
    try {
      const r = await CONN.query(`SELECT count(*) AS c FROM "${name}"`);
      const cnt = Number(r.toArray()[0].c);
      TABLE_INFO.push({ name, rows: cnt, source: manifest[name].source || '' });
    } catch (_) {
      TABLE_INFO.push({ name, rows: 0, source: manifest[name].source || '' });
    }
  }

    READY = true;
    log('数据库就绪');
  })().catch((err) => {
    // 初始化失败：释放锁以便后续重试，同时把异常抛给调用方
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/** 执行 SQL，返回 { columns, rows } */
export async function query(sql) {
  if (!READY) throw new Error('数据库尚未就绪');
  const result = await CONN.query(sql);
  const columns = result.schema.fields.map((f) => f.name);
  const rows = result.toArray().map((row) => {
    const o = {};
    for (const f of result.schema.fields) o[f.name] = normalizeValue(row[f.name]);
    return o;
  });
  return { columns, rows };
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
