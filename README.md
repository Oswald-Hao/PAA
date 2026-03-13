# 📄 研究思维放大器 (Research Mind Amplifier)

研究思维放大器是一款基于 React 和 Google Gemini AI 构建的智能学术论文阅读与写作辅助工具。它集成了 PDF 阅读、智能结构解析、行内 AI 辅助（解释、总结、翻译、扩写、对比、图表生成）以及学术写作辅助等功能，旨在大幅提升科研人员的文献阅读与创作效率。

## ✨ 核心功能

- **智能论文解析**：上传 PDF 后，AI 自动提取论文的核心问题、研究方法、实验结果、主要贡献，并推荐相关主题和参考文献。
- **行内 AI 悬浮菜单**：在 PDF 中划选任意文本，即可一键调用 AI 进行解释、总结、翻译、扩写、对比，甚至根据数据生成可视化图表。
- **学术写作协作**：
  - **大纲生成**：输入研究想法，一键生成包含 Introduction, Related Work, Method, Experiment, Conclusion 等部分的完整学术大纲。
  - **段落润色**：输入草稿，AI 作为资深学术编辑帮您修正语法、优化逻辑，并提升学术表达的严谨性。
- **全局历史记录与撤销**：支持撤销操作，防止误操作。
- **深色/浅色模式**：提供舒适的阅读体验。

---

## 🚀 快速开始

### 1. 环境准备

确保您的本地环境已安装 [Node.js](https://nodejs.org/) (推荐 v18 或以上版本) 和 npm/yarn/pnpm。

### 2. 克隆与安装依赖

```bash
# 克隆项目 (如果您还没有克隆)
git clone <your-repo-url>
cd research-mind-amplifier

# 安装依赖
npm install
```

### 3. 配置环境变量

复制 `.env.example` 文件并重命名为 `.env`，然后填入您的 Google Gemini API Key：

```bash
cp .env.example .env
```

在 `.env` 文件中配置：
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*(注：如果您在应用内的“设置”面板中手动配置了 API Key，则会优先使用手动配置的 Key。)*

### 4. 本地开发运行

```bash
npm run dev
```
运行后，在浏览器中访问 `http://localhost:3000` 即可预览应用。

---

## 📦 部署指南

本项目基于 Vite 构建，可以非常方便地部署到各种静态网站托管平台（如 Vercel, Netlify, GitHub Pages）或使用 Nginx 部署。

### 选项 A：部署到 Vercel (推荐)

Vercel 对 Vite 项目提供了开箱即用的支持。

1. 注册并登录 [Vercel](https://vercel.com/)。
2. 点击 **Add New... -> Project**。
3. 导入您的 GitHub 仓库。
4. 在 **Environment Variables** 选项卡中，添加 `GEMINI_API_KEY`，并填入您的 API Key。
5. 点击 **Deploy**。Vercel 会自动识别 Vite 配置并完成构建与部署。

### 选项 B：部署到 Netlify

1. 注册并登录 [Netlify](https://netlify.com/)。
2. 点击 **Add new site -> Import an existing project**。
3. 连接您的 GitHub 仓库。
4. 在 **Build settings** 中：
   - Build command: `npm run build`
   - Publish directory: `dist`
5. 点击 **Advanced build settings**，添加环境变量 `GEMINI_API_KEY`。
6. 点击 **Deploy site**。

### 选项 C：使用 Nginx 静态部署

如果您有自己的云服务器，可以构建静态文件并使用 Nginx 代理。

1. 在本地或服务器上执行构建命令：
   ```bash
   npm run build
   ```
   这将在项目根目录下生成一个 `dist` 文件夹。

2. 将 `dist` 文件夹中的所有文件上传到您的服务器（例如 `/var/www/research-mind-amplifier`）。

3. 配置 Nginx (`/etc/nginx/sites-available/default` 或您的配置文件)：
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com; # 替换为您的域名或 IP

       root /var/www/research-mind-amplifier;
       index index.html;

       # 支持单页应用 (SPA) 路由
       location / {
           try_files $uri $uri/ /index.html;
       }
   }
   ```
4. 重启 Nginx：
   ```bash
   sudo systemctl restart nginx
   ```

---

## 🛠 技术栈

- **前端框架**: React 18
- **构建工具**: Vite
- **样式**: Tailwind CSS
- **AI 模型**: Google Gemini API (`@google/genai`)
- **PDF 渲染**: `react-pdf`, `pdfjs-dist`
- **图表渲染**: `recharts`
- **Markdown 渲染**: `react-markdown`
- **图标**: `lucide-react`

## 📄 许可证

MIT License
