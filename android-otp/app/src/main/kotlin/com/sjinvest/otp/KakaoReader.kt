package com.sjinvest.otp

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.concurrent.thread

/**
 * 접근성 리더 — 카카오톡 화면이 보일 때 그 화면의 글자에서 인증번호를 직접 읽는다.
 * 보험사 알림톡이 '알림으로는 안 뜨고 카톡창을 열어야 보이는' 경우를 처리.
 * (사용자가 설정 > 접근성에서 'SJ 인증번호'를 켜야 동작, com.kakao.talk 에만 반응)
 */
class KakaoReader : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (event.packageName?.toString() != "com.kakao.talk") return

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

        if (Otp.KEYWORDS.none { body.contains(it, ignoreCase = true) }) return
        val code = Otp.extractCode(body) ?: return
        if (Otp.isDuplicate(code)) return

        val insurer = Otp.INSURERS.firstOrNull { body.contains(it) }
        val prefs = getSharedPreferences(Otp.PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) return

        thread { Sender.post(url, token, code, insurer, "카카오톡(화면)", body.take(200)) }
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
