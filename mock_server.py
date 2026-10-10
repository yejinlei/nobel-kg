#!/usr/bin/env python3
"""
mock_server.py —— 本地测试用 mock OpenAI 兼容端点 + 静态文件服务器
=============================================================
目的：零真 Key 地完整验证 LangGraph 流程。

行为：
- GET  /*      → 静态文件（同目录，index.html / js/* / data/* / viz/*）
- POST /v1/chat/completions → 一个"会调工具"的假模型：
    · 第一轮：看到问题就返回 tool_calls（用关键词粗略判断意图并选工具）
    · 工具结果回来后：返回一条假装"综合了工具结果"的中文回答（流式返回）
    · 如果问题包含 "深度研究/前沿" 等关键词，第一轮返回 content=null, tool_calls 触发调工具；
      后续在 compose 时返回流式文本
- 这样可以真实跑通 plan → act → compose 的整条 LangGraph 状态图。

注意：仅用于本地测试，不要部署到公网（没有任何安全限制）。
启动：
    python3 mock_server.py 8000
    浏览器打开 http://localhost:8000
    在设置里填 baseUrl=http://localhost:8000/v1，model=mock，apiKey=any（随便填）
"""
import json, sys, re, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path

ROOT = Path(__file__).parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

# 简易工具选择：根据用户问题返回相应 tool_calls
def guess_tools(q):
    n = q.lower()
    calls = []
    def add(name, args):
        calls.append({
            "id": f"call_{len(calls)+1}",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}
        })

    # 识别两个人名
    if re.search(r'和|到|之间|隔几代|路径|相隔|几代人', q) and re.search(r'[A-Za-z\u4e00-\u9fff]{2,}', q):
        # 简单抓两个中文人名（基于关键词）
        names = re.findall(r'[杨振宁玻尔索末菲海森堡卢瑟福费米玻恩泡利狄拉克戴塞罗思卡甘硖合宪三纳格尔黑格曼钱永佑克里克沃森佩鲁茨查德威克泰勒拉比居里汤姆孙布拉格鲍林皮埃尔]{2,5}', q)
        uniq = []
        for x in names:
            if x not in uniq: uniq.append(x)
        if len(uniq) >= 2:
            add("两点师承路径", {"from": uniq[0], "to": uniq[1]})
            return calls

    if any(k in q for k in ["预测", "潜力", "最可能"]):
        add("诺奖潜力预测", {})
        return calls
    if any(k in q for k in ["排名", "产出", "培养最多", "最多诺奖"]):
        add("导师产出力排名", {})
        return calls
    if any(k in q for k in ["学派"]):
        add("学派查询", {})
        return calls
    if any(k in q for k in ["论文", "代表作", "著作", "时滞", "期刊"]):
        # 抓人名
        for k in ["杨振宁","玻尔","索末菲","卡甘","克里克","戴塞罗思","海森堡","卢瑟福","硖合宪三"]:
            if k in q:
                add("论文查询", {"person": k}); return calls
        add("论文查询", {})
        return calls
    if any(k in q for k in ["师承", "门下", "弟子", "学生", "导师", "师从", "老师", "祖先", "跟谁"]):
        for k in ["杨振宁","玻尔","索末菲","海森堡","卢瑟福","卡甘","费米","玻恩","泡利","戴塞罗思","克里克","硖合宪三","钱永佑"]:
            if k in q:
                direction = "向下" if any(x in q for x in ["学生","门下","弟子","培养","带出"]) else "向上"
                add("查师承链", {"person": k, "direction": direction})
                return calls
    if any(k in q for k in ["总览", "统计", "概况", "多少人"]):
        add("网络统计", {})
        return calls
    if any(k in q for k in ["合作", "合著"]):
        add("合作网络", {}); return calls
    if any(k in q for k in ["流动", "国籍"]):
        add("人才流动分析", {}); return calls
    if any(k in q for k in ["范式"]):
        add("研究范式", {}); return calls
    if any(k in q for k in ["订正", "修正"]):
        add("数据订正记录", {}); return calls
    # 单人 → 人物画像
    for k in ["杨振宁","玻尔","索末菲","海森堡","卢瑟福","费米","玻恩","泡利","卡甘","硖合宪三","钱永佑","克里克","沃森","佩鲁茨","查德威克","戴塞罗思","纳格尔","黑格曼","泰勒","鲍林","拉比","居里","汤姆孙","布拉格","狄拉克"]:
        if k in q:
            add("人物画像", {"person": k})
            return calls
    add("网络统计", {})
    return calls


MIME = {
    ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
    ".js":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
    ".parquet":"application/octet-stream", ".png":"image/png", ".jpg":"image/jpeg",
    ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff2":"font/woff2",
    ".ttl":"text/turtle; charset=utf-8", ".md":"text/markdown; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # 简洁日志
        sys.stderr.write("[mock] %s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/" or p == "": p = "/index.html"
        fp = (ROOT / p.lstrip("/")).resolve()
        # 防目录穿越
        try:
            fp.relative_to(ROOT)
        except ValueError:
            self.send_error(403); return
        if fp.is_dir(): fp = fp / "index.html"
        if not fp.exists():
            self.send_error(404, f"not found: {p}"); return
        ext = fp.suffix.lower()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        # 静态资源允许跨域（本地 mock 无意义，但为了一致）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(fp, "rb") as f:
            self.wfile.write(f.read())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if not u.path.endswith("/chat/completions"):
            self.send_error(404); return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_error(400, "bad json"); return
        msgs = body.get("messages") or []
        stream = bool(body.get("stream"))

        # 判断是否处于工具调用后（messages 里有 role=tool）
        has_tool_result = any(m.get("role") == "tool" for m in msgs)
        user_q = ""
        for m in reversed(msgs):
            if m.get("role") == "user":
                user_q = m.get("content") or ""
                # 过滤掉我们塞的研究 notes
                if "【联网检索结果" in user_q:
                    continue
                break

        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        if stream:
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self._stream_reply(has_tool_result, user_q, msgs)
        else:
            # 先算出完整响应体，再带 Content-Length 发送，避免客户端等不到消息体结尾
            data = self._reply(has_tool_result, user_q, msgs)
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def _reply(self, has_tool_result, user_q, msgs):
        if not has_tool_result:
            # 第一步：返回 tool_calls
            calls = guess_tools(user_q)
            return {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "mock",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": None, "tool_calls": calls},
                    "finish_reason": "tool_calls",
                }],
            }
        # 工具结果回来了：给一个简短的总结
        tool_texts = []
        for m in msgs:
            if m.get("role") == "tool":
                try:
                    c = m.get("content")
                    obj = json.loads(c)
                    if isinstance(obj, dict) and obj.get("text"):
                        tool_texts.append(obj["text"][:300])
                except Exception:
                    pass
        answer = (
            "（本地 Mock 模型）我已根据本体论数据查询了相关结果，以下是基于工具返回的事实整理：\n\n" +
            ("\n\n---\n\n".join(tool_texts) if tool_texts else "（工具未返回文本结果，请查看结构化数据。）") +
            "\n\n> 提示：这是本地 Mock 端点的固定回答，仅用于验证 LangGraph 工具调用链路正常。"
            "真实模型请填入 OpenRouter 等真实接口地址。"
        )
        return {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "mock",
            "choices": [{"index":0, "message": {"role":"assistant", "content": answer}, "finish_reason":"stop"}],
        }

    def _stream_reply(self, has_tool_result, user_q, msgs):
        # 流：先发 tool_calls（如果需要），或发文字 delta
        def send(ev):
            self.wfile.write(("data: " + json.dumps(ev, ensure_ascii=False) + "\n\n").encode("utf-8"))
            self.wfile.flush()

        if not has_tool_result:
            calls = guess_tools(user_q)
            # 流式下 tool_calls 需分 delta 发
            msg = {"role":"assistant","content":None}
            tc_delta = []
            for i,c in enumerate(calls):
                tc_delta.append({
                    "index": i,
                    "id": c["id"],
                    "type": "function",
                    "function": {
                        "name": c["function"]["name"],
                        "arguments": c["function"]["arguments"],
                    }
                })
            # 一次性发完（mock 不做细粒度分片）
            send({
                "id":"chatcmpl-mock","object":"chat.completion.chunk","created":int(time.time()),"model":"mock",
                "choices":[{"index":0,"delta":msg,"finish_reason":None}]
            })
            send({
                "id":"chatcmpl-mock","object":"chat.completion.chunk","created":int(time.time()),"model":"mock",
                "choices":[{"index":0,"delta":{"tool_calls": tc_delta},"finish_reason":None}]
            })
            send({
                "id":"chatcmpl-mock","object":"chat.completion.chunk","created":int(time.time()),"model":"mock",
                "choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]
            })
            send("[DONE]")
            return

        # 工具回来：流式吐字
        reply = (
            "（本地 Mock 模型）我已根据本体论数据查询了相关结果，以下是基于工具返回的事实整理。\n\n"
            "由于你目前连接的是本地 mock 端点，我不会做真正的综合推理，"
            "请查看工具返回的结构化结果；接入真实模型（如 OpenRouter 上的 GPT-4o-mini）后会自动启用多步推理与自然语言回答。"
        )
        # 按字发送，模拟流式
        send({"id":"chatcmpl-mock","object":"chat.completion.chunk","created":int(time.time()),"model":"mock",
              "choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":None}]})
        for ch in reply:
            send({"id":"chatcmpl-mock","object":"chat.completion.chunk","created":int(time.time()),"model":"mock",
                  "choices":[{"index":0,"delta":{"content":ch},"finish_reason":None}]})
            time.sleep(0.005)
        send({"id":"chatcmpl-mock","object":"chat.completion.chunk","created":int(time.time()),"model":"mock",
              "choices":[{"index":0,"delta":{},"finish_reason":"stop"}]})
        send("[DONE]")


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[mock] Mock OpenAI 端点 + 静态文件服务已启动：http://127.0.0.1:{PORT}")
    print(f"[mock]   静态文件根: {ROOT}")
    print(f"[mock]   OpenAI 兼容端点: http://127.0.0.1:{PORT}/v1/chat/completions")
    print(f"[mock]   浏览器打开 http://localhost:{PORT} ，")
    print(f"[mock]   在设置里填 baseUrl=http://localhost:{PORT}/v1  model=mock  apiKey=任意值，即可测试 LLM 路径。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[mock] 已停止。")

if __name__ == "__main__":
    main()
