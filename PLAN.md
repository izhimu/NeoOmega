# NeoOmega 实施路线图与技术计划 (Implementation Plan)

## 🎯 总体目标
构建高可靠、零技术债、现代化的 Chrome 代理扩展（Manifest V3），全面兼容 SwitchyOmega / ZeroOmega 核心特性，并以原生 TS + Vue 3 + WXT 提供卓越体验。

---

## 📅 分阶段实施计划

### 阶段一：核心数据模型与 PAC 引擎（已完成）
1. **核心模型设计 (`src/core/types.ts`)**：
   - `Profile`: 支持 `DirectProfile`、`SystemProfile`、`FixedProfile`、`PacProfile`、`SwitchProfile`、`VirtualProfile`。
   - `ProxyServer`: 协议 (HTTP, HTTPS, SOCKS4, SOCKS5)、主机、端口、认证信息。
   - `RuleCondition`: Host 通配符 (`*.google.com`)、URL 正则、CIDR、Host 关键字、Bypass 规则。
   - `SwitchRule`: 条件集合 -> 目标情景模式。
2. **轻量 PAC 脚本生成器 (`src/core/pac/generator.ts`)**：
   - 纯函数生成极简、高效的 `FindProxyForURL(url, host)` JavaScript 代码。
   - 消除旧版 `omega-pac` 依赖的 UglifyJS/Browserify 庞大依赖，采用安全模版生成。
   - 实现 CIDR 计算 (`isInNet`)、通配符转正则 (`shExpMatch`)。
3. **单元测试矩阵 (`tests/pac.test.ts`)**：
   - 单测覆盖：Fixed 代理 PAC 生成、Switch 自动切换规则链路、CIDR 匹配、默认回退代理。

---

### 阶段二：MV3 调度与存储层（已完成）
1. **Manifest V3 权限与基础配置 (`wxt.config.ts`)**：
   - 权限集：`proxy`, `storage`, `unlimitedStorage`, `webRequest`, `webRequestAuthProvider`, `alarms`, `tabs`, `sidePanel`。
   - Host 权限：`<all_urls>`。
2. **状态与存储抽象 (`src/core/storage/index.ts`)**：
   - 基于 `chrome.storage.local` 构建原子读写与响应式监听。
   - 解决 Service Worker 频繁冷启动时状态重载的一致性保证。
3. **Proxy 调度器 (`src/core/proxy/proxy-manager.ts`)**：
   - 封装 `chrome.proxy.settings.set` 与 `clear`。
   - 实时同步当前系统/浏览器生效代理配置 (`chrome.proxy.settings.onChange`)。
   - 处理虚拟情景模式解析（展开别名指向真实目标）。
4. **代理认证器 (`src/core/proxy/auth-manager.ts`)**：
   - 监听 `chrome.webRequest.onAuthRequired`，对指定代理服务器自动填报凭据。

---

### 阶段三：SwitchyOmega 迁移与规则列表（已完成）
1. **SwitchyOmega 兼容解析器 (`src/core/parsers/switchyomega.ts`)**：
   - 解析 SwitchyOmega / ZeroOmega 的 `.bak` 备份 JSON。
   - 映射旧版 `BypassCondition`、`HostWildcardCondition`、`UrlRegexCondition` 到新版模型。
2. **在线规则列表支持 (`src/core/parsers/autoproxy.ts`)**：
   - 支持 AutoProxy / GFWList base64 文本解码与解析。
   - 定时任务调度器 (`chrome.alarms`) 定期自动拉取更新。

---

### 阶段四：UI 界面与交互体验（已完成）
1. **Popup 快捷弹窗 (`entrypoints/popup/`)**：
   - 情景模式列表一键切换与激活状态高亮。
   - 当前标签页域名与匹配命中情景模式显示。
   - 失败请求红点计数，展开后可直接「为该域名添加分流规则」。
2. **Options 完整配置中心 (`entrypoints/options/`)**：
   - 情景模式管理与配置（添加/删除/重命名/颜色标识）。
   - 规则表格编辑器（拖拽优先级排序、添加条件）。
   - 规则测试模拟器（输入 URL 实时推演命中哪条规则与代理）。
   - 导入与导出（SwitchyOmega 兼容导入、NeoOmega 原生备份）。
3. **Side Panel 实时网络监控 (`entrypoints/sidepanel/`)**：
   - 侧边栏实时抓取当前页面的网络请求与代理状态。

---

### 阶段五：系统验证与发布交付
1. 运行完整 Vitest 单元测试套件。
2. 在 Chrome 中加载 `.output/chrome-mv3` 进行实机功能验收。
3. 构建生产包与发布。
