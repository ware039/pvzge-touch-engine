package com.fct.gardendless

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.view.InputDevice
import android.view.MotionEvent
import android.webkit.WebView
import kotlin.math.abs

class MouseGameWebView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : WebView(context, attrs) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var isDragging = false
    private var primaryPointerId = 0
    private var lastScrollY = 0f
    private var touchStartCenterX = 0f
    private var touchStartCenterY = 0f
    private var hasMovedEnough = false
    private val moveThreshold = 20f
    private var maxTouches = 0
    private var isTouching = false

    // 240Hz 触控采样抗积压与防抖死区配置
    private var lastInjectedMoveX = 0f
    private var lastInjectedMoveY = 0f
    private var lastInjectedMoveTime = 0L
    private val moveDeadzoneSq = 9f // 3px 物理像素死区平方
    private val minMoveIntervalMs = 8L // 限制最高派发频率 ~120Hz，消灭背压

    // 获取屏幕密度，用于将物理像素转换为CSS像素
    private val density = context.resources.displayMetrics.density

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.source == InputDevice.SOURCE_MOUSE) {
            return super.dispatchTouchEvent(event)
        }

        val action = event.actionMasked
        val pointerCount = event.pointerCount
        if (pointerCount > maxTouches) maxTouches = pointerCount

        when (action) {
            MotionEvent.ACTION_DOWN -> {
                if (pointerCount == 1) {
                    isTouching = true
                    primaryPointerId = event.getPointerId(0)
                    val dx = event.x
                    val dy = event.y
                    touchStartCenterX = dx
                    touchStartCenterY = dy
                    hasMovedEnough = false
                    lastInjectedMoveX = dx
                    lastInjectedMoveY = dy
                    lastInjectedMoveTime = System.currentTimeMillis()

                    // 1. [Move] 保持原样：立即瞬移光标（Native）

                    // 2. [Down] 快速派发 mousedown
                    if (isTouching && maxTouches == 1) {
                        injectJsMouseEvent(dx, dy, "mousedown", 0)
                        isDragging = true
                    }
                    return super.dispatchTouchEvent(event)
                }
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                if (pointerCount == 2) {
                    // 多指点按时不立即强制中断拖拽，记录两指中心位置用于判定是否为协同滑动
                    hasMovedEnough = false
                    val cx = (event.getX(0) + event.getX(1)) / 2
                    val cy = (event.getY(0) + event.getY(1)) / 2
                    touchStartCenterX = cx
                    touchStartCenterY = cy
                    lastScrollY = cy
                }
            }

            MotionEvent.ACTION_MOVE -> {
                if (pointerCount == 1 && isDragging) {
                    val mx = event.x
                    val my = event.y
                    val now = System.currentTimeMillis()
                    val distSq = (mx - lastInjectedMoveX) * (mx - lastInjectedMoveX) + (my - lastInjectedMoveY) * (my - lastInjectedMoveY)
                    if (distSq >= moveDeadzoneSq && (now - lastInjectedMoveTime) >= minMoveIntervalMs) {
                        lastInjectedMoveX = mx
                        lastInjectedMoveY = my
                        lastInjectedMoveTime = now
                        injectMouseEventAt(mx, my, MotionEvent.ACTION_MOVE, MotionEvent.BUTTON_PRIMARY)
                    }
                } else if (pointerCount >= 2) {
                    val cx = (event.getX(0) + event.getX(1)) / 2
                    val cy = (event.getY(0) + event.getY(1)) / 2
                    val deltaTotal = abs(cy - touchStartCenterY)

                    if (hasMovedEnough || deltaTotal > moveThreshold) {
                        if (!hasMovedEnough) {
                            // 确定发生双指协同滑移，此时才解除左键拖拽并切换为滚轮模式
                            isDragging = false
                            hasMovedEnough = true
                        }
                        val scrollDelta = cy - lastScrollY
                        injectScrollEventAt(touchStartCenterX, touchStartCenterY, scrollDelta * 2)
                        lastScrollY = cy
                    } else if (isDragging) {
                        // 未超出双指位移容差：主手指保持继续拖拽卡牌/铲子
                        val p0Idx = event.findPointerIndex(primaryPointerId)
                        if (p0Idx >= 0) {
                            val mx = event.getX(p0Idx)
                            val my = event.getY(p0Idx)
                            val now = System.currentTimeMillis()
                            val distSq = (mx - lastInjectedMoveX) * (mx - lastInjectedMoveX) + (my - lastInjectedMoveY) * (my - lastInjectedMoveY)
                            if (distSq >= moveDeadzoneSq && (now - lastInjectedMoveTime) >= minMoveIntervalMs) {
                                lastInjectedMoveX = mx
                                lastInjectedMoveY = my
                                lastInjectedMoveTime = now
                                injectMouseEventAt(mx, my, MotionEvent.ACTION_MOVE, MotionEvent.BUTTON_PRIMARY)
                            }
                        }
                    }
                }
            }

            MotionEvent.ACTION_POINTER_UP -> {
                val upIndex = event.actionIndex
                val upId = event.getPointerId(upIndex)
                if (upId != primaryPointerId && !hasMovedEnough) {
                    // 次级手指快速点击（如单手拖拽卡牌时，另一只手指快速点按拾取阳光或硬币）
                    val upX = event.getX(upIndex)
                    val upY = event.getY(upIndex)
                    injectJsMouseEvent(upX, upY, "mousedown", 0)
                    injectJsMouseEvent(upX, upY, "mouseup", 0)
                } else if (upId == primaryPointerId && isDragging) {
                    val upX = event.getX(upIndex)
                    val upY = event.getY(upIndex)
                    injectJsMouseEvent(upX, upY, "mouseup", 0)
                    isDragging = false
                }
            }

            MotionEvent.ACTION_UP -> {
                isTouching = false
                mainHandler.removeCallbacksAndMessages(null)
                lastInjectedMoveTime = 0L

                if (isDragging) {
                    injectJsMouseEvent(event.x, event.y, "mouseup", 0)
                    maxTouches = 0
                    isDragging = false
                    hasMovedEnough = false
                    return super.dispatchTouchEvent(event)
                } else if (maxTouches == 2 && !hasMovedEnough) {
                    // 双指原地点按触发右键
                    injectRightClickAt(touchStartCenterX, touchStartCenterY)
                }

                maxTouches = 0
                isDragging = false
                hasMovedEnough = false
            }
        }
        return true
    }

    /**
     * 优化：通过预编译常驻调度函数 window.__pvzFastDispatch 快速派发鼠标事件
     * 避免每一次点击产生动态匿名闭包与 V8 即时解析开销
     * @param x 物理像素X
     * @param y 物理像素Y
     * @param type 事件类型 "mousedown" 或 "mouseup"
     * @param button 按键代码：0=左键, 2=右键
     */
    private fun injectJsMouseEvent(x: Float, y: Float, type: String, button: Int) {
        val cssX = x / density
        val cssY = y / density
        val js = "if(window.__pvzFastDispatch){window.__pvzFastDispatch($x,$y,'$type',$button);}else{" +
            "(function(){var el=document.getElementById('GameCanvas');if(!el)return;" +
            "el.dispatchEvent(new MouseEvent('$type',{view:window,bubbles:true,cancelable:true,screenX:$x,screenY:$y,clientX:$cssX,clientY:$cssY,button:$button}));})();}"
        this.evaluateJavascript(js, null)
    }

    // 保持不变：用于 Move
    private fun injectMouseEventAt(x: Float, y: Float, action: Int, buttonState: Int) {
        val props = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_MOUSE })
        val coords = arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y })
        val ev = MotionEvent.obtain(
            System.currentTimeMillis(), System.currentTimeMillis(), action,
            1, props, coords, 0, buttonState, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0
        )
        super.dispatchTouchEvent(ev)
        ev.recycle()
    }

    // 保持不变：用于 Scroll
    private fun injectScrollEventAt(x: Float, y: Float, delta: Float) {
        val props = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_MOUSE })
        val coords = arrayOf(MotionEvent.PointerCoords().apply {
            this.x = x; this.y = y
            setAxisValue(MotionEvent.AXIS_VSCROLL, delta / 15f)
        })
        val ev = MotionEvent.obtain(
            System.currentTimeMillis(), System.currentTimeMillis(), MotionEvent.ACTION_SCROLL,
            1, props, coords, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0
        )
        super.dispatchGenericMotionEvent(ev)
        ev.recycle()
    }

    // 修改：右键点击逻辑，Move 用 Native，点击用 JS
    private fun injectRightClickAt(x: Float, y: Float) {
        // 1. Move 到位 (Native)
        //injectMouseEventAt(x, y, MotionEvent.ACTION_MOVE, MotionEvent.BUTTON_PRIMARY)
        injectJsMouseEvent(x, y, "mousedown", 2)
        injectJsMouseEvent(x, y, "mouseup", 2)
    }
}