# 默维高颜整家定制 - 后端（微信云托管）

本目录是小程序的后端服务，提供内容管理与公开 API：
- 公开 API：小程序前端读取轮播图、案例、设计师、关于、联系等内容；提交预约表单
- 管理 API + 管理页：在 `/admin/` 用 JSON 方式编辑内容（需要 Token）

## 本地启动

```bash
cd admin
npm i
ADMIN_TOKEN=dev-admin-token PORT=3000 npm run dev
```

打开：
- 管理页：http://localhost:3000/admin/
- 健康检查：http://localhost:3000/healthz

## 环境变量

- `PORT`：监听端口（默认 3000）
- `ADMIN_TOKEN`：管理接口 Token（请求头 `x-admin-token`），不配置时默认 `dev-admin-token`
- `ADMIN_USERNAME`：后台登录用户名（默认 `admin`）
- `ADMIN_PASSWORD`：后台登录密码（生产环境必须配置；本地开发默认 `admin123456`）
- `STORE_PATH`：文件存储模式下的数据文件路径（默认 `admin/data/store.json`）

MySQL（云托管 MySQL，配置后自动切换为 MySQL 存储）：
- `MYSQL_HOST`
- `MYSQL_PORT`（可选，默认 3306）
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `MYSQL_POOL_SIZE`（可选）

对象存储 COS（用于后台上传图片，配置后管理页可直接上传）：
- `COS_BUCKET`
- `COS_REGION`
- `COS_PUBLIC_BASE_URL`（可选：自定义公网访问前缀，例如 CDN 域名或存储桶自定义域名）

凭证说明：
- 微信云托管运行环境通常会注入临时凭证，后端会自动从运行环境获取（无需手动配置 SecretId/SecretKey）
- 如需在本地直接连 COS 调试，可额外配置 `COS_SECRET_ID` / `COS_SECRET_KEY`（或使用 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`）

## 公开 API（小程序使用）

- `GET /api/public/site`：全局品牌信息
- `GET /api/public/home`：首页所需数据（轮播、导航、热门案例、服务、优势、页脚等）
- `GET /api/public/cases?style=现代简约`：案例列表（可选 style 过滤，`全部` 返回全量）
- `GET /api/public/designers`：设计师列表
- `GET /api/public/about`：关于页数据
- `GET /api/public/contact`：联系页数据
- `POST /api/public/appointments`：提交预约
  - body：`{ name, phone, community, area, demand }`

## 管理（后台编辑内容）

管理页：`/admin/`（内部会调用管理 API，需要 Token）

管理 API（需要请求头 `x-admin-token`）：
- `GET /api/admin/section/:key`：读取模块（key 可用：`site|home|cases|designers|about|contact|appointments`）
- `PUT /api/admin/section/:key`：保存模块（appointments 通过预约提交写入，不建议手改）
- `POST /api/admin/reset`：全量恢复默认数据
- `POST /api/admin/upload`：上传图片到对象存储（form-data：`file`，返回 `url`）

## 微信云托管部署提示

- 推荐将 GitHub 仓库只放 `admin/` 目录内容（按你的拆分要求）
- 云托管构建方式选择 Dockerfile（本目录已提供 `Dockerfile`）
- 在云托管环境变量里设置 `ADMIN_TOKEN`（不要用默认值）
- 部署后得到的服务域名，配置到小程序前端的 `API_BASE_URL`
