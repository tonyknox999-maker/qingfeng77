---
date: 2026-11-12
source: manual
type: 笔记
topic: [自媒体创作, 77体验]
persona: first
etl_status: done
etl_date: 2026-11-12
etl_note: 个人品牌页工程产物-侧车索引-工程文件留raw不ETL
---

# qingfeng77-site · 清风77个人品牌页（侧车索引）

> 二进制/工程文件无法插 frontmatter，按 CLAUDE.md「PDF / 二进制档案 ETL 规则」用侧车 `_index.md` 登记打标。**工程文件本体不动**，raw 不可变。

## 是什么

清风77 个人 IP 官网 · 本地离线版（双击 `index.html` 即可打开，无需联网）。
定位语：「把人生当盲盒拆的人」。5 板块 + 3 粒子幕间：00 自我介绍 / 01 身份 / 02 兴趣 / 03 生活 / 04 联系，粒子上 9 个形态随滚动变形（清风77 → 山脊 → 心跳 → 盲盒 → 巨型77 → 唱片 → 太阳 → 热气球 → 二维码）。

## 文件构成（83 个文件）

| 目录/文件 | 内容 |
|---|---|
| `index.html` | 主页面（5 板块结构 + 粒子 canvas） |
| `css/site.css` | 样式（细雅字重 + 垂直渐变，明暗双主题） |
| `js/site.js` / `field.js` / `qrcode.js` / `three.min.js` | 滚动驱动 + 粒子场 + 二维码生成 + Three.js |
| `fonts/` | Archivo（拉丁变量字）/ Martian Mono（等宽数字） |
| `images/` | 真人照片 + 折纸作品 + 占位图（见下） |
| `README.txt` | 使用说明 + 换照片三步法 + 对照表 |

## 图片素材归类（下游引用用文字描述 + 路径，不搬运）

- **家庭真人照**：`images/fam01-05.jpg`、`childhood.jpg`（本人与女儿婴儿期、成长照）
- **折纸作品**：`images/work0-8.jpg`（奥赛 / 奔兔 / 圣诞狐 / 变色龙等）
- **大师合影**：`images/master1.jpg`（与折纸艺术家合影，纸尚折学营）
- **人生经历照**：`images/exp02-18.jpg`、`tedx-poster.jpg`、`temple.jpg`（禅修）、`drama1-2.jpg`（戏剧）、`songmv.jpg`
- **小红书/记忆法**：`images/xhs01-07.jpg`、`memory1-8.jpg`（裁判席 / 赛场）
- **日常**：`images/daily1-5.jpg`、`office.jpg`、`portrait.jpg`、`life-extra.jpg`
- **游戏**：`images/game-hunt.png`、`game-phil.png`（站内两个粒子小游戏）

## ETL 处置

- 本批为**工程产物**（HTML/CSS/JS/图片），非内容素材 → **留 raw 不 ETL**（沿用 2026-11-07「工程归档一律打 done + etl_note」判据）。
- 站点内容本身是清风**已公开的个人叙事**（自我介绍 / 77 体验清单 / 兴趣），与 `30-myself` 现有内容高度重合，**不重复沉淀**。
- ⚠️ **待清风确认（隐私边界）**：站点为公开品牌页，`images/` 内含**女儿（萌小C）婴儿期及成长真人照**、妻子相关家庭照。是否将家庭真人照公开上线，属对外发布口径 + 隐私边界，ETL 不自动决策。
