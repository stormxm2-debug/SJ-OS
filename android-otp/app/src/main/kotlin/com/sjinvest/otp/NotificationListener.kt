package com.sjinvest.otp

import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlin.concurrent.thread

/**
 * 알림 접근으로 인증번호를 캡처한다. (문자 읽기 권한 불필요)
 *
 * 통신사·제조사마다 문자 앱이 다르므로(삼성 메시지, Google 메시지, LGU+ '내바라기',
 * SKT·KT 메시지 등) 특정 앱 목록에 의존하지 않고, 자기 앱·시스템을 제외한 모든
 * 알림에서 '인증 키워드 + 4~8자리 숫자'가 있으면 전송한다. 카카오 알림톡도 포함.
 * 삼성/카톡 등 MessagingStyle 알림은 본문이 android.messages 배열에 담기므로 모두 읽는다.
 * (사용자가 설정에서 '알림 접근'을 허용해야 동작)
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
        // MessagingStyle(삼성 메시지/카톡 등) — 본문이 messages 배열에 들어감
        @Suppress("DEPRECATION")
        ex.getParcelableArray("android.messages")?.forEach { p ->
            (p as? Bundle)?.let { add(it.getCharSequence("text")) }
        }
        add(n.tickerText)

        val title = ex.getCharSequence("android.title")?.toString() ?: ""
        val body = parts.joinToString(" ").trim()
        if (body.isBlank()) return

        // 인증 관련 알림만 전송 (일반 알림/대화 오탐 방지)
        if (Otp.KEYWORDS.none { body.contains(it, ignoreCase = true) }) return
        val code = extractCode(body) ?: return
        if (isDuplicate(code)) return

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

    /** 인증 키워드 바로 뒤의 숫자를 우선 추출(번호가 여러 개일 때 OTP를 정확히 집음). */
    private fun extractCode(body: String): String? {
        val near = Regex(
            "(?:인증번호|인증|OTP|코드|verification|보안|승인|본인확인)[^0-9]{0,12}(\\d{4,8})",
            RegexOption.IGNORE_CASE
        ).find(body)?.groupValues?.getOrNull(1)
        if (!near.isNullOrBlank()) return near
        return Regex("(\\d{4,8})").find(body)?.value
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
        // 자기 앱 외에, 코드가 섞이기 쉬운 시스템/런처 계열만 제외 (문자앱은 통신사마다 달라 허용)
        private val IGNORED_PREFIXES = listOf(
            "com.android.systemui",
            "com.google.android.gms",
            "com.samsung.android.app.aodservice",
            "com.sec.android.app.launcher",
            "com.android.settings"
        )
    }
}
