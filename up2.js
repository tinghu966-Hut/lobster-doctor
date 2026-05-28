const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
const appId = config.channels.feishu.appId;
const appSecret = config.channels.feishu.appSecret;

function doReq(method, urlPath, headers, bodyData) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'open.feishu.cn',
      method: method,
      path: urlPath,
      headers: headers
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function main() {
  // 1. Get token
  const tokenBody = JSON.stringify({ app_id: appId, app_secret: appSecret });
  const tokenRes = await doReq('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { 'Content-Type': 'application/json' }, tokenBody);
  if (tokenRes.code !== 0) {
    console.log('Token fail:', tokenRes.msg);
    return;
  }
  const token = tokenRes.tenant_access_token;
  console.log('1. Token OK');

  // 2. Upload file
  const filePath = path.join(os.tmpdir(), '龙虾保姆_v2.1.zip');
  if (!fs.existsSync(filePath)) {
    console.log('File not found at:', filePath);
    return;
  }
  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;
  const boundary = '----' + Date.now();

  const textPart = [
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

  const fileBuf = fs.readFileSync(filePath);
  const footer = '\r\n--' + boundary + '--\r\n';
  const body = Buffer.concat([
    Buffer.from(textPart + '\r\n', 'utf8'),
    fileBuf,
    Buffer.from(footer, 'utf8')
  ]);

  const uploadRes = await doReq('POST', '/open-apis/drive/v1/files/upload_all', {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': body.length
  }, body);

  if (uploadRes.code === 0) {
    console.log('2. Upload OK!');
    console.log('   File token:', uploadRes.data.file_token);
  } else {
    console.log('2. Upload fail:', uploadRes.code, uploadRes.msg);
  }
}

main().catch(e => console.log('Error:', e.message));
