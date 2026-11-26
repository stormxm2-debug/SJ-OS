package com.sjinvest.otp

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/** 1회 설정 화면: 수신 주소 + 기기 토큰 저장, SMS 권한 요청, 테스트 전송. */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences(SmsReceiver.PREFS, Context.MODE_PRIVATE)
        val urlEt = findViewById<EditText>(R.id.url)
        val tokenEt = findViewById<EditText>(R.id.token)
        val status = findViewById<TextView>(R.id.status)

        urlEt.setText(prefs.getString("url", getString(R.string.default_url)))
        tokenEt.setText(prefs.getString("token", ""))

        findViewById<Button>(R.id.save).setOnClickListener {
            prefs.edit()
                .putString("url", urlEt.text.toString().trim())
                .putString("token", tokenEt.text.toString().trim())
                .apply()
            status.text = "저장됨 ✓ 이제 보험사 인증문자가 자동으로 전달됩니다."
            ensurePermission()
        }

        findViewById<Button>(R.id.test).setOnClickListener {
            val url = urlEt.text.toString().trim()
            val token = tokenEt.text.toString().trim()
            status.text = "테스트 전송 중…"
            thread {
                val ok = Sender.post(url, token, "000000", "테스트", "앱", "테스트 전송입니다")
                runOnUiThread {
                    status.text = if (ok) "테스트 전송 성공 ✓ 총무 화면에서 000000 확인" else "전송 실패 — URL/토큰을 확인하세요."
                }
            }
        }

        findViewById<Button>(R.id.notif).setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (e: Exception) {
                status.text = "설정 화면을 열 수 없습니다. 설정 > 알림 접근에서 'SJ 인증번호'를 켜주세요."
            }
        }

        ensurePermission()
        updateNotifStatus(status)
    }

    override fun onResume() {
        super.onResume()
        updateNotifStatus(findViewById(R.id.status))
    }

    private fun updateNotifStatus(status: TextView) {
        val enabled = isNotificationAccessEnabled()
        if (!enabled) {
            status.text = "카톡 알림톡도 받으려면 '카톡 알림 접근 허용'을 눌러 켜주세요."
        }
    }

    private fun isNotificationAccessEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        return flat.contains(packageName)
    }

    private fun ensurePermission() {
        val need = arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (need.isNotEmpty()) ActivityCompat.requestPermissions(this, need.toTypedArray(), 1)
    }
}
