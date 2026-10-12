// 一次性构建脚本：为大型 wasm/js 生成 Brotli 预压缩副本
// 用法: node scripts/build_br.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TARGETS = [
  // 新 SQLite-WASM 数据层（主用）
  'lib/sqljs/sql-wasm.wasm',
  'lib/sqljs/sql-wasm.js',
  'data/knowledge.sqlite',
  // LangGraph Agent 运行时
  'lib/langgraph.bundle.js',
  'lib/world-110m.json',
  // 旧 DuckDB-WASM（保留但不再被 db.js 引用；预压缩以防某些可视化页面仍需要）
  'lib/duckdb/duckdb-eh.wasm',
  'lib/duckdb/duckdb-mvp.wasm',
  'lib/duckdb/duckdb-browser-eh.worker.js',
  'lib/duckdb/duckdb-browser-mvp.worker.js',
  'lib/duckdb.bundle.js',
];

const QUALITY = 11;

console.log('Brotli 预压缩 (quality=' + QUALITY + ')');
console.log('='.repeat(64));

let totalOrig = 0, totalBr = 0;
for (const rel of TARGETS) {
  const abs = path.join(__dirname, '..', rel);
  if (!fs.existsSync(abs)) { console.log('SKIP', rel); continue; }
  const orig = fs.statSync(abs).size;
  const buf = fs.readFileSync(abs);
  const br = zlib.brotliCompressSync(buf, {
    [zlib.constants.BROTLI_PARAM_QUALITY]: QUALITY,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: orig,
  });
  const brPath = abs + '.br';
  fs.writeFileSync(brPath, br);
  const pct = (100 * br.length / orig).toFixed(1);
  console.log(
    rel.padEnd(48),
    (orig / 1e6).toFixed(2).padStart(6) + ' MB ->',
    (br.length / 1e6).toFixed(2).padStart(6) + ' MB',
    '(' + pct + '%)'
  );
  totalOrig += orig;
  totalBr += br.length;
}

console.log('-'.repeat(64));
console.log(
  'TOTAL'.padEnd(48),
  (totalOrig / 1e6).toFixed(2).padStart(6) + ' MB ->',
  (totalBr / 1e6).toFixed(2).padStart(6) + ' MB',
  '(' + (100 * totalBr / totalOrig).toFixed(1) + '%)'
);
