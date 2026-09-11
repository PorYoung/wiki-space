// 一次性修复脚本：worker token URL 内嵌（避免 shell 引号问题）
const fs = require('fs');
const p = 'D:/works/wiki-space/ewiki/apps/worker/src/index.ts';
let s = fs.readFileSync(p, 'utf8');
const lines = s.split('\n');
let done = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('sec.token') && lines[i].includes("url.replace('https://'")) && !done) {
    console.log('OLD LINE', i + 1, ':', JSON.stringify(lines[i]));
    lines[i] = "          if (sec.token && url.startsWith('https://')) url = url.replace('https://', `https://oauth2:${encodeURIComponent(sec.token)}@`);";
    done = true;
  }
}
if (!done) {
  console.log('NO MATCH LINE FOUND');
  process.exit(1);
}
fs.writeFileSync(p, lines.join('\n'));
console.log('REPLACED OK');
