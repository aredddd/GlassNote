const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.js$/.test(file))
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
}
walk(path.join(root, 'src'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((script) => [...script.js, ...script.css]),
];
for (const file of files)
  if (!fs.existsSync(path.join(root, file))) throw new Error('扩展缺少文件：' + file);
for (const [size, file] of Object.entries(manifest.icons)) {
  const png = fs.readFileSync(path.join(root, file));
  if (
    png.length < 24 ||
    png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    png.readUInt32BE(16) !== Number(size) ||
    png.readUInt32BE(20) !== Number(size)
  )
    throw new Error('扩展图标必须是正确尺寸的 PNG：' + file);
}
console.log('JavaScript 语法和扩展入口检查通过。');
