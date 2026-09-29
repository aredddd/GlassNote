# 版本发布

GitHub 发行包和 Edge 商店送审是两个独立步骤。GitHub Release 成功不代表商店已上架；Microsoft 后台仍需完成注册、资料验证和审核。

## 发布准备

1. 更新 manifest.json、package.json 和 package-lock.json 中的版本，三者保持一致。标签使用 v 加版本号，例如 v3.0.0。
2. 更新 CHANGELOG.md，核对 README、PRIVACY.md、THIRD_PARTY_NOTICES.md 与实际行为一致。
3. 如涉及权限、存储或页面定位，补充对应回归；确认旧版备份可以导入，格式开关不会丢失附带笔记。
4. 执行本地检查，合并 PR，并确认主干 CI 通过。

```sh
npm ci
npx playwright install chromium
npm run check
npm run format:check
npm test
npm run test:e2e
npm run package
npm run package:verify
```

Linux 安装浏览器时可使用 npx playwright install --with-deps chromium。真实网站验收是可选的人工发布检查，不在 CI 中依赖第三方站点的可用性。

## GitHub Release

在要发布的主干提交上创建版本标签并推送：

```sh
git switch main
git pull --ff-only
git tag -a v3.0.0 -m "GlassNote v3.0.0"
git push origin v3.0.0
```

示例版本号仅用于说明，后续发布应替换成实际的新版本。不要覆盖已经发布的标签或在同一版本名下替换不同内容的安装包。

Release 工作流检查标签和项目版本、运行回归、构建并复验 ZIP，再上传安装包和 SHA256SUMS。发布失败时应先检查工作流日志，修正后使用新的版本；不要把打包成功当作发布成功。

用户应下载 GlassNote-v版本号.zip；GitHub 自动生成的 Source code 压缩包是源码归档，与可安装的扩展包不同。扩展包根目录直接包含 manifest.json，不含开发依赖和测试数据。

下载后可在两个文件所在目录核对 SHA-256：

```sh
# macOS
shasum -a 256 -c SHA256SUMS

# Linux
sha256sum -c SHA256SUMS
```

Windows PowerShell 可计算 ZIP 的散列，并与 SHA256SUMS 中对应行比较：

```powershell
Get-FileHash .\GlassNote-v3.0.0.zip -Algorithm SHA256
```

## Edge 商店

使用经校验的同一份 ZIP。商店文案、隐私链接、权限理由及审核步骤见 [Edge 发布材料](EDGE_STORE.md)。更新商店截图时使用自编演示数据，不上传私有页面或个人笔记。

在商店审核通过并取得公开安装链接后，再更新 README 的商店状态和安装入口。开发者注册联系方式只填写到 Microsoft 后台，不提交到仓库或发行包。
