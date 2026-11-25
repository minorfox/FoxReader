# Contributing to FoxReader

感谢你对 **FoxReader** 的关注与贡献！在提交代码或文档变更前，请阅读以下协作约定。

## 分支管理策略

- `main`：稳定基线分支，仅保留经过完整验证的正式基线与发布版本，不直接向 `main` 提交日常开发代码。
- `dev`：活跃集成分支，里程碑开发与日常集成在此进行。
- 建议从 `dev` 切出短期特性或修复分支（如 `feat/m2-text-highlight`、`fix/pdf-scroll-sync`），完成后向 `dev` 提交 Pull Request。

## 提交信息规范（Conventional Commits）

请使用清晰的语义化提交信息：

- `feat(<scope>): ...` — 新增功能
- `fix(<scope>): ...` — 修复缺陷
- `docs: ...` — 文档更新
- `chore: ...` — 工程配置、构建脚本或杂项维护
- `refactor(<scope>): ...` — 代码重构（不改变外部行为）
- `test(<scope>): ...` — 测试补充与修复

## 本地开发与验证

1. 阅读 [docs/PRD.md](./docs/PRD.md) 了解架构边界、表结构与工程风险规避策略。
2. 安装依赖并运行检查：

```bash
npm.cmd install
npm.cmd run typecheck
npm.cmd run test:db
npm.cmd run build
```

3. 启动桌面端调试：

```bash
npm.cmd run dev
```

## Pull Request 检查清单

- [ ] 遵守原 PDF 只读不改写与所有数据集中存储于 `FoxReaderData/` 的核心原则。
- [ ] 未引入需要本机 C++ 编译工具链的原生依赖（或已提供零编译兼容方案）。
- [ ] 通过 `npm.cmd run typecheck`、`npm.cmd run test:db` 与 `npm.cmd run build`。
- [ ] 如涉及数据库表结构或用户可见功能变更，已同步更新 `CHANGELOG.md` 的 `[Unreleased]` 章节。

## 开源协议

向本项目提交贡献即表示你同意你的代码将按 [MIT License](./LICENSE) 发布。
