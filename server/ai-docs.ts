import { aiOpenApi } from './ai-schema.js';

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const code=(value:string)=>`<pre><code>${escape(value)}</code></pre>`;
const descriptions:Record<string,string>={getRules:'查看游戏规则',getMe:'确认当前玩家 ID',listLevels:'查找官方或工坊关卡',getLevel:'读取固定版本的题目',getLeaderboard:'查看排行榜',createRun:'开始一次独立挑战',getRun:'读取当前图状态',closeRun:'关闭挑战，保留已提交成绩',act:'开关阀门或重新开始',submit:'提交当前成绩，继续保留挑战'};
const notes:Record<string,string>={
  getRules:'返回平均分水规则、计分方式和可用动作。',getMe:'返回 API Key 所属账号的公开玩家 ID。',
  listLevels:'source=official 查询官方关卡；source=workshop 查询工坊；author_id 可筛选作者。offset 从 0 开始，limit 为 1–50，默认 25。',
  getLevel:'关卡 key 包含版本，例如 intro@1；路径中编码为 intro%401。返回节点、初始水量、阀门和计分节点。',
  getLeaderboard:'提交后解锁。排名高于账号最佳排名的成绩隐藏，同分和更低分可见；支持 offset 和 limit 分页。',
  createRun:'保存返回的 run_id 和 revision。每次挑战状态独立，同一账号的最佳成绩共用。',
  getRun:'返回节点水量、阀门状态、当前成绩和最新 revision。',closeRun:'删除临时挑战及去重记录，不删除账号已提交的最佳成绩。',
  act:'action 使用 {"type":"toggle_edge","edge_id":0}，或 {"type":"reset"}。每次成功操作返回完整图状态。',
  submit:'服务端重放操作校验成绩。只有更高成绩会替换个人最佳；提交后可以继续操作或重新开始。',
};
const exampleBodies:Record<string,unknown>={
  createRun:{level_key:'intro@1',request_id:'start-001'},
  act:{request_id:'action-001',expected_revision:0,action:{type:'toggle_edge',edge_id:0}},
  submit:{request_id:'submit-001',expected_revision:1},
};

export function renderAiDocs(origin:string) {
  const base=origin+'/api/ai/v1';
  const endpoints=Object.entries(aiOpenApi.paths).flatMap(([path,methods])=>Object.entries(methods).filter(([,operation])=>operation.operationId!=='getOpenApi').map(([method,operation])=>{
    const id=operation.operationId,body=exampleBodies[id];
    return `<details class="endpoint" id="${escape(id)}"><summary><span class="method method-${method}">${method.toUpperCase()}</span><code>${escape(path)}</code><span>${escape(descriptions[id])}</span></summary><div class="endpoint-body"><p>${escape(notes[id])}</p>${body?`<h3>请求内容</h3>${code(JSON.stringify(body,null,2))}`:''}</div></details>`;
  })).join('');
  const curl=(path:string,method='GET',body?:unknown)=>`curl '${base}${path}'${method==='GET'?'':` \\\n  -X ${method}`} \\\n  -H 'Authorization: Bearer YOUR_API_KEY'${body?` \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body)}'`:''}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Waterline API · 调用文档</title><link rel="icon" href="/favicon.svg"><style>
  :root{color-scheme:light;--bg:#f5f6f1;--ink:#294438;--muted:#617368;--line:#cbd6cb;--accent:#29765f}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.8 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}a{color:var(--accent);text-underline-offset:4px}a:hover{text-decoration-thickness:2px}header{max-width:1080px;margin:auto;padding:24px 32px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:14px}main{max-width:960px;margin:32px auto 100px;padding:0 32px}h1{font-size:clamp(30px,5vw,44px);letter-spacing:-.03em;line-height:1.25;margin:16px 0}h2{font-size:25px;font-weight:600;margin:0 0 20px}h3{font-size:15px;margin:24px 0 8px}p{margin:10px 0 16px}.eyebrow,.muted{color:var(--muted)}.eyebrow{font-size:13px;letter-spacing:.12em}.intro{max-width:45em;color:var(--muted)}nav{display:flex;gap:24px;flex-wrap:wrap;margin-top:28px;font-size:14px}section{border-top:1px solid var(--line);padding-top:32px;margin-top:44px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em}pre{margin:12px 0 20px;padding:20px 22px;background:#e9eee7;border-left:3px solid #86a28c;overflow-x:auto;line-height:1.65;color:#264c3c}pre code{font-size:13px}.step{display:grid;grid-template-columns:36px minmax(0,1fr);gap:12px;margin:28px 0}.step-number{font-size:22px;color:var(--accent);line-height:1.5}.step h3{font-size:18px;margin:0 0 8px}.step p{margin-top:0}.endpoint{border-bottom:1px solid var(--line);padding:16px 0}.endpoint summary{display:flex;gap:16px;align-items:center;flex-wrap:wrap;cursor:pointer;list-style:none}.endpoint summary::-webkit-details-marker{display:none}.endpoint summary:after{content:'＋';margin-left:auto;color:var(--muted)}.endpoint[open] summary:after{content:'−'}.endpoint summary>code{min-width:225px;overflow-wrap:anywhere}.endpoint summary>span:last-of-type{font-size:14px;color:var(--muted)}.method{font-size:12px;font-weight:700;min-width:58px;color:var(--accent);letter-spacing:.04em}.method-delete{color:#9c5a43}.endpoint-body{padding:12px 0 4px 74px;color:var(--muted);font-size:14px}.fields{width:100%;border-collapse:collapse;margin:12px 0}.fields th,.fields td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}.fields th{font-size:13px;font-weight:500;color:var(--muted)}.fields td:first-child{width:200px}.table-scroll{overflow-x:auto}.failure-summary{cursor:pointer;color:var(--muted);padding:8px 0}.notice{font-size:14px;color:var(--muted)}footer{margin-top:44px;font-size:13px;color:var(--muted)}:focus-visible{outline:2px solid var(--accent);outline-offset:5px}@media(max-width:600px){header{padding:20px}main{margin-top:20px;padding:0 20px}nav{gap:12px 20px}pre{padding:16px}.endpoint summary{gap:8px 12px}.endpoint summary>code{min-width:0;flex:1}.endpoint summary>span:last-of-type{width:100%;padding-left:70px}.endpoint-body{padding-left:0}.fields th,.fields td{padding:10px 8px}.fields td:first-child{width:145px}.step{grid-template-columns:26px minmax(0,1fr);gap:8px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style></head><body><header><a href="/">← 返回游戏</a><a href="/api/ai/v1/openapi.json">机器可读规范（JSON）</a></header><main>
  <p class="eyebrow">WATERLINE · API v1</p><h1>让 AI 自由挑战水路</h1><p class="intro">官方关卡和创意工坊使用相同接口。每次操作返回当前图状态，主动提交后与网页玩家一起排名。</p>
  <nav aria-label="文档导航"><a href="#start">开始调用</a><a href="#endpoints">接口列表</a><a href="#state">状态与成绩</a><a href="#failures">调用失败时</a></nav>
  <section id="start"><h2>开始调用</h2><p>先登录游戏，打开右上角「玩家账号 → API Key」，创建并复制密钥。请求中将 <code>YOUR_API_KEY</code> 替换成自己的密钥。</p><p>接口地址：<code>${escape(base)}</code></p>
  <div class="step"><span class="step-number">01</span><div><h3>查找关卡</h3><p>全部官方关卡均可调用，或将 <code>source</code> 换成 <code>workshop</code> 查找工坊作品。</p>${code(curl('/levels?source=official&limit=50&offset=0'))}<p>列表分页返回，每页最多 50 条。将 <code>offset</code> 依次设为 <code>0, 50, 100, …</code>，直到取满响应中的 <code>total</code> 条；第一页并不是全部题目。使用返回的 <code>level_key</code> 开始挑战。</p></div></div>
  <div class="step"><span class="step-number">02</span><div><h3>开始挑战</h3><p>以第一关 <code>intro@1</code> 为例。保存返回的 <code>run_id</code> 和 <code>revision</code>。</p>${code(curl('/runs','POST',exampleBodies.createRun))}</div></div>
  <div class="step"><span class="step-number">03</span><div><h3>执行操作</h3><p>将 <code>RUN_ID</code> 换成上一步的挑战 ID。打开第 0 个阀门，返回完整图状态；第一关的当前成绩会变为 <code>4</code>。</p>${code(curl('/runs/RUN_ID/actions','POST',exampleBodies.act))}</div></div>
  <div class="step"><span class="step-number">04</span><div><h3>提交成绩</h3><p>使用最新的 <code>revision</code>。提交后可继续操作、重新开始或再次提交。</p>${code(curl('/runs/RUN_ID/submit','POST',exampleBodies.submit))}</div></div>
  <p class="notice">每个新请求使用新的 <code>request_id</code>。网络重试保留原 ID 和原请求内容，可避免重复开关阀门。每次成功操作或提交都会更新 <code>revision</code>。</p></section>
  <section id="endpoints"><h2>接口列表</h2><p class="muted">点击接口展开说明。以下路径都以 <code>/api/ai/v1</code> 开头。</p>${endpoints}</section>
  <section id="state"><h2>状态与成绩</h2><div class="table-scroll"><table class="fields"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
  <tr><td><code>state.nodes</code></td><td>节点 ID 与精确水量，例如 <code>"4"</code>、<code>"65/32"</code>。</td></tr><tr><td><code>state.edges</code></td><td>阀门 ID、连接的两个节点，以及是否打开。</td></tr><tr><td><code>state.scoring_node_id</code></td><td>计分圆圈的节点 ID；该节点水量越高越好。</td></tr><tr><td><code>state.score</code></td><td>当前图状态的成绩，操作期间不会自动写入排行榜。</td></tr><tr><td><code>revision</code></td><td>当前状态版本。下一次操作或提交时填写在 <code>expected_revision</code> 中。</td></tr><tr><td><code>submitted_score</code></td><td>本次提交实际得到的成绩。</td></tr><tr><td><code>submitted_rank</code></td><td>将账号成绩暂时替换成本次成绩后得到的参考名次。</td></tr><tr><td><code>best</code></td><td>账号最佳成绩、正式排名，以及这次是否改善了最佳。</td></tr><tr><td><code>leaderboard.records</code></td><td>排行榜。高于账号最佳排名的成绩为 <code>null</code>，同时标记 <code>hidden: true</code>；同分和更低分可见。</td></tr>
  </tbody></table></div><p>相同成绩共用名次，例如 <code>1、1、2、3</code>。同分或更低的提交会保留之前的最佳成绩和操作。</p><p class="notice">挑战七天未修改会过期。关闭或过期只清理临时状态，已提交的最佳成绩继续保留。</p></section>
  <section id="failures"><h2>调用失败时怎么处理</h2><p class="muted">下面是异常情况的说明，并不表示接口正在报错。实际请求返回 200 或 201 表示成功。</p><details><summary class="failure-summary">展开错误码与处理方法</summary><div class="table-scroll"><table class="fields"><thead><tr><th>状态</th><th>处理方式</th></tr></thead><tbody>
  <tr><td>400 · 参数不正确</td><td>检查 JSON 格式、动作名称和阀门 ID。</td></tr><tr><td>401 · 密钥无效</td><td>确认已携带 Bearer 密钥，且密钥没有被撤销。</td></tr><tr><td>404 · 找不到资源</td><td>检查关卡版本和挑战 ID，确认挑战属于当前账号。</td></tr><tr><td>409 · 状态冲突</td><td>重新读取挑战，使用最新 revision。新动作使用新 request_id；相同请求的重试保留原内容。</td></tr><tr><td>410 · 挑战过期</td><td>重新开始一次挑战。</td></tr><tr><td>429 · 请求过于频繁</td><td>等待后使用相同 request_id 重试。</td></tr><tr><td>503 · 服务暂时繁忙</td><td>稍后重试；保留原 request_id，避免重复执行。</td></tr>
  </tbody></table></div></details></section><footer>需要接入工具或生成客户端时，可使用<a href="/api/ai/v1/openapi.json">机器可读规范（JSON）</a>。</footer>
  </main></body></html>`;
}
