package com.sjinvest.otp

import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlin.concurrent.thread

/**
 * 알림 접근으로 인증번호를 캡처한다. (문자 읽기 권한 불필요)
 *
 * 통신사·제조사마다 문자 앱이 다르므로 특정 앱 목록에 의존하지 않고, 자기 앱·시스템을
 * 제외한 모든 알림에서 '인증 키워드 + 4~8자리 숫자'가 있으면 전송한다. 카카오 알림톡 포함.
 * 삼성/카톡 등 MessagingStyle 알림은 본문이 android.messages 배열에 담기므로 모두 읽는다.
 * (알림이 아예 안 뜨는 경우는 KakaoReader 접근성 리더가 화면에서 직접 읽는다.)
 */
class NotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        if (pkg == applicationContext.packageName) return
        if (IGNORED_PREFIXES.any { pkg.startsWith(it) }) return

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
        @Suppress("DEPRECATION")
        ex.getParcelableArray("android.messages")?.forEach { p ->
            (p as? Bundle)?.let { add(it.getCharSequence("text")) }
        }
        add(n.tickerText)

        val title = ex.getCharSequence("android.title")?.toString() ?: ""
        val body = parts.joinToString(" ").trim()
        if (body.isBlank()) return

        if (Otp.KEYWORDS.none { body.contains(it, ignoreCase = true) }) return
        val code = Otp.extractCode(body) ?: return
        if (Otp.isDuplicate(code)) return

        val isKakao = pkg == "com.kakao.talk"
        val insurer = Otp.INSURERS.firstOrNull { body.contains(it) }
            ?: if (isKakao) title.takeIf { it.isNotBlank() && it != "카카오톡" } else null
        val sender = if (isKakao) "카카오톡" else title.ifBlank { "문자" }

        val prefs = getSharedPreferences(Otp.PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) return

        thread { Sender.post(url, token, code, insurer, sender, body.take(200)) }
    }

    companion object {
        private val IGNORED_PREFIXES = listOf(
            "com.android.systemui",
            "com.google.android.gms",
            "com.samsung.android.app.aodservice",
            "com.sec.android.app.launcher",
            "com.android.settings"
        )
    }
}
