# MP3 部署和提交步骤

代码已经实现用户和任务的全部 CRUD 接口、查询参数、字段校验、双向引用同步和事务回滚。`npm test` 会启动独立的临时 MongoDB 副本集，通过 HTTP 测试 API，不连接你的 Atlas 数据库；首次测试可能需要下载 MongoDB 二进制文件。正式运行需要你自己的 Atlas 连接字符串。

## 1. 创建 MongoDB Atlas 数据库

1. 登录 [MongoDB Atlas](https://cloud.mongodb.com/)，创建一个项目和 **Free / M0** 集群。
2. 在 **Database Access** 创建数据库用户，设置用户名和密码，并授予 `mp3` 数据库的读写权限。这个用户与 Atlas 网站登录账号不同。
3. 在 **Network Access → Add IP Address** 选择 **Allow Access from Anywhere**，即 `0.0.0.0/0`。这是本作业 README 指定的配置。
4. 集群页面点击 **Connect → Drivers → Node.js**，复制 `mongodb+srv://...` 连接字符串。替换数据库用户名和密码，并将数据库名设为 `mp3`，例如：

   ```text
   mongodb+srv://DB_USER:DB_PASSWORD@YOUR_CLUSTER.mongodb.net/mp3?retryWrites=true&w=majority
   ```

   使用实际连接信息，不要保留尖括号或示例占位符。密码中的特殊字符需要 URL 编码。
5. 把连接字符串填入本项目 `.env` 的 `MONGODB_URI=` 后面，并保存。不要把密码发送到聊天或提交到 GitHub。`.env` 已在 `.gitignore` 中。

官方说明：[创建免费集群](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/)、[连接集群](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/)。

## 2. 本地启动和测试

本项目要求 **Node 24**。如果使用 nvm：

```bash
cd /shared/nas/data/m1/xuejunz2/cs409/mp4
nvm install 24
nvm use 24
npm ci
npm test
npm start
```

当前这台机器还准备了独立的 Node 24 环境，可以不用安装 nvm：

```bash
cd /shared/nas/data/m1/xuejunz2/cs409/mp4
export PATH="/shared/nas/data/m1/xuejunz2/.local/share/cs409-node24/node_modules/.bin:$PATH"
node -v
npm test
npm start
```

`npm start` 需要配置好 `.env`；`npm test` 不需要。服务器连接成功后输出 `Server running on port 3000`。

浏览器访问 `http://localhost:3000/api/users` 或运行：

```bash
curl http://localhost:3000/api/users
```

空数据库会返回 `{"message":"OK","data":[]}`。如果在远程服务器上运行，可在 VS Code 的 Ports 面板转发 3000 端口，或直接在服务器终端运行 curl。

## 3. GitHub 仓库

项目仓库为 [xuejunzhang2002/mp4](https://github.com/xuejunzhang2002/mp4)，默认分支为 `main`。仓库名是 `mp4`，其中的代码对应 CS409 MP3 作业。

以后修改代码后，在本项目目录执行：

```bash
git add .
git status
git commit -m "Update task management API"
git push origin main
```

提交列表应包含 `.env.example`，但不应包含 `.env` 或 `node_modules`。首次在这个目录本地运行前，先执行 `cp .env.example .env` 并配置连接字符串，再使用 Node 24 执行 `npm ci`。

## 4. 在 Render 部署

登录 [Render](https://dashboard.render.com/)，选择 **New → Web Service**，连接刚才的 GitHub 仓库，按下表配置：

| 配置项 | 值 |
| --- | --- |
| Language / Runtime | Node |
| Branch | 刚才推送的分支 |
| Root Directory | 留空（本项目本身就是 Git 仓库根目录） |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance Type | Free |
| Health Check Path | `/api` |
| 环境变量 `NODE_VERSION` | `24` |
| 环境变量 `MONGODB_URI` | 第 1 步的真实 Atlas 连接字符串 |

不用手动设置 `PORT`，Render 会提供。创建服务并等到部署成功。也可以使用 **New → Blueprint**，让 Render 读取项目已有的 `render.yaml`；按提示填写 `MONGODB_URI`。

部署完成后打开 `https://你的服务名.onrender.com/api/users`，确认收到 JSON 响应。若启动失败，检查 Render Logs，以及 Atlas 用户密码、数据库权限和 Network Access。

官方说明：[部署 Express](https://render.com/docs/deploy-node-express-app)、[Node 版本设置](https://render.com/docs/node-version)、[Blueprint 配置](https://render.com/docs/blueprint-spec)。

## 5. 运行课程评分器

在本地 `.env` 中设置：

```dotenv
API_URL=https://你的服务名.onrender.com
```

地址不要包含 `/api`，也不要使用 localhost。然后在 Node 24 环境中执行：

```bash
npm run submit
```

脚本读取 `.env`，原有 `AUTOGRADER_URL` 保持不变。Render 服务休眠时，先打开部署地址等它唤醒，再运行评分器。此步骤可能需要几分钟，并会在数据库中创建测试数据。

本地测试通过不等于课程评分器已通过；未部署前不能获得课程分数。

## 6. 正式提交

根据 README，本次截止时间为 **2026 年 11 月 3 日 23:59，美国中部时间**。

填写课程的 [Submission Form](https://forms.gle/4V1v2VWU78XwM3H57)，提交自己的 GitHub 仓库和部署地址，保持服务及数据库在评分时可用。`npm run submit` 只做自测，不会正式提交作业。

课程允许使用 LLM，但要求同时提交聊天记录并填写 LLM 使用调查。请保存并提交本次完整聊天记录；这份部署说明不能替代聊天记录。参考资料还包括 [Mongoose 事务文档](https://mongoosejs.com/docs/transactions.html) 和 [Mongoose 查询 API](https://mongoosejs.com/docs/api/query.html)，以及上述 Atlas、Render 官方文档。

## 实现约定

- 所有普通响应都使用 `{ message, data }`；创建返回 201，读取/替换/删除返回 200，OPTIONS 返回 204。
- `count=true` 返回满足 `where` 的总数量；`skip`、`limit`、`select` 只影响返回文档列表。
- `PUT` 重置遗漏的可选字段，保留服务器生成的 `dateCreated`。
- 用户和任务之间的多文档更新放在事务中，正式数据库使用 Atlas；本地自行部署 MongoDB 时需要 replica set。
- 双向引用与错误回滚的回归测试在 `test/api.test.js`。
