# JTab

JTab 是一款以浏览器书签为数据源的新标签页扩展，面向 Chrome、Microsoft Edge 和 Firefox。第一版采用现代化 Fluid 主题，重点解决多层书签目录浏览、指定文件夹展示、可靠的网站图标兜底、背景定制和自定义 CSS。

## 功能

- 以顶层入口组织已选收藏夹，子文件夹可在当前页面逐级展开并排列直属书签。
- 支持选择多个文件夹及其直接内容或完整子树，并保留独立的本地入口顺序。
- 设置面板直接在新标签页内打开；独立 Options 页面仅保留为自定义 CSS 恢复入口。
- 搜索框可就地切换 Google、Bing、百度、DuckDuckGo 或已配置的自定义引擎。
- 书签可切换详细卡片或方形图标模式，并可分别调整收藏栏透明度、磨砂、书签卡片透明度与两种布局的卡片圆角。
- Chrome 和 Edge 优先读取浏览器本地 favicon 数据；Firefox 使用本地文字字标兜底。
- 支持内置背景、本地图片和用户主动配置的 HTTPS 背景地址。
- 提供经过校验的自定义 CSS，禁止 `@import` 和远程资源 URL。
- 设置保存在 `browser.storage.local`，图片保存在扩展自己的 IndexedDB。
- 不提供账号、登录或云同步，不收集书签、搜索词或使用行为。

## 浏览器与权限

| 浏览器        | 构建目标      | 权限                              |
| ------------- | ------------- | --------------------------------- |
| Chrome / Edge | `chrome-mv3`  | `bookmarks`、`storage`、`favicon` |
| Firefox 140+  | `firefox-mv3` | `bookmarks`、`storage`            |

`favicon` 仅用于 Chrome/Edge 提供的浏览器本地 `_favicon` 资源。JTab 不访问网站的 `/favicon.ico`，也不调用第三方 favicon 服务。Firefox 无对应公开接口，因此显示用户设置的本地图标或离线生成的域名字母图标。

Firefox 桌面版最低支持 140（包含当前 ESR）；Android 版因数据收集声明的 Manifest 兼容要求最低为 142。

JTab 不申请主机权限、可选权限、`tabs`、`tabGroups` 或后台内容脚本权限。Chrome/Edge 的隐身窗口不允许扩展覆盖新标签页，这是浏览器平台限制。

## 自定义样式接口

Fluid 主题公开以下稳定变量，用户 CSS 可以在最后一层覆盖它们：

- `--jtab-content-opacity`、`--jtab-content-blur`：收藏栏底层透明度与磨砂强度。
- `--jtab-bookmark-card-opacity`：书签卡片底层透明度。
- `--jtab-bookmark-detail-card-radius`、`--jtab-bookmark-icon-card-radius`：详细模式与图标模式的书签卡片圆角。
- `--jtab-bookmark-icon-radius`：站点图标圆角，内置设置固定为 `18%`，仍允许用户 CSS 覆盖。

品牌图标、目录菜单、文件夹图标、书签卡片和三个外观设置分组分别提供稳定的 `data-jtab-role`，避免自定义样式依赖易变的 DOM 层级。

## 自定义 CSS 恢复

设置通常通过新标签页右上角的设置按钮打开。若用户 CSS 隐藏了该入口或设置遮罩，可从浏览器扩展详情页打开“扩展程序选项”；该独立恢复页面不会加载用户 CSS，可用于停用或重置样式。

## 本地开发

环境要求：Node.js 22 或更高版本、pnpm 10。

```powershell
pnpm install
pnpm dev
pnpm dev:firefox
```

生产构建与发布包：

```powershell
pnpm build:all
pnpm zip:all
```

GitHub Release、三家商店提交与每个发布包的对应关系见 [发布指南](./docs/PUBLISHING.md)。

输出目录：

- `.output/chrome-mv3`：Chrome 与 Edge 共用的解压扩展。
- `.output/firefox-mv3`：Firefox MV3 解压扩展。
- `.output/jtab-<version>-chrome.zip`：Chrome Web Store 与 Edge Add-ons 共用包。
- `.output/jtab-<version>-firefox.zip`：Firefox Add-ons 扩展包。
- `.output/jtab-<version>-sources.zip`：Firefox Add-ons 源码审核包。

Firefox 源码审核包仅包含生产源码、构建配置、锁文件、项目文档和本地资源，明确排除测试、构建输出、缓存与只读参考目录。审核者可在解压目录中复现两个浏览器构建：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm build:firefox
```

加载解压扩展：

1. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，启用开发人员模式并加载 `.output/chrome-mv3`。
2. Firefox 打开 `about:debugging#/runtime/this-firefox`，选择“临时载入附加组件”，加载 `.output/firefox-mv3/manifest.json`。

## 质量检查

以下质量检查从完整项目仓库执行。Firefox 源码审核包不包含 `tests/`，因此包内只执行前述可复现构建命令，不执行 `pnpm verify`。

```powershell
pnpm verify
pnpm verify:privacy
pnpm verify:manifests
pnpm verify:packages
```

- `verify:privacy` 阻止同步存储、站点根 favicon 和已知第三方 favicon 服务进入源码。
- `verify:manifests` 对两个浏览器产物执行权限快照和 manifest 边界检查。
- `lint:firefox` 使用 `web-ext lint` 校验 Firefox 商店包；错误会阻断发布，警告需在交付前审阅。
- `verify:packages` 全量比对商店 ZIP、解压构建目录和源码白名单，并从源码包临时重建 Chrome/Firefox 产物执行逐字节一致性检查。

扩展图标是 JTab 项目自有设计，可通过 `pnpm icons:generate` 从无外部依赖的生成脚本重新生成。

## 项目结构

```text
entrypoints/       新标签页、页内设置面板与独立恢复设置页
src/core/          书签树、选择规则和数据类型
src/services/      书签、设置、图片和 CSS 服务
public/            本地化、背景与扩展图标
scripts/           图标生成和发布契约校验
docs/              商店中英文描述
tests/             单元与服务测试
```

目录 `小舒同学 - 基于书签的新标签页 3.0.2` 仅用于只读产品参考，已从 Git、Lint、Firefox 源码包和所有商店产物中排除。

## 隐私

完整说明见 [PRIVACY.md](./PRIVACY.md)。
