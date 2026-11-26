package com.sjinvest.otp

import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlin.concurrent.thread

/**
 * 카카오톡 알림톡 캡처 — 카톡 알림에서 인증번호를 추출해 서버로 전송한다.
 * 보험사 OTP가 문자가 아닌 카카오 알림톡으로 오는 경우를 처리.
 * (사용자가 설정에서 '알림 접근'을 허용해야 동작)
 */
class NotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != "com.kakao.talk") return
        val ex = sbn.notification?.extras ?: return
        val title = ex.getCharSequence("android.title")?.toString() ?: ""
        val text = ex.getCharSequence("android.text")?.toString() ?: ""
        val big = ex.getCharSequence("android.bigText")?.toString() ?: ""
        val body = listOf(title, text, big).filter { it.isNotBlank() }.joinToString(" ").trim()
        if (body.isBlank()) return

        if (SmsReceiver.KEYWORDS.none { body.contains(it, ignoreCase = true) }) return
        val code = Regex("(\\d{4,8})").find(body)?.value ?: return
        if (isDuplicate(code)) return

        val insurer = SmsReceiver.INSURERS.firstOrNull { body.contains(it) }
            ?: title.takeIf { it.isNotBlank() && it != "카카오톡" }

        val prefs = getSharedPreferences(SmsReceiver.PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) return

        thread { Sender.post(url, token, code, insurer, "카카오톡", body.take(200)) }
    }

    /** 카톡은 같은 메시지로 알림을 여러 번 갱신하므로 60초 내 동일 코드는 1회만 전송. */
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
    }
}
