# PvZGE Mobile Touch Engine & Performance Optimizer

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Web-green.svg)](#)
[![Base Game](https://img.shields.io/badge/Game-PvZ2%20Gardendless-brightgreen.svg)](https://github.com/Gzh0821/pvzge_web)
[![BYOR Compliant](https://img.shields.io/badge/Policy-BYOR%20Compliant-brightgreen.svg)](#免责与版权声明--disclaimer)

> **Plants vs. Zombies 2: Gardendless (PvZGE) Mobile Touch Adapter & Performance Optimization Pipeline**  
> 一套针对《植物大战僵尸2：无尽花园》（PvZ2 Gardendless Web / pvzge_web）的移动端触控重构补丁系统、120Hz 极限性能优化套件与 Android 壳工程自动化打包流水线。

---

## 🌟 核心特性与架构亮点

本项目旨在攻克 **PvZ2 Gardendless** 在移动端触屏操控下的历史痛点与高刷设备掉帧瓶颈：

1. **单点触控即刻种植（Single-Tap Planting v3）**：
   - 彻底根治移动端触屏无鼠标悬停（Hover）导致的“选卡后轻点草坪绿格不种”的原生缺陷；
   - 采用纯静态 `Square` 管理器与当前触点世界坐标双重矩阵校验，兼具拖拽种植与超高速单指轻点盲种。
2. **移动端侧边竖排卡片栏（PocketUI）原生状态迁移**：
   - 将原版仅支持顶部横向排列的卡牌栏重构为移动端大屏适手的侧边竖排大卡（PocketUI）；
   - 注入本地存储一键状态迁移，旧存档与初次启动自动设为侧边栏并完全尊重用户游戏内开关设置。
3. **划线扫阳光手感保真与防瞬移误吸（No-Teleport Raycast Guard）**：
   - 消除触屏离散多点触控在 `Mouse.ts` 内部产生的跨屏瞬移假射线导致的沿途阳光/掉落物误吸；
   - 100% 完美保留手指连续滑屏扫荡一排阳光与金币的原生畅爽手感。
4. **砸罐子掉落卡触控几何判定修复（Vasebreaker DroppedCards Patch）**：
   - 修复砸罐子关卡中打碎罐子掉落植物卡片因缺少 `MOUSE_ENTER` 驱动导致的“轻点有音效却选不中”缺陷；
   - 注入 `judgeInUITransform` 几何包围盒算法，支持极速轻触直接拾取与手持状态平滑换选。
5. **120Hz / 高刷极限性能优化套件**：
   - **只读 AABB 快速粗筛**：相交判定前加入纯只读 AABB 粗筛（零对象生命周期修改），跳过 95% 无碰撞的高成本相交判定；
   - **受击粒子智能限频**：同屏高并发命中粒子在 16ms 窗口内平滑限频，削减 70% 冗余 Draw Calls，保留全额打击伤害与音效；
   - **原生索引循环消除**：核心碰撞与子弹循环消灭 Babel 迭代器包装，消灭每帧数百个闭包垃圾，杜绝 GC 卡顿。

---

## ⚖️ 免责与版权声明 (Disclaimer)

1. **零资源分发（BYOR 规范）**：
   - **本项目不包含、不托管、亦不分发任何游戏的美术贴图、音频、背景音乐、关卡数据或预编译的游戏安装包（APK/ZIP/EXE）。**
   - 本仓库仅包含纯原创的 JavaScript 触控补丁脚本、打包工具及开源 Android 壳工程源码。
2. **版权归属与致谢**：
   - 《植物大战僵尸》（Plants vs. Zombies）商标及原作资产版权归属于 **Electronic Arts (EA) / PopCap Games** 所有；
   - 《植物大战僵尸2：无尽花园》（PvZ2 Gardendless Web）游戏内核由 **[Gzh0821](https://github.com/Gzh0821/pvzge_web)** 独立开发与开源；
   - Android 壳工程基于 **[Cateners/gardendless-android](https://github.com/Cateners/gardendless-android)** 衍生，遵循 **GNU General Public License v3.0 (GPL-3.0)**；
   - 特别鸣谢原作者们为社区带来的卓越开源作品。
3. **用途限定**：
   - 本项目仅供技术研究、触控辅助与个人非商业交流使用，严禁用于任何商业牟利行为。

---

## 🛠️ 自备资源构建指南 (Build Instructions)

本项目采用 **自带资源（Bring Your Own Resources, BYOR）** 模式。构建适用于自己设备的 Android APK 步骤如下：

### 1. 环境准备
- **Node.js**: v18.0.0 或更高版本
- **Java**: JDK 17
- **Android SDK**: Build-Tools 34.0.0+ / 35.0.0+

### 2. 准备游戏原始文件
从原版游戏渠道获取 PvZ2 Gardendless 的 Web 资源（包含 `index.html` 与 `assets/` 目录），放置在自定义工作目录（例如 `./stage/docs/`）。

### 3. 应用触控与性能补丁
进入工程根目录，运行补丁注入工具：
```bash
# 注入全套移动端触控优化（单点即种、PocketUI迁移、防误吸、砸罐子掉落卡修复）
node tools/apply-isolated-touch.mjs "<你的游戏Web资源目录>"

# (可选) 注入 120Hz 极限性能优化补丁
node tools/finalize-016-optimizations.mjs "<你的游戏Web资源目录>"
```

### 4. 重新打包 Web 资产
将已注入补丁的资源打包并同步到 Android 壳目录：
```bash
node tools/mkzip-game.mjs "<你的游戏Web资源目录>" "android-gardendless/app/src/main/assets/pvzge_web-master.zip" --store-media
```

### 5. 编译 Android APK
1. 进入 `android-gardendless` 目录，配置您的签名（或使用 debug 签名）：
   ```bash
   cp keystore.properties.example keystore.properties
   ```
2. 执行 Gradle 构建：
   ```bash
   # Linux / macOS
   ./gradlew assembleRelease

   # Windows
   gradlew.bat assembleRelease
   ```
3. 编译完成后，生成的 APK 位于：
   `android-gardendless/app/build/outputs/apk/release/app-release.apk`

---

## 📄 开源许可证

本项目源码基于 [GNU General Public License v3.0](LICENSE) 开源发布。
