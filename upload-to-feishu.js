// upload-to-feishu.js - 上传龙虾保姆到飞书云盘
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appId = config.channels.feishu.appId;
const appSecret = config.channels.feishu.appSecret;

// 1. 获取 token
function getToken() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ app_id: appId, app_secret: appSecret });
    const req = https.request({
      hostname: 'open.feishu.cn', method: 'POST',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.write(body); req.end();
  });
}

// 2. 上传文件
function uploadFile(token, filePath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const boundary = '----LobsterNanny' + Date.now();
    
    // Build multipart
    const header = [
      '--' + boundary,
      'Content-Disposition: form-data; name="file_name"',
      '',
      fileName,
      '--' + boundary,
      'Content-Disposition: form-data; name="parent_type"',
      '',
      'explorer',
      '--' + boundary,
      'Content-Disposition: form-data; name="parent_node"',
      '',
      '',
      '--' + boundary,
      'Content-Disposition: form-data; name="size"',
      '',
      String(fileSize),
      '--' + boundary,
      'Content-Disposition: form-data; name="file"; filename="' + fileName + '"',
      'Content-Type: application/zip',
      '',
    ].join('\r\n');
    
    const footer = '\r\n--' + boundary + '--\r\n';
    const fileContent = fs.readFileSync(filePath);
    const headerBuf = Buffer.from(header, 'utf8');
    const footerBuf = Buffer.from(footer, 'utf8');
    const body = Buffer.concat([headerBuf, Buffer.from('\r\n', 'utf8'), fileContent, footerBuf]);
    
    const req = https.request({
      hostname: 'open.feishu.cn', method: 'POST',
      path: '/open-apis/drive/v1/files/upload_all',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.write(body); req.end();
  });
}

async function main() {
  console.log('1. 获取飞书 token...');
  const tokenRes = await getToken();
  if (tokenRes.code !== 0) {
    console.log('❌ Token 失败:', tokenRes.code, tokenRes.msg);
    return;
  }
  console.log('✅ Token 获取成功');
  
  const token = tokenRes.tenant_access_token;
  
  // 找 zip 文件
  const desktop = path.join(os.homedir(), 'Desktop');
  const files = fs.readdirSync(desktop).filter(f => f.includes('龙虾保姆') && f.endsWith('.zip'));
  if (files.length === 0) {
    console.log('❌ 桌面没找到龙虾保姆 zip 文件');
    return;
  }
  
  const zipPath = path.join(desktop, files[0]);
  console.log('2. 上传文件:', files[0], '(' + (fs.statSync(zipPath).size / 1024).toFixed(1) + 'KB)');
  
  const uploadRes = await uploadFile(token, zipPath);
  console.log('3. 上传结果:', JSON.stringify(uploadRes, null, 2));
  
  if (uploadRes.code === 0) {
    const ft = uploadRes.data?.file_token;
    console.log('\n✅ 上传成功！');
    console.log('   文件 token:', ft);
    console.log('   分享链接: https://xxx.feishu.cn/drive/file/' + ft);
    console.log('   把这个链接发到群里，朋友就能下载了');
  }
}

main().catch(e => console.log('❌ 错误:', e.message));
