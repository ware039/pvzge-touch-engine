// gardendless-android

// Copyright (C) 2026  Caten Hu

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

package com.fct.gardendless

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.webkit.WebChromeClient.CustomViewCallback
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoader.InternalStoragePathHandler
import com.google.android.material.color.DynamicColors
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipInputStream
import androidx.core.net.toUri

class GameActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var aspectContainer: AspectRatioFrameLayout

    private val prefs by lazy { getSharedPreferences("app_data", MODE_PRIVATE) }

    private val FILE_CHOOSER_RESULT_CODE = 101
    private val EXPORT_SAVE_RESULT_CODE = 102

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // 导出流程中解出的存档内容，等待用户在保存对话框里选定目标后再写入
    private var pendingExport: ByteArray? = null
    // 游戏经 Tauri dialog.save 给出的文件名，可能覆盖默认建议名
    private var pendingExportName: String? = null

    // 网页全屏（HTML5 Fullscreen API）回调，非空表示当前处于全屏
    private var fullscreenCallback: CustomViewCallback? = null

    // ------------------------------------------------------------------
    // GP Next（随包 mod 框架）用的 Tauri FS 兼容层
    //
    // GP Next 通过 Tauri IPC 读写 gp-next\packs / gp-next\patches / gp-next\_gpn_edits；
    // WebView 壳里 __TAURI_INTERNALS__ 缺失会让它整片刷 "reading 'invoke'" 而不可用。
    // ⚠ 归因纠错（2026-10-02 下午 / vc24）：曾把「关内点绿格不种」归因到 GP Next 的半途补丁，
    //   那是**误读屏上小字**造成的 —— 真符号是 judgeLIndex，真凶是我们自己注入的 v2 补丁
    //   (UIInGame.onMouseDown 把 Square 管理器实例当类用)，与 GP Next 无关。
    // 这里把文件能力落到 filesDir/gpnext，并严格限制在该目录之内。
    // ------------------------------------------------------------------
    private val gpNextRoot: File by lazy { File(filesDir, "gpnext").apply { mkdirs() } }

    private fun gpResolve(rawPath: String?): File {
        val raw = (rawPath ?: "").trim()
        val candidate = when {
            raw.isEmpty() -> gpNextRoot
            raw.startsWith("/") -> File(raw)
            Regex("^[A-Za-z]:[\\\\/]").containsMatchIn(raw) -> File(raw)
            else -> File(gpNextRoot, raw)
        }
        val root = gpNextRoot.canonicalFile
        val target = candidate.canonicalFile
        if (target != root && !target.path.startsWith(root.path + File.separator)) {
            throw SecurityException("gpnext fs: path outside root: " + raw)
        }
        return target
    }

    private fun gpStatJson(f: File): org.json.JSONObject {
        val o = org.json.JSONObject()
        o.put("name", f.name)
        o.put("isFile", f.isFile)
        o.put("isDirectory", f.isDirectory)
        o.put("isSymlink", false)
        o.put("size", f.length())
        o.put("mtime", f.lastModified())
        o.put("atime", f.lastModified())
        o.put("birthtime", f.lastModified())
        o.put("readonly", !f.canWrite())
        for (k in listOf("fileAttributes", "dev", "ino", "mode", "nlink", "uid", "gid", "rdev", "blksize", "blocks")) {
            o.put(k, 0)
        }
        return o
    }

    private companion object {
        const val PREF_FULLSCREEN = "webview_fullscreen"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        DynamicColors.applyToActivityIfAvailable(this)
        setupFullScreen()

        fun setupWebview() {

// 2. 初始化 WebView
            webView = MouseGameWebView(this)

            // 黑色背景容器，重写测量逻辑实现比例动态适配（最小16:10，最大17:9）
            aspectContainer = AspectRatioFrameLayout(this).apply {
                setBackgroundColor(android.graphics.Color.BLACK)
                // 沿用上次退出时的全屏状态，避免先小后大的尺寸跳变
                fullscreen = prefs.getBoolean(PREF_FULLSCREEN, false)
                // 设置 WebView 居中显示
                addView(
                    webView,
                    android.widget.FrameLayout.LayoutParams(
                        android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                        android.view.ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { gravity = android.view.Gravity.CENTER }
                )
            }

            // 将容器设置为 Content View
            setContentView(aspectContainer)

            // 3. 配置 AssetLoader (关键步骤)
            val assetLoader = WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler(
                    "/",
                    InternalStoragePathHandler(this, File(filesDir, "pvzge_web-master/docs"))
                )
                .build()

            // 4. 设置 WebView 参数
            webView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true // 很多游戏需要存储数据
                allowFileAccess = false  // 使用 AssetLoader 后可以关闭文件访问，更安全
                allowContentAccess = false
                mediaPlaybackRequiresUserGesture = false
            }
            webView.overScrollMode = View.OVER_SCROLL_NEVER
            webView.isVerticalScrollBarEnabled = false
            webView.isHorizontalScrollBarEnabled = false

            // 网页 → 原生桥接：游戏跑在 Tauri polyfill 上，全屏和保存文件名这两件事
            // 在 WebView 里都会丢失（前者被实现为空函数，后者用 prompt 实现而 WebView 不响应），
            // 故在 JS 层截获意图后经此桥转发
            webView.addJavascriptInterface(object {
                @JavascriptInterface
                fun setFullscreen(value: Boolean) {
                    webView.post { setWebviewFullscreen(value) }
                }

                @JavascriptInterface
                fun setExportName(name: String) {
                    pendingExportName = name
                }

                // ---- Tauri FS 兼容层（供注入页面的 tauri-shim.js 调用）----
                @JavascriptInterface
                fun fsBase(): String {
                    gpNextRoot.mkdirs()
                    return gpNextRoot.absolutePath
                }

                @JavascriptInterface
                fun fsExists(path: String): Boolean = gpResolve(path).exists()

                @JavascriptInterface
                fun fsReadText(path: String): String? {
                    val f = gpResolve(path)
                    if (!f.isFile) return null
                    return try { f.readText() } catch (e: Exception) { null }
                }

                @JavascriptInterface
                fun fsWriteText(path: String, text: String): Boolean {
                    val f = gpResolve(path)
                    f.parentFile?.mkdirs()
                    return try { f.writeText(text); true } catch (e: Exception) { false }
                }

                @JavascriptInterface
                fun fsMkdir(path: String, recursive: Boolean): Boolean {
                    val f = gpResolve(path)
                    return if (recursive) f.mkdirs() || f.isDirectory else f.mkdir() || f.isDirectory
                }

                @JavascriptInterface
                fun fsRemove(path: String, recursive: Boolean): Boolean {
                    val f = gpResolve(path)
                    if (!f.exists()) return false
                    return if (recursive) f.deleteRecursively() else f.delete()
                }

                @JavascriptInterface
                fun fsRename(from: String, to: String): Boolean {
                    val src = gpResolve(from)
                    val dst = gpResolve(to)
                    dst.parentFile?.mkdirs()
                    return src.renameTo(dst)
                }

                @JavascriptInterface
                fun fsCopy(from: String, to: String): Boolean {
                    val src = gpResolve(from)
                    val dst = gpResolve(to)
                    if (!src.isFile) return false
                    dst.parentFile?.mkdirs()
                    return try {
                        src.inputStream().use { input -> dst.outputStream().use { input.copyTo(it) } }
                        true
                    } catch (e: Exception) { false }
                }

                @JavascriptInterface
                fun fsReadDir(path: String): String {
                    val f = gpResolve(path)
                    val arr = org.json.JSONArray()
                    val kids = f.listFiles()
                    if (kids != null) for (k in kids) arr.put(gpStatJson(k))
                    return arr.toString()
                }

                @JavascriptInterface
                fun fsStat(path: String): String = gpStatJson(gpResolve(path)).toString()

                @JavascriptInterface
                fun fsReadBase64(path: String): String? {
                    val f = gpResolve(path)
                    if (!f.isFile) return null
                    return try {
                        android.util.Base64.encodeToString(f.readBytes(), android.util.Base64.NO_WRAP)
                    } catch (e: Exception) { null }
                }

                @JavascriptInterface
                fun fsWriteBase64(path: String, base64: String): Boolean {
                    val f = gpResolve(path)
                    f.parentFile?.mkdirs()
                    return try {
                        f.writeBytes(android.util.Base64.decode(base64, android.util.Base64.DEFAULT))
                        true
                    } catch (e: Exception) { false }
                }
            }, "GardendlessBridge")

            webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                if (!url.startsWith("data:")) return@setDownloadListener

                // 1. 解析 Data URI（格式通常为 data:application/json;base64,XXXXX）
                val parts = url.split(",")
                if (parts.size < 2) return@setDownloadListener
                pendingExport = Uri.decode(parts.subList(1, parts.size).joinToString(",")).toByteArray()

                // 2. 交给系统保存对话框，由用户决定位置和文件名
                val fallbackType = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
                val name = pendingExportName ?: suggestFileName(contentDisposition, fallbackType)
                pendingExportName = null
                // 文件名通常已自带扩展名（由游戏给出），mime 必须与之匹配，
                // 否则 SAF 会按 mime 再追加一个后缀（例如 .json 变成 .json.txt）
                val type = mimeFromExtension(name) ?: fallbackType
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    this.type = type
                    addCategory(Intent.CATEGORY_OPENABLE)
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                startActivityForResult(intent, EXPORT_SAVE_RESULT_CODE)
            }

            webView.webViewClient = object : WebViewClient() {
                // 关键：拦截 URL 跳转逻辑
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false

                    // 1. 如果是内部游戏资源路径，允许在 WebView 中加载
                    if (url.startsWith("https://appassets.androidplatform.net/")) {
                        return false
                    }

                    // 2. 如果是外部链接，跳转到外部浏览器
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, url.toUri())
                        startActivity(intent)
                        return true // 表示我们已经处理了该跳转
                    } catch (e: Exception) {
                        e.printStackTrace()
                        return false
                    }
                }
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    view?.evaluateJavascript(gameBridgeHookJs, null)
                    view?.postDelayed({ view?.evaluateJavascript(tauriShimJs, null) }, 0)
                    view?.postDelayed({ view?.evaluateJavascript(tauriShimJs, null) }, 400)
                    view?.postDelayed({ view?.evaluateJavascript(tauriShimJs, null) }, 1500)
                    val js = """
(function() {
    const target = document.getElementById("GameCanvas");
    if (!target) return;

    target.addEventListener("touchstart", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
    }, { capture: true, passive: false });
    target.addEventListener("touchmove", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
    }, { capture: true, passive: false });
    target.addEventListener("touchend", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
    }, { capture: true, passive: false });
})();
                        """.trimIndent()
                    view?.postDelayed({
                        view.evaluateJavascript(js, null)
                    }, 8000)
                }

                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    // 拦截并交给 AssetLoader 处理
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }
            webView.webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    // 保存回调以便在 onActivityResult 中使用
                    this@GameActivity.filePathCallback = filePathCallback

                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)

                        // 1. 设置主类型为通配符，以便能够显示更多文件
                        type = "*/*"

                        // 2. 显式指定允许的多种 MIME 类型
                        val mimeTypes = arrayOf(
                            "application/json",
                            "application/octet-stream", // 很多系统把 json5 识别为 bin
                            "text/plain"               // 有些系统把 json5 识别为纯文本
                        )
                        putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
                    }
                    try {
                        startActivityForResult(intent!!, FILE_CHOOSER_RESULT_CODE)
                    } catch (e: Exception) {
                        this@GameActivity.filePathCallback = null
                        return false
                    }
                    return true
                }

                // 网页调用 element.requestFullscreen() 时触发
                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    if (fullscreenCallback != null) {
                        // 已在全屏，拒绝重复进入并立刻通知网页
                        callback.onCustomViewHidden()
                        return
                    }
                    fullscreenCallback = callback
                    setWebviewFullscreen(true)
                }

                // 网页调用 document.exitFullscreen() 时触发
                override fun onHideCustomView() {
                    val callback = fullscreenCallback ?: return
                    // 必须回调 onCustomViewHidden，否则 WebView 内部会一直停留在全屏状态
                    callback.onCustomViewHidden()
                    fullscreenCallback = null
                    setWebviewFullscreen(false)
                }
            }

            // 5. 加载入口文件
            // 映射关系：https://appassets.androidplatform.net/ -> gameDir/
            webView.loadUrl("https://appassets.androidplatform.net/index.html")

            setupBackNavigation()
        }

        fun checkAndExtractAssets(currentVersion: Int) {
            // 1. 创建一个简单的进度对话框
            val progressBar = ProgressBar(this).apply {
                isIndeterminate = true // 设置为不确定模式（循环转圈）
                setPadding(50, 50, 50, 50)
            }

            val dialog = MaterialAlertDialogBuilder(this)
                .setTitle(R.string.unzipping) // 建议在 strings.xml 定义“正在准备资源...”
                .setMessage(R.string.description)
                .setView(progressBar)
                .setCancelable(false) // 防止解压时用户点击返回键取消
                .create()

            dialog.show()

            // 2. 开启协程/后台线程处理 IO
            GlobalScope.launch(Dispatchers.IO) {
                try {
                    assets.open("pvzge_web-master.zip").use { inputStream ->
                        ZipInputStream(inputStream).use { zis ->
                            var entry = zis.nextEntry
                            while (entry != null) {
                                val file = File(filesDir, entry.name)
                                if (entry.isDirectory) {
                                    file.mkdirs()
                                } else {
                                    file.parentFile?.mkdirs()
                                    file.outputStream().use { zis.copyTo(it) }
                                }
                                entry = zis.nextEntry
                            }
                        }
                    }

                    // 写入版本号
                    prefs.edit().putInt("extracted_version", currentVersion).apply()

                    // 3. 回到主线程关闭对话框并加载游戏
                    withContext(Dispatchers.Main) {
                        dialog.dismiss()
                        setupWebview() // 将你原来的 WebView 初始化逻辑封装成此函数
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                    withContext(Dispatchers.Main) {
                        dialog.dismiss()
                    }
                }
            }
        }



        // 1. 准备路径
        val currentVersion = packageManager.getPackageInfo(packageName, 0).versionCode

        if (prefs.getInt("extracted_version", 0) != currentVersion) {
            checkAndExtractAssets(currentVersion)
        } else {
            setupWebview()
        }
    }

    override fun onDestroy() {
        // 页面若仍处于全屏，通知 WebView 退出，避免其内部状态残留
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        super.onDestroy()
    }

    // 在 Activity 中处理选择结果
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            FILE_CHOOSER_RESULT_CODE -> {
                val result = if (data == null || resultCode != RESULT_OK) null else arrayOf(data.data!!)
                filePathCallback?.onReceiveValue(result as Array<Uri>?)
                filePathCallback = null
            }
            EXPORT_SAVE_RESULT_CODE -> {
                val bytes = pendingExport
                pendingExport = null
                // 用户取消保存时 data 为 null，直接丢弃暂存内容
                val uri = data?.data
                if (bytes != null && uri != null) saveExportTo(uri, bytes)
            }
        }
    }

    private fun saveExportTo(uri: Uri, bytes: ByteArray) {
        GlobalScope.launch(Dispatchers.IO) {
            val ok = runCatching {
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw java.io.IOException("openOutputStream returned null")
            }.isSuccess
            withContext(Dispatchers.Main) {
                Toast.makeText(
                    this@GameActivity,
                    if (ok) R.string.export_done else R.string.export_failed,
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    /**
     * 保存对话框默认名的兜底：游戏通常已通过 Tauri dialog.save 给出文件名（见 [gameBridgeHookJs]），
     * 取不到时才退回 contentDisposition 的建议名，再取不到才按类型和时间生成。
     */
    private fun suggestFileName(contentDisposition: String?, mimeType: String): String {
        contentDisposition
            ?.let { Regex("""filename\*?=(?:UTF-8''|utf-8'')?"?([^";]+)"?""", RegexOption.IGNORE_CASE).find(it) }
            ?.groupValues?.get(1)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?.let { return it }

        val time = java.time.LocalDateTime.now()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))
        return "gardendless_$time.${mimeToExtension(mimeType)}"
    }

    private fun mimeToExtension(mimeType: String): String = when (val type = mimeType.substringBefore(';').trim()) {
        "application/json" -> "json"
        "text/plain" -> "txt"
        "application/octet-stream" -> "bin"
        else -> type.substringAfter('/').takeIf { it.all(Char::isLetterOrDigit) } ?: "bin"
    }

    private fun mimeFromExtension(fileName: String): String? {
        val ext = fileName.substringAfterLast('.', "")
            .takeIf { it.isNotBlank() && it != fileName } ?: return null
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase())
    }

    private fun setupFullScreen() {
        // 隐藏 ActionBar (如果在 Manifest 中没设主题，这里是双保险)
        supportActionBar?.hide()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11 (API 30) 及以上
            window.setDecorFitsSystemWindows(false)
            val params = window.attributes
            params.preferredRefreshRate = 120f
            window.attributes = params
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            // 旧版本兼容写法
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }

        // 保持屏幕常亮，适合游戏场景
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /**
     * 注入页面的钩子。
     *
     * 游戏跑在 Tauri polyfill 上，有两件事在 WebView 里会丢失：
     * - 全屏：polyfill 把 `plugin:window|set_fullscreen` 实现为空函数，且 WebView 对非 video
     *   元素不回调 onShowCustomView；
     * - 导出文件名：polyfill 用 `prompt()` 询问文件名，而 WebView 不响应 prompt 恒返回 null，
     *   游戏拿不到名字，导出时只能退化为默认名。
     *
     * 这里包装相关通道，把网页的意图转发给原生处理。
     */


    // >>> PVZGE_HOOK_tauriShimJs_BEGIN (由 apply-native-hooks.mjs 生成，勿手改) >>>
    private val tauriShimJs = """
    // Tauri IPC 兼容层（由原生 GameActivity 在页面脚本之前注入）
    // 背景：GP Next（随包 mod 框架）与游戏自身的 Tauri 调用都直接访问 window.__TAURI_INTERNALS__；
    //       Android WebView 壳里没有这套对象 → gp-next\packs|patches|_gpn_edits 全部报
    //       "Cannot read properties of undefined (reading 'invoke')"。
    //       ⚠ 归因纠错（2026-10-02 下午，vc24）：曾把「关内点绿格不种」的错误串误读为
    //       `squares.judgeIndex`，据此把责任推给 GP Next 的半途补丁 —— **该归因不成立**。
    //       真符号与真凶都是**我们自己注入的 v2 补丁**：UIInGame.onMouseDown 里
    //       `this.squares.judgeLIndex is not a function`（把 Square 管理器实例当类用），
    //       抛错掐断该 handler 剩余逻辑 → 目标格子 index 无法置 1 → 不调用 PlaceUIPlant。
    //       本 shim 只解决「GP Next 的 FS/IPC 不可用」，与种植缺陷无关（vc24 已修）。
    // 做法：补出 __TAURI_INTERNALS__（invoke / transformCallback / metadata），文件类命令走原生
    //       GardendlessBridge 的 fs* 方法，根目录限定 filesDir/gpnext。
    //
    // ⚠ 关键时序：游戏的 startup-platform 会在**引擎导入之前**检查 `window.__TAURI_INTERNALS__`，
    //   一旦存在就走"原生 Tauri 启动流程"（startupAttempt / packInstallStore / configurationStorage），
    //   在 WebView 里会卡死在启动阶段（实测：场景名一直为空、引擎起不来）。
    //   所以本 shim **必须等引擎起来之后再挂**（轮询 legacy 全局 cc.director），
    //   让游戏按 Web 路径正常启动，而 GP Next 在之后加载/重载补丁时就能拿到 Tauri 能力。
    (function () {
      if (window.__pvzgeTauriShim) return;
      window.__pvzgeTauriShim = true;
      window.__pvzgeTauriShimLoaded = true;

      var D0 = (window.__D = window.__D || {});
      D0.tauri = D0.tauri || { calls: 0, unknown: [], last: '', err: '', base: '' };
      D0.tauri.loaded = true;

      function tiRef() { return window.__TAURI_INTERNALS__; }
      function functional() {
        try { var t = tiRef(); return !!(t && typeof t.invoke === 'function'); } catch (e) { return false; }
      }
      function engineUp() {
        try { return !!(window.cc && window.cc.director && window.cc.director.getScene()); } catch (e) { return false; }
      }

      function install() {
        if (window.__pvzgeTauriInstall) return;
        window.__pvzgeTauriInstall = true;

      var D = (window.__D = window.__D || {});
      D.tauri = D.tauri || { calls: 0, unknown: [], last: '', err: '', base: '' };

      function B() { return window.GardendlessBridge || null; }
      function baseDir() {
        if (D.tauri.base) return D.tauri.base;
        var b = B();
        var v = null;
        try { v = (b && b.fsBase) ? String(b.fsBase()) : null; } catch (e) { v = null; }
        D.tauri.base = v || '/data/local/tmp/gpnext';
        return D.tauri.base;
      }
      function join(p) {
        var s = (p == null) ? '' : String(p);
        if (!s) return baseDir();
        if (s.charAt(0) === '/' || /^[A-Za-z]:[\\/]/.test(s)) return s;   // 绝对路径交给原生做包含性校验
        return baseDir() + '/' + s.replace(/^[\\/]+/, '');
      }
      function fail(msg, code) { var e = new Error(msg); e.code = code || 'FS_ERROR'; return e; }
      function need(name) {
        var b = B();
        if (!b || typeof b[name] !== 'function') throw fail('native bridge missing: ' + name, 'BRIDGE_MISSING');
        return b;
      }

      // ---- Tauri 事件总线（GP Next 的面板/菜单动作依赖 listen+emit 往返，纯 no-op 会让它失联）----
      var listeners = Object.create(null);
      var evSeq = 0;
      function evListen(a) {
        var ev = String((a && a.event) || '');
        var arr = listeners[ev] || (listeners[ev] = []);
        var id = ++evSeq;
        arr.push({ id: id, handler: a && a.handler });
        D.tauri.listeners = (D.tauri.listeners || 0) + 1;
        return id;
      }
      function evUnlisten(a) {
        var ev = String((a && a.event) || '');
        var id = a && a.id;
        if (listeners[ev]) listeners[ev] = listeners[ev].filter(function (x) { return x.id !== id; });
        return null;
      }
      function evEmit(a) {
        var ev = String((a && a.event) || '');
        var payload = a && a.payload;
        var arr = listeners[ev] || [];
        D.tauri.lastEvent = ev;
        for (var i = 0; i < arr.length; i++) {
          var fn = window['_' + arr[i].handler];
          if (typeof fn === 'function') {
            try { fn({ event: ev, id: a && a.id, payload: payload }); } catch (e) { D.tauri.err = 'emit ' + String(e && e.message); }
          }
        }
        return null;
      }

      var H = {
        'plugin:path|resolve_directory': function () { return baseDir(); },
        'plugin:path|join': function (a) { return join(a && a.path); },
        'plugin:path|normalize': function (a) { return join(a && a.path); },

        'plugin:fs|read_text_file': function (a) {
          var b = need('fsReadText');
          var s = b.fsReadText(join(a && a.path));
          if (s == null) throw fail('read_text_file failed: ' + (a && a.path), 'FS_READ');
          return String(s);
        },
        'plugin:fs|write_text_file': function (a) {
          var b = need('fsWriteText');
          var text = (a && a.contents != null) ? String(a.contents) : '';
          if (!b.fsWriteText(join(a && a.path), text)) throw fail('write_text_file failed: ' + (a && a.path), 'FS_WRITE');
          return null;
        },
        'plugin:fs|read_dir': function (a) {
          var b = need('fsReadDir');
          var raw = b.fsReadDir(join(a && a.path));
          if (raw == null) throw fail('read_dir failed: ' + (a && a.path), 'FS_READ_DIR');
          return JSON.parse(String(raw));
        },
        'plugin:fs|exists': function (a) { return !!need('fsExists').fsExists(join(a && a.path)); },
        'plugin:fs|mkdir': function (a) {
          var b = need('fsMkdir');
          var rec = !!((a && a.options) || {}).recursive;
          if (!b.fsMkdir(join(a && a.path), rec)) throw fail('mkdir failed: ' + (a && a.path), 'FS_MKDIR');
          return null;
        },
        'plugin:fs|remove': function (a) {
          var b = need('fsRemove');
          var rec = !!((a && a.options) || {}).recursive;
          if (!b.fsRemove(join(a && a.path), rec)) throw fail('remove failed: ' + (a && a.path), 'FS_REMOVE');
          return null;
        },
        'plugin:fs|rename': function (a) {
          var b = need('fsRename');
          var from = (a && (a.oldPath || a.from)) || '';
          var to = (a && (a.newPath || a.to)) || '';
          if (!b.fsRename(join(from), join(to))) throw fail('rename failed', 'FS_RENAME');
          return null;
        },
        'plugin:fs|copy_file': function (a) {
          var b = need('fsCopy');
          var from = (a && (a.fromPath || a.from)) || '';
          var to = (a && (a.toPath || a.to)) || '';
          if (!b.fsCopy(join(from), join(to))) throw fail('copy_file failed', 'FS_COPY');
          return null;
        },
        'plugin:fs|stat': function (a) { return JSON.parse(String(need('fsStat').fsStat(join(a && a.path)))); },
        'plugin:fs|lstat': function (a) { return JSON.parse(String(need('fsStat').fsStat(join(a && a.path)))); },
        'plugin:fs|read_file': function (a) {
          var b64 = need('fsReadBase64').fsReadBase64(join(a && a.path));
          if (b64 == null) throw fail('read_file failed: ' + (a && a.path), 'FS_READ');
          var bin = atob(String(b64));
          var out = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        },
        'plugin:fs|write_file': function (a) {
          var data = (a && a.data) || new Uint8Array(0);
          var bin = '';
          for (var i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
          if (!need('fsWriteBase64').fsWriteBase64(join(a && a.path), btoa(bin))) throw fail('write_file failed', 'FS_WRITE');
          return null;
        },

        'plugin:window|get_all_windows': function () { return ['main']; },
        'plugin:window|is_fullscreen': function () { return false; },
        'plugin:window|set_fullscreen': function (a) {
          var b = B();
          if (b && b.setFullscreen) b.setFullscreen(!!(a && a.value));
          return null;
        },
        'plugin:dialog|save': function (a) {
          var p = (a && (a.defaultPath || ((a.options || {}).defaultPath))) || '';
          var name = p ? String(p).split(/[\\/]/).pop() : '';
          var b = B();
          if (name && b && b.setExportName) b.setExportName(name);
          return name || null;
        },
        'plugin:resources|close': function () { return null; },
        'plugin:event|listen': evListen,
        'plugin:event|unlisten': evUnlisten,
        'plugin:event|emit': evEmit,
        'plugin:event|emit_to': evEmit,
        'update_macos_menu': function () { return null; },
        'plugin:app|version': function () { return '0.15.0'; },
        'plugin:app|name': function () { return 'gardendless'; },
        'plugin:os|platform': function () { return 'android'; },
        'plugin:os|arch': function () { return 'aarch64'; },
        'plugin:os|locale': function () { return 'zh-CN'; }
      };

      // 纯桩：只要不炸即可（GP Next 会用到窗口/对话框若干命令）
      var noopPrefixes = ['plugin:window|', 'plugin:webview|', 'plugin:dialog|', 'plugin:app|', 'plugin:os|', 'plugin:event|', 'plugin:resources|'];
      function known(cmd) {
        if (H[cmd]) return H[cmd];
        for (var i = 0; i < noopPrefixes.length; i++) if (String(cmd).indexOf(noopPrefixes[i]) === 0) return function () { return null; };
        return null;
      }

      function invoke(cmd, args) {
        D.tauri.calls++;
        D.tauri.last = String(cmd);
        var h = known(cmd);
        try {
          if (!h) {
            if (D.tauri.unknown.length < 16 && D.tauri.unknown.indexOf(String(cmd)) < 0) D.tauri.unknown.push(String(cmd));
            return Promise.resolve(null);
          }
          return Promise.resolve(h(args || {}));
        } catch (e) {
          D.tauri.err = String((e && e.message) || e).slice(0, 120);
          return Promise.reject(e);
        }
      }

      var cbId = 0;
      function transformCallback(cb, once) {
        var id = ++cbId;
        window['_' + id] = function (result) {
          try { if (typeof cb === 'function') cb(result); }
          finally { if (once) { try { delete window['_' + id]; } catch (e) {} } }
        };
        return id;
      }

      var ti = window.__TAURI_INTERNALS__ || {};
      if (typeof ti.invoke !== 'function') ti.invoke = invoke;
      if (typeof ti.transformCallback !== 'function') ti.transformCallback = transformCallback;
      if (!ti.metadata) {
        ti.metadata = {
          currentWindow: { label: 'main' },
          currentWebview: { windowLabel: 'main', label: 'main' },
          windows: [{ label: 'main' }],
          platform: 'android'
        };
      }
      if (typeof ti.convertFileSrc !== 'function') ti.convertFileSrc = function (p) { return String(p); };
      if (!ti.plugins) ti.plugins = {};
      window.__TAURI_INTERNALS__ = ti;
      if (!window.__TAURI__) window.__TAURI__ = { core: { invoke: invoke }, tauri: { invoke: invoke } };
      D.tauri.installedAt = Date.now();

      // ---- 自动修复：GP Next 上次因缺 FS 而半途失败（助手函数没定义、调用点却留下了），
      //      等它的公共 API 就绪后请它"带着 FS 能力重跑补丁"（等价点面板的「重新加载所有补丁」）。
      var waited = 0;
      (function waitApi() {
        var g = window.gpNext;
        if (g && typeof g.reload === 'function') {
          D.tauri.reload = 'calling';
          Promise.resolve()
            .then(function () { return g.reload(); })
            .then(function () { D.tauri.reload = 'ok@' + Math.round((Date.now() - D.tauri.installedAt) / 1000) + 's'; })
            .catch(function (e) { D.tauri.reload = 'err:' + String((e && e.message) || e).slice(0, 60); });
          return;
        }
        waited += 300;
        if (waited > 60000) { D.tauri.reload = 'no-api'; return; }
        setTimeout(waitApi, 300);
      })();
      }

      // 引擎起来之前绝不挂 internals（否则游戏会走 Tauri 启动流程而卡死）
      // 同时把"为什么没挂/挂没挂"全程写进 __D.tauri，供屏上诊断层显示（真机 debug 的关键证据）。
      var t0 = Date.now();
      (function wait() {
        var t = D0.tauri;
        t.attempts = (t.attempts || 0) + 1;
        t.ccExists = !!window.cc;
        t.engineUp = engineUp();
        t.tiExists = !!tiRef();
        t.tiHasInvoke = !!(tiRef() && typeof tiRef().invoke === 'function');
        if (functional()) { t.skipped = 'real-tauri'; return; }          // 真 Tauri（或别人已提供可用 invoke）就不抢
        if (t.engineUp || Date.now() - t0 > 6000) { install(); t.installed = true; return; }
        setTimeout(wait, 100);
      })();
    })();

    """.trimIndent()
    // <<< PVZGE_HOOK_tauriShimJs_END <<<



    private val gameBridgeHookJs = """
(function() {
    if (window.__gdHooked) return;
    window.__gdHooked = true;

    try {
        var origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attributes) {
            if (type === 'webgl2' || type === 'webgl') {
                attributes = attributes || {};
                attributes.desynchronized = true;
                attributes.powerPreference = 'high-performance';
            }
            return origGetContext.call(this, type, attributes);
        };
    } catch (e) {}

    try {
        var style = document.createElement('style');
        style.textContent = '#GameCanvas, #GameDiv, #Cocos3dGameContainer { touch-action: none !important; -webkit-touch-callout: none !important; user-select: none !important; }';
        (document.head || document.documentElement).appendChild(style);
    } catch (e) {}

    var bridge = window.GardendlessBridge;

    // 快速触控分发：预编译常驻调度器，消除每次点击动态 eval 闭包开销
    window.__pvzFastDispatch = function(x, y, type, button) {
        var el = document.getElementById("GameCanvas");
        if (!el) return;
        var d = window.devicePixelRatio || 1;
        var ev = new MouseEvent(type, {
            view: window,
            bubbles: true,
            cancelable: true,
            screenX: x,
            screenY: y,
            clientX: x / d,
            clientY: y / d,
            button: button
        });
        el.dispatchEvent(ev);
    };

    // 游戏启动时（约 2s）会按自己内部状态同步一次 setFullscreen(false)，
    // 那会把我们从 SharedPreferences 恢复的全屏状态冲掉。
    // 故在启动保护期内忽略这条自动同步的 false；true 一律放行，不影响用户主动操作。
    var bootGuard = true;
    setTimeout(function() { bootGuard = false; }, 6000);

    var setFullscreen = function(v) {
        if (bootGuard && !v) { bootGuard = false; return; }
        bootGuard = false;
        try { bridge.setFullscreen(!!v); } catch (e) { /* 桥不可用时静默降级 */ }
    };

    var setExportName = function(name) {
        if (!name) return;
        try { bridge.setExportName(String(name)); } catch (e) { /* 忽略 */ }
    };

    // 下载命名：游戏用 <a download="名字" href="data:..."> + click() 触发导出，
    // 文件名只存在于 a.download 上，不会传给原生，故在此捕获
    var isDataHref = function(el) {
        return (el && el.getAttribute && (el.getAttribute('href') || '').indexOf('data:') === 0);
    };
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        if (this.download && isDataHref(this)) setExportName(this.download);
        return origClick.apply(this, arguments);
    };
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
        if (a && isDataHref(a)) setExportName(a.getAttribute('download'));
    }, true);

    // 标准 Fullscreen API（游戏若改用此路径也能覆盖）
    var ep = Element.prototype;
    var req = ep.requestFullscreen || ep.webkitRequestFullscreen || ep.webkitRequestFullScreen;
    if (req) {
        ep.requestFullscreen = function() { setFullscreen(true); return req.apply(this, arguments); };
    }
    var dp = Document.prototype;
    var exit = dp.exitFullscreen || dp.webkitExitFullscreen || dp.webkitCancelFullScreen;
    if (exit) {
        dp.exitFullscreen = function() { setFullscreen(false); return exit.apply(this, arguments); };
    }

    // Tauri invoke：游戏实际走这条
    var patchTauri = function() {
        var ti = window.__TAURI_INTERNALS__;
        if (!ti || !ti.invoke || ti.__gdHooked) return false;
        ti.__gdHooked = true;
        var orig = ti.invoke;
        ti.invoke = function(cmd, args) {
            if (cmd === 'plugin:window|set_fullscreen') {
                setFullscreen(!!(args && args.value));
                return Promise.resolve(null);
            }
            if (cmd === 'plugin:dialog|save') {
                // 游戏请求一个保存文件名。原生记下它，随后用它作为保存对话框的默认名，
                // 与游戏自身的命名规则（存档、键位配置等各不相同）保持一致。
                var raw = args && (args.defaultPath || (args.options && args.options.defaultPath));
                var name = raw ? String(raw).split(/[\\/]/).pop() : '';
                if (name) {
                    setExportName(name);
                    return Promise.resolve(name);
                }
            }
            return orig.apply(this, arguments);
        };
        return true;
    };

    // polyfill 在 head 中同步执行，可能晚于本脚本，短暂轮询等待
    if (!patchTauri()) {
        var tries = 0;
        var timer = setInterval(function() {
            if (patchTauri() || ++tries > 100) clearInterval(timer);
        }, 50);
    }
})();
    """.trimIndent()

    /**
     * 切换 WebView 满屏 / 比例适配，并持久化该状态供下次启动沿用。
     */
    private fun setWebviewFullscreen(enabled: Boolean) {
        aspectContainer.fullscreen = enabled
        prefs.edit().putBoolean(PREF_FULLSCREEN, enabled).apply()
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    showExitDialog()
                }
            }
        })
    }

    private fun showExitDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.hint) // 需在 strings.xml 定义
            .setMessage(R.string.exit_confirm)
            .setPositiveButton(R.string.yes) { _, _ -> finish() }
            .setNegativeButton(R.string.no, null)
            .show()
    }
}

