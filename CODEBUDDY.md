# dev-meta 项目规范

<!--
  dev-meta 版本绑定。通用规范（DoD、AI 协作约定、编码约定、工作日志指引）由 ~/.codebuddy/CODEBUDDY.md 全局加载。
  本文件只写「采用版本 + 例外项」：不复制规范正文，也不重复 dev-meta 仓库地址
  （仓库地址由全局层 ~/.codebuddy/CODEBUDDY.md 统一提供，项目层再写一份只会漂移）。
-->

## 规范来源

| 项 | 值 |
|---|---|
| 来源仓库 | `dev-meta` |
| 采用版本 | 137d24a |

## 本项目例外

- **私有规划目录**：内部规划笔记存放于 `docs/private/`，该目录被 `.gitignore` 排除、不进版本控制。`docs/00~06` 工程文档（含契约 SSOT `03`）仍按通用规范正常跟踪，不得迁入 `docs/private/`。
- **`04_UI_UX_DESIGN.md` 的 upstream 集合偏差**：`dev-meta` 模板与 `dm-init-docs` 依赖表把 `04` 的 upstream 定为 `00` + `03`；本项目 `04` 额外将 `02_SYSTEM_DESIGN.md` 列为 upstream（其 §5 检查项 4 的判据是 `02` §4 状态机定义）。该偏差已在此登记，不按违规处理；若 dev-meta 模板后续收录该依赖，删除本条并回归模板口径。
- **npm 包与 VS Code 扩展分目录持包**：npm 占位包位于仓库根，已发布至 `0.0.4` 并按 `05` §2 **冻结**，不再演进；VS Code 扩展位于 `extension/`，持有独立 `package.json`（`publisher: rolligen`），版本自 `0.0.1` 起独立编号。两者互不干扰。详见 `docs/01_TECHNICAL_SPEC.md` §4 与 `docs/05_ROADMAP_AND_COMPLIANCE.md` §2。
- **`.codebuddy/` 目录的入库边界**：`.codebuddy/` 是 CodeBuddy 的项目数据目录，只对其中的 `skills/` 入库，**`plans/` 一律排除**（`.gitignore`）。理由：`plans/` 是本地规划快照，内容与 `docs/versions/*/500-schedule.md` 执行记录重复且会过期，属典型误提交源；`skills/` 是 TypeSafe 官方 skill 的 vendor 副本（MIT，随包保留 `LICENSE`），入库后任何 agent 与离线环境都能读到与 `03` §2.1 对齐的上游说明。安装与校验：`npx skills add typesafe-ai/skills --skill typesafe-ai`（`skills-lock.json` 记录来源与 `computedHash`；更新 skill 后须同步该 lock 的 hash）。
