/**
 * pi-orchestrator: 带角色的动态 worker 编排（支持远程 SSH）
 * 
 * 配置文件: ~/.pi/orchestrator.json 或 .pi/orchestrator.json
 * 
 * 两种执行模式：
 *   星型 (Hub): 主控 → A → 主控 → B → 主控（默认，适合复杂任务）
 *   链式 (Chain): 主控 → A → B → C → 主控（适合简单流水线）
 * 
 * Worker 类型：
 *   本地 Worker: 直接 spawn 子进程
 *   远程 Worker: 通过 SSH 在远程机器启动 Pi
 * 
 * 命令：
 *   /orch <任务>                          - 星型：自动分配，结果回主控
 *   /orch-to <类型> <任务>                - 星型：指定类型执行
 *   /orch-chain <步骤1> → <步骤2> → ...  - 链式：顺序执行，结果传递
 *   /orch-all <任务>                      - 广播给所有空闲 worker
 *   /orch-spawn <类型> [数量]             - 增加 worker
 *   /orch-kill <id>                       - 销毁 worker
 *   /orch-scale <类型> <数量>             - 调整数量
 *   /orch-status                          - 查看状态
 *   /orch-types                           - 查看类型配置
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

// ============ 类型定义 ============

interface SSHConfig {
  host: string;                     // 远程主机 IP 或域名
  user?: string;                    // SSH 用户名（默认当前用户）
  port?: number;                    // SSH 端口（默认 22）
  keyFile?: string;                 // SSH 私钥路径
  password?: string;                // SSH 密码（不推荐，建议用密钥）
  piPath?: string;                  // 远程 Pi 可执行文件路径（默认 "pi"）
  env?: Record<string, string>;     // 远程环境变量
}

interface WorkerTypeConfig {
  label: string;
  model?: string;
  provider?: string;               // 提供商，如 xiaomi-token-plan-cn
  systemPrompt?: string;
  cwd?: string;
  tools?: string[];
  skills?: string[];
  extensions?: string[];
  tags?: string[];
  count?: number;
  env?: Record<string, string>;
  autoRestart?: boolean;
  ssh?: SSHConfig;                  // SSH 配置，有此项则为远程 Worker
}

interface OrchestratorConfig {
  workerTypes: Record<string, WorkerTypeConfig>;
  defaultModel?: string;
}

interface Worker {
  id: string;
  type: string;
  config: WorkerTypeConfig;
  process: ChildProcess;
  status: "idle" | "busy" | "dead";
  currentTask?: string;
  results: Array<{ task: string; result: string; timestamp: number }>;
  createdAt: number;
  taskCount: number;
  isRemote: boolean;                // 是否远程 Worker
}

interface TaskItem {
  task: string;
  workerType?: string;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  mode: "hub" | "chain";
  chainContext?: string;
}

// ============ 全局状态 ============

let config: OrchestratorConfig;
const workers = new Map<string, Worker>();
const taskQueue: TaskItem[] = [];
let ctxRef: ExtensionContext | undefined;

// ============ 工具函数 ============

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return resolve(process.env.HOME ?? "~", p.slice(2));
  }
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function loadConfig(): OrchestratorConfig {
  const paths = [
    resolve(process.cwd(), ".pi/orchestrator.json"),
    resolve(process.env.HOME ?? "~", ".pi/orchestrator.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch (e) {
        console.error(`配置解析失败: ${p}`, e);
      }
    }
  }

  return {
    workerTypes: {
      general: { label: "通用", count: 1, tags: [] },
    },
    defaultModel: "anthropic/claude-sonnet-4-20250514",
  };
}

// ============ SSH 工具函数 ============

function buildSSHArgs(sshCfg: SSHConfig, remoteCommand: string): string[] {
  const args: string[] = [];

  // SSH 端口
  if (sshCfg.port && sshCfg.port !== 22) {
    args.push("-p", String(sshCfg.port));
  }

  // SSH 私钥
  if (sshCfg.keyFile) {
    args.push("-i", expandPath(sshCfg.keyFile));
  }

  // 严格接受 host key（首次连接不询问）
  args.push("-o", "StrictHostKeyChecking=no");
  args.push("-o", "BatchMode=yes");

  // 用户名和主机
  const userHost = sshCfg.user
    ? `${sshCfg.user}@${sshCfg.host}`
    : sshCfg.host;
  args.push(userHost);

  // 远程命令
  args.push(remoteCommand);

  return args;
}

function buildRemotePiCommand(typeCfg: WorkerTypeConfig): string {
  const parts: string[] = [];

  // 添加环境变量
  if (typeCfg.ssh?.env) {
    for (const [key, val] of Object.entries(typeCfg.ssh.env)) {
      parts.push(`${key}="${val}"`);
    }
  }
  if (typeCfg.env) {
    for (const [key, val] of Object.entries(typeCfg.env)) {
      parts.push(`${key}="${val}"`);
    }
  }

  // Pi 路径
  const piPath = typeCfg.ssh?.piPath ?? "pi";
  parts.push(piPath);

  // Pi 参数
  parts.push("--mode", "rpc", "--no-session");

  if (typeCfg.provider) parts.push("--provider", typeCfg.provider);
  if (typeCfg.model) parts.push("--model", typeCfg.model);
  if (typeCfg.tools?.length) parts.push("--tools", typeCfg.tools.join(","));

  // 远程技能（路径是远程机器的路径）
  if (typeCfg.skills) {
    parts.push("--no-skills");
    for (const skill of typeCfg.skills) parts.push("--skill", skill);
  }

  // 远程扩展（路径是远程机器的路径）
  if (typeCfg.extensions) {
    parts.push("--no-extensions");
    for (const ext of typeCfg.extensions) parts.push("-e", ext);
  }

  return parts.join(" ");
}

// ============ Worker 生命周期 ============

function buildPiArgs(typeCfg: WorkerTypeConfig): string[] {
  const args: string[] = ["--mode", "rpc", "--no-session"];

  if (typeCfg.model) args.push("--model", typeCfg.model);
  if (typeCfg.tools?.length) args.push("--tools", typeCfg.tools.join(","));

  if (typeCfg.skills) {
    args.push("--no-skills");
    for (const skill of typeCfg.skills) args.push("--skill", expandPath(skill));
  }

  if (typeCfg.extensions) {
    args.push("--no-extensions");
    for (const ext of typeCfg.extensions) args.push("-e", expandPath(ext));
  }

  return args;
}

function createWorker(typeKey: string, typeCfg: WorkerTypeConfig): Worker {
  const id = `${typeKey}-${randomUUID().slice(0, 6)}`;
  const isRemote = !!typeCfg.ssh?.host;

  let child: ChildProcess;

  if (isRemote) {
    // ========== 远程 Worker（SSH）==========
    const sshCfg = typeCfg.ssh!;
    const remoteCmd = buildRemotePiCommand(typeCfg);
    const sshArgs = buildSSHArgs(sshCfg, remoteCmd);

    child = spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    // ========== 本地 Worker ==========
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...typeCfg.env,
    };

    child = spawn("pi", buildPiArgs(typeCfg), {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: typeCfg.cwd ? expandPath(typeCfg.cwd) : process.cwd(),
    });
  }

  const worker: Worker = {
    id,
    type: typeKey,
    config: typeCfg,
    process: child,
    status: "idle",
    results: [],
    createdAt: Date.now(),
    taskCount: 0,
    isRemote,
  };

  // 处理 RPC 输出
  let buffer = "";
  child.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleRpcMessage(worker, JSON.parse(line));
      } catch { /* 非 JSON 忽略 */ }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      // SSH 连接错误时会有 stderr 输出
      if (msg.includes("Permission denied") || msg.includes("Connection refused")) {
        ctxRef?.ui.notify(`❌ SSH 连接失败(${id}): ${msg}`, "error");
      }
    }
  });

  child.on("exit", () => {
    worker.status = "dead";
    const location = isRemote ? "远程" : "本地";
    ctxRef?.ui.notify(`💀 ${location}${typeCfg.label}(${id}) 退出`, "info");

    if (typeCfg.autoRestart !== false) {
      setTimeout(() => {
        if (workers.has(id)) {
          workers.delete(id);
          const newWorker = createWorker(typeKey, typeCfg);
          workers.set(newWorker.id, newWorker);
          ctxRef?.ui.notify(`♻️ 重建 ${typeCfg.label}: ${newWorker.id}`, "info");
          processQueue();
        }
      }, 1000);
    }
  });

  // 初始化 RPC
  sendRpc(worker, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { systemPrompt: typeCfg.systemPrompt },
  });

  const location = isRemote ? `远程(${sshCfg!.host})` : "本地";
  ctxRef?.ui.notify(`🚀 启动 ${location} Worker: ${id}`, "info");

  return worker;
}

function sendRpc(worker: Worker, msg: any) {
  if (worker.process.stdin?.writable) {
    worker.process.stdin.write(JSON.stringify(msg) + "\n");
  }
}

function handleRpcMessage(worker: Worker, msg: any) {
  if (msg.method === "notification" && msg.params?.type === "agent_end") {
    worker.status = "idle";
    worker.currentTask = undefined;
    worker.taskCount++;

    const messages = msg.params.messages ?? [];
    const last = messages.filter((m: any) => m.role === "assistant").pop();
    const text = last?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") ?? "";

    if (text) {
      worker.results.push({
        task: worker.currentTask ?? "",
        result: text,
        timestamp: Date.now(),
      });
    }

    const location = worker.isRemote ? "远程" : "本地";
    ctxRef?.ui.notify(`✅ ${location}${worker.config.label}(${worker.id}) 完成`, "info");
    processQueue();
  }
}

// ============ 任务路由 ============

function matchWorkerType(task: string): string | undefined {
  const taskLower = task.toLowerCase();

  for (const [key, cfg] of Object.entries(config.workerTypes)) {
    if (cfg.tags?.some(tag => taskLower.includes(tag.toLowerCase()))) {
      return key;
    }
  }

  return undefined;
}

function findBestWorker(preferredType?: string): Worker | undefined {
  const idle = Array.from(workers.values()).filter(w => w.status === "idle");

  if (preferredType) {
    return idle.find(w => w.type === preferredType) ?? idle[0];
  }

  return idle[0];
}

function processQueue() {
  if (taskQueue.length === 0) return;

  const item = taskQueue.shift()!;
  const worker = findBestWorker(item.workerType);

  if (worker) {
    const fullTask = item.mode === "chain" && item.chainContext
      ? `${item.task}\n\n--- 上一步结果 ---\n${item.chainContext}`
      : item.task;

    assignTask(worker, fullTask, item.resolve, item.reject);
  } else {
    taskQueue.unshift(item);
  }

  updateStatus();
}

function assignTask(
  worker: Worker,
  task: string,
  resolve?: (r: string) => void,
  reject?: (e: Error) => void,
) {
  worker.status = "busy";
  worker.currentTask = task;

  sendRpc(worker, {
    jsonrpc: "2.0",
    method: "prompt",
    params: { text: task },
  });

  if (resolve) {
    const startIdx = worker.results.length;
    const check = setInterval(() => {
      if (worker.status === "idle") {
        clearInterval(check);
        resolve(worker.results[startIdx]?.result ?? "无结果");
      }
      if (worker.status === "dead") {
        clearInterval(check);
        reject?.(new Error(`Worker ${worker.id} 已销毁`));
      }
    }, 300);
  }
}

function assignTaskAsync(worker: Worker, task: string, chainContext?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullTask = chainContext
      ? `${task}\n\n--- 上一步结果 ---\n${chainContext}`
      : task;
    assignTask(worker, fullTask, resolve, reject);
  });
}

function enqueueTask(task: string, workerType?: string, mode: "hub" | "chain" = "hub", chainContext?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    taskQueue.push({ task, workerType, resolve, reject, mode, chainContext });
  });
}

function updateStatus() {
  if (!ctxRef) return;
  const counts = Object.keys(config.workerTypes).map(type => {
    const ws = Array.from(workers.values()).filter(w => w.type === type);
    const busy = ws.filter(w => w.status === "busy").length;
    const remote = ws.filter(w => w.isRemote).length;
    const label = remote > 0 ? `${config.workerTypes[type].label}(${remote}远程)` : config.workerTypes[type].label;
    return `${label}:${ws.length - busy}/${ws.length}`;
  });
  ctxRef.ui.setStatus("orch", `[${counts.join("|")}] 队列:${taskQueue.length}`);
}

// ============ 扩展入口 ============

export default function (pi: ExtensionAPI) {
  // 如果没有配置文件，跳过
  const configPaths = [
    resolve(process.cwd(), ".pi/orchestrator.json"),
    resolve(process.env.HOME ?? "~", ".pi/orchestrator.json"),
  ];
  const hasConfig = configPaths.some(p => existsSync(p));
  if (!hasConfig) return;

  config = loadConfig();

  // 启动
  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    ctx.ui.notify("🚀 启动 Worker 池...", "info");

    for (const [typeKey, typeCfg] of Object.entries(config.workerTypes)) {
      const count = typeCfg.count ?? 1;
      for (let i = 0; i < count; i++) {
        workers.set(createWorker(typeKey, typeCfg).id, createWorker(typeKey, typeCfg));
      }
    }

    await new Promise(r => setTimeout(r, 3000)); // 远程连接需要更多时间

    const localCount = Array.from(workers.values()).filter(w => !w.isRemote).length;
    const remoteCount = Array.from(workers.values()).filter(w => w.isRemote).length;

    const summary = Object.entries(config.workerTypes).map(([k, v]) => {
      const count = Array.from(workers.values()).filter(w => w.type === k).length;
      return `${v.label}:${count}`;
    }).join(" | ");

    ctx.ui.notify(`✅ Worker 池就绪: ${summary} (本地:${localCount} 远程:${remoteCount})`, "info");
    updateStatus();
  });

  // ==================== 星型模式命令 ====================

  pi.registerCommand("orch", {
    description: "星型模式：分发任务，结果返回主控",
    handler: async (args, ctx) => {
      if (!args) { ctx.ui.notify("用法: /orch <任务>", "info"); return; }

      const type = matchWorkerType(args);
      const worker = findBestWorker(type);

      if (worker) {
        const location = worker.isRemote ? "远程" : "本地";
        ctx.ui.notify(`📤 [星型] → ${location}${worker.config.label}: ${args}`, "info");
        assignTask(worker, args, (result) => {
          ctx.ui.notify(`📥 结果:\n${result}`, "info");
        });
      } else {
        enqueueTask(args, type, "hub").then(result => {
          ctx.ui.notify(`📥 结果:\n${result}`, "info");
        });
        ctx.ui.notify(`⏳ 已入队 (${type ?? "任意"})`, "info");
      }

      updateStatus();
    },
  });

  pi.registerCommand("orch-to", {
    description: "星型模式：指定 worker 类型执行",
    handler: async (args, ctx) => {
      const spaceIdx = args.indexOf(" ");
      if (spaceIdx === -1) {
        ctx.ui.notify("用法: /orch-to <类型> <任务>", "info");
        return;
      }

      const typeKey = args.slice(0, spaceIdx);
      const task = args.slice(spaceIdx + 1);

      if (!config.workerTypes[typeKey]) {
        ctx.ui.notify(`未知类型: ${typeKey}\n可用: ${Object.keys(config.workerTypes).join(", ")}`, "error");
        return;
      }

      const worker = findBestWorker(typeKey);
      if (worker) {
        const location = worker.isRemote ? "远程" : "本地";
        ctx.ui.notify(`📤 [星型] → ${location}${config.workerTypes[typeKey].label}: ${task}`, "info");
        assignTask(worker, task, (result) => {
          ctx.ui.notify(`📥 结果:\n${result}`, "info");
        });
      } else {
        enqueueTask(task, typeKey, "hub").then(result => {
          ctx.ui.notify(`📥 结果:\n${result}`, "info");
        });
        ctx.ui.notify(`⏳ 已入队`, "info");
      }
    },
  });

  // ==================== 链式模式命令 ====================

  pi.registerCommand("orch-chain", {
    description: "链式模式：step1 → step2 → ... 结果顺序传递",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("用法: /orch-chain <步骤1> → <步骤2> → ...\n示例: /orch-chain 写登录组件 → 写对应CSS → 写使用文档", "info");
        return;
      }

      const steps = args.split("→").map(s => s.trim()).filter(Boolean);

      if (steps.length < 2) {
        ctx.ui.notify("至少需要 2 个步骤，用 → 分隔", "info");
        return;
      }

      ctx.ui.notify(`🔗 链式执行 ${steps.length} 步:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`, "info");

      let currentResult = "";
      let currentStep = 0;

      for (const step of steps) {
        currentStep++;
        const type = matchWorkerType(step);
        const worker = findBestWorker(type);

        ctx.ui.notify(`⏳ 步骤 ${currentStep}/${steps.length}: ${step}`, "info");

        try {
          if (worker) {
            currentResult = await assignTaskAsync(worker, step, currentResult);
          } else {
            currentResult = await enqueueTask(step, type, "chain", currentResult);
          }

          ctx.ui.notify(`✅ 步骤 ${currentStep} 完成`, "info");
        } catch (err: any) {
          ctx.ui.notify(`❌ 步骤 ${currentStep} 失败: ${err.message}\n链式中断`, "error");
          return;
        }
      }

      ctx.ui.notify(`🎉 链式执行完成！最终结果:\n${currentResult}`, "info");
    },
  });

  // ==================== 通用命令 ====================

  pi.registerCommand("orch-all", {
    description: "广播任务给所有空闲 worker",
    handler: async (args, ctx) => {
      if (!args) { ctx.ui.notify("用法: /orch-all <任务>", "info"); return; }

      const idle = Array.from(workers.values()).filter(w => w.status === "idle");
      if (idle.length === 0) {
        ctx.ui.notify("没有空闲 worker", "error");
        return;
      }

      ctx.ui.notify(`📢 广播给 ${idle.length} 个 worker`, "info");
      for (const w of idle) assignTask(w, args);
    },
  });

  pi.registerCommand("orch-spawn", {
    description: "增加指定类型的 worker",
    handler: async (args, ctx) => {
      const [typeKey, countStr] = args.split(" ");
      const count = parseInt(countStr) || 1;

      if (!typeKey || !config.workerTypes[typeKey]) {
        ctx.ui.notify(`用法: /orch-spawn <类型> [数量]\n类型: ${Object.keys(config.workerTypes).join(", ")}`, "info");
        return;
      }

      for (let i = 0; i < count; i++) {
        workers.set(createWorker(typeKey, config.workerTypes[typeKey]).id, createWorker(typeKey, config.workerTypes[typeKey]));
      }

      ctx.ui.notify(`✅ 已创建 ${count} 个 ${config.workerTypes[typeKey].label}`, "info");
      updateStatus();
    },
  });

  pi.registerCommand("orch-scale", {
    description: "调整 worker 数量",
    handler: async (args, ctx) => {
      const [typeKey, countStr] = args.split(" ");
      const target = parseInt(countStr);

      if (!typeKey || !config.workerTypes[typeKey] || isNaN(target)) {
        ctx.ui.notify("用法: /orch-scale <类型> <数量>", "info");
        return;
      }

      const current = Array.from(workers.values()).filter(w => w.type === typeKey);
      const typeCfg = config.workerTypes[typeKey];

      if (target > current.length) {
        for (let i = 0; i < target - current.length; i++) {
          workers.set(createWorker(typeKey, typeCfg).id, createWorker(typeKey, typeCfg));
        }
        ctx.ui.notify(`📈 ${typeCfg.label}: ${current.length} → ${target}`, "info");
      } else if (target < current.length) {
        const toKill = current.filter(w => w.status === "idle").slice(0, current.length - target);
        for (const w of toKill) {
          w.process.kill();
          workers.delete(w.id);
        }
        ctx.ui.notify(`📉 ${typeCfg.label}: ${current.length} → ${target}`, "info");
      }

      updateStatus();
    },
  });

  pi.registerCommand("orch-status", {
    description: "查看所有 worker 状态",
    handler: async (_args, ctx) => {
      const lines: string[] = [];

      for (const [typeKey, typeCfg] of Object.entries(config.workerTypes)) {
        const ws = Array.from(workers.values()).filter(w => w.type === typeKey);
        const local = ws.filter(w => !w.isRemote);
        const remote = ws.filter(w => w.isRemote);

        lines.push(`\n【${typeCfg.label}】${ws.length} 个${remote.length > 0 ? ` (本地:${local.length} 远程:${remote.length})` : ""}`);

        for (const w of ws) {
          const emoji = w.status === "idle" ? "🟢" : w.status === "busy" ? "🟡" : "🔴";
          const age = Math.floor((Date.now() - w.createdAt) / 1000);
          const location = w.isRemote ? `远程(${w.config.ssh?.host})` : "本地";
          lines.push(`  ${emoji} ${w.id} | ${location} | ${w.status} | 任务:${w.taskCount} | ${age}s`);
          if (w.currentTask) lines.push(`     → ${w.currentTask.slice(0, 60)}`);
        }
      }

      lines.push(`\n📊 总计: ${workers.size} | 队列: ${taskQueue.length}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("orch-types", {
    description: "查看所有 worker 类型配置",
    handler: async (_args, ctx) => {
      const lines = Object.entries(config.workerTypes).map(([key, cfg]) => {
        const sshInfo = cfg.ssh
          ? `SSH → ${cfg.ssh.user ?? "当前用户"}@${cfg.ssh.host}:${cfg.ssh.port ?? 22}`
          : "本地";

        return [
          `【${key}】 ${cfg.label} [${sshInfo}]`,
          `  模型: ${cfg.model ?? "(默认)"}`,
          `  目录: ${cfg.cwd ?? "(当前)"}`,
          `  工具: ${cfg.tools?.join(", ") ?? "(默认)"}`,
          `  技能: ${cfg.skills?.join(", ") ?? "无"}`,
          `  扩展: ${cfg.extensions?.join(", ") ?? "无"}`,
          `  标签: ${cfg.tags?.join(", ") ?? "无"}`,
          `  数量: ${cfg.count ?? 1}`,
        ].join("\n");
      });
      ctx.ui.notify(lines.join("\n\n"), "info");
    },
  });

  pi.registerCommand("orch-kill", {
    description: "销毁指定 worker",
    handler: async (args, ctx) => {
      const worker = workers.get(args) ?? Array.from(workers.values()).find(w => w.id === args);
      if (!worker) {
        ctx.ui.notify(`未找到: ${args}`, "error");
        return;
      }
      worker.process.kill();
      workers.delete(worker.id);
      ctx.ui.notify(`已销毁 ${worker.config.label}(${worker.id})`, "info");
      updateStatus();
    },
  });

  // ==================== LLM 工具 ====================

  pi.registerTool({
    name: "orch_assign",
    label: "分发任务(星型)",
    description: `星型模式：分发任务给 worker，结果返回给你。类型: ${Object.keys(config.workerTypes).join(", ")}`,
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
        workerType: { type: "string", description: "指定 worker 类型（可选）" },
      },
      required: ["task"],
    },
    async execute(_id, params) {
      const type = params.workerType || matchWorkerType(params.task);
      const worker = findBestWorker(type);

      if (worker) {
        const result = await assignTaskAsync(worker, params.task);
        return {
          content: [{ type: "text", text: result }],
          details: { worker: worker.id, type, remote: worker.isRemote },
        };
      }

      const result = await enqueueTask(params.task, type, "hub");
      return {
        content: [{ type: "text", text: result }],
        details: { type },
      };
    },
  });

  pi.registerTool({
    name: "orch_chain",
    label: "链式执行",
    description: "链式模式：按顺序执行多个步骤，每步结果传给下一步。",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "按顺序执行的步骤列表",
        },
      },
      required: ["steps"],
    },
    async execute(_id, params) {
      const steps: string[] = params.steps;

      if (steps.length === 0) {
        return { content: [{ type: "text", text: "没有步骤" }], details: {}, isError: true };
      }

      let currentResult = "";
      const log: string[] = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const type = matchWorkerType(step);
        const worker = findBestWorker(type);

        log.push(`步骤 ${i + 1}: ${step}`);

        try {
          if (worker) {
            currentResult = await assignTaskAsync(worker, step, currentResult);
          } else {
            currentResult = await enqueueTask(step, type, "chain", currentResult);
          }
          log.push(`  ✅ 完成`);
        } catch (err: any) {
          log.push(`  ❌ 失败: ${err.message}`);
          return {
            content: [{ type: "text", text: `链式执行中断:\n${log.join("\n")}` }],
            details: { failedAt: i + 1 },
            isError: true,
          };
        }
      }

      return {
        content: [{ type: "text", text: `链式执行完成:\n${log.join("\n")}\n\n最终结果:\n${currentResult}` }],
        details: { steps: steps.length },
      };
    },
  });

  pi.registerTool({
    name: "orch_status",
    label: "Worker 状态",
    description: "查看 worker 池状态",
    parameters: { type: "object", properties: {} },
    async execute() {
      const lines = Object.entries(config.workerTypes).map(([key, cfg]) => {
        const ws = Array.from(workers.values()).filter(w => w.type === key);
        const idle = ws.filter(w => w.status === "idle").length;
        const remote = ws.filter(w => w.isRemote).length;
        return `${cfg.label}: ${idle}/${ws.length} 空闲${remote > 0 ? ` (${remote}远程)` : ""}`;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") || "无 worker" }],
        details: { total: workers.size, queue: taskQueue.length },
      };
    },
  });

  // 清理函数
  function cleanupWorkers() {
    const count = workers.size;
    if (count === 0) return;
    
    for (const w of workers.values()) {
      try {
        w.process.kill('SIGTERM');
      } catch {}
    }
    workers.clear();
    
    // 如果 ctx 可用，显示通知
    ctxRef?.ui.notify(`已清理 ${count} 个 Worker`, "info");
  }

  // 正常退出清理（/new, /quit, /resume 等）
  pi.on("session_shutdown", async () => {
    cleanupWorkers();
  });

  // 进程信号处理（Ctrl+C 等）
  process.on('SIGINT', () => {
    cleanupWorkers();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanupWorkers();
    process.exit(0);
  });

  // 进程退出时清理（最后防线）
  process.on('exit', () => {
    cleanupWorkers();
  });
}
