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
const localeReferences = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(
  (match) => match[1],
);
const localeRoot = path.join(root, '_locales');
if ((localeReferences.length || fs.existsSync(localeRoot)) && !manifest.default_locale)
  throw new Error('使用语言包时必须声明 default_locale');
if (manifest.default_locale) {
  if (!/^[A-Za-z0-9_]+$/.test(manifest.default_locale))
    throw new Error('default_locale 必须是合法的语言目录名');
  const messagesPath = path.join(localeRoot, manifest.default_locale, 'messages.json');
  if (!fs.existsSync(messagesPath)) throw new Error('缺少默认语言包：' + messagesPath);
  const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
  if (!messages || typeof messages !== 'object' || Array.isArray(messages))
    throw new Error('语言包必须是消息名称到消息内容的对象');
  const normalizedMessages = new Map();
  for (const [key, value] of Object.entries(messages)) {
    if (!value || typeof value.message !== 'string' || !value.message.trim())
      throw new Error('语言包消息内容不能为空：' + key);
    normalizedMessages.set(key.toLowerCase(), value.message);
  }
  for (const key of localeReferences)
    if (!normalizedMessages.has(key.toLowerCase()))
      throw new Error('默认语言包缺少 manifest 引用的消息：' + key);
}
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
console.log('JavaScript 语法、扩展入口和语言包检查通过。');
