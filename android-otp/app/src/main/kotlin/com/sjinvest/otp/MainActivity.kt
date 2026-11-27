package com.sjinvest.otp

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/** 1회 설정 화면: 수신 주소 + 기기 토큰 저장, 알림 접근·접근성 허용, 테스트 전송, 감지 기록. */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences(Otp.PREFS, Context.MODE_PRIVATE)
        val urlEt = findViewById<EditText>(R.id.url)
        val tokenEt = findViewById<EditText>(R.id.token)
        val status = findViewById<TextView>(R.id.status)
        val logView = findViewById<TextView>(R.id.log)

        urlEt.setText(prefs.getString("url", getString(R.string.default_url)))
        tokenEt.setText(prefs.getString("token", ""))
        findViewById<TextView>(R.id.version).text = "버전 " + appVersion()

        findViewById<Button>(R.id.save).setOnClickListener {
            prefs.edit()
                .putString("url", urlEt.text.toString().trim())
                .putString("token", tokenEt.text.toString().trim())
                .apply()
            status.text = "저장됨 ✓ 아래 ①알림 접근, ②접근성 둘 다 켜주세요."
        }

        findViewById<Button>(R.id.test).setOnClickListener {
            val url = urlEt.text.toString().trim()
            val token = tokenEt.text.toString().trim()
            status.text = "테스트 전송 중…"
            thread {
                val rc = Sender.post(url, token, "000000", "테스트", "앱", "테스트 전송입니다")
                Otp.log(applicationContext, "[테스트버튼] 000000 → ${Otp.resultText(rc)}")
                runOnUiThread {
                    status.text = if (rc in 200..299) "테스트 전송 성공 ✓ 총무 화면에서 000000 확인"
                        else "전송 실패(${Otp.resultText(rc)}) — URL/토큰 확인"
                    refreshLog(logView)
                }
            }
        }

        findViewById<Button>(R.id.notif).setOnClickListener {
            try { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
            catch (e: Exception) { status.text = "설정 > 알림 접근에서 'SJ 인증번호'를 켜주세요." }
        }

        findViewById<Button>(R.id.accessibility).setOnClickListener {
            try { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            catch (e: Exception) { status.text = "설정 > 접근성에서 'SJ 인증번호'를 켜주세요." }
        }

        findViewById<Button>(R.id.refresh).setOnClickListener { refreshLog(logView) }
        findViewById<Button>(R.id.clearlog).setOnClickListener {
            Otp.clearLog(this); refreshLog(logView)
        }

        updateStatus(status)
        refreshLog(logView)
    }

    override fun onResume() {
        super.onResume()
        updateStatus(findViewById(R.id.status))
        refreshLog(findViewById(R.id.log))
    }

    private fun refreshLog(logView: TextView) {
        val l = Otp.readLog(this)
        logView.text = if (l.isBlank()) "아직 감지된 인증번호가 없습니다.\n(문자/카톡으로 인증번호가 오면 여기에 기록됩니다)" else l
    }

    private fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
    } catch (e: Exception) { "?" }

    private fun updateStatus(status: TextView) {
        val notif = isNotificationAccessEnabled()
        val acc = isAccessibilityEnabled()
        status.text = when {
            notif && acc -> "준비 완료 ✓ 문자·카톡 인증번호가 자동으로 전달됩니다."
            !notif && !acc -> "① '알림 접근', ② '접근성'을 둘 다 켜주세요."
            !notif -> "① '알림 접근 허용'을 켜주세요. (문자·카톡 알림용)"
            else -> "② '카톡 화면 읽기(접근성)'을 켜주세요. (알림톡이 안 뜨는 보험사용)"
        }
    }

    private fun isNotificationAccessEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        return flat.contains(packageName)
    }

    private fun isAccessibilityEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return flat.contains(packageName)
    }
}
