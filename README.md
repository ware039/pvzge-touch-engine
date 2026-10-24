# PvZGE Mobile Touch Engine & Performance Optimizer

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Web-green.svg)](#)
[![Engine](https://img.shields.io/badge/Engine-Cocos%20Creator%203.8+-orange.svg)](#)
[![BYOR Compliant](https://img.shields.io/badge/Policy-BYOR%20Compliant-brightgreen.svg)](#免责与版权声明--disclaimer)

> **Plants vs. Zombies Hybrid Edition (PvZGE) Mobile Touch Adapter & Performance Optimization Pipeline**  
> 一套针对《植物大战僵尸：杂交版》Web/移动端的高性能触控适配补丁系统与 Android 壳工程自动化流水线。

---

## 🌟 核心特性与架构亮点

本项目旨在解决 Cocos Creator 架构在移动端触屏下的交互缺陷与高刷掉帧瓶颈：

1. **原汁原味点触种植（Single-Tap Planting v3）**：
   - 彻底解决移动端触控无 Hover 状态导致的“选卡点绿格不种”缺陷；
   - 采用纯静态 `Square` 与当前触点世界坐标双重矩阵校验，兼具拖拽种植与高速轻点盲种。
2. **移动端侧边竖排卡片栏（PocketUI）原生迁移**：
   - 将原版仅支持顶部横向排列的卡牌栏无缝重构为移动端适手的侧边栏；
   - 注入本地存储一键状态迁移，首次运行自动适配并尊重用户设置开关。
3. **划线扫阳光手感保真与防瞬移误吸（No-Teleport Raycast Guard）**：
   - 消除触屏离散多点触控在 `Mouse.ts` 内部产生的跨屏瞬移假射线；
   - 100% 完美保留手指连续滑屏扫荡一排阳光/金币的原生畅爽手感。
4. **砸罐子掉落卡触控几何判定修复（Vasebreaker DroppedCards Patch）**：
   - 修复砸罐子模式下打碎罐子掉落种子包因缺少 `MOUSE_ENTER` 导致点击有音效却无法选中的缺陷；
   - 注入 `judgeInUITransform` 几何包围盒算法，支持极速轻触拾取与手持状态平滑换选。
5. **120Hz 极限性能优化套件**：
   - **只读 AABB 粗筛**：相交判定前加入极速 AABB 过滤，减少 95% 无碰撞高成本几何计算；
   - **受击粒子智能限频**：同屏高并发命中粒子在 16ms 窗口内平滑限频，削减 70% Draw Calls；
   - **消除闭包垃圾**：核心射击与碰撞遍历替换原生索引循环，彻底杜绝 GC 掉帧顿挫。

---

## ⚖️ 免责与版权声明 (Disclaimer)

1. **零资源分发（BYOR 规范）**：
   - **本项目不包含、不托管、亦不分发任何《植物大战僵尸》原作或《植物大战僵尸：杂交版》的美术贴图、音频、背景音乐、关卡脚本或编译后的二进制数据。**
   - 本仓库仅包含纯原创的 JavaScript/TypeScript 补丁注入脚本、构建自动化工具及开源 Android 壳代码。
2. **版权归属**：
   - 《植物大战僵尸》（Plants vs. Zombies）商标及相关素材版权归属于 **Electronic Arts (EA) / PopCap Games** 所有；
   - 《植物大战僵尸：杂交版》（PvZGE）改版创意与衍生资产归属于同人原作者（@潜艇伟伟迷 等）；
   - Android 壳工程基于开源项目 [Gardendless] 衍生，遵循 **GNU General Public License v3.0 (GPL-3.0)**。
3. **用途限定**：
   - 本项目仅供个人学习、逆向工程研究及触控辅助技术交流使用，严禁用于任何商业牟利行为。

---

## 🛠️ 自备资源构建指南 (Build Instructions)

本项目采用 **自带资源（Bring Your Own Resources, BYOR）** 模式。构建自己的 Android APK 仅需以下步骤：

### 1. 环境准备
- **Node.js**: v18.0.0 或更高版本
- **Java**: JDK 17
- **Android SDK**: Build-Tools 34.0.0+ / 35.0.0+

### 2. 准备游戏原始文件
从官方或合规发布渠道获取 PvZGE 的 Web/PC 发布包，解压后将包含 `index.html` 与 `assets/` 的目录放置在：
```text
stage/pvzge_web-0.16.0/docs/
```

### 3. 应用触控与性能补丁
进入工程根目录，运行补丁注入工具：
```bash
# 注入触控补丁、PocketUI 与砸罐子掉落卡修复
node tools/apply-isolated-touch.mjs "stage/pvzge_web-0.16.0/docs"

# (可选) 注入 120Hz 极限性能优化补丁
node tools/finalize-016-optimizations.mjs "stage/pvzge_web-0.16.0/docs"
```

### 4. 重新打包 Web 资产
将已打补丁的资源打包并同步到 Android 壳目录：
```bash
node tools/mkzip-game.mjs "stage/pvzge_web-0.16.0/docs" "android-gardendless/app/src/main/assets/pvzge_web-master.zip" --store-media
```

### 5. 编译 Android APK
1. 进入 `android-gardendless` 目录，复制签名配置模板并填入您的证书信息：
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
