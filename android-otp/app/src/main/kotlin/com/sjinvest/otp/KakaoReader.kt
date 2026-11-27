package com.sjinvest.otp

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.concurrent.thread

/**
 * 접근성 리더 — 카카오톡 화면이 보일 때 그 화면 글자에서 인증번호를 직접 읽는다.
 * 보험사 알림톡이 '알림으론 안 뜨고 카톡창을 열어야 보이는' 경우를 처리.
 * (설정 > 접근성에서 'SJ 인증번호' ON, com.kakao.talk 에만 반응)
 */
class KakaoReader : AccessibilityService() {
    private var lastScan = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (event.packageName?.toString() != "com.kakao.talk") return
        // 과도한 스캔 방지 (0.6초 간격)
        val now = System.currentTimeMillis()
        if (now - lastScan < 600) return
        lastScan = now

        val root = rootInActiveWindow ?: return
        val sb = StringBuilder()
        try {
            collectText(root, sb, 0)
        } finally {
            @Suppress("DEPRECATION")
            root.recycle()
        }
        val body = sb.toString().trim()
        if (body.isBlank()) return

        // 화면 스캔은 매우 자주 발생하므로, '인증번호' 패턴이 실제로 있을 때만 처리(로그 스팸 방지).
        val code = Otp.extractCode(body) ?: return
        if (Otp.isDuplicate(code)) return

        val insurer = Otp.INSURERS.firstOrNull { body.contains(it) }
        val prefs = getSharedPreferences(Otp.PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) { Otp.log(this, "[카톡화면] $code → 토큰 미저장"); return }

        thread {
            val rc = Sender.post(url, token, code, insurer, "카카오톡(화면)", body.take(200))
            Otp.log(applicationContext, "[카톡화면] $code → ${Otp.resultText(rc)}")
        }
    }

    override fun onInterrupt() {}

    private fun collectText(node: AccessibilityNodeInfo?, sb: StringBuilder, depth: Int) {
        node ?: return
        if (depth > 60 || sb.length > 4000) return
        node.text?.let { if (it.isNotBlank()) sb.append(it).append(' ') }
        node.contentDescription?.let { if (it.isNotBlank()) sb.append(it).append(' ') }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collectText(child, sb, depth + 1)
            @Suppress("DEPRECATION")
            child?.recycle()
        }
    }
}
