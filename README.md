# Pi Orchestrator

> 让你的 Pi 变成「指挥官」，指挥多个 Pi 一起干活

## 这是什么

一个 Pi 技能，装上之后你的 Pi 就能：

- 🎯 **分发任务** - 把任务派给不同的「小弟 Pi」执行
- 🔗 **链式协作** - A 做完交给 B，B 做完交给 C
- 🌐 **远程调度** - 让阿里云、腾讯云的机器也帮你干活
- 📈 **动态扩缩** - 忙的时候多招人，闲的时候裁员

## 亮点

| 亮点 | 说明 |
|------|------|
| **自然语言操控** | 不用记命令，直接跟 Pi 说话 |
| **本地 + 远程混合** | 本地机器和云服务器一起用 |
| **自动路由** | 前端任务给前端 Pi，后端任务给后端 Pi |
| **故障自愈** | Worker 挂了自动重建 |

## 当前配置

默认使用 **小米 MiMo 大模型**（`mimo-v2.5-pro`），通过 MiMo Token Plan 调用。

想换别的模型？直接跟 Pi 说：

> "帮我把模型换成 Claude"

或者

> "前端用 GPT-4o，后端用 MiMo"

Pi 会自动帮你改配置。

## 安装

```bash
# 安装技能
pi install git:github.com/Drok1015/pi-orchestrator

# 或手动
git clone https://github.com/Drok1015/pi-orchestrator ~/.agents/skills/pi-orchestrator
cp ~/.agents/skills/pi-orchestrator/pi-orchestrator.ts ~/.pi/agent/extensions/
cp ~/.agents/skills/pi-orchestrator/orchestrator.example.json ~/.pi/orchestrator.json
```

## 使用

装好之后，**直接跟 Pi 说话就行**：

```
你: 帮我创建一个前端 worker 和一个后端 worker
Pi: 好的，已创建...

你: 把这个登录页面的任务派给前端
Pi: 已分配给前端 worker...

你: 阿里云那台机器也帮我用上
Pi: 好的，我来配置远程 worker...

你: 现在有几个 worker 在忙？
Pi: 当前状态：前端 1/2 空闲，后端 0/1 空闲...

你: 帮我同时写前端、后端和测试代码
Pi: 我来拆分任务，并行执行...
```

**不需要记任何命令**，Pi 都能听懂。

## 进阶用法（可选）

如果你喜欢敲命令，这些也能用：

| 命令 | 说明 |
|------|------|
| `/orch <任务>` | 派任务（自动选人） |
| `/orch-chain A → B → C` | 顺序执行 |
| `/orch-status` | 查看状态 |
| `/orch-spawn frontend 3` | 前端加到 3 人 |

但说实话，直接说话更方便。

## 配置文件

`~/.pi/orchestrator.json`，定义你有哪些 Worker：

```json
{
  "workerTypes": {
    "前端": { ... },
    "后端": { ... },
    "阿里云": { "ssh": { "host": "xxx" } }
  }
}
```

配置也懒得写？跟 Pi 说：

> "帮我生成一份 orchestrator 配置，要有前端、后端、测试三种 worker"

Pi 帮你写好。

## 仓库

[github.com/Drok1015/pi-orchestrator](https://github.com/Drok1015/pi-orchestrator)

## License

MIT
