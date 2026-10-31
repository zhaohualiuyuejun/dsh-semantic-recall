# dsh-semantic-recall

会话语义检索插件（DeepSeek Harness）。

**换新对话，不再等于从头再来。** 跨工作区索引最近 N 天（默认 7）的对话，用一句模糊描述就能召回过去聊过的话题和原话；找不准时会反问你，而不是硬编。

## 安装

在 DSH 里用 plugin_manager（创造模式）：

```
action: install_bundle
target: https://github.com/zhaohualiuyuejun/dsh-semantic-recall/releases/download/v0.2.0/dsh-semantic-recall-0.2.0.tgz
```

装完**刷新一次页面**，左侧「设置」里会出现「会话语义检索」，在那里填 API Key、勾选要索引的工作区。

完整说明（能力、判定规则、隐私边界、已知限制）见发布包内的 README。

## License

MIT
