const https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
const appId = config.channels.feishu.appId;
const appSecret = config.channels.feishu.appSecret;

function req(method, urlPath, hdrs, data) {
  return new Promise((resolve) => {
    const r = https.request({ hostname: 'open.feishu.cn', method, path: urlPath, headers: hdrs }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const t = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ app_id: appId, app_secret: appSecret }));
  if (t.code !== 0) { console.log('Token fail:', t.code, t.msg); return; }
  const token = t.tenant_access_token;
  console.log('1. Token OK');

  const filePath = path.join(os.tmpdir(), '龙虾保姆_v2.1.zip');
  const fileName = '龙虾保姆_v2.1.zip';
  const fileSize = fs.statSync(filePath).size;
  const boundary = '----Lobster' + Date.now();

  let parts = '';
  parts += '--' + boundary + '\r\n';
  parts += 'Content-Disposition: form-data; name="file_name"\r\n\r\n';
  parts += fileName + '\r\n';
  parts += '--' + boundary + '\r\n';
  parts += 'Content-Disposition: form-data; name="parent_type"\r\n\r\n';
  parts += 'explorer\r\n';
  parts += '--' + boundary + '\r\n';
  parts += 'Content-Disposition: form-data; name="parent_node"\r\n\r\n';
  parts += '\r\n';
  parts += '--' + boundary + '\r\n';
  parts += 'Content-Disposition: form-data; name="size"\r\n\r\n';
  parts += String(fileSize) + '\r\n';
  parts += '--' + boundary + '\r\n';
  parts += 'Content-Disposition: form-data; name="file"; filename="' + fileName + '"\r\n';
  parts += 'Content-Type: application/zip\r\n\r\n';

  const footer = '\r\n--' + boundary + '--\r\n';
  const fileBuf = fs.readFileSync(filePath);
  const body = Buffer.concat([Buffer.from(parts, 'utf8'), fileBuf, Buffer.from(footer, 'utf8')]);

  const u = await req('POST', '/open-apis/drive/v1/files/upload_all', {
    'Authorization': '***' + token,
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': body.length
  }, body);

  if (u.code === 0) {
    console.log('2. Upload OK: ' + u.data.file_token);
    console.log('3. 可在飞书云盘搜索"龙虾保姆_v2.1"找到');
  } else {
    console.log('Upload fail:', JSON.stringify(u));
  }
}
main();
