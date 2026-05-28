/**
 * 🦐 龙虾医生 — Lobster Doctor
 * OpenClaw 中文伴侣工具服务器
 * 
 * 双击 run.bat 启动，自动打开浏览器
 */

const express = require('express');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = 18928; // 🦐 谐音
const HOST = '127.0.0.1';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// API: 系统检测
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

  const openclawConfig = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  let config = null;
  if (fs.existsSync(openclawConfig)) {
    try { config = JSON.parse(fs.readFileSync(openclawConfig, 'utf8')); } catch(e) {}
  }

  res.json({ checks, config });
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
    exec(`start "" /B "${path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd')}" gateway restart >nul 2>&1`, { shell: 'cmd.exe' });
    
    res.json({ success: true, message: '✅ 飞书配置已写入，Gateway 正在重启...' });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// API: 测试飞书连接
// ============================================================
app.post('/api/test/feishu', (req, res) => {
  const { appId, appSecret } = req.body;
  
  // 简单验证：检查飞书 API 是否可达
  const powershell = `
    try {
      $body = @{ app_id = "${appId.replace(/"/g, '`"')}"; app_secret = "${appSecret.replace(/"/g, '`"')}" } | ConvertTo-Json
      $resp = Invoke-RestMethod -Uri "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
      if ($resp.code -eq 0) { Write-Output "✅ 连接成功! Tenant: $($resp.tenant_access_token.Substring(0,10))..." }
      else { Write-Output "❌ 错误: $($resp.msg)" }
    } catch { Write-Output "❌ 连接失败: $_" }
  `;
  
  exec(`powershell -NoProfile -Command "${powershell.replace(/"/g, '\\"')}"`, { shell: 'cmd.exe' }, (err, stdout) => {
    res.json({ output: stdout });
  });
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
    
    // 根据 provider 类型写入
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
    
    // 保存 API Key 到 auth-profiles.json
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
  
  // 保存一份紧急备份
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

  // 执行 git restore
  exec(`cd /d "${ws}" && git checkout HEAD -- IDENTITY.md USER.md SOUL.md AGENTS.md TOOLS.md HEARTBEAT.md RECOVERY.md 2>nul && git checkout HEAD -- memory\\ 2>nul && git checkout HEAD -- .learnings\\ 2>nul`, { 
    shell: 'cmd.exe',
    maxBuffer: 1024 * 1024
  }, (err, stdout, stderr) => {
    // 重启 Gateway
    const openclawCmd = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd');
    exec(`start "" /B "${openclawCmd}" gateway restart >nul 2>&1`, { shell: 'cmd.exe' });
    
    // 检查关键文件
    const keyFiles = ['IDENTITY.md', 'USER.md', 'SOUL.md'];
    const missing = keyFiles.filter(f => !fs.existsSync(path.join(ws, f)));
    
    // 如果 git 恢复失败，尝试从备份恢复
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
  
  // 清理旧备份（保留最近5个）
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
// API: 视频智能分析
// ============================================================

// Auto-detect ffmpeg path
function findFfmpeg() {
  var paths = ['ffmpeg', 'D:\\ffmpeg\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe'];
  for (var i = 0; i < paths.length; i++) {
    try { execSync('"' + paths[i] + '" -version', { stdio: 'pipe' }); return paths[i]; } catch(e) {}
  }
  try {
    var r = execSync('where ffmpeg 2>nul', { encoding: 'utf8', shell: 'cmd.exe' });
    var line = r.trim().split('\r\n')[0] || r.trim().split('\n')[0];
    if (line) return line;
  } catch(e) {}
  return null;
}
var FFMPEG_PATH = findFfmpeg();
var analysisTasks = new Map();

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
// API: 视觉模型分析（支持模型路由）
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
// 启动服务器
// ============================================================
app.listen(PORT, HOST, () => {
  console.log(`
  🦐 龙虾医生 v1.0
  ─────────────────────
  服务已启动: http://${HOST}:${PORT}
  按 Ctrl+C 停止
  
  本工具帮助中国用户安装和配置 OpenClaw
  `);
  
  // 尝试自动打开浏览器
  try {
    const open = require('open');
    open(`http://${HOST}:${PORT}`);
  } catch(e) {}
});
