# napcat-plugin-ai-tagger

NapCat 插件 —— AI 图片反推标签

## 功能

在群聊中发送 `rec` 并附带图片（或引用含图片的消息），通过 HuggingFace WD Tagger API 反推 AI 绘画标签、角色识别和 NSFW 安全评级。

## 安装

1. 下载 `napcat-plugin-ai-tagger.zip`
2. 解压到 NapCat 的 `plugins` 目录
3. 重启 NapCat

> 💡 你也可以在 NapCat WebUI 中直接安装插件。

## 命令

| 命令 | 说明 |
|------|------|
| `rec` + 图片 | 识别图片中的 AI 绘画标签 |
| `rec` + 引用图片消息 | 识别引用消息中的图片 |

## 配置

在 NapCat WebUI 配置面板中可修改：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `model` | WD Tagger 模型 | `SmilingWolf/wd-swinv2-tagger-v3` |
| `generalThreshold` | 通用标签阈值 | `0.35` |
| `characterThreshold` | 角色标签阈值 | `0.85` |
| `proxyAgent` | 代理地址（可选） | (空) |

## 支持的模型

- SmilingWolf/wd-swinv2-tagger-v3
- SmilingWolf/wd-convnext-tagger-v3
- SmilingWolf/wd-vit-tagger-v3
- SmilingWolf/wd-v1-4-moat-tagger-v2
- SmilingWolf/wd-v1-4-swinv2-tagger-v2
- SmilingWolf/wd-v1-4-convnext-tagger-v2
- SmilingWolf/wd-v1-4-convnextv2-tagger-v2
- SmilingWolf/wd-v1-4-vit-tagger-v2

## 许可证

MIT
