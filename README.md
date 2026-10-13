# 🐘 HugoPad

**安卓 Markdown 编辑器 · 内嵌 Hugo 构建/预览 · 一键推送到腾讯 EdgeOne Pages**

一个用 [Capacitor](https://capacitorjs.com/) + [CodeMirror 6](https://codemirror.net/) 构建的 Android App：

| 功能 | 说明 |
| --- | --- |
| 📝 Markdown 编辑 | CodeMirror 6，移动端工具栏（标题/加粗/链接/表格…），即时预览 |
| 🏷 自动 Hugo 标签 | 保存时自动补全 front matter（title/date/lastmod/draft），标签为空时按内容智能推荐（中英文） |
| 🔨 内嵌 Hugo | Hugo 二进制随 APK 打包（arm64/armv7/x86_64，优先 Extended 支持 SCSS），离线构建整站 |
| ▶ 本地预览 | App 内置 HTTP 服务器，iframe 直接预览 `public/` 成品站 |
| 🎨 主题管理 | 推荐主题一键安装（git 浅克隆），支持任意 GitHub 主题仓库，一键切换 `theme` 配置 |
| ☁ Git 推送 | isomorphic-git 纯浏览器实现：提交全部变更 → HTTPS+Token 推送 GitHub → **EdgeOne Pages 自动构建发布** |
| 🔁 GitHub Actions | 推送代码自动出 APK（`gh` CLI 可下载），打 tag 自动发 Release |

## 快速开始（用 GitHub 构建 APK）

> 本仓库不含 `android/` 目录与 Hugo 二进制，全部由 CI 自动生成，克隆即用。

### 方式一：网页操作

1. Fork 或推送到你的 GitHub 仓库。
2. 打开 **Actions** → **Build Android APK** → 自动运行（约 10–20 分钟）。
3. 运行完成后在该次运行页面底部 **Artifacts** 下载 `HugoPad-apk`。
4. 手机安装 `HugoPad-debug.apk`（需允许安装未知来源应用）。

### 方式二：gh CLI

```sh
gh repo create hugopad --public --source=. --remote=origin --push   # 首次推送
gh run watch                                                        # 盯构建进度
gh run download --name HugoPad-apk                                  # 下载 APK

# 发正式版（自动带 APK 的 Release）
gh release create v0.1.0 --title "v0.1.0" --generate-notes
gh release download v0.1.0 --pattern '*.apk'
```

构建参数：Actions 页面可手动 **Run workflow** 并指定 Hugo 版本（如 `v0.139.4`）。

## App 内使用流程

1. **新建站点**：首页 → 新建站点（自动生成 `hugo.toml`、`archetypes/`、示例文章…）。
2. **装主题**：`主题` 页从推荐列表安装，或输入任意 `owner/repo`；安装后自动设为当前主题。
3. **写文章**：`内容` 页 → 新文章 / 打开 `content/` 下文件。
   - 保存时自动补全/刷新 front matter（`title`、`date`、`lastmod`）。
   - 标签为空时**自动推荐标签**（中英文词频 + 站内已有标签），也可点 `🏷 标签` 手动挑选。
4. **构建预览**：`构建/预览` 页 → `构建并预览`，成品站在 App 内直接浏览；可加 `--buildDrafts --minify` 等参数。
5. **部署到 EdgeOne Pages**：
   - 在 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages) 创建项目，导入 GitHub 仓库（**建议先建空仓库**），框架选 Hugo、输出目录 `public`。
   - App `Git / 部署` 页填：仓库地址、分支、GitHub 用户名、Token（PAT，需 `repo` 权限）。
   - `提交全部变更` → `推送`，EdgeOne 检测到 push 自动构建发布。

> 🔐 Token 只保存在手机应用私有目录，不上传任何服务器；泄露请立即在 GitHub 撤销。

## 本地开发

需要 Node 18+（构建 Web 资源）；构建 APK 另需 JDK 17 + Android SDK。

```sh
npm install
npm test            # front matter / 智能标签 单元测试
npm run build       # esbuild 打包 src-web -> www/

# Android（本机有 JDK17 + Android SDK + Go 时）
npm run prepare:android           # cap add android + 注入原生插件 + cap sync
HUGO_VERSION=v0.139.4 npm run hugo  # 交叉编译 Hugo -> jniLibs/*/libhugo.so
cd android && ./gradlew assembleDebug
```

### 技术要点

- **Hugo 二进制**：CI 用 Go 以 `GOOS=android` 交叉编译（必须，Go 标准库在 android 下避开 faccessat2 系统调用，否则会撞 Android seccomp 的 SIGSYS），打包为 `jniLibs/<abi>/libhugo.so`；运行时从 `nativeLibraryDir` 直接 `exec`（规避 Android 10+ 数据目录不可执行限制）。优先 NDK CGO Extended 版本（支持 SCSS），失败自动退回标准版并自动安装 NDK。
- **预览服务器**：Java 插件在 `127.0.0.1` 随机端口起静态文件服务，WebView iframe 加载（manifest 已开 cleartext + 允许混合内容）。
- **Git**：[isomorphic-git](https://isomorphic-git.org/)（浏览器 fetch，github.com git 端点支持 CORS），文件系统为 Capacitor Filesystem 的 node-fs 适配层。
- **主题安装**：zip 直链无 CORS 权限，故默认走 git 浅克隆。

## 目录结构

```
src-web/                 Web 应用（esbuild 打包进 www/）
  js/app.js              全部界面与流程（站点/编辑/主题/构建/Git）
  js/hugo.js             front matter 解析序列化 + 智能标签（纯函数，可测试）
  js/git.js              isomorphic-git 封装
  js/capfs.js            isomorphic-git 文件系统适配
  js/native.js           原生插件桥 + Filesystem 封装
android-plugin/          HugoNative.java（执行 hugo + 本地 HTTP 预览服务）
scripts/prepare-android.sh  生成 android/ 工程、注入插件、打补丁
scripts/fetch-hugo.sh       交叉编译 Hugo 为 jniLibs
scripts/test-fm.mjs         单元测试
.github/workflows/android.yml  APK 构建流水线
```

## 已知限制

- CI 优先尝试 **Hugo Extended**（NDK + libsass，支持 SCSS 主题）；若该 ABI 编译失败自动退回标准版（不支持 libsass 编译的 SCSS 主题，构建日志会提示）。
- 推送要求远端为空仓库或与本仓库同源；否则需先在电脑上 `pull` 合并。
- 生成的 APK 为 debug 签名，适合自用；上架/长期使用请自配签名密钥。
