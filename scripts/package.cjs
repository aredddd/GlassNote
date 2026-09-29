const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'check.cjs')], { stdio: 'inherit' });
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
const filename = 'GlassNote-v3.0.0.zip';
const target = path.join(output, filename);
fs.rmSync(target, { force: true });
execFileSync('zip', ['-qr', target, 'manifest.json', 'src', 'styles', 'assets', 'README.md'], {
  cwd: root,
});
console.log('安装包：' + target);
