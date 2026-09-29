const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { packageExtension, releaseVersion, tagArgument } = require('./package-lib.cjs');

const root = path.resolve(__dirname, '..');
const tag = tagArgument(process.argv.slice(2));
releaseVersion(root, tag);
execFileSync(process.execPath, [path.join(__dirname, 'check.cjs')], { stdio: 'inherit' });
const result = packageExtension(root, path.join(root, 'dist'), tag);
console.log(`安装包：${result.archive}\n校验和：${result.checksums}\n包内文件：${result.files}`);
