package com.sjinvest.otp

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** otp-ingest 엣지함수로 인증번호를 전송한다. 키 불필요(기기 토큰으로 인증). */
object Sender {
    fun post(url: String, token: String, code: String, insurer: String?, sender: String?, raw: String?): Boolean {
        if (url.isBlank() || token.isBlank() || code.isBlank()) return false
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10000
                readTimeout = 15000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            val body = JSONObject().apply {
                put("token", token)
                put("code", code)
                if (!insurer.isNullOrBlank()) put("insurer", insurer)
                if (!sender.isNullOrBlank()) put("sender", sender)
                if (!raw.isNullOrBlank()) put("raw", raw)
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val ok = conn.responseCode in 200..299
            conn.disconnect()
            ok
        } catch (e: Exception) {
            false
        }
    }
}
