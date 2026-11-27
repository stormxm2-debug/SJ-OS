package com.sjinvest.otp

import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlin.concurrent.thread

/**
 * 알림 접근으로 인증번호를 캡처한다. (문자 읽기 권한 불필요)
 * 자기 앱·시스템 제외, 모든 알림에서 '인증 키워드 + 숫자'면 전송. 카톡 알림톡 포함.
 * MessagingStyle(삼성 메시지/카톡) 본문은 android.messages 배열에 있으므로 모두 읽는다.
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
        val isKakao = pkg == "com.kakao.talk"
        val hasKw = Otp.KEYWORDS.any { body.contains(it, ignoreCase = true) }

        // 관련 없는 알림은 조용히 무시 (로그 스팸 방지)
        if (!isKakao && !hasKw) return

        val tag = if (isKakao) "카톡알림" else "문자알림"
        if (body.isBlank()) { Otp.log(this, "[$tag] 내용 비어있음"); return }
        if (!hasKw) { Otp.log(this, "[$tag] 키워드없음: ${body.take(40)}"); return }
        val code = Otp.extractCode(body)
        if (code == null) { Otp.log(this, "[$tag] 숫자없음: ${body.take(40)}"); return }
        if (Otp.isDuplicate(code)) return

        val insurer = Otp.INSURERS.firstOrNull { body.contains(it) }
            ?: if (isKakao) title.takeIf { it.isNotBlank() && it != "카카오톡" } else null
        val sender = if (isKakao) "카카오톡" else title.ifBlank { "문자" }

        val prefs = getSharedPreferences(Otp.PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) { Otp.log(this, "[$tag] $code → 토큰 미저장"); return }

        thread {
            val rc = Sender.post(url, token, code, insurer, sender, body.take(200))
            Otp.log(applicationContext, "[$tag] $code → ${Otp.resultText(rc)}")
        }
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
