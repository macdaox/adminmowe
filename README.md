# 默维高颜整家定制 - 后端（微信云托管）

本目录是小程序的后端服务，提供内容管理与公开 API：
- 公开 API：小程序前端读取轮播图、案例、设计师、关于、联系等内容；提交预约表单
- 管理 API + 管理页：后台系统（网页）用于登录、上传图片、维护内容与线索

## 本地启动

```bash
cd admin
npm i
ADMIN_TOKEN=dev-admin-token PORT=3000 npm run dev
```

打开：
- 管理页：http://localhost:3000/
- 健康检查：http://localhost:3000/healthz

## 环境变量

- `PORT`：监听端口（本地可用 3000；云托管建议与服务端口一致，通常为 80）
- `ADMIN_TOKEN`：管理接口 Token（用于 Bearer Token 鉴权），不配置时默认 `dev-admin-token`
- `ADMIN_EMAIL`：后台登录邮箱（默认 `admin@example.com`）
- `ADMIN_PASSWORD`：后台登录密码（生产环境必须配置；本地开发默认 `admin123`）
- `STORE_PATH`：文件存储模式下的数据文件路径（默认 `admin/data/store.json`）
- `CLOUD_ENV_ID`：云开发环境 ID（用于后台上传图片走“云托管对象存储/云存储 SDK”时需要；建议设置为你的环境 ID）
- `CLOUD_UPLOAD_TIMEOUT_MS`：云存储上传超时（毫秒，默认 15000）
- `CLOUD_UPLOAD_RETURN_TEMP_URL`：是否在上传后生成临时预览链接（`1` 开启；默认不开启，避免超时）

MySQL（云托管 MySQL，配置后自动切换为 MySQL 存储）：
- `MYSQL_HOST`（或云托管提供的 `MYSQL_ADDRESS`，形如 `10.x.x.x:3306`）
- `MYSQL_PORT`（可选，默认 3306；使用 `MYSQL_ADDRESS` 时可不填）
- `MYSQL_USER`（或云托管提供的 `MYSQL_USERNAME`）
- `MYSQL_PASSWORD`（部分环境可能叫 `MYSQL_PASS`）
- `MYSQL_DATABASE`
- `MYSQL_POOL_SIZE`（可选）

对象存储 / 云存储（用于后台上传图片）：
- `COS_BUCKET`
- `COS_REGION`
- `COS_PUBLIC_BASE_URL`（可选：自定义公网访问前缀，例如 CDN 域名或存储桶自定义域名）
- `COS_CREDENTIALS_TIMEOUT_MS`（可选：获取临时凭证超时，默认 8000）
- `WXCLOUDRUN_OPENAPI_BASE`（可选：云调用基地址，默认 `http://api.weixin.qq.com`）
- `WXCLOUDRUN_OPENAPI_TIMEOUT_MS`（可选：云调用接口超时，默认 2000）
- `WXCLOUDRUN_DISABLE_METADATA_CREDENTIALS`（可选：是否禁用 metadata 获取凭证，默认 `1` 禁用；云托管推荐保持禁用）

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

管理页：`/`（后台系统 SPA）

鉴权方式：
- 登录：`POST /api/admin/login`（body：`{ email, password }`）
- 后续请求：`Authorization: Bearer <token>`（token 为登录返回值）

后台常用接口（均为 Bearer Token 鉴权）：
- `GET /api/admin/me`
- `GET /api/admin/stats`
- `GET/PUT /api/admin/settings`
- `GET /api/admin/leads`
- `GET/POST/PUT/DELETE /api/admin/home-banners|home-navs|home-services|home-advantages|cases|designers|about-infos|about-history`
- `POST /api/admin/upload`：上传图片到对象存储（form-data：`file`）

## 微信云托管部署提示

- 推荐将 GitHub 仓库只放 `admin/` 目录内容（按你的拆分要求）
- 云托管构建方式选择 Dockerfile（本目录已提供 `Dockerfile`）
- 在云托管环境变量里设置 `ADMIN_TOKEN`（不要用默认值）
- 部署后得到的服务域名，配置到小程序前端的 `API_BASE_URL`
