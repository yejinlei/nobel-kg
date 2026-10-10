/* ============================================================
   render.js —— 输出渲染层
   支持：Markdown 文本 / 表格 / 动态图表（SVG 柱状、环形）/ 内嵌图谱 iframe
   全部本地实现，无第三方依赖。
   ============================================================ */

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------- Markdown ------------------------- */

function inlineFmt(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

function splitTableRow(line) {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}

function isSepRow(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

export function renderMarkdown(src) {
  const lines = String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push('<p>' + inlineFmt(para.join(' ')) + '</p>');
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块
    if (/^```/.test(trimmed)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      flush();
      const header = splitTableRow(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        body.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(tableHtml(header, body));
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const lv = h[1].length;
      out.push(`<h${lv}>${inlineFmt(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    // 引用
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + inlineFmt(buf.join(' ')) + '</blockquote>');
      continue;
    }

    // 列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((t) => '<li>' + inlineFmt(t) + '</li>').join('') + `</${tag}>`);
      continue;
    }

    if (trimmed === '') { flush(); i++; continue; }

    para.push(trimmed);
    i++;
  }
  flush();
  return out.join('\n');
}

export function tableHtml(columns, rows, title) {
  const head = '<tr>' + columns.map((c) => `<th>${inlineFmt(String(c))}</th>`).join('') + '</tr>';
  const body = rows.map((r) => {
    const cells = Array.isArray(r) ? r : columns.map((c) => r[c]);
    return '<tr>' + cells.map((c) => `<td>${inlineFmt(c == null ? '' : String(c))}</td>`).join('') + '</tr>';
  }).join('');
  const cap = title ? `<div class="chart-title">${escapeHtml(title)}</div>` : '';
  return `${cap}<div class="table-wrap"><table>${head}${body}</table></div>`;
}

/* ------------------------- 图表（SVG） ------------------------- */

const PALETTE = ['#2f5fd0', '#d0502f', '#2f9d6a', '#8b5cd6', '#e0a020', '#3aa6b9', '#c2508f', '#6b7a8f'];

function fmtNum(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function barChartSVG(data, opts = {}) {
  const items = (data || []).filter((d) => d && d.value != null);
  if (!items.length) return '<p style="color:#8b93a1">暂无数据</p>';
  const W = opts.width || 600;
  const rowH = opts.rowHeight || 26;
  const gap = 7;
  const padTop = 8, padBottom = 8;
  const padLeft = opts.labelWidth || 150;
  const padRight = 64;
  const H = padTop + padBottom + items.length * (rowH + gap) - gap;
  const max = Math.max(...items.map((d) => Math.abs(Number(d.value) || 0)), 1);
  const plotW = Math.max(40, W - padLeft - padRight);
  const color = opts.color || PALETTE[0];

  let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.title || '柱状图')}">`;
  items.forEach((d, i) => {
    const y = padTop + i * (rowH + gap);
    const v = Number(d.value) || 0;
    const w = Math.max(2, Math.round((plotW * Math.abs(v)) / max));
    const label = String(d.label == null ? '' : d.label);
    const shown = label.length > 12 ? label.slice(0, 11) + '…' : label;
    s += `<text x="${padLeft - 9}" y="${y + rowH * 0.7}" text-anchor="end" font-size="12.5" fill="#5b6675">${escapeHtml(shown)}</text>`;
    s += `<rect x="${padLeft}" y="${y}" width="${plotW}" height="${rowH}" rx="4" fill="#eef2f8"/>`;
    s += `<rect x="${padLeft}" y="${y}" width="${w}" height="${rowH}" rx="4" fill="${d.color || color}"/>`;
    s += `<text x="${padLeft + plotW + 8}" y="${y + rowH * 0.7}" font-size="12.5" font-weight="600" fill="#1a2028">${escapeHtml(fmtNum(v))}</text>`;
  });
  s += '</svg>';
  return s;
}

export function pieChartSVG(data, opts = {}) {
  const items = (data || []).filter((d) => d && Number(d.value) > 0);
  if (!items.length) return '<p style="color:#8b93a1">暂无数据</p>';
  const total = items.reduce((a, d) => a + Number(d.value), 0);
  const W = opts.width || 600;
  const R = 78, r = 46;
  const cx = 96, cy = Math.max(100, items.length * 15 + 20);
  const H = Math.max(200, items.length * 26 + 24);
  const cyy = H / 2;

  let ang = -Math.PI / 2;
  let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.title || '环形图')}">`;
  items.forEach((d, i) => {
    const frac = Number(d.value) / total;
    const a2 = ang + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const color = d.color || PALETTE[i % PALETTE.length];
    if (frac >= 0.9999) {
      s += `<circle cx="${cx}" cy="${cyy}" r="${(R + r) / 2}" fill="none" stroke="${color}" stroke-width="${R - r}"/>`;
    } else {
      const x1 = cx + R * Math.cos(ang), y1 = cyy + R * Math.sin(ang);
      const x2 = cx + R * Math.cos(a2), y2 = cyy + R * Math.sin(a2);
      const x3 = cx + r * Math.cos(a2), y3 = cyy + r * Math.sin(a2);
      const x4 = cx + r * Math.cos(ang), y4 = cyy + r * Math.sin(ang);
      s += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${color}"/>`;
    }
    ang = a2;
  });
  s += `<text x="${cx}" y="${cyy - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="#1a2028">${escapeHtml(fmtNum(total))}</text>`;
  s += `<text x="${cx}" y="${cyy + 16}" text-anchor="middle" font-size="11.5" fill="#8b93a1">合计</text>`;

  const legendX = 210;
  items.forEach((d, i) => {
    const y = 30 + i * 26;
    const color = d.color || PALETTE[i % PALETTE.length];
    const pct = ((Number(d.value) / total) * 100).toFixed(1);
    s += `<rect x="${legendX}" y="${y - 10}" width="11" height="11" rx="2.5" fill="${color}"/>`;
    s += `<text x="${legendX + 18}" y="${y}" font-size="12.5" fill="#1a2028">${escapeHtml(String(d.label))}</text>`;
    s += `<text x="${W - 12}" y="${y}" text-anchor="end" font-size="12.5" fill="#5b6675">${escapeHtml(fmtNum(d.value))}（${pct}%）</text>`;
  });
  s += '</svg>';
  return s;
}

/* ------------------------- 拼装 ------------------------- */

/**
 * 把结构化块渲染为 HTML
 * 块类型：markdown | table | bar | pie | viz
 */
export function renderBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (!b) return '';
    switch (b.type) {
      case 'markdown':
        return renderMarkdown(b.text);
      case 'table':
        return tableHtml(b.columns || Object.keys(b.rows?.[0] || {}), b.rows || [], b.title);
      case 'bar':
        return `<div class="chart-block">${b.title ? `<div class="chart-title">${escapeHtml(b.title)}</div>` : ''}${barChartSVG(b.data, b.opts)}</div>`;
      case 'pie':
        return `<div class="chart-block">${b.title ? `<div class="chart-title">${escapeHtml(b.title)}</div>` : ''}${pieChartSVG(b.data, b.opts)}</div>`;
      case 'viz':
        return vizEmbed(b);
      case 'html':
        return b.html || '';
      default:
        return '';
    }
  }).join('\n');
}

/** 内嵌图谱页面 */
export function vizEmbed(b) {
  const src = b.src;
  const head = `<div class="viz-embed-head"><span>${escapeHtml(b.title || '图谱')}</span><a href="${escapeHtml(src)}" target="_blank" rel="noopener">在新窗口打开 ↗</a></div>`;
  const h = b.height || 560;
  return `<div class="viz-embed">${head}<iframe src="${escapeHtml(src)}" height="${h}" loading="lazy" title="${escapeHtml(b.title || '图谱')}"></iframe></div>`;
}

/** 工具调用痕迹折叠块 */
export function renderTrace(steps) {
  if (!steps || !steps.length) return '';
  const inner = steps.map((s) => {
    const label = s.label ? escapeHtml(s.label) : '';
    const detail = s.detail ? `<div>${escapeHtml(s.detail)}</div>` : '';
    return `<div class="trace-step"><span class="trace-tool">${escapeHtml(s.tool || '查询')}</span>${label ? ' · ' + label : ''}${detail}</div>`;
  }).join('');
  return `<details class="trace-block"><summary>🔎 本体查询过程（${steps.length} 步）</summary><div class="trace-inner">${inner}</div></details>`;
}
