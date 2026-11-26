package com.sjinvest.otp

import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlin.concurrent.thread

/**
 * 알림 접근으로 인증번호를 캡처한다. (문자 읽기 권한 불필요)
 *  - 문자(SMS) 앱 알림 (삼성/구글/기본 메시지)
 *  - 카카오톡 알림톡 (com.kakao.talk)
 *
 * 삼성 메시지·카카오톡은 'MessagingStyle' 알림이라 본문이 android.text 가 아니라
 * android.messages 배열/textLines 에 들어간다. 모든 칸을 읽어 본문을 합친다.
 * (사용자가 설정에서 '알림 접근'을 허용해야 동작)
 */
class NotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        val channel = when {
            pkg == "com.kakao.talk" -> "카카오톡"
            isSmsApp(pkg) -> "문자"
            else -> return
        }

        val n = sbn.notification ?: return
        val ex = n.extras ?: Bundle()
        val parts = ArrayList<String>()
        fun add(cs: CharSequence?) {
            val s = cs?.toString()?.trim()
            if (!s.isNullOrBlank()) parts.add(s)
        }
        add(ex.getCharSequence("android.title"))
        add(ex.getCharSequence("android.text"))
        add(ex.getCharSequence("android.bigText"))
        add(ex.getCharSequence("android.subText"))
        add(ex.getCharSequence("android.summaryText"))
        add(ex.getCharSequence("android.infoText"))
        ex.getCharSequenceArray("android.textLines")?.forEach { add(it) }
        // MessagingStyle(삼성 메시지/카톡) — 본문이 messages 배열에 들어감
        @Suppress("DEPRECATION")
        ex.getParcelableArray("android.messages")?.forEach { p ->
            (p as? Bundle)?.let { add(it.getCharSequence("text")) }
        }
        add(n.tickerText)

        val title = ex.getCharSequence("android.title")?.toString() ?: ""
        val body = parts.joinToString(" ").trim()
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

    /** 문자(SMS/MMS) 앱 판별 — 알려진 패키지 + 이름 패턴. */
    private fun isSmsApp(pkg: String): Boolean {
        if (SMS_PACKAGES.contains(pkg)) return true
        return pkg.contains("messaging") || pkg.contains(".mms") || pkg.endsWith(".messages")
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
