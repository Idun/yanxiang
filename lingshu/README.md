# NOVA / 灵枢（分享版）

个人本地优先的 AI 长篇小说工作室。

本目录为**干净分享包**：

- DeepSeek API Key 为空，需自行填写  
- 不含小说数据库，首次启动会自动创建空库  
- 请先阅读同目录下的 **《启动手册.md》**

## 技术栈

- 后端：`apps/api` — FastAPI + SQLModel（端口 8000）  
- 前端：`apps/web` — Vue 3 + Naive UI（端口 5173）  
- 数据：`data/nova.db`、`data/settings.json`（本地，勿提交密钥）

## 快速开始

详见 [启动手册.md](./启动手册.md)。

摘要：

1. 后端：`apps/api` 建虚拟环境 → `pip install -r requirements.txt` → `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`  
2. 前端：`apps/web` → `npm install` → `npm run dev`  
3. 打开 http://localhost:5173 ，在「设置」填入 DeepSeek API Key  

## 能力概览

- 作品与设定管理（简介 / 世界观 / 角色 / 大纲，字段 AI，确认才入库）  
- 一卷先定季再拆章；剧情要点可改  
- 多 Agent 写章：内容规划 → 写作 → 章间接力 → 审查 → 去 AI 味 → 读者 → 改写  
- 章节锁定、预览、全书评估雷达  

## 注意

分享或二次分发前，请确认：

- `apps/api/.env` 与 `data/settings.json` 中 **没有**真实 API Key  
- `data/` 下 **没有**个人作品的 `nova.db`  
