# 自定义 CSS 指南

JTab 的自定义 CSS 用于调整新标签页的显示效果。样式保存到当前浏览器配置文件的 `browser.storage.local`，只在新标签页中注入，不会同步到其他设备或浏览器。

## 使用方式

1. 在新标签页右上角打开设置，进入“自定义 CSS”。
2. 输入样式，通过实时校验后保存并启用。
3. 若样式隐藏了设置入口，在浏览器的扩展详情页打开“扩展程序选项”并重置。Options 页面不会加载用户 CSS。

自定义样式被包装在 `@layer user` 中，位于 JTab 内置主题之后，因此可以覆盖本文列出的公开变量和选择器。

## 公开变量

请把变量定义在 `.jtab-shell` 上。透明度使用 `0` 到 `1`，模糊与详细卡片圆角使用 CSS 长度，两个百分比圆角使用 `%`。

| 变量                                 | 默认值 | 作用                               |
| ------------------------------------ | ------ | ---------------------------------- |
| `--jtab-content-opacity`             | `0.82` | 收藏栏底层透明度，`0` 为完全透明。 |
| `--jtab-content-blur`                | `0px`  | 收藏栏磨砂强度。                   |
| `--jtab-bookmark-card-opacity`       | `0.8`  | 详细卡片与单图标书签的底层透明度。 |
| `--jtab-bookmark-detail-card-radius` | `8px`  | 详细卡片模式的卡片圆角。           |
| `--jtab-bookmark-icon-card-radius`   | `24%`  | 单图标模式书签卡片的圆角。         |
| `--jtab-bookmark-icon-radius`        | `18%`  | 书签图标本身的圆角，不影响卡片框。 |

示例：让收藏栏更轻、详细卡片稍圆，同时保持图标卡片方正。

```css
.jtab-shell {
  --jtab-content-opacity: 0.68;
  --jtab-content-blur: 10px;
  --jtab-bookmark-card-opacity: 0.74;
  --jtab-bookmark-detail-card-radius: 16px;
  --jtab-bookmark-icon-card-radius: 12%;
  --jtab-bookmark-icon-radius: 22%;
}
```

## 稳定选择器

JTab 为常见定制目标提供 `data-jtab-role`。优先使用这些属性，不要依赖未在此列出的内部类名或 DOM 层级。

| 选择器                             | 目标                                         |
| ---------------------------------- | -------------------------------------------- |
| `[data-jtab-role="background"]`    | 全屏背景图片。                               |
| `[data-jtab-role="workspace"]`     | 新标签页主工作区。                           |
| `[data-jtab-role="brand-logo"]`    | 左上角 JTab 品牌图标。                       |
| `[data-jtab-role="folder-menu"]`   | 左上角的文件夹菜单按钮。                     |
| `[data-jtab-role="folder-icon"]`   | 首页入口、目录树与文件夹卡片中的文件夹图标。 |
| `[data-jtab-role="content-grid"]`  | 当前文件夹的内容网格。                       |
| `[data-jtab-role="bookmark-grid"]` | 展开目录中的书签网格。                       |
| `[data-jtab-role="bookmark-card"]` | 详细卡片和单图标模式中的书签卡片。           |
| `[data-jtab-role="bookmark-icon"]` | 书签卡片内的网站图标或文字字标。             |

示例：只强化书签边框、文件夹图标和图标悬停，而不改变书签数据或交互。

```css
[data-jtab-role='bookmark-card'] {
  border-color: color-mix(in srgb, #1f8c76 42%, transparent);
  box-shadow: 0 12px 28px rgb(8 37 30 / 14%);
}

[data-jtab-role='bookmark-card']:hover {
  transform: translateY(-2px);
}

[data-jtab-role='folder-icon'] {
  color: #117a68;
}

[data-jtab-role='bookmark-icon'] {
  box-shadow: 0 4px 12px rgb(7 34 28 / 14%);
}
```

## 安全边界

- CSS 最大 100 KB，保存前必须通过 CSS 语法校验。
- 禁止 `@import`。
- 禁止通过 `url()`、`image-set()` 或字符串加载 `http://`、`https://`、`//` 等远程资源，包含转义后的写法。
- 不要隐藏键盘焦点、设置按钮或整个工作区；这会降低可访问性，也可能使恢复操作变得困难。
- JTab 的内部类名、计算变量和设置变量不是公开契约，版本升级后可能调整。需要长期保留的样式只使用本文变量与 `data-jtab-role`。

## 常见方案

### 透明工作台

```css
.jtab-shell {
  --jtab-content-opacity: 0.32;
  --jtab-content-blur: 16px;
  --jtab-bookmark-card-opacity: 0.56;
}
```

### 无卡片图标墙

```css
.jtab-shell {
  --jtab-bookmark-card-opacity: 0;
  --jtab-bookmark-icon-card-radius: 18%;
}

[data-jtab-role='bookmark-card'] {
  box-shadow: none;
}
```

### 高对比度焦点

```css
[data-jtab-role='bookmark-card']:focus-within {
  outline: 3px solid #f5b94c;
  outline-offset: 3px;
}
```
