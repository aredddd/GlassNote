const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { deflateRawSync, inflateRawSync } = require('node:zlib');

const REQUIRED_FILES = [
  'manifest.json',
  'README.md',
  'LICENSE',
  'PRIVACY.md',
  'THIRD_PARTY_NOTICES.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
];
const TREES = {
  _locales: /\.json$/,
  src: /\.(js|html|css)$/,
  styles: /\.css$/,
  assets: /\.(png|svg|ico|webp)$/,
  docs: /\.(md|png|svg|webp)$/,
};
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function releaseVersion(root, tag) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const manifest = read('manifest.json');
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  const version = manifest.version;
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split('.').some((part) => Number(part) > 65535) ||
    version === '0.0.0'
  )
    throw new Error('扩展版本必须是 Chrome 支持的三段数字版本，如 3.0.0');
  if (manifest.manifest_version !== 3) throw new Error('发布包必须是 Manifest V3 扩展');
  if (
    pkg.version !== version ||
    lock.version !== version ||
    lock.packages?.['']?.version !== version
  )
    throw new Error('manifest.json、package.json 和 package-lock.json 的版本必须一致');
  if (tag !== undefined && tag !== `v${version}`)
    throw new Error(`标签 ${tag} 与项目版本不一致，预期 v${version}`);
  return version;
}

function tagArgument(args) {
  if (!args.length) return undefined;
  if (args.length !== 2 || args[0] !== '--tag' || !args[1])
    throw new Error('参数格式：--tag v3.0.0');
  return args[1];
}

function packageFiles(root) {
  const files = [];
  function add(name) {
    const full = path.join(root, name);
    if (!fs.lstatSync(full).isFile()) throw new Error(`发布文件不能是目录或符号链接：${name}`);
    files.push({ name, data: fs.readFileSync(full) });
  }
  for (const name of REQUIRED_FILES) add(name);
  for (const name of ['CHANGELOG.md', 'CONTRIBUTORS.md']) {
    if (fs.existsSync(path.join(root, name))) add(name);
  }
  function walk(name, extension) {
    const full = path.join(root, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`发布目录不能包含符号链接：${name}`);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) {
        if (!child.startsWith('.')) walk(`${name}/${child}`, extension);
      }
    } else if (stat.isFile() && extension.test(name)) add(name);
  }
  for (const [name, extension] of Object.entries(TREES)) walk(name, extension);
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 小型标准 ZIP（deflate、UTF-8、无 ZIP64），无需系统 zip 命令或运行时依赖。
// 固定时间与文件排序，让相同源文件在同一 Node 环境中重复打包结果一致。
function createArchive(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  if (files.length > 65535) throw new Error('发布文件数量超过 ZIP 限制');
  for (const { name, data } of files) {
    const filename = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    local.copy(record, 6, 4, 30);
    record.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed);
    central.push(record, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// 只接受本项目生成的标准 ZIP 布局，检查中央目录、局部头、大小和每个文件的 CRC。
function readArchive(archive) {
  const fail = () => {
    throw new Error('ZIP 结构或文件校验失败');
  };
  const end = archive.length - 22;
  if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) fail();
  if (archive.readUInt32LE(end + 4) !== 0 || archive.readUInt16LE(end + 20) !== 0) fail();
  const count = archive.readUInt16LE(end + 10);
  if (count !== archive.readUInt16LE(end + 8)) fail();
  let offset = archive.readUInt32LE(end + 16);
  if (offset + archive.readUInt32LE(end + 12) !== end) fail();
  const centralStart = offset;
  const files = new Map();
  let localEnd = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) fail();
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    if (
      extraLength ||
      commentLength ||
      offset + 46 + nameLength > end ||
      localOffset !== localEnd ||
      localOffset + 30 + nameLength + compressedSize > centralStart ||
      archive.readUInt16LE(offset + 8) !== 0x800 ||
      archive.readUInt16LE(offset + 10) !== 8 ||
      archive.readUInt16LE(offset + 34) !== 0 ||
      archive.readUInt32LE(localOffset) !== 0x04034b50
    )
      fail();
    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (
      !name ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.split('/').some((part) => !part || part === '.' || part === '..') ||
      files.has(name) ||
      !archive
        .subarray(localOffset + 4, localOffset + 30)
        .equals(archive.subarray(offset + 6, offset + 32)) ||
      !nameBytes.equals(archive.subarray(localOffset + 30, localOffset + 30 + nameLength))
    )
      fail();
    localEnd = localOffset + 30 + nameLength + compressedSize;
    const data = inflateRawSync(archive.subarray(localOffset + 30 + nameLength, localEnd), {
      maxOutputLength: 16 * 1024 * 1024,
    });
    if (data.length !== size || crc32(data) !== archive.readUInt32LE(offset + 16)) fail();
    files.set(name, data);
    offset += 46 + nameLength;
  }
  if (offset !== end || localEnd !== centralStart) fail();
  return files;
}

function verifyPackage(root, output, tag) {
  const version = releaseVersion(root, tag);
  const filename = `GlassNote-v${version}.zip`;
  const archivePath = path.join(output, filename);
  const archive = fs.readFileSync(archivePath);
  const sumsPath = path.join(output, 'SHA256SUMS');
  if (fs.readFileSync(sumsPath, 'utf8') !== `${sha256(archive)}  ${filename}\n`)
    throw new Error('SHA256SUMS 与发布包不匹配');
  const entries = readArchive(archive);
  const expected = packageFiles(root);
  if (entries.size !== expected.length) throw new Error('ZIP 文件清单与发布白名单不一致');
  for (const { name, data } of expected) {
    if (!entries.get(name)?.equals(data)) throw new Error(`ZIP 文件缺失或内容不一致：${name}`);
  }
  return { version, archive: archivePath, checksums: sumsPath, files: entries.size };
}

function packageExtension(root, output, tag) {
  const version = releaseVersion(root, tag);
  const filename = `GlassNote-v${version}.zip`;
  const archive = createArchive(packageFiles(root));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, filename), archive);
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${sha256(archive)}  ${filename}\n`);
  return verifyPackage(root, output, tag);
}

module.exports = { packageExtension, releaseVersion, verifyPackage, readArchive, tagArgument };
