# Our Free Model (lite)

在 DeepSeek Harness 里免登录、免注册、免 API Key 直接使用免费模型的最小实现。

上游项目：[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)（MIT）。
本仓库是它的**去功能化分支**：只保留免费模型车道本身，其余全部删除，代码量约为上游插件端的十分之一。

## 保留了什么

- **免费模型车道**：OpenCode Zen 网关 + Kilo 免费池，模型清单随上游刷新。
- **可用性探测**：按你这台机器的网络出口实测哪些模型能用，地区受限的单独归组。
- **单模型测速**：每个模型一行「测速」，真实发一次极短请求，显示首字延迟与 tok/s。
- **一个设置页**：总开关、是否显示地区受限模型、清单刷新间隔。

## 删除了什么（上游有、这里没有）

| 功能 | 为什么删 |
| --- | --- |
| EAC 协付车道 + GitHub 登录 + Star 门禁 | 需要把 GitHub 身份和用量交给第三方网关；星标是增长手段 |
| 北辰 API 中转站赞助横幅（含返现邀请码） | 广告 |
| 公告中心（作者推送） | 广告/公告通道，正文由作者远程控制 |
| 推荐项目页、满屏 Star 按钮、QQ 群 | 推广 |
| 应用内自更新 + 升级页 | 能用作者签名的整包替换你的插件代码，等于能把删掉的功能装回来 |
| 十个第三方账号渠道（Qoder/TRAE/Cline/…） | 39 MB 打包代码 + 第三方账号登录面 |
| 订阅导入（读 ~/.claude、~/.codex、~/.gemini 凭据） | 碰本机其它工具的登录凭据 |
| 聚合渠道（76 家自带 Key） | 额外的 Key 存储与出网面 |
| 路由降级链、省 Token、本地/局域网网关 | 与「开箱即用的免费模型」无关 |
| 看板、运行日志、模型工作台 | 同上；本插件不再写任何统计文件 |

代码里**没有任何**远程安装、热更新、公告拉取、星标校验或 GitHub 登录路径。`npm test` 会扫描这些能力的入口标记（GitHub 登录/OAuth、Release 下载、自更新、公告文件、赞助网关、HMAC 签名、子进程等）；源码注释和出处链接里出现 `EAC`、`github.com/...` 字样只是署名或历史说明，不是功能。

## 安装

不发布到 npm，仓库为私有。tgz 用 `npm pack` 生成；SHA-256 以 Release 页公布的值（或本地 `shasum -a 256` 的输出）为准——README 本身也在包里，不能内嵌自己的哈希。

### A. 安装脚本（推荐）

```bash
# 1. 在仓库里本地打包（v3.0.0-lite.2 尚未发布为 Release）
git clone https://github.com/Syrupdesu/our-free-model-lite.git
cd our-free-model-lite
npm pack --silent
shasum -a 256 dsh-our-free-model-3.0.0-lite.2.tgz   # 记下输出，供分发时核对

# 2. 安装
./scripts/install.sh dsh-our-free-model-3.0.0-lite.2.tgz
```

脚本会备份原来的插件与 `package.json`/`pnpm-lock.yaml`，改依赖、跑 `pnpm install`、
校验装上的版本；任何一步失败都会自动回滚。回滚上一版：

```bash
./scripts/revert.sh ~/.dsh/profiles/desktop/.ofmlite-backup-<时间戳>
```

### B. 手动

```bash
cp dsh-our-free-model-3.0.0-lite.2.tgz ~/.dsh/profiles/desktop/vendor/
# 把 ~/.dsh/profiles/desktop/package.json 里那一行改成：
#   "dsh-our-free-model": "file:./vendor/dsh-our-free-model-3.0.0-lite.2.tgz"
cd ~/.dsh/profiles/desktop
pnpm install --no-frozen-lockfile
```

装完**重启 DeepSeek Harness**。设置 → Our Free Model → 「刷新清单」，模型即出现在模型选择器里。

## 数据与出网

- 设置/缓存写在 `~/.dsh/our-free-model/`（目录 0700，文件 0600：`settings.json`、`catalog.json`、`availability.json`、`session-map.json`）。
- 出网只有三处：`opencode.ai`（模型清单与对话）、Kilo 网关（清单与对话）、探测出口 IP 用到的 `api.ipify.org` / `ipinfo.io` / `ipapi.co`（任一可用即停，失败就跳过）。
- 不写统计、不上报、不拉公告、不检查更新。

## 许可

MIT。上游版权归 Ebony-Vinyl 及贡献者，本分支的修改同样以 MIT 发布，详见 [NOTICE.md](NOTICE.md)。
