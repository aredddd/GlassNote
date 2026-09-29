const path = require('node:path');
const { releaseVersion, verifyPackage, tagArgument } = require('./package-lib.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const versionOnly = args[0] === '--version-only';
const tag = tagArgument(versionOnly ? args.slice(1) : args);
if (versionOnly) {
  console.log(`版本校验通过：v${releaseVersion(root, tag)}`);
} else {
  const result = verifyPackage(root, path.join(root, 'dist'), tag);
  console.log(`发布包校验通过：v${result.version}，${result.files} 个文件，SHA-256 一致。`);
}
