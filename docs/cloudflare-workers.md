# Cloudflare Workers + D1 部署

通过 OpenNext 运行完整 Next.js 应用，数据库使用 Cloudflare D1（SQLite），无需 Docker 或外部 PostgreSQL。原有 Node.js / Docker 部署仍使用 PostgreSQL，Worker 构建自动生成 SQLite Prisma Client。

## 1. 安装和创建 D1

准备 Cloudflare 账户和符合根目录 package.json engines 的 Node.js（建议 24.22.1 或更高的 24.x），在仓库根目录执行：

```sh
npm ci
cd local
npx wrangler login
npx wrangler d1 create subboost
```

复制创建结果中的 database_id，将它配置为构建 Secret `D1_DATABASE_ID`。不要把真实 ID 写入 `local/wrangler.jsonc`；该文件的全零 ID 用于本地预览和无凭据构建，binding 保持为 DB。

D1 绑定需要在部署时确定，Worker 的运行时 Secret 不能替代绑定配置。部署和远程迁移脚本从构建进程的 `D1_DATABASE_ID` 环境变量读取 UUID，生成 Git 忽略的临时 Wrangler 配置，命令结束后删除。未设置或格式不正确时会直接报错。

默认 Worker 名称为 subboost。如果修改 wrangler.jsonc 的 name，必须同步修改 services 中的 service，让 WORKER_SELF_REFERENCE 指向自身。

## 2. 配置运行时变量

继续在 local 目录执行：

```sh
npx wrangler secret put APP_URL
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put JWT_SECRET
npx wrangler secret put CRON_SECRET
npx wrangler secret put LOCAL_SETUP_TOKEN
```

| 变量 | 内容 |
| --- | --- |
| APP_URL | 实际公开 HTTPS 地址，例如 `https://subboost.<你的子域>.workers.dev` 或自定义域名 |
| ENCRYPTION_KEY | 至少 32 字符的随机加密密钥；有数据后请保存并保持稳定 |
| JWT_SECRET | 至少 32 字符的随机会话签名密钥 |
| CRON_SECRET | 随机定时任务鉴权密钥 |
| LOCAL_SETUP_TOKEN | 首次创建管理员时使用的随机初始化令牌 |
| GITHUB_TOKEN | 可选，提高 GitHub API 限流额度，同样通过 wrangler secret put 配置 |

每个密钥使用不同的随机值，可多次运行以下命令生成，不要提交真实密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

无需 DATABASE_URL 或数据库密码，Worker 通过 DB 绑定访问 D1。

## 3. 初始化并部署

回到仓库根目录执行：

PowerShell：

```powershell
cd ..
$env:D1_DATABASE_ID = '你的D1数据库UUID'
npm run db:migrate
npm run deploy
```

Bash 中先执行 `export D1_DATABASE_ID='你的D1数据库UUID'`，再执行上述 npm 命令。

db:migrate 将 `local/prisma/d1-migrations` 中的 SQLite 迁移应用到远程 D1。deploy 构建 SQLite Prisma Client、Next.js 和 Worker 后部署。已有 D1 数据时，升级前先备份。迁移不会自动导入原 PostgreSQL 数据。

只构建使用 `npm run build:worker`，不需要生产密钥、远程数据库连接或 Cloudflare 登录。

部署后打开站点，使用 LOCAL_SETUP_TOKEN 创建管理员。检查 `/api/health/ready` 应返回 HTTP 200。登录的密码哈希和订阅转换需要一定 CPU，请结合实际负载选择 Workers 套餐，当前限额见 [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)。

## Cloudflare Git 自动部署

使用 Workers Builds 连接仓库，根目录选仓库根目录：

- 安装命令：`npm ci`
- 构建命令：`npm run build:worker`
- 部署命令：`npm run deploy:worker`
- NODE_VERSION 设置为符合 engines 的版本。

在 **Worker → 设置 → 构建 → 变量和机密** 中添加类型为 Secret 的 `D1_DATABASE_ID`，值为 D1 数据库 UUID。这个 Secret 用于构建／部署进程，请勿只添加到 Worker 的运行时变量中。

先创建 D1，并在本地设置同名环境变量执行一次远程迁移。在 Worker 的运行时设置中配置 APP_URL、ENCRYPTION_KEY 等机密。后续有数据库结构变更时需先执行新迁移。

部署命令必须使用 `npm run deploy:worker`，直接运行 opennextjs-cloudflare deploy 或 wrangler deploy 不会注入真实数据库 ID。CI 的 `npm run deploy:dry-run` 可以不设置 D1_DATABASE_ID，不访问远程数据库。

## 本地 D1 预览

复制 `local/.dev.vars.example` 为 `local/.dev.vars`，填入测试密钥。然后在仓库根目录执行：

```sh
npm run db:migrate:local
npm run preview
```

默认地址为 `http://localhost:8787`，使用 `.wrangler` 下的本地 D1 数据，不访问远程数据库。普通 npm run dev 保留 PostgreSQL 开发方式，测试 D1 请使用 preview。Windows 上 OpenNext 建议在 WSL 中运行，亦可在 Cloudflare Builds 的 Linux 环境构建。

## 数据与运行说明

- D1 模型由 `local/prisma/schema.prisma` 自动转换为 SQLite schema；原 PostgreSQL 迁移与 D1 迁移分别维护。修改模型后运行 `npm run local:db:generate`，再用 Prisma migrate diff 生成后续 SQLite SQL，加入 d1-migrations，勿覆盖已部署的迁移。
- D1 不提供 Prisma 回调事务的原子保证。Worker 路径用 D1 原子 batch 保存订阅及更新状态，并检查 updatedAt 防止覆盖并发修改；首次管理员创建和任务租约使用原子条件 SQL。
- Cron 每 6 分钟刷新订阅，每小时第 3 分钟刷新规则索引，通过自身服务绑定及 CRON_SECRET 鉴权，无需 cron 容器。调度时区为 UTC。
- Workers 使用 DoH 验证订阅域名，再使用原生 fetch。每次重定向重新验证目标，保留超时及响应大小限制，global_fetch_strictly_public 提供平台公网访问限制。平台不支持访问本机或内网订阅。
- Surge / Loon / Quantumult X 解析器预编译为 JavaScript，避免 Workers 禁止的运行时 eval。修改 pegjs 语法后执行 `npm run generate:parsers` 并提交生成文件。
- 内存限流和规则缓存仅在当前 isolate 内生效。公开部署可另外配置 Cloudflare WAF 限流。大量订阅刷新仍受 Workers 和 D1 的配额及执行时间限制。

参考：[OpenNext 部署指南](https://opennext.js.org/cloudflare/get-started)、[Cloudflare D1 与 Prisma](https://developers.cloudflare.com/d1/tutorials/d1-and-prisma-orm/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
