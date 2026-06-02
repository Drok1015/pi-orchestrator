# Pi Orchestrator Skill

> 让 Pi 成为多 Worker 编排主控，支持本地和远程 Worker（SSH）

## 概述

使用此技能后，Pi 将具备以下能力：
- 动态创建和管理 Worker 进程
- 支持本地 Worker 和远程 Worker（SSH）
- 星型模式（任务分发后结果回主控）
- 链式模式（任务顺序执行，结果传递）
- 自动路由任务到匹配的 Worker 类型
- 动态扩缩容 Worker 数量

## 前置条件

### 主控机器需要
- Node.js v20+
- Pi 已安装 (`npm install -g @earendil-works/pi-coding-agent`)
- SSH 密钥（连接远程 Worker 需要）
- API Key（主控自己的 LLM 调用）

### 远程 Worker 机器需要
- Node.js v20+
- Pi 已安装
- API Key 已配置
- SSH 免密登录已设置

## 配置文件

配置文件位置：`~/.pi/orchestrator.json`

```json
{
  "defaultModel": "mimo-v2.5-pro",
  "workerTypes": {
    "frontend": {
      "label": "前端",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是前端专家，擅长 React、Vue、TypeScript、CSS。",
      "tags": ["前端", "页面", "UI", "组件", "CSS", "样式", "React", "Vue", "HTML"],
      "count": 1,
      "tools": ["read", "write", "edit", "bash"],
      "skills": [],
      "extensions": [],
      "env": {
        "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
      }
    },
    "backend": {
      "label": "后端",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是后端专家，擅长 Node.js、Python、数据库、API 设计。",
      "tags": ["后端", "API", "数据库", "服务", "接口", "SQL", "Redis"],
      "count": 1,
      "tools": ["read", "write", "edit", "bash"],
      "skills": [],
      "extensions": [],
      "env": {
        "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
      }
    },
    "aliyun": {
      "label": "阿里云",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是全栈开发专家，擅长各种开发任务。",
      "tags": ["部署", "服务器", "运维", "监控", "远程"],
      "count": 1,
      "tools": ["read", "write", "edit", "bash"],
      "skills": [],
      "extensions": [],
      "env": {},
      "ssh": {
        "host": "47.94.217.166",
        "user": "root",
        "port": 22,
        "keyFile": "~/.ssh/id_rsa",
        "piPath": "pi",
        "env": {
          "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
        }
      }
    }
  }
}
```

## 配置字段说明

### WorkerTypeConfig

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `label` | string | ✅ | 显示名称 |
| `provider` | string | ❌ | 提供商，如 `xiaomi-token-plan-cn` |
| `model` | string | ❌ | 模型 ID，如 `mimo-v2.5-pro` |
| `systemPrompt` | string | ❌ | 角色提示词 |
| `tags` | string[] | ❌ | 任务匹配关键词 |
| `count` | number | ❌ | 初始启动数量（默认 1，设 0 不自动启动） |
| `tools` | string[] | ❌ | 可用工具：`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` |
| `skills` | string[] | ❌ | 技能文件路径（远程机器的路径） |
| `extensions` | string[] | ❌ | 扩展文件路径（远程机器的路径） |
| `env` | object | ❌ | 环境变量（本地 Worker 的 API Key 等） |
| `autoRestart` | boolean | ❌ | 崩溃后自动重建（默认 true） |
| `ssh` | SSHConfig | ❌ | SSH 配置，有此项则为远程 Worker |

### SSHConfig

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `host` | string | ✅ | 远程主机 IP 或域名 |
| `user` | string | ❌ | SSH 用户名（默认当前用户） |
| `port` | number | ❌ | SSH 端口（默认 22） |
| `keyFile` | string | ❌ | SSH 私钥路径（默认 `~/.ssh/id_rsa`） |
| `piPath` | string | ❌ | 远程 Pi 可执行文件路径（默认 `pi`） |
| `env` | object | ❌ | 远程环境变量（远程 Worker 的 API Key 等） |

## 启动方式

```bash
# 直接启动，自动加载 orchestrator.json
pi
```

如果 `~/.pi/orchestrator.json` 存在，扩展自动启用。

## 命令

### 星型模式（结果回主控）

| 命令 | 说明 |
|------|------|
| `/orch <任务>` | 自动匹配 Worker 类型执行 |
| `/orch-to <类型> <任务>` | 指定类型执行 |

### 链式模式（结果顺序传递）

| 命令 | 说明 |
|------|------|
| `/orch-chain <步骤1> → <步骤2> → ...` | 顺序执行，每步结果传给下一步 |

### 管理命令

| 命令 | 说明 |
|------|------|
| `/orch-all <任务>` | 广播给所有空闲 Worker |
| `/orch-spawn <类型> [数量]` | 动态增加 Worker |
| `/orch-kill <id>` | 销毁指定 Worker |
| `/orch-scale <类型> <数量>` | 调整到指定数量 |
| `/orch-status` | 查看所有 Worker 状态 |
| `/orch-types` | 查看类型配置详情 |

## LLM 工具

当此技能加载后，LLM 可以调用以下工具：

| 工具 | 说明 | 参数 |
|------|------|------|
| `orch_assign` | 星型模式分发任务 | `{ task: string, workerType?: string }` |
| `orch_chain` | 链式执行多步骤 | `{ steps: string[] }` |
| `orch_status` | 查看 Worker 状态 | `{}` |

## 任务路由逻辑

当使用 `/orch <任务>` 时，系统会根据任务内容自动匹配 Worker 类型：

1. 提取任务中的关键词
2. 与各 Worker 类型的 `tags` 匹配
3. 找到匹配的空闲 Worker 执行
4. 如果没有匹配或没有空闲 Worker，加入队列等待

## 执行模式选择

### 星型模式（Hub）

```
主控 → Worker A → 主控（检查结果）
     → Worker B → 主控（汇总返回）
```

**适用场景：**
- 需要中间检查、决策
- 结果要汇总多个 Worker
- 可能需要重新路由

**示例：**
```
/orch 写登录页面
```

### 链式模式（Chain）

```
主控 → Worker A → Worker B → Worker C → 主控
         结果→      结果→      结果→
```

**适用场景：**
- 步骤固定的流水线
- 每步只需要上步输出
- 不需要中间决策

**示例：**
```
/orch-chain 写React组件 → 写CSS样式 → 写使用文档
```

## Worker 生命周期

| 事件 | 行为 |
|------|------|
| 启动主控 | 根据 `count` 创建 Worker |
| Worker 崩溃 | 自动重建（如果 `autoRestart` 不为 false） |
| 任务完成 | Worker 保持空闲，等待下一个任务 |
| `/new` 或 `/quit` | 清理所有 Worker |
| Ctrl+C | 清理所有 Worker |

## API Key 配置

### 环境变量名

| 提供商 | 环境变量 |
|--------|----------|
| Anthropic Claude | `ANTHROPIC_API_KEY` |
| OpenAI GPT | `OPENAI_API_KEY` |
| Google Gemini | `GOOGLE_API_KEY` |
| Xiaomi MiMo | `XIAOMI_API_KEY` |
| MiMo Token Plan (中国) | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| MiMo Token Plan (阿姆斯特丹) | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` |
| MiMo Token Plan (新加坡) | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` |

### 查看当前 API Key

```bash
cat ~/.pi/agent/auth.json
```

## 远程 Worker 配置步骤

### 1. 远程机器安装 Pi

```bash
# SSH 到远程机器
ssh root@远程IP

# 安装 Node.js (如果需要)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 安装 Pi
npm install -g @earendil-works/pi-coding-agent --ignore-scripts

# 验证
pi --version
```

### 2. 配置 SSH 免密登录

```bash
# 本地机器执行
ssh-keygen -t rsa -b 4096  # 如果没有密钥
ssh-copy-id -i ~/.ssh/id_rsa.pub root@远程IP
```

### 3. 配置 API Key

**方法一：在配置文件的 env 里传（推荐）**

```json
"ssh": {
  "host": "远程IP",
  "user": "root",
  "env": {
    "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
  }
}
```

**方法二：在远程机器的环境变量里配置**

```bash
# SSH 到远程机器
echo 'export XIAOMI_TOKEN_PLAN_CN_API_KEY=tp-你的token' >> ~/.bashrc
source ~/.bashrc
```

### 4. 验证连接

```bash
# 测试 SSH
ssh root@远程IP "echo 连接成功"

# 测试 Pi
ssh root@远程IP "pi --version"

# 测试 API
ssh root@远程IP "XIAOMI_TOKEN_PLAN_CN_API_KEY=tp-你的token pi --provider xiaomi-token-plan-cn -p '你好'"
```

## 完整配置示例

### 示例 1：本地 Worker + MiMo

```json
{
  "defaultModel": "mimo-v2.5-pro",
  "workerTypes": {
    "frontend": {
      "label": "前端",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是前端专家",
      "tags": ["前端", "UI", "页面"],
      "count": 1,
      "tools": ["read", "write", "edit", "bash"],
      "env": {
        "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
      }
    },
    "backend": {
      "label": "后端",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是后端专家",
      "tags": ["后端", "API", "数据库"],
      "count": 1,
      "tools": ["read", "write", "edit", "bash"],
      "env": {
        "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
      }
    }
  }
}
```

### 示例 2：混合部署（本地 + 远程）

```json
{
  "defaultModel": "mimo-v2.5-pro",
  "workerTypes": {
    "frontend": {
      "label": "前端",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是前端专家",
      "tags": ["前端", "UI"],
      "count": 1,
      "env": {
        "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
      }
    },
    "aliyun": {
      "label": "阿里云",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "systemPrompt": "你是全栈开发专家",
      "tags": ["部署", "服务器", "运维", "远程"],
      "count": 1,
      "ssh": {
        "host": "47.94.217.166",
        "user": "root",
        "env": {
          "XIAOMI_TOKEN_PLAN_CN_API_KEY": "tp-你的token"
        }
      }
    }
  }
}
```

### 示例 3：不同权限的 Worker

```json
{
  "workerTypes": {
    "developer": {
      "label": "开发",
      "tools": ["read", "write", "edit", "bash"],
      "count": 2
    },
    "reviewer": {
      "label": "审查",
      "tools": ["read", "grep", "find", "ls"],
      "systemPrompt": "你只能读取和分析代码，不能修改"
    },
    "tester": {
      "label": "测试",
      "tools": ["read", "write", "bash"],
      "systemPrompt": "你只能写测试文件，不能修改源码"
    }
  }
}
```

### 示例 4：省钱配置（不同模型）

```json
{
  "defaultModel": "mimo-v2.5-pro",
  "workerTypes": {
    "complex": {
      "label": "复杂任务",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "tags": ["重构", "架构", "设计"],
      "count": 1
    },
    "simple": {
      "label": "简单任务",
      "provider": "xiaomi-token-plan-cn",
      "model": "mimo-v2.5-pro",
      "tags": ["格式化", "重命名", "注释"],
      "count": 2
    }
  }
}
```

## 故障排查

### Worker 没启动

```bash
# 检查配置文件
cat ~/.pi/orchestrator.json

# 检查 JSON 格式
python3 -c "import json; json.load(open('$HOME/.pi/orchestrator.json'))"
```

### Worker 崩溃

- 默认自动重建，等 1 秒
- 查看状态：`/orch-status`
- 手动重建：`/orch-spawn <类型>`

### 远程 Worker 连接失败

```bash
# 测试 SSH
ssh root@远程IP "echo 连接成功"

# 测试 Pi
ssh root@远程IP "pi --version"

# 测试 API
ssh root@远程IP "XIAOMI_TOKEN_PLAN_CN_API_KEY=tp-你的token pi --provider xiaomi-token-plan-cn -p '你好'"
```

### 任务卡住

```
/orch-status    # 查看哪个 Worker 在忙
/orch-kill <id> # 销毁卡住的 Worker
```

## 快速参考

```
┌─────────────────────────────────────────────────────────┐
│  启动                                                    │
│  pi                           # 自动加载 orchestrator   │
├─────────────────────────────────────────────────────────┤
│  星型模式                                                │
│  /orch <任务>                  # 自动分配                │
│  /orch-to <类型> <任务>        # 指定类型                │
├─────────────────────────────────────────────────────────┤
│  链式模式                                                │
│  /orch-chain A → B → C         # 顺序执行                │
├─────────────────────────────────────────────────────────┤
│  管理                                                    │
│  /orch-all <任务>              # 广播                    │
│  /orch-spawn <类型> [数量]     # 增加 Worker             │
│  /orch-kill <id>               # 销毁 Worker             │
│  /orch-scale <类型> <数量>     # 调整数量                │
│  /orch-status                  # 查看状态                │
│  /orch-types                   # 查看配置                │
├─────────────────────────────────────────────────────────┤
│  配置文件                                                │
│  ~/.pi/orchestrator.json       # 全局配置                │
│  .pi/orchestrator.json         # 项目配置（优先）        │
└─────────────────────────────────────────────────────────┘
```
