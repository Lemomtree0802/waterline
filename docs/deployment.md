# 使用 Docker Compose 部署 Waterline

`compose.yaml` 会从源码构建 `app`，并启动 PostgreSQL 17 服务 `db`。宿主机需要 Docker Engine、Compose v2 插件、Git、OpenSSL、curl 和一个可配置 HTTPS 的域名。应用、游戏静态文件和 API 一起打包，Node.js 在容器内运行。

## 1. 下载并配置

以下命令在 Linux 服务器上执行。安装好 Docker 后，克隆源码并进入仓库目录。

```sh
git clone --branch master https://github.com/Lemomtree0802/waterline.git
cd waterline
docker compose version
openssl rand -hex 32
```

在仓库根目录创建 `.env`，把生成的密码和自己的域名填进去。只让部署账号读取这个文件。

```dotenv
DB_PASSWORD=替换为上一步生成的十六进制密码
PUBLIC_ORIGIN=https://waterline.example.com
VERIFICATION_WORKERS=2
```

- `DB_PASSWORD` 同时用于初始化 PostgreSQL 和应用连接。已有数据库卷继续使用初始化时的数据库密码。
- `PUBLIC_ORIGIN` 填玩家实际访问的 HTTPS 地址，只填写协议、域名和端口。有非默认端口时带上端口，地址末尾省略 `/`。
- `VERIFICATION_WORKERS` 是成绩校验线程数，可省略，Compose 默认使用 2。
- 生产使用 `compose.yaml`。`compose.dev.yaml` 只启动供本地 Node.js 开发使用的数据库。

## 2. 构建并启动

在仓库根目录运行以下命令。第一次启动时，应用会创建数据库表并写入官方关卡。

```sh
chmod 600 .env
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl -fsS http://127.0.0.1:4174/api/health
```

`app` 和 `db` 应显示为健康，健康接口应返回 `{"ok":true,"mode":"online"}`。应用只绑定宿主机的 `127.0.0.1:4174`。PostgreSQL 通过 Compose 内部网络访问，数据存放在 `database-data` 卷中。

## 3. 配置 HTTPS 入口

把域名解析到服务器。在 Nginx 或 OpenResty 中为该域名配置 HTTPS 证书，并把整站代理到 Waterline。宿主机上的代理和使用 host 网络的代理容器都可以通过 `http://127.0.0.1:4174` 访问应用。

使用 1Panel 时，可在面板终端执行上面的 Compose 命令，再在「网站」中新建反向代理站点并启用 HTTPS。如通过面板创建编排，选择源码目录中的 `compose.yaml` 并让编排读取同一目录的 `.env`。管理已有实例时，继续使用原来的编排项目名，以便挂载原数据库卷。

如果 OpenResty 在独立的 Docker 桥接网络中，先把它接入 Compose 创建的 `waterline-network`，然后将代理目标设为 `http://waterline-app:3000`。`1panel-openresty` 请替换为实际容器名。

```sh
docker inspect --format '{{.HostConfig.NetworkMode}}' 1panel-openresty
docker network connect waterline-network 1panel-openresty
```

把下面的配置放到该域名的 HTTPS 站点中。在 1Panel 里编辑已有的 `location /`，按代理的网络模式填写 `proxy_pass`。

```nginx
location / {
    proxy_pass http://127.0.0.1:4174;
    proxy_set_header Host $http_host;
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

关闭代理缓冲后，排行榜的实时通知可以及时到达浏览器。如果多个玩家共用代理 IP 且遇到登录限流，可在 `.env` 中把 `TRUST_PROXY` 配置为实际反向代理的精确 IP 或受控网段，并重建 `app`。OpenResty 容器重建后，检查它是否仍连接到 `waterline-network`。

## 4. 验证部署

用实际域名替换下方的示例域名。

```sh
curl -fsS https://waterline.example.com/api/health
curl -fsS -o /dev/null https://waterline.example.com/api/ai/v1/openapi.json
```

然后在浏览器打开 HTTPS 地址，注册或登录，提交一次关卡成绩。刷新页面后再去选关，确认能看到刚才保存的最佳成绩。需要验证 AI 调用时，在「玩家账号 → API Key」创建密钥，然后按 [AI API 文档](ai-api.md) 发起挑战。

如果健康接口失败，先用 `docker compose ps` 查看容器状态，再用 `docker compose logs --tail=100 app db` 查看错误。宿主机的健康接口可用而域名返回 502 时，检查代理目标和 Docker 网络。

## 5. 备份与更新

更新前先备份 PostgreSQL。在仓库目录运行以下命令，备份保存到仓库之外的目录。

```sh
umask 077
backup_dir="$HOME/waterline-backups"
backup_name="waterline-$(date -u +%Y%m%dT%H%M%SZ).dump"
mkdir -p "$backup_dir"
docker compose exec -T db pg_dump -U waterline -d waterline -Fc -f "/tmp/$backup_name" &&
docker compose cp "db:/tmp/$backup_name" "$backup_dir/$backup_name" &&
docker compose exec -T db rm "/tmp/$backup_name"
```

备份含有玩家数据和密码哈希，限制访问并保留一份异地副本。备份成功后更新应用。

```sh
git pull --ff-only origin master
docker compose up -d --build --wait app
curl -fsS http://127.0.0.1:4174/api/health
```

在原目录沿用同一 Compose 项目名更新时，重建应用会继续使用原数据库卷。保留玩家数据时，避免使用会删除卷的 `docker compose down -v`。

## 6. 恢复到空数据库

在已配置 `.env` 的新实例上恢复。先只启动 `db`，让 `waterline` 数据库保持空白，完成恢复后再启动 `app`。把示例文件名换成实际的备份路径。

```sh
backup_file="$HOME/waterline-backups/实际备份文件.dump"
docker compose up -d --wait db &&
docker compose cp "$backup_file" db:/tmp/waterline-restore.dump &&
docker compose exec -T db pg_restore --single-transaction --no-owner -U waterline -d waterline /tmp/waterline-restore.dump &&
docker compose exec -T db rm /tmp/waterline-restore.dump &&
docker compose up -d --build --wait app
```

恢复后按第 4 节验证，并登录已有账号确认成绩和工坊作品。

## 运行参数

`VERIFICATION_WORKERS` 接受 1–16 的整数。每次请求最多 16 MiB，单个校验任务最多运行 30 秒，最多有 128 个任务在队列里等待。应用实例通过 PostgreSQL 的 `LISTEN/NOTIFY` 同步榜单和工坊更新，登录限流按应用实例计数。

官方关卡的 `id@version` 用于关联成绩和操作记录。更新题面时提高版本号，以便保留旧记录。

Compose 命令和备份工具的选项可查阅 [Docker Compose 文档](https://docs.docker.com/reference/cli/docker/compose/up/) 和 [PostgreSQL 恢复文档](https://www.postgresql.org/docs/17/app-pgrestore.html)。
