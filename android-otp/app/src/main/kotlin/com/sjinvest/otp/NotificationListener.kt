package com.sjinvest.otp

import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlin.concurrent.thread

/**
 * 알림 접근으로 인증번호를 캡처한다. (문자 읽기 권한 READ_SMS/RECEIVE_SMS 불필요)
 *  - 카카오톡 알림톡 (com.kakao.talk)
 *  - 문자(SMS) 앱 알림 (삼성/구글/기본 메시지) — 문자가 오면 뜨는 "알림"을 읽음
 * 문자 권한을 쓰지 않으므로 구글의 사이드로드 하드 차단(악성 앱 의심)에 걸리지 않는다.
 * (사용자가 설정에서 '알림 접근'을 허용해야 동작)
 */
class NotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        val channel = when {
            pkg == "com.kakao.talk" -> "카카오톡"
            SMS_PACKAGES.contains(pkg) -> "문자"
            else -> return
        }

        val ex = sbn.notification?.extras ?: return
        val title = ex.getCharSequence("android.title")?.toString() ?: ""
        val text = ex.getCharSequence("android.text")?.toString() ?: ""
        val big = ex.getCharSequence("android.bigText")?.toString() ?: ""
        val body = listOf(text, big, title).filter { it.isNotBlank() }.joinToString(" ").trim()
        if (body.isBlank()) return

        // 인증 관련 알림만 전송 (개인 문자/대화 오탐 방지)
        if (Otp.KEYWORDS.none { body.contains(it, ignoreCase = true) }) return
        val code = Regex("(\\d{4,8})").find(body)?.value ?: return
        if (isDuplicate(code)) return

        val insurer = Otp.INSURERS.firstOrNull { body.contains(it) }
            ?: if (channel == "카카오톡") title.takeIf { it.isNotBlank() && it != "카카오톡" } else null
        val sender = if (channel == "문자") title.ifBlank { "문자" } else "카카오톡"

        val prefs = getSharedPreferences(Otp.PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) return

        thread { Sender.post(url, token, code, insurer, sender, body.take(200)) }
    }

    /** 같은 메시지로 알림이 여러 번 갱신되므로 60초 내 동일 코드는 1회만 전송. */
    private fun isDuplicate(code: String): Boolean {
        val now = System.currentTimeMillis()
        synchronized(recent) {
            recent.entries.removeAll { now - it.value > 60_000 }
            if (recent.containsKey(code)) return true
            recent[code] = now
            return false
        }
    }

    companion object {
        private val recent = HashMap<String, Long>()
        private val SMS_PACKAGES = setOf(
            "com.samsung.android.messaging",
            "com.google.android.apps.messaging",
            "com.android.messaging",
            "com.android.mms",
            "com.samsung.android.mms"
        )
    }
}
