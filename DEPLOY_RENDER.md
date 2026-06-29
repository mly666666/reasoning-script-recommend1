# Render 部署说明

1. 把这个文件夹上传到 GitHub，建议使用私有仓库。
2. 确认仓库里包含 `public/data.json`，不要上传 `work/*.har`。
3. 打开 Render，选择 `New` -> `Web Service`。
4. 连接这个 GitHub 仓库。
5. 配置保持默认即可，或使用：
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free`
6. 创建服务后，Render 会给出一个 `onrender.com` 网址。

当前部署版会优先读取 `public/data.json`，访客打开即可查看、筛选和导出，不需要数据库。
