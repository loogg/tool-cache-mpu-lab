# Tool Template

用于创建具有独立仓库、语义化版本和 GitHub Pages 发布流程的 React/Vite 工具。

## 从模板创建工具

1. 使用 GitHub 的 **Use this template** 创建名为 `tool-<short-name>` 的公共仓库。
2. 修改 `package.json` 中的名称和初始版本。
3. 修改页面标题、描述、仓库链接和工具实现。
4. 在仓库 Settings → Pages 中选择 **GitHub Actions**。
5. 运行 `npm ci`、`npm run lint` 和 `npm run build`。
6. 创建首个 `vX.Y.Z` 标签并推送。

部署 base 会自动使用 GitHub 仓库名，不需要为每个工具手工修改。

## 版本与发布

`package.json.version` 是界面版本徽标和发布校验的唯一来源。

```powershell
npm version patch -m "chore(release): v%s"
git push origin main --follow-tags
```

需要时将 `patch` 换成 `minor` 或 `major`。普通提交只运行 CI，只有 `v*.*.*` 标签发布 Pages。不要移动或复用已有标签；回滚使用新的 patch 版本。

生成的工具发布时不需要修改 `toolbox`；只有工具名称、说明、图标、URL 或上下架状态变化时才更新首页清单。
