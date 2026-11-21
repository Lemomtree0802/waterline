# 后端 API

程序与 AI 调用使用独立的版本化接口，见 [AI API](ai-api.md)；网页账号窗口可创建和撤销 API Key。其成绩与网页玩家混排，支持官方关卡与工坊自由挑战。`GET /api/ai/v1/openapi.json` 提供机器可读契约。

API 与网页同源。写请求携带 `X-Waterline-Request: 1`；联网适配器同时发送当前账号的 `X-Waterline-Player`，避免其他窗口切换 Cookie 后写入错误账号。Origin 必须匹配部署配置，不开放跨域写入。

会话由 HttpOnly、SameSite Cookie 维持，正式环境同时使用 Secure。公开玩家 ID 为唯一用户名，内部 UUID 不作为排行榜的展示 ID。

| 请求 | 用途 |
| --- | --- |
| `GET /api/health` | `{ok:true,mode:"online"}` |
| `GET /api/session` | 当前账号，访客返回 null |
| `GET /api/me/api-keys` | 登录后查看自己的密钥元数据，不返回完整密钥或摘要 |
| `POST /api/me/api-keys` | `{name}` 创建密钥，完整 key 只在本次响应返回 |
| `DELETE /api/me/api-keys/:id` | 撤销自己的密钥；API Key 本身不能访问这些管理接口 |
| `GET /api/bootstrap` | 公共关卡、自己的最佳精确成绩/操作/实时名次、私人草稿和偏好。progress/completions 始终为空，不恢复旧尝试 |
| `POST /api/auth/register` | `{username,password}`，注册并登录 |
| `POST /api/auth/login` | `{username,password}`，登录 |
| `POST /api/auth/logout` | 退出 |
| `GET /api/levels` | 未删除的官方及工坊关卡；不返回目标分数、极限、作者成绩或参考解法 |
| `POST /api/runs` | `{key,moves}`，重放计算精确水量；只在改善最佳时替换唯一记录及操作序列；返回 improved、record、rank、leaderboard |
| `GET /api/levels/:key/leaderboard?offset=0&limit=25` | 提交后解锁；limit 为 1–50，offset 非负。返回 rank、mine、total、unlocked、offset、limit、records |
| `GET /api/players?q=...` | 按公开玩家 ID 搜索，最多 20 个结果 |
| `GET /api/players/:username` | 玩家资料、作品及成绩；比当前查看者更高的分数仍隐藏，未提交者看不到分数 |
| `PUT /api/me/draft` | `{puzzle,revision}`，允许空白、单节点、未连通草稿；不接受用户命名或通关水量，description 是留给玩家的话 |
| `PATCH /api/me/preferences` | 保存数字格式等偏好 |
| `POST /api/levels` | `{puzzle,moves,draftRevision}`，验证图及操作后发布；服务端按 author_sequence 生成玩家ID-序号，不自动提交个人成绩 |
| `DELETE /api/levels/:key` | 仅作者可删除自己的工坊关卡；软删除后不可继续访问或提交，序号不复用，历史成绩保留 |
| `GET /api/events?key=...` | SSE 的 score、catalog、resync 事件 |
| `PUT /api/me/progress/:key` | 旧自动保存接口返回 410，不写入尝试 |
| `POST /api/me/import-local` | 旧尝试导入返回 410，需要重新挑战并显式提交 |

`key` 采用 `id@version`，路径使用 encodeURIComponent。moves 为规范化边数组的下标序列。公开题面只有初始水量、连线和计分圆圈，不包含目标分数或参考操作。公开内容中的关卡名称由服务端生成，不信任作者上传的名称、ID、序号、精选标志或分数。

排行榜 records 的每行为 `{rank,playerId,score,hidden,isMine}`。playerId 为公开用户名。当前玩家排名为 R 时，rank<R 的 score 为 null；其他行返回精确分数字符串。没有提交记录时 unlocked 为 false、records 为空。自己的 mine 可包含自己的最佳操作；其他玩家的行不包含操作、内部记录 ID 或提交时间。玩家资料接口使用同样的分数遮挡规则，不能借资料页绕过排行榜。

同分采用密集排名，首次达到该精确水量的时间仅用于同名次内的显示顺序，不改变名次。重复或较低成绩保留原最佳水量、操作和时间。独立草稿采用 revision 乐观并发控制；发布只清空内容与版本均匹配的草稿。作者序号使用数据库事务锁分配，包含已删除作品，防止并发重号和删除后复用。

现有最佳记录及其 moves 原样保留；不再将旧尝试自动变成最佳成绩。历史 progress/completions 表未删除。工坊精选使用 featured_at 字段预留，当前没有自动审核算法或公开修改精选的接口。

典型错误：400 输入或操作非法，401 需要登录，403 来源或归属校验失败，404 玩家/关卡不存在，409 账号切换或版本冲突，410 旧保存流程已停用，429 请求频繁，503 服务暂不可用。错误体为 `{message}`。
