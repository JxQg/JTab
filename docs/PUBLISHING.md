# JTab 发布指南

本项目的 GitHub Actions 只负责可复现构建、质量校验和 GitHub Release。Chrome Web Store、Microsoft Edge Add-ons 与 Firefox Add-ons (AMO) 都有首次提交审核和商店资料，首次上架及每次商店提交由发布者在后台人工确认。

## GitHub 发布

首次公开前，在 GitHub 创建空仓库并把当前源码推送到 `main`。Actions 的 `Verify` 工作流会在推送到 `main` 及每个拉取请求上执行 `pnpm verify`。

发布版本时，先更新 `package.json` 的 `version`，确认本地校验通过，然后创建与版本完全一致的标签：

```powershell
pnpm install --frozen-lockfile
pnpm verify
git tag v1.0.1
git push origin v1.0.1
```

`Release` 工作流会拒绝版本不匹配的标签，并执行 `pnpm zip:all`。成功后会创建同名 GitHub Release，附加以下文件：

| 文件                         | 用途                                       |
| ---------------------------- | ------------------------------------------ |
| `jtab-<version>-chrome.zip`  | Chrome Web Store 与 Microsoft Edge Add-ons |
| `jtab-<version>-firefox.zip` | Firefox Add-ons (AMO)                      |
| `jtab-<version>-sources.zip` | Firefox 审核所需、可复现构建的源码包       |

不要提交 `.output/`、`node_modules/`、本地环境变量或编辑器配置。`.gitignore` 已覆盖这些内容。

## 商店共同准备

首次提交前完成以下事项：

1. 注册每个商店要求的开发者帐号，并完成其身份或付款资料。
2. 在公开 GitHub 仓库提供 `PRIVACY.md` 的稳定 URL，并在商店隐私页面使用该 URL。
3. 使用 `docs/STORE_LISTING.zh-CN.md` 和 `docs/STORE_LISTING.en-US.md` 填写描述、单一用途和权限说明。
4. 准备商店要求的截图、宣传图和支持地址；截图应展示真实的新标签页与设置页面，不应包含书签或个人资料。
5. 每次上传前使用同一标签的 GitHub Release 文件，不要重新压缩解压构建目录。

## Chrome Web Store

1. 打开 [Chrome 开发者信息中心](https://chrome.google.com/webstore/devconsole)，创建或登录开发者帐号。
2. 选择“添加新商品”，上传 GitHub Release 中的 `jtab-<version>-chrome.zip`。
3. 填写商品详情、隐私、分发范围和商店素材。数据使用声明应与 `PRIVACY.md` 保持一致：不收集、不传输、不出售用户数据。
4. 说明 `bookmarks`、`storage` 与 `favicon` 权限的本地用途；JTab 没有主机权限、账号或遥测。
5. 提交审核。需要自行安排发布时间时，在提交时取消自动发布，审核通过后再手动发布。

官方说明：[在 Chrome 应用商店中发布](https://developer.chrome.com/docs/webstore/publish)。

## Microsoft Edge Add-ons

1. 在 [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) 注册并进入 Edge 扩展工作区。
2. 创建新扩展，上传同一个 `jtab-<version>-chrome.zip`。
3. 在 Availability 选择公开范围和市场，在 Properties、Privacy 和 Store listings 填写商店资料。
4. 明确说明扩展的唯一用途和每项权限理由；Remote code 选择与实现一致的“无”。
5. 在 Certification testing notes 说明测试步骤，提交认证审核。

官方说明：[发布 Microsoft Edge 扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)。

## Firefox Add-ons (AMO)

1. 登录 [AMO Developer Hub](https://addons.mozilla.org/developers/)，选择提交新附加组件并选择在 AMO 上架。
2. 上传 `jtab-<version>-firefox.zip`。不要上传 Chromium ZIP。
3. 当 AMO 询问是否提供源码时，上传 `jtab-<version>-sources.zip`。该包排除了构建产物、测试与缓存，可从中复现 Chrome 和 Firefox 构建。
4. 填写名称、摘要、描述、分类、支持方式和许可证。若商店页面要求隐私政策，使用公开的 `PRIVACY.md` URL。
5. 在 Reviewer notes 中说明：扩展无账号、无遥测、无远程代码；`bookmarks` 与 `storage` 仅在本地使用，Firefox 不申请 `favicon` 权限。
6. 提交版本并等待校验与审核。之后的更新必须在同一 AMO 附加组件页面上传，才能保留用户升级路径。

官方说明：[提交附加组件](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)。

## 自动商店提交

当前不自动向三个商店上传。自动提交需要各平台的发布 API 凭据、扩展/产品 ID、刷新令牌或签名策略，且仍无法绕过首次审核和商店资料校验。待三个商店均首次上架并确认 ID 后，可单独增加受 GitHub Environments 保护的发布工作流；凭据只保存为 GitHub Actions Secrets，绝不提交到仓库。
