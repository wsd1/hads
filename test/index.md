---
title: 示例front-matter
---

感谢 https://github.com/sinedied/hads 项目提供了一个如此完美的开头，让我久久未能实施的思路得以发挥。


# 一一改造版说明
---

1、支持阿里云OSS，请添加一个config.json，格式如：

```json
{
  "aliOSS": {
    "region": "xx",
    "accessKeyId": "xxx",
    "accessKeySecret": "xxx",
    "bucket": "xxx"
  }

}
```

2、支持front-matter

可以尝试在markdown内容头部加上：

```yaml
---
title: Hello
slug: home
---

```

渲染时不会被渲染出来，但是编辑时会显示出来。比如本文就有这个头部，不信点编辑看看。






## 参考项目和文档

https://github.com/sinedied/hads

https://github.com/jonschlinkert/gray-matter

https://github.com/e10101/multer-ali-oss

