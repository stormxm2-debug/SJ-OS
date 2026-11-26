package com.sjinvest.otp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import kotlin.concurrent.thread

/** 수신 SMS에서 인증번호를 추출해 서버로 전송한다. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val body = msgs.joinToString("") { it.messageBody ?: "" }
        val sender = msgs.firstOrNull()?.originatingAddress ?: ""
        if (body.isBlank()) return

        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString("url", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (url.isBlank() || token.isBlank()) return

        // 인증 관련 문자만 (오탐 방지)
        if (KEYWORDS.none { body.contains(it, ignoreCase = true) }) return
        val code = Regex("(\\d{4,8})").find(body)?.value ?: return
        val insurer = INSURERS.firstOrNull { body.contains(it) }

        thread { Sender.post(url, token, code, insurer, sender, body.take(200)) }
    }

    companion object {
        const val PREFS = "sj_otp"
        val KEYWORDS = listOf("인증", "OTP", "verification", "코드", "보안", "승인", "본인확인", "인증번호")
        val INSURERS = listOf(
            "삼성화재", "현대해상", "DB손해보험", "KB손해보험", "메리츠", "흥국", "롯데손해보험",
            "한화손해보험", "NH농협", "MG손해보험", "하나손해보험", "AXA", "캐롯", "삼성생명",
            "한화생명", "교보생명", "라이나"
        )
    }
}
