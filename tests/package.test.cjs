const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const {
  packageExtension,
  releaseVersion,
  verifyPackage,
  readArchive,
} = require('../scripts/package-lib.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glassnote-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  write('manifest.json', JSON.stringify({ manifest_version: 3, version: '3.2.1' }));
  write('package.json', JSON.stringify({ version: '3.2.1' }));
  write(
    'package-lock.json',
    JSON.stringify({ version: '3.2.1', packages: { '': { version: '3.2.1' } } }),
  );
  for (const name of [
    'README.md',
    'LICENSE',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
  ])
    write(name, `公开发布文件：${name}\n`);
  write('src/background/background.js', "console.log('GlassNote');\n");
  write('styles/content.css', ':host { color: green; }');
  write('assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write('docs/安装说明.md', '中文文档应当正确保存在 ZIP 中。\n');
  const output = path.join(root, 'dist');
  return { root, output, write };
}

test('发布包按版本命名，附许可证和隐私声明，排除依赖、工作文件和隐藏文件', (t) => {
  const { root, output, write } = fixture(t);
  for (const name of [
    '.env',
    'src/.env',
    'src/debug.log',
    'work/draft.md',
    'tests/fixture.html',
    'node_modules/dev/index.js',
  ])
    write(name, '不应发布');
  const result = packageExtension(root, output, 'v3.2.1');
  assert.equal(path.basename(result.archive), 'GlassNote-v3.2.1.zip');
  const archive = fs.readFileSync(result.archive);
  const entries = readArchive(archive);
  assert.equal(entries.size, 11);
  for (const name of [
    'LICENSE',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/安装说明.md',
  ])
    assert.ok(entries.has(name), name);
  assert.equal(entries.get('docs/安装说明.md').toString(), '中文文档应当正确保存在 ZIP 中。\n');
  assert.ok(
    [...entries.keys()].every((name) => !/node_modules|work\/|tests\/|\.env|debug/.test(name)),
  );
  const hash = createHash('sha256').update(archive).digest('hex');
  assert.equal(fs.readFileSync(result.checksums, 'utf8'), `${hash}  GlassNote-v3.2.1.zip\n`);
  packageExtension(root, output, 'v3.2.1');
  assert.deepEqual(fs.readFileSync(result.archive), archive, '重复打包结果应稳定');
});

test('发布前拒绝标签、manifest、package 和锁文件之间的版本不一致', (t) => {
  const { root, write } = fixture(t);
  assert.equal(releaseVersion(root, 'v3.2.1'), '3.2.1');
  assert.throws(() => releaseVersion(root, 'v3.2.2'), /标签/);
  write('package.json', JSON.stringify({ version: '3.2.2' }));
  assert.throws(() => releaseVersion(root), /版本必须一致/);
  write('package.json', JSON.stringify({ version: '3.2.1' }));
  write(
    'package-lock.json',
    JSON.stringify({ version: '3.2.1', packages: { '': { version: '3.2.2' } } }),
  );
  assert.throws(() => releaseVersion(root), /版本必须一致/);
});

test('拒绝无法安装的版本、非 MV3 和缺失许可证的发布包', (t) => {
  const { root, output, write } = fixture(t);
  for (const version of ['3.2.1-beta', '03.2.1', '65536.2.1', '0.0.0']) {
    write('manifest.json', JSON.stringify({ manifest_version: 3, version }));
    assert.throws(() => releaseVersion(root), /三段数字/);
  }
  write('manifest.json', JSON.stringify({ manifest_version: 2, version: '3.2.1' }));
  assert.throws(() => releaseVersion(root), /Manifest V3/);
  write('manifest.json', JSON.stringify({ manifest_version: 3, version: '3.2.1' }));
  fs.rmSync(path.join(root, 'LICENSE'));
  assert.throws(() => packageExtension(root, output), /LICENSE/);
  assert.equal(fs.existsSync(output), false, '缺文件时不能留下看似可用的产物');
});

test('发布包复验能够发现 ZIP 损坏、校验和篡改与源文件变化', (t) => {
  const { root, output, write } = fixture(t);
  const result = packageExtension(root, output);
  const archive = fs.readFileSync(result.archive);
  const damaged = Buffer.from(archive);
  damaged[0] ^= 1;
  fs.writeFileSync(result.archive, damaged);
  assert.throws(() => verifyPackage(root, output), /SHA256SUMS/);
  const hash = createHash('sha256').update(damaged).digest('hex');
  fs.writeFileSync(result.checksums, `${hash}  GlassNote-v3.2.1.zip\n`);
  assert.throws(() => verifyPackage(root, output), /ZIP 结构/);
  packageExtension(root, output);
  write('src/background/background.js', 'changed after packaging');
  assert.throws(() => verifyPackage(root, output), /内容不一致/);
});

test('发布白名单内的符号链接不能将外部文件带入安装包', (t) => {
  const { root, output } = fixture(t);
  fs.symlinkSync(path.join(root, 'LICENSE'), path.join(root, 'src/linked.js'));
  assert.throws(() => packageExtension(root, output), /符号链接/);
});
