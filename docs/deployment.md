# 1Panel 部署

推荐使用 Docker Compose 运行 Node.js 与 PostgreSQL，由 1Panel 的 OpenResty 提供域名和 HTTPS。游戏页面、字体和 API 随同一个镜像发布，数据库单独使用持久化卷。

## 首次部署

1. 把代码放在服务器固定目录，例如 `/opt/waterline`。使用 Git 克隆或上传源码都可以。
2. 在该目录新建 `.env`，不要提交到 Git。生成一个足够长的随机十六进制密码，例如 `openssl rand -hex 32`，填入下方；十六进制字符可直接用于数据库连接 URL。

   ```dotenv
   DB_PASSWORD=这里填生成的随机十六进制密码
   PUBLIC_ORIGIN=https://你的游戏域名
   VERIFICATION_WORKERS=2
   ```

   `PUBLIC_ORIGIN` 必须与玩家访问的 HTTPS 地址完全一致，不要带末尾 `/`。生产环境使用 Secure、HttpOnly 会话 Cookie。域名变更时需修改此值并重建 app 容器。

3. 在目录中执行 `docker compose up -d --build`，或在 1Panel「容器 → 编排」中以该目录和 `compose.yaml` 创建编排。首次启动会自动创建表并写入官方关卡。确认 app 和 db 均健康。
4. 在 1Panel 创建反向代理网站，绑定域名并申请 HTTPS 证书。只保留 HTTPS 作为玩家入口。
5. 如果 OpenResty 容器使用独立网络，把它接入已有的 `waterline-network` 网络，代理目标设置为 `http://waterline-app:3000`。可以通过 1Panel 的容器网络设置操作；也可以执行 `docker network connect waterline-network <实际的OpenResty容器名>`。在该容器重建后确认网络仍连接。独立网络中的 `127.0.0.1` 指向该容器自身。
6. 如果 OpenResty 直接在宿主机运行，或容器的网络模式为 `host`，代理目标设置为 `http://127.0.0.1:4174`。可用 `docker inspect <实际的OpenResty容器名> --format '{{.HostConfig.NetworkMode}}'` 确认网络模式。数据库没有公开端口；应用的宿主机端口只绑定回环地址。

建议整站代理到应用，减少前端版本与 API 版本不一致的情况。代理中保留以下设置（按 1Panel 现有 location 配置合并，避免重复创建 `/`）：

```nginx
location / {
    proxy_pass http://waterline-app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 60s;
    client_max_body_size 16m;
}
```

`proxy_buffering off` 确保实时排行榜通知能及时到达。心跳间隔为 15 秒。后端在反向代理后默认不信任任意 `X-Forwarded-For`，登录限流按直接连接 IP 计算；所有访问经同一代理时会共享这个限制。可以配置 `TRUST_PROXY` 为 OpenResty 的精确 IP 或受控网段来启用真实玩家 IP；不要设为任意代理可信，也不要公开应用端口绕过 OpenResty。

## 上线检查

- 打开 `https://域名/api/health` 应返回 `{"ok":true,"mode":"online"}`。
- 注册一个玩家，操作关卡后重新登录，确认进度恢复。
- 用另一个玩家验证公共工坊可见、私人草稿不可见、排行榜自动更新。
- 确认浏览器会话 Cookie 有 Secure 和 HttpOnly，页面底部显示「已联网」。

## 更新、备份与恢复

更新前先备份：

```sh
docker compose exec -T db pg_dump -U waterline -d waterline -Fc > waterline-backup.dump
```

把备份复制到独立位置；可以在 1Panel 配置定期备份任务。随后更新 Git 工作区并执行 `docker compose up -d --build app`。应用重建不会重置数据库。不要执行 `docker compose down -v`，它会删除数据库卷。

恢复时先停止应用写入，再把备份导入准备好的空数据库：

```sh
docker compose stop app
docker compose exec -T db pg_restore -U waterline -d waterline --no-owner < waterline-backup.dump
docker compose start app
```

上述恢复命令用于空数据库；向已有数据的数据库恢复需要先规划替换方式。数据库备份包含玩家信息和密码哈希，应限制访问。

查看日志：`docker compose logs --tail=100 app`。官方题目的 `id@version` 是持久化标识；以后修改题面必须增加版本，避免历史解法对应不同图形。当前是第一版数据库结构，后续变更需添加明确的数据迁移。

## 当前范围与容量设置

第一版提供账号注册/登录/退出、进度同步、私人草稿、公开工坊、精确成绩校验和实时榜单。暂未提供邮件找回密码、账号管理后台或工坊内容管理。

步数没有游戏规则限制。单次请求最大 16 MiB，校验任务最长 30 秒，工作线程待处理队列最多 128 项；超出时返回错误，前端保留修改并允许重试。工作线程默认最多 4 个，Compose 默认 2 个，可通过 `VERIFICATION_WORKERS` 设置 1–16。成绩接口仅返回个人名次、自己的记录和提交人数；水量相同共用一个名次，不按时间分先后。名次仍按全部玩家的最佳成绩精确计算，采用内存缓存。人数或关卡数大幅增加时应做负载测试，再调整分页、缓存和资源配额。

每个应用实例使用 PostgreSQL LISTEN/NOTIFY 接收榜单与工坊更新，支持多个应用实例之间传播；登录限流目前在各实例内存中，不是共享计数器。
