/**
 * 🦐 龙虾保姆 — Lobster Nanny
 * OpenClaw 一条龙服务伴侣工具服务器
 * 
 * 从安装到运维全包，开机引导 + 实时仪表盘 + 智能诊断 + 自动更新
 * 
 * v2.0 — 升级自 龙虾医生 v1.0
 */

const express = require('express');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 18928; // 🦐 谐音
const HOST = '127.0.0.1';
const APP_VERSION = '2.0.0';
const APP_NAME = '龙虾保姆';

app.use(express.json({ limit: '500mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Helper: 安全执行命令
// ============================================================
function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', shell: 'cmd.exe', timeout: 30000, ...opts }).toString().trim();
  } catch(e) {
    return e.stdout ? e.stdout.toString().trim() : null;
  }
}

function safeExecAsync(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 1024 * 1024, shell: 'cmd.exe', timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ success: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), error: err ? err.message : null });
    });
  });
}

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch(e) {}
  return null;
}

function getOpenclawConfig() {
  return readJsonFile(path.join(os.homedir(), '.openclaw', 'openclaw.json'));
}

function getAuthProfiles() {
  return readJsonFile(path.join(os.homedir(), '.openclaw', 'auth-profiles.json'));
}

// ============================================================
// Helper: HTTPS 请求工具（避免 API Key 泄露到命令行）
// ============================================================

function httpsGetJson(hostname, path, headers) {
  return new Promise((resolve) => {
    const options = { hostname, path, method: 'GET', headers, rejectUnauthorized: true };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data, statusCode: res.statusCode }));
    });
    req.on('error', (e) => resolve({ ok: false, data: e.message }));
    req.end();
  });
}

function httpsPostJson(hostname, path, body, headers = {}) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
      rejectUnauthorized: true,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(data), statusCode: res.statusCode }); }
        catch(e) { resolve({ ok: false, data: data, statusCode: res.statusCode }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, data: e.message }));
    req.write(bodyStr);
    req.end();
  });
}

async function testFeishuConnection(appId, appSecret) {
  const result = await httpsPostJson('open.feishu.cn', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret });
  return (result.ok && result.data && result.data.code === 0) ? 'ok' : 'fail';
}

async function testDeepSeekKey(apiKey) {
  const result = await httpsGetJson('api.deepseek.com', '/models', { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' });
  return result.ok ? 'ok' : 'fail';
}

// ============================================================
// API: 系统检测 (升级版)
// ============================================================
app.get('/api/status', (req, res) => {
  const checks = {
    node: false,
    openclaw: false,
    ffmpeg: false,
    git: false,
    powershell: true,
    gateway: false,
    workspace: false,
  };

  try { execSync('node --version', { stdio: 'pipe' }); checks.node = true; } catch(e) {}
  try { execSync('openclaw --version 2>nul || call openclaw --version', { stdio: 'pipe', shell: 'cmd.exe' }); checks.openclaw = true; } catch(e) {}
  try { execSync('ffmpeg -version', { stdio: 'pipe' }); checks.ffmpeg = true; } catch(e) {}
  try { execSync('git --version', { stdio: 'pipe' }); checks.git = true; } catch(e) {}
  
  const ws = path.join(os.homedir(), '.openclaw', 'workspace');
  checks.workspace = fs.existsSync(ws);
  
  const gw = path.join(os.homedir(), '.openclaw', 'gateway.json');
  checks.gateway = fs.existsSync(gw);

  const config = getOpenclawConfig();

  res.json({ checks, config });
});

// ============================================================
// API: 实时仪表盘 (新增)
// ============================================================
app.get('/api/dashboard', (req, res) => {
  // Gateway 在线检测
  let gatewayOnline = false;
  try {
    const gwInfo = safeExec('openclaw gateway status 2>nul || call openclaw gateway status', { timeout: 5000 });
    gatewayOnline = gwInfo && (gwInfo.includes('running') || gwInfo.includes('online'));
  } catch(e) {}

  // 系统资源
  const cpuInfo = os.cpus();
  const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : '未知';
  const cpuCores = cpuInfo.length;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsage = totalMem > 0 ? ((1 - freeMem / totalMem) * 100).toFixed(1) : 0;
  const uptime = os.uptime();

  // 飞书连接状态
  const config = getOpenclawConfig();
  let feishuConfigured = false;
  let feishuAppId = '';
  if (config && config.channels && config.channels.feishu && config.channels.feishu.enabled) {
    feishuConfigured = true;
    feishuAppId = config.channels.feishu.appId || '';
  }

  // 模型可用性
  const auth = getAuthProfiles();
  const configuredModels = [];
  if (auth) {
    if (auth['deepseek:default']) configuredModels.push('DeepSeek');
    if (auth['aliyun:default']) configuredModels.push('阿里云');
    if (auth['openai:default']) configuredModels.push('OpenAI');
  }

  // 技能已安装
  let installedSkills = [];
  try {
    const skillsInfo = safeExec('openclaw skills list 2>nul || call openclaw skills list', { timeout: 10000 });
    if (skillsInfo) {
      installedSkills = skillsInfo.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('No') && !l.startsWith('Skill'))
        .slice(0, 10);
    }
  } catch(e) {}

  // 磁盘信息
  let diskFree = '未知';
  let diskTotal = '未知';
  try {
    const diskInfo = safeExec('wmic logicaldisk where drivetype=3 get size,freespace,deviceid /format:csv', { timeout: 5000 });
    if (diskInfo) {
      const lines = diskInfo.split('\n').filter(l => l.trim() && !l.includes('DeviceID'));
      if (lines.length > 0) {
        const parts = lines[0].split(',').filter(Boolean);
        if (parts.length >= 3) {
          diskFree = (parseInt(parts[1]) / (1024*1024*1024)).toFixed(1) + ' GB';
          diskTotal = (parseInt(parts[2]) / (1024*1024*1024)).toFixed(1) + ' GB';
        }
      }
    }
  } catch(e) {}

  // Onboarding 状态
  const onboardingFlag = path.join(os.homedir(), '.openclaw', '.onboarding_complete');
  const onboardingComplete = fs.existsSync(onboardingFlag);

  res.json({
    version: APP_VERSION,
    appName: APP_NAME,
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpuModel,
      cpuCores,
      cpuLoad: os.loadavg ? os.loadavg()[0].toFixed(1) : 'N/A',
      memTotal: (totalMem / (1024*1024*1024)).toFixed(1) + ' GB',
      memFree: (freeMem / (1024*1024*1024)).toFixed(1) + ' GB',
      memUsage: memUsage + '%',
      uptime: Math.floor(uptime / 86400) + 'd ' + Math.floor((uptime % 86400) / 3600) + 'h',
      diskFree,
      diskTotal,
    },
    services: {
      gatewayOnline,
      feishuConfigured,
      feishuAppId,
      configuredModels,
      installedSkills: installedSkills.length,
    },
    onboardingComplete,
  });
});

// ============================================================
// API: 智能诊断 (新增)
// ============================================================
app.get('/api/diagnostics', async (req, res) => {
  const issues = [];

  // 1. 检查 Node.js
  const nodeVer = safeExec('node --version');
  if (!nodeVer) {
    issues.push({ severity: 'critical', category: '环境', title: 'Node.js 未安装', fix: '请从 https://nodejs.org 下载安装 Node.js v18+', autoFixable: false });
  } else {
    const ver = nodeVer.replace('v', '');
    const major = parseInt(ver.split('.')[0]);
    if (major < 18) {
      issues.push({ severity: 'warning', category: '环境', title: `Node.js 版本过低 (${nodeVer})`, fix: '建议升级到 v18+，当前版本可能不兼容', autoFixable: false });
    }
  }

  // 2. 检查 OpenClaw
  const ocVer = safeExec('openclaw --version 2>nul || call openclaw --version');
  if (!ocVer) {
    issues.push({ severity: 'critical', category: '核心', title: 'OpenClaw 未安装', fix: '使用智能安装功能安装 OpenClaw', autoFixable: true, fixEndpoint: '/api/install/openclaw' });
  }

  // 3. 检查 Gateway 配置
  const gwPath = path.join(os.homedir(), '.openclaw', 'gateway.json');
  if (!fs.existsSync(gwPath)) {
    issues.push({ severity: 'warning', category: '核心', title: 'Gateway 未配置', fix: 'OpenClaw 安装后需启动 Gateway 生成配置文件', autoFixable: false });
  } else {
    try {
      const gw = JSON.parse(fs.readFileSync(gwPath, 'utf8'));
      // 检查 Gateway 是否在运行
      let gwRunning = false;
      try {
        const status = safeExec('openclaw gateway status 2>nul || call openclaw gateway status', { timeout: 3000 });
        gwRunning = status && (status.includes('running') || status.includes('online'));
      } catch(e) {}
      if (!gwRunning) {
        issues.push({ severity: 'warning', category: '核心', title: 'Gateway 未运行', fix: '尝试重启 Gateway', autoFixable: true, fixEndpoint: '/api/gateway/restart' });
      }
    } catch(e) {
      issues.push({ severity: 'error', category: '核心', title: 'Gateway 配置文件损坏', fix: '删除 gateway.json 并重新启动 Gateway', autoFixable: false });
    }
  }

  // 4. 检查飞书配置
  const config = getOpenclawConfig();
  if (config && config.channels && config.channels.feishu && config.channels.feishu.enabled) {
    const appId = config.channels.feishu.appId || '';
    const appSecret = config.channels.feishu.appSecret || '';
    if (!appId || !appSecret) {
      issues.push({ severity: 'warning', category: '飞书', title: '飞书配置不完整', fix: '请在「飞书助手」中填写完整的 App ID 和 App Secret', autoFixable: false });
    } else {
      // 验证飞书连通性（安全方式，不泄露 Secret）
      const testResult = await testFeishuConnection(appId, appSecret);
      if (testResult !== 'ok') {
        issues.push({ severity: 'error', category: '飞书', title: '飞书连接失败', fix: '检查 App ID 和 App Secret 是否有效，或在飞书开放平台重新发布应用', autoFixable: false });
      }
    }
  } else {
    issues.push({ severity: 'info', category: '飞书', title: '飞书未配置', fix: '如需使用飞书机器人，请先在「飞书助手」中配置', autoFixable: false });
  }

  // 5. 检查模型配置
  const auth = getAuthProfiles();
  const configuredModels = [];
  if (auth) {
    if (auth['deepseek:default']) configuredModels.push('DeepSeek');
    if (auth['aliyun:default']) configuredModels.push('阿里云');
    if (auth['openai:default']) configuredModels.push('OpenAI');
  }
  if (configuredModels.length === 0) {
    issues.push({ severity: 'info', category: '模型', title: '未配置 AI 模型', fix: '在「模型管家」中配置任意 API Key 即可使用 AI 功能', autoFixable: false });
  } else {
    // 验证 DeepSeek key 是否有效（安全方式，不泄露 Key）
    if (configuredModels.includes('DeepSeek')) {
      const key = auth['deepseek:default'].apiKey || '';
      if (key && key.length > 10) {
        const testResult = await testDeepSeekKey(key);
        if (testResult !== 'ok') {
          issues.push({ severity: 'error', category: '模型', title: 'DeepSeek API Key 无效', fix: '请检查 DeepSeek API Key 是否正确，或在「模型管家」中重新配置', autoFixable: false });
        }
      }
    }
  }

  // 6. 检查工作区
  const ws = path.join(os.homedir(), '.openclaw', 'workspace');
  if (!fs.existsSync(ws)) {
    issues.push({ severity: 'warning', category: '工作区', title: '工作区目录不存在', fix: 'OpenClaw 启动后会自动创建工作区', autoFixable: false });
  } else {
    const vitalFiles = ['AGENTS.md', 'USER.md'];
    const missing = vitalFiles.filter(f => !fs.existsSync(path.join(ws, f)));
    if (missing.length > 0) {
      issues.push({ severity: 'warning', category: '工作区', title: `缺少关键文件: ${missing.join(', ')}`, fix: '运行「一键急救」恢复关键文件', autoFixable: true, fixEndpoint: '/api/emergency/restore' });
    }
  }

  // 7. 检查 Git
  const gitVer = safeExec('git --version');
  if (!gitVer) {
    issues.push({ severity: 'info', category: '工具', title: 'Git 未安装', fix: '安装 Git 以使用版本控制功能（可选）', autoFixable: false });
  }

  // 8. 检查 FFmpeg
  const ffVer = safeExec('ffmpeg -version');
  if (!ffVer) {
    issues.push({ severity: 'info', category: '工具', title: 'FFmpeg 未安装', fix: '安装 FFmpeg 以使用视频分析功能（可选）', autoFixable: false });
  }

  // 9. 检查 npm 全局权限
  const wsDir = path.join(os.homedir(), '.openclaw');
  let workspaceOk = false;
  try {
    fs.accessSync(wsDir, fs.constants.W_OK);
    workspaceOk = true;
  } catch(e) {}

  // 10. 检查是否有多个龙虾实例
  // skip - self diagnostic

  // 计算总体健康度
  const critical = issues.filter(i => i.severity === 'critical').length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  let healthScore = 100;
  healthScore -= critical * 25;
  healthScore -= errors * 15;
  healthScore -= warnings * 10;
  healthScore -= infos * 5;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const status = healthScore >= 80 ? 'healthy' : (healthScore >= 50 ? 'fair' : 'poor');

  res.json({
    healthScore,
    status,
    summary: {
      total: issues.length,
      critical,
      error: errors,
      warning: warnings,
      info: infos,
    },
    issues,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// API: 诊断一键修复
// ============================================================
app.post('/api/diagnostics/fix', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.json({ success: false, error: '未指定修复端点' });

  if (endpoint === '/api/install/openclaw') {
    const result = await safeExecAsync('npm install -g openclaw');
    return res.json({ success: result.success, output: result.stdout + '\n' + result.stderr, error: result.error });
  }
  
  if (endpoint === '/api/emergency/restore') {
    // 触发急诊恢复
    const ws = path.join(os.homedir(), '.openclaw', 'workspace');
    const result = await safeExecAsync(`cd /d "${ws}" && git checkout HEAD -- IDENTITY.md USER.md SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md RECOVERY.md 2>nul`);
    return res.json({ success: true, output: '✅ 已尝试恢复关键文件\n' + (result.stdout || ''), error: null });
  }

  if (endpoint === '/api/gateway/restart') {
    const result = await safeExecAsync('openclaw gateway restart 2>nul || call openclaw gateway restart');
    return res.json({ success: true, output: result.stdout || 'Gateway 重启指令已发送', error: null });
  }

  res.json({ success: false, error: '未知修复端点: ' + endpoint });
});

// ============================================================
// API: Gateway 重启
// ============================================================
app.post('/api/gateway/restart', (req, res) => {
  const openclawCmd = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd');
  exec(`start "" /B "${openclawCmd}" gateway restart >nul 2>&1`, { shell: 'cmd.exe' });
  res.json({ success: true, message: 'Gateway 重启指令已发送' });
});

// ============================================================
// API: 安装 OpenClaw
// ============================================================
app.post('/api/install/openclaw', (req, res) => {
  const script = `
    $ErrorActionPreference = "Stop"
    Write-Output "🔍 检查 Node.js..."
    node --version
    Write-Output "📦 安装/更新 OpenClaw..."
    npm install -g openclaw
    Write-Output "✅ OpenClaw 安装完成!"
    openclaw --version
  `;
  
  exec(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { 
    maxBuffer: 1024 * 1024,
    shell: 'cmd.exe'
  }, (err, stdout, stderr) => {
    res.json({ 
      success: !err, 
      output: stdout + (stderr ? '\n⚠️ ' + stderr : ''),
      error: err ? err.message : null
    });
  });
});

// ============================================================
// API: 安装 Node.js (引导用)
// ============================================================
app.get('/api/install/nodejs-guide', (req, res) => {
  res.json({
    success: true,
    message: '请从 Node.js 官网下载安装包',
    url: 'https://nodejs.org',
    instructions: `
1. 打开 https://nodejs.org
2. 下载 LTS 版本（左侧）
3. 运行安装包，一路默认即可
4. 安装完成后回到本页面继续
    `.trim()
  });
});

// ============================================================
// API: 修复 PowerShell 执行策略
// ============================================================
app.post('/api/fix/powershell', (req, res) => {
  exec('powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"', (err, stdout, stderr) => {
    res.json({ success: !err, output: stdout, error: err ? err.message : null });
  });
});

// ============================================================
// API: 飞书配置助手
// ============================================================
app.post('/api/config/feishu', (req, res) => {
  const { appId, appSecret } = req.body;
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  
  if (!fs.existsSync(configPath)) {
    return res.json({ success: false, error: '未找到 openclaw.json 配置文件' });
  }

  try {
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.channels = config.channels || {};
    config.channels.feishu = {
      enabled: true,
      appId: appId,
      appSecret: appSecret,
      connectionMode: "websocket",
      domain: "feishu",
      groupPolicy: "open",
      dmPolicy: "open"
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    // 重启 Gateway
    const openclawCmd = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd');
    exec(`start "" /B "${openclawCmd}" gateway restart >nul 2>&1`, { shell: 'cmd.exe' });
    
    res.json({ success: true, message: '✅ 飞书配置已写入，Gateway 正在重启...' });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// API: 测试飞书连接
// ============================================================
app.post('/api/test/feishu', async (req, res) => {
  const { appId, appSecret } = req.body;
  
  const result = await httpsPostJson('open.feishu.cn', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret });
  
  if (result.ok && result.data && result.data.code === 0) {
    const preview = result.data.tenant_access_token ? result.data.tenant_access_token.substring(0, 10) + '...' : 'N/A';
    res.json({ output: `✅ 连接成功! Tenant: ${preview}` });
  } else if (result.data && result.data.msg) {
    res.json({ output: `❌ 错误: ${result.data.msg}` });
  } else {
    res.json({ output: `❌ 连接失败: ${result.data || '未知错误'}` });
  }
});

// ============================================================
// API: 模型管家 - 保存 API Key
// ============================================================
app.post('/api/config/model', (req, res) => {
  const { provider, apiKey, baseUrl } = req.body;
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  
  if (!fs.existsSync(configPath)) {
    return res.json({ success: false, error: '未找到配置文件' });
  }

  try {
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    
    if (provider === 'deepseek') {
      config.models.providers.deepseek = {
        baseUrl: baseUrl || "https://api.deepseek.com",
        api: "openai-completions",
        ...config.models.providers.deepseek
      };
      config.auth = config.auth || {};
      config.auth.profiles = config.auth.profiles || {};
      config.auth.profiles["deepseek:default"] = { provider: "deepseek", mode: "api_key" };
    } else if (provider === 'aliyun') {
      config.models.providers.aliyun = {
        baseUrl: baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api: "openai-completions",
        ...config.models.providers.aliyun
      };
      config.auth = config.auth || {};
      config.auth.profiles = config.auth.profiles || {};
      config.auth.profiles["aliyun:default"] = { provider: "aliyun", mode: "api_key" };
    } else if (provider === 'openai') {
      config.models.providers.openai = {
        baseUrl: baseUrl || "https://api.openai.com/v1",
        api: "openai-completions",
        ...config.models.providers.openai
      };
      config.auth = config.auth || {};
      config.auth.profiles = config.auth.profiles || {};
      config.auth.profiles["openai:default"] = { provider: "openai", mode: "api_key" };
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    const authPath = path.join(os.homedir(), '.openclaw', 'auth-profiles.json');
    let auth = {};
    if (fs.existsSync(authPath)) {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    }
    auth[`${provider}:default`] = { apiKey: apiKey };
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');

    res.json({ success: true, message: `✅ ${provider} 配置已保存` });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// API: 技能商店 - 安装 Skill
// ============================================================
app.post('/api/skills/install', (req, res) => {
  const { slug } = req.body;
  const openclawCmd = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd');
  
  exec(`"${openclawCmd}" skills install "${slug}" --force`, { 
    maxBuffer: 1024 * 1024,
    shell: 'cmd.exe'
  }, (err, stdout, stderr) => {
    res.json({ 
      success: !err, 
      output: stdout + (stderr ? '\n⚠️ ' + stderr : ''),
      error: err ? `安装失败: ${err.message}` : null
    });
  });
});

// ============================================================
// API: 技能商店 - 搜索 Skill
// ============================================================
app.get('/api/skills/search', (req, res) => {
  const { q } = req.query;
  const openclawCmd = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd');
  
  exec(`"${openclawCmd}" skills search "${q || ''}"`, { 
    maxBuffer: 1024 * 1024,
    shell: 'cmd.exe'
  }, (err, stdout) => {
    const lines = stdout.split('\n').filter(l => l.trim());
    const skills = lines.map(line => {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 2) {
        return { slug: parts[0].trim(), name: parts[1].trim(), desc: parts.slice(2).join(' ').trim() };
      }
      return null;
    }).filter(Boolean);
    res.json({ skills });
  });
});

// ============================================================
// API: 急诊中心 - 一键抢救
// ============================================================
app.post('/api/emergency/restore', (req, res) => {
  const ws = path.join(os.homedir(), '.openclaw', 'workspace');
  const backupDir = path.join(os.homedir(), '.openclaw', 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  let backupPath = null;
  if (fs.existsSync(ws)) {
    backupPath = path.join(backupDir, `pre-restore-${timestamp}`);
    fs.mkdirSync(backupPath, { recursive: true });
    
    const criticalFiles = ['IDENTITY.md', 'USER.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'RECOVERY.md'];
    criticalFiles.forEach(f => {
      const src = path.join(ws, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupPath, f));
      }
    });
    
    const memDir = path.join(ws, 'memory');
    if (fs.existsSync(memDir)) {
      fs.mkdirSync(path.join(backupPath, 'memory'), { recursive: true });
      fs.cpSync(memDir, path.join(backupPath, 'memory'), { recursive: true });
    }
  }

  exec(`cd /d "${ws}" && git checkout HEAD -- IDENTITY.md USER.md SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md RECOVERY.md 2>nul && git checkout HEAD -- "memory/" 2>nul && git checkout HEAD -- ".learnings/" 2>nul`, { 
    shell: 'cmd.exe',
    maxBuffer: 1024 * 1024
  }, (err, stdout, stderr) => {
    const openclawCmd = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd');
    exec(`start "" /B "${openclawCmd}" gateway restart >nul 2>&1`, { shell: 'cmd.exe' });
    
    const keyFiles = ['IDENTITY.md', 'USER.md', 'SOUL.md'];
    const missing = keyFiles.filter(f => !fs.existsSync(path.join(ws, f)));
    
    if (missing.length > 0 && backupPath) {
      keyFiles.forEach(f => {
        const src = path.join(backupPath, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(ws, f));
        }
      });
    }

    res.json({
      success: true,
      restored: keyFiles.filter(f => fs.existsSync(path.join(ws, f))),
      backupSaved: !!backupPath,
      backupPath: backupPath,
      message: missing.length === 0 ? '✅ 抢救成功！所有关键文件已恢复' : `⚠️ 部分文件恢复，缺失: ${missing.join(', ')}`
    });
  });
});

// ============================================================
// API: 备份医生
// ============================================================
app.post('/api/backup/create', (req, res) => {
  const ws = path.join(os.homedir(), '.openclaw', 'workspace');
  const backupDir = path.join(os.homedir(), '.openclaw', 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `backup-${timestamp}`);
  
  fs.mkdirSync(backupPath, { recursive: true });
  
  const items = ['IDENTITY.md', 'USER.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'RECOVERY.md', 'HEARTBEAT.md', 'memory', '.learnings'];
  let restored = [];
  
  items.forEach(item => {
    const src = path.join(ws, item);
    if (fs.existsSync(src)) {
      const dest = path.join(backupPath, item);
      if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
      restored.push(item);
    }
  });
  
  const allBackups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup-'))
    .sort()
    .reverse();
  allBackups.slice(5).forEach(f => {
    fs.rmSync(path.join(backupDir, f), { recursive: true, force: true });
  });

  res.json({ success: true, backupPath, restored, count: restored.length });
});

// ============================================================
// API: 备份列表
// ============================================================
app.get('/api/backup/list', (req, res) => {
  const backupDir = path.join(os.homedir(), '.openclaw', 'backups');
  if (!fs.existsSync(backupDir)) {
    return res.json({ backups: [] });
  }
  
  const backups = fs.readdirSync(backupDir)
    .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory())
    .map(f => {
      const stat = fs.statSync(path.join(backupDir, f));
      return { name: f, time: stat.mtime, size: getDirSize(path.join(backupDir, f)) };
    })
    .sort((a, b) => b.time - a.time);
  
  res.json({ backups });
});

function getDirSize(dir) {
  let size = 0;
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) size += getDirSize(full);
      else size += fs.statSync(full).size;
    }
  } catch(e) {}
  return size;
}

// ============================================================
// API: 急诊日志
// ============================================================
app.get('/api/logs', (req, res) => {
  const logDir = path.join(os.homedir(), '.openclaw', 'logs');
  let logs = [];
  if (fs.existsSync(logDir)) {
    logs = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, time: fs.statSync(path.join(logDir, f)).mtime }));
  }
  res.json({ logs });
});

// ============================================================
// API: 引导向导 - 检查步骤 (新增)
// ============================================================
app.get('/api/onboarding/check', (req, res) => {
  const steps = [
    { id: 'system', title: '检测系统环境', done: true, icon: '🖥️' },
    { id: 'node', title: '安装 Node.js', 
      done: (() => { try { execSync('node --version', { stdio: 'pipe' }); return true; } catch(e) { return false; } })(),
      icon: '🟢' },
    { id: 'openclaw', title: '安装 OpenClaw',
      done: (() => { try { execSync('openclaw --version 2>nul || call openclaw --version', { stdio: 'pipe', shell: 'cmd.exe' }); return true; } catch(e) { return false; } })(),
      icon: '🦐' },
    { id: 'feishu', title: '配置飞书',
      icon: '💬',
      done: (() => {
        const cfg = getOpenclawConfig();
        return !!(cfg && cfg.channels && cfg.channels.feishu && cfg.channels.feishu.enabled && cfg.channels.feishu.appId);
      })() },
    { id: 'model', title: '配置 AI 模型',
      icon: '🤖',
      done: (() => {
        const auth = getAuthProfiles();
        return !!(auth && (auth['deepseek:default'] || auth['aliyun:default'] || auth['openai:default']));
      })() },
    { id: 'complete', title: '完成！', done: false, icon: '🎉' },
  ];

  const completed = steps.filter(s => s.done).length;
  const total = steps.length;
  const currentStep = steps.findIndex(s => !s.done);
  
  // 检查是否全部完成
  const allDone = completed >= total - 1; // -1 because 'complete' step is always false

  res.json({
    steps,
    progress: Math.round((completed / total) * 100),
    currentStep: currentStep >= 0 ? currentStep : total - 1,
    allDone,
    isFreshInstall: !allDone,
  });
});

// ============================================================
// API: 引导向导 - 标记完成 / 跳过 (新增)
// ============================================================
app.post('/api/onboarding/complete', (req, res) => {
  const flagFile = path.join(os.homedir(), '.openclaw', '.onboarding_complete');
  try {
    fs.writeFileSync(flagFile, new Date().toISOString(), 'utf8');
    res.json({ success: true, message: '✅ 引导完成标记已保存' });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// API: 自动更新检查 (新增)
// ============================================================
app.get('/api/update/check', (req, res) => {
  // 检查 npm 上是否有新版本
  const currentVersion = APP_VERSION;
  
  // 获取 npm 上的最新版本
  exec('npm view openclaw version 2>nul', { shell: 'cmd.exe', timeout: 10000 }, (err, stdout) => {
    const npmVersion = stdout ? stdout.trim() : null;
    
    // 获取龙虾保姆自身更新 (通过 GitHub)
    const selfUpdateUrl = 'https://api.github.com/repos/openclaw/lobster-nanny/releases/latest';
    https.get(selfUpdateUrl, { headers: { 'User-Agent': 'lobster-nanny/2.0', 'Accept': 'application/json' } }, (selfRes) => {
      let data = '';
      selfRes.on('data', chunk => data += chunk);
      selfRes.on('end', () => {
        let selfUpdate = null;
        try {
          const release = JSON.parse(data);
          if (release.tag_name && release.tag_name !== `v${currentVersion}`) {
            selfUpdate = {
              version: release.tag_name,
              url: release.html_url,
              notes: release.body ? release.body.substring(0, 500) : '',
              published_at: release.published_at,
            };
          }
        } catch(e) {
          // GitHub API 可能限流, 忽略
        }

        res.json({
          currentVersion,
          openclaw: {
            installed: (() => { try { return safeExec('openclaw --version 2>nul || call openclaw --version') || '未知'; } catch(e) { return '未安装'; } })(),
            latest: npmVersion || '未知',
            hasUpdate: npmVersion ? npmVersion !== safeExec('openclaw --version 2>nul || call openclaw --version') : false,
          },
          self: {
            currentVersion,
            updateAvailable: !!selfUpdate,
            update: selfUpdate,
          },
          timestamp: new Date().toISOString(),
        });
      });
    }).on('error', () => {
      res.json({
        currentVersion,
        openclaw: { installed: (safeExec('openclaw --version 2>nul || call openclaw --version')) || '未知', latest: npmVersion || '未知', hasUpdate: false },
        self: { currentVersion, updateAvailable: false, update: null },
        timestamp: new Date().toISOString(),
      });
    });
  });
});

// ============================================================
// API: 一键部署 - 生成 Docker/Nginx 配置 (新增)
// ============================================================
app.post('/api/deploy/generate', (req, res) => {
  const { type, name, port, domain } = req.body;
  
  if (type === 'docker') {
    const dockerfile = `FROM node:20-alpine
WORKDIR /app

# 安装 OpenClaw
RUN npm install -g openclaw

# 复制配置文件
COPY openclaw.json /root/.openclaw/
COPY auth-profiles.json /root/.openclaw/

# 暴露端口
EXPOSE ${port || 18928}

# 启动命令
CMD ["npx", "openclaw", "gateway", "start"]
`;
    const dockerCompose = `version: '3.8'
services:
  openclaw:
    build: .
    container_name: ${name || 'openclaw-gateway'}
    ports:
      - "${port || 18928}:${port || 18928}"
    volumes:
      - ./data:/root/.openclaw
    restart: unless-stopped
    environment:
      - NODE_ENV=production
`;
    const readme = `# ${name || 'OpenClaw'} Docker 部署

## 使用方法

1. 将 openclaw.json 和 auth-profiles.json 放在当前目录
2. 运行:

\`\`\`bash
docker-compose up -d
\`\`\`

3. 查看日志:

\`\`\`bash
docker-compose logs -f
\`\`\`
`;
    return res.json({
      success: true,
      type: 'docker',
      files: {
        'Dockerfile': dockerfile,
        'docker-compose.yml': dockerCompose,
        'README.md': readme,
      }
    });
  }
  
  if (type === 'nginx') {
    const nginxConfig = `# ${name || 'OpenClaw'} Nginx 反向代理配置
# 请将 example.com 替换为你的实际域名

server {
    listen 80;
    server_name ${domain || 'example.com'};
    
    # 重定向 HTTP → HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain || 'example.com'};
    
    # SSL 证书配置 (请使用 certbot 或自行申请)
    ssl_certificate /etc/letsencrypt/live/${domain || 'example.com'}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain || 'example.com'}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # 代理到 OpenClaw Gateway
    location / {
        proxy_pass http://127.0.0.1:${port || 18928};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
    
    # 限制上传大小 (根据需求调整)
    client_max_body_size 100m;
    
    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
}
`;
    const certbotGuide = `# Let's Encrypt SSL 证书获取 (使用 Certbot)

# 1. 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 2. 获取证书
sudo certbot --nginx -d ${domain || 'example.com'}

# 3. 自动续期 (certbot 会自动添加 systemd timer)
# 测试续期:
sudo certbot renew --dry-run
`;
    return res.json({
      success: true,
      type: 'nginx',
      files: {
        'nginx.conf': nginxConfig,
        'ssl-setup.md': certbotGuide,
      }
    });
  }

  if (type === 'systemd') {
    const serviceContent = `[Unit]
Description=${name || 'OpenClaw Gateway'} Service
After=network.target

[Service]
Type=simple
User=${os.userInfo().username}
ExecStart=${path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd')} gateway start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
    return res.json({
      success: true,
      type: 'systemd',
      files: {
        'openclaw-gateway.service': serviceContent,
        'README.md': `# Systemd 服务配置

## 安装

\`\`\`bash
sudo cp openclaw-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openclaw-gateway
sudo systemctl start openclaw-gateway
\`\`\`

## 管理

\`\`\`bash
sudo systemctl status openclaw-gateway
sudo systemctl restart openclaw-gateway
sudo journalctl -u openclaw-gateway -f
\`\`\`
`
      }
    });
  }

  res.json({ success: false, error: '不支持的部署类型: ' + type });
});

// ============================================================
// API: 用户反馈 - 复制诊断信息 (新增)
// ============================================================
app.get('/api/diagnostics/copy', async (req, res) => {
  let info = '';
  
  info += `=== 🦐 龙虾保姆 诊断信息 ===\n`;
  info += `时间: ${new Date().toLocaleString('zh-CN')}\n`;
  info += `版本: ${APP_VERSION}\n`;
  info += `主机: ${os.hostname()}\n`;
  info += `系统: ${os.platform()} ${os.arch()}\n`;
  info += `\n`;

  // Node.js 版本
  info += `--- 环境 ---\n`;
  info += `Node.js: ${safeExec('node --version') || '未安装'}\n`;
  info += `npm: ${safeExec('npm --version') || '未安装'}\n`;
  info += `OpenClaw: ${safeExec('openclaw --version 2>nul || call openclaw --version') || '未安装'}\n`;
  info += `Git: ${safeExec('git --version') || '未安装'}\n`;
  info += `FFmpeg: ${safeExec('ffmpeg -version').split('\n')[0] || '未安装'}\n`;
  info += `\n`;

  // 系统资源
  info += `--- 系统资源 ---\n`;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  info += `内存: ${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB 空闲\n`;
  info += `CPU: ${os.cpus().length} 核\n`;
  info += `运行时间: ${Math.floor(os.uptime() / 86400)}d ${Math.floor((os.uptime() % 86400) / 3600)}h\n`;
  info += `\n`;

  // 配置状态
  info += `--- 配置状态 ---\n`;
  const config = getOpenclawConfig();
  info += `飞书配置: ${(config && config.channels && config.channels.feishu && config.channels.feishu.enabled) ? '已配置' : '未配置'}\n`;
  const auth = getAuthProfiles();
  if (auth) {
    const models = Object.keys(auth).join(', ');
    info += `已配置模型: ${models || '无'}\n`;
  } else {
    info += `已配置模型: 无\n`;
  }
  info += `Gateway 配置: ${fs.existsSync(path.join(os.homedir(), '.openclaw', 'gateway.json')) ? '存在' : '不存在'}\n`;
  info += `工作区: ${fs.existsSync(path.join(os.homedir(), '.openclaw', 'workspace')) ? '存在' : '不存在'}\n`;
  info += `\n`;

  // 错误日志 (最近5条)
  info += `--- 最近日志 ---\n`;
  const logDir = path.join(os.homedir(), '.openclaw', 'logs');
  if (fs.existsSync(logDir)) {
    const logs = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, 3);
    for (const logFile of logs) {
      try {
        const content = fs.readFileSync(path.join(logDir, logFile), 'utf8').split('\n').slice(-10).join('\n');
        info += `[${logFile}]\n${content}\n\n`;
      } catch(e) {}
    }
  } else {
    info += `无日志目录\n`;
  }

  info += `=== 诊断信息结束 ===\n`;

  res.json({
    success: true,
    info,
    lines: info.split('\n').length,
  });
});

// ============================================================
// API: 视频智能分析
// ============================================================

function findFfmpeg() {
  const paths = ['ffmpeg', 'D:\\ffmpeg\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe'];
  for (let i = 0; i < paths.length; i++) {
    try { execSync('"' + paths[i] + '" -version', { stdio: 'pipe' }); return paths[i]; } catch(e) {}
  }
  try {
    const r = execSync('where ffmpeg 2>nul', { encoding: 'utf8', shell: 'cmd.exe' });
    const line = r.trim().split('\r\n')[0] || r.trim().split('\n')[0];
    if (line) return line;
  } catch(e) {}
  return null;
}
const FFMPEG_PATH = findFfmpeg();
const analysisTasks = new Map();

function getDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const authPath = path.join(os.homedir(), '.openclaw', 'auth-profiles.json');
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (auth['deepseek:default']?.apiKey) return auth['deepseek:default'].apiKey;
    }
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const key = config.auth?.profiles?.['deepseek:default']?.apiKey;
      if (key) return key;
    }
  } catch(e) {}
  return null;
}

function getVideoInfo(videoPath) {
  const cmd = `"${FFMPEG_PATH}" -i "${videoPath}" 2>&1`;
  let output = '';
  try {
    output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe', shell: 'cmd.exe' });
  } catch(e) {
    output = e.stdout || e.stderr || e.message || '';
  }
  const info = { duration: 0, width: 0, height: 0, codec: '', format: '' };
  const durM = output.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
  if (durM) {
    info.duration = parseInt(durM[1]) * 3600 + parseInt(durM[2]) * 60 + parseInt(durM[3]) + parseInt(durM[4]) / 100;
  }
  const resM = output.match(/(\d+)x(\d+)[,\s]/);
  if (resM) { info.width = parseInt(resM[1]); info.height = parseInt(resM[2]); }
  const codecM = output.match(/Video:\s*(\w+)/);
  if (codecM) info.codec = codecM[1];
  const fmtM = output.match(/Input #0, (\w+)/);
  if (fmtM) info.format = fmtM[1];
  return info;
}

function extractFrames(videoPath, tmpDir, numFrames) {
  const frames = [];
  const info = getVideoInfo(videoPath);
  const duration = info.duration;
  if (duration <= 0) throw new Error('无法获取视频时长，文件可能已损坏');
  const count = Math.min(numFrames, Math.max(1, Math.floor(duration / 2)));
  const interval = duration / count;
  for (let i = 0; i < count; i++) {
    const time = Math.min(i * interval, duration - 0.5);
    const frameFile = path.join(tmpDir, `frame_${i}.jpg`);
    const cmd = `"${FFMPEG_PATH}" -ss ${time} -i "${videoPath}" -vframes 1 -q:v 3 -y "${frameFile}" 2>&1`;
    try {
      execSync(cmd, { stdio: 'pipe', shell: 'cmd.exe' });
      if (fs.existsSync(frameFile) && fs.statSync(frameFile).size > 0) {
        frames.push({ time, file: frameFile });
      }
    } catch(e) {}
  }
  if (frames.length === 0) throw new Error('无法提取视频帧，请检查视频文件是否正常');
  return frames;
}

function getAliyunKey() {
  if (process.env.ALIYUN_API_KEY) return process.env.ALIYUN_API_KEY;
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
  try {
    const authPath = path.join(os.homedir(), '.openclaw', 'auth-profiles.json');
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (auth['aliyun:default']?.apiKey) return auth['aliyun:default'].apiKey;
    }
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const key = config.auth?.profiles?.['aliyun:default']?.apiKey;
      if (key) return key;
    }
  } catch(e) {}
  return null;
}

function callAliyun(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = getAliyunKey();
    if (!apiKey) return reject(new Error('未配置阿里云 API Key，请先在"模型管家"中配置'));
    const body = JSON.stringify({
      model: 'qwen-vl-max',
      messages,
      max_tokens: 4096,
      temperature: 0.7
    });
    const options = {
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.choices?.[0]?.message?.content || '';
          resolve(text);
        } catch(e) {
          reject(new Error('API响应解析失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callDeepSeek(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = getDeepSeekKey();
    if (!apiKey) return reject(new Error('未配置 DeepSeek API Key，请先在"模型管家"中配置'));
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      max_tokens: 4096,
      temperature: 0.7
    });
    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.choices?.[0]?.message?.content || '';
          resolve(text);
        } catch(e) {
          reject(new Error('API响应解析失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function processVideoTask(taskId) {
  const task = analysisTasks.get(taskId);
  if (!task) return;
  try {
    task.status = 'processing';

    task.progress = 10;
    task.message = '正在分析视频信息...';
    const info = getVideoInfo(task.videoFile);

    task.progress = 25;
    task.message = '正在提取视频关键帧...';
    const frames = extractFrames(task.videoFile, task.tmpDir, 8);

    task.progress = 40;
    task.message = '正在准备分析数据...';
    const frameData = frames.map(f => ({
      time: f.time,
      data: fs.readFileSync(f.file).toString('base64')
    }));

    task.progress = 55;
    task.message = 'AI 正在分析视频内容，请稍候...';

    const content = [
      {
        type: 'text',
        text: `You are a video content analyzer. Analyze this video based on its key frames.

Video Info:
- Duration: ${info.duration.toFixed(1)}s
- Resolution: ${info.width}x${info.height}
- Codec: ${info.codec}
- Format: ${info.format}

Key frames at timestamps: ${frames.map(f => f.time.toFixed(1) + 's').join(', ')}

Please provide in Chinese (中文):
1. **视频摘要** (2-3 sentences describing the video)
2. **关键场景** (list each scene with timestamp and description)
3. **内容分类** (tutorial, presentation, interview, entertainment, etc.)`
      },
      ...frameData.map(f => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${f.data}` }
      }))
    ];

    const model = task.model || 'aliyun';
    const caller = model === 'aliyun' ? callAliyun : callDeepSeek;
    const analysis = await caller([{ role: 'user', content }]);

    task.progress = 90;
    task.message = '正在整理分析结果...';

    const segments = frames.map(f => {
      const m = Math.floor(f.time / 60);
      const s = Math.floor(f.time % 60);
      return { timestamp: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, timeSeconds: f.time };
    });

    task.progress = 100;
    task.message = '分析完成';
    task.status = 'done';
    task.result = {
      videoInfo: info,
      segments,
      analysis
    };

    setTimeout(() => {
      try { if (fs.existsSync(task.tmpDir)) fs.rmSync(task.tmpDir, { recursive: true, force: true }); } catch(e) {}
    }, 120000);

  } catch(e) {
    task.status = 'error';
    task.error = e.message;
    task.progress = 100;
    task.message = '分析失败';
  }
}

app.post('/api/video/analyze', (req, res) => {
  const { videoPath, videoData, fileName } = req.body;

  if (!videoPath && !videoData) {
    return res.json({ success: false, error: '请提供视频文件路径(videoPath)或视频数据(videoData)' });
  }

  const taskId = (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) :
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const tmpDir = path.join(os.tmpdir(), 'lobster-video', taskId);
  fs.mkdirSync(tmpDir, { recursive: true });

  let videoFile;
  if (videoPath) {
    if (!fs.existsSync(videoPath)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.json({ success: false, error: '视频文件不存在: ' + videoPath });
    }
    videoFile = videoPath;
  } else {
    const ext = fileName ? path.extname(fileName) : '.mp4';
    videoFile = path.join(tmpDir, 'input' + ext);
    fs.writeFileSync(videoFile, Buffer.from(videoData, 'base64'));
  }

  analysisTasks.set(taskId, {
    status: 'queued', progress: 0, message: '排队中...',
    tmpDir, videoFile, result: null, error: null,
    model: req.body.model || 'aliyun'
  });

  processVideoTask(taskId);

  res.json({ success: true, taskId });
});

app.get('/api/video/analyze/status/:taskId', (req, res) => {
  const task = analysisTasks.get(req.params.taskId);
  if (!task) return res.json({ success: false, error: '任务不存在或已过期' });

  if (task.status === 'done') {
    res.json({ success: true, status: 'done', progress: 100, message: '分析完成', result: task.result });
  } else if (task.status === 'error') {
    res.json({ success: false, status: 'error', progress: 100, message: task.error, error: task.error });
  } else {
    res.json({ success: true, status: task.status, progress: task.progress, message: task.message });
  }
});

// ============================================================
// API: 视觉模型分析
// ============================================================
app.post('/api/vision/analyze', async (req, res) => {
  const { model, image, prompt, images } = req.body;
  if (!image && (!images || images.length === 0)) {
    return res.json({ success: false, error: '请提供图片数据(image 或 images)' });
  }

  const content = [
    { type: 'text', text: prompt || '请详细描述这张图片的内容，包括物体、场景、颜色、文字等' }
  ];

  if (image) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } });
  }
  if (images) {
    images.forEach(img => {
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } });
    });
  }

  try {
    let analysis;
    if (model === 'deepseek') {
      analysis = await callDeepSeek([{ role: 'user', content }]);
    } else {
      analysis = await callAliyun([{ role: 'user', content }]);
    }
    res.json({ success: true, analysis });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// API: Keep-Alive (心跳)
// ============================================================
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, time: Date.now() });
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(PORT, HOST, () => {
  console.log(`
  🦐 龙虾保姆 v${APP_VERSION}
  ─────────────────────
  服务已启动: http://${HOST}:${PORT}
  按 Ctrl+C 停止
  
  一条龙服务 · 从安装到运维全包
  `);
  
  // 尝试自动打开浏览器
  try {
    const open = require('open');
    open(`http://${HOST}:${PORT}`);
  } catch(e) {}
});
