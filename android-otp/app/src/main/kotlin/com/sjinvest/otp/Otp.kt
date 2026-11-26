package com.sjinvest.otp

/** 공용 상수 + 인증번호 추출/중복 판정 (알림 리스너·접근성 리더 공용). */
object Otp {
    const val PREFS = "sj_otp"
    val KEYWORDS = listOf("인증", "OTP", "verification", "코드", "보안", "승인", "본인확인", "인증번호")
    val INSURERS = listOf(
        "삼성화재", "현대해상", "DB손해보험", "KB손해보험", "메리츠", "흥국", "롯데손해보험",
        "한화손해보험", "NH농협", "MG손해보험", "하나손해보험", "AXA", "캐롯", "삼성생명",
        "한화생명", "교보생명", "라이나"
    )

    /** 인증 키워드 바로 뒤의 숫자를 우선 추출(번호가 여러 개일 때 OTP를 정확히 집음). */
    fun extractCode(body: String): String? {
        val near = Regex(
            "(?:인증번호|인증|OTP|코드|verification|보안|승인|본인확인)[^0-9]{0,12}(\\d{4,8})",
            RegexOption.IGNORE_CASE
        ).find(body)?.groupValues?.getOrNull(1)
        if (!near.isNullOrBlank()) return near
        return Regex("(\\d{4,8})").find(body)?.value
    }

    private val recent = HashMap<String, Long>()

    /** 60초 내 동일 코드는 1회만 전송 (알림/화면 중복 방지, 두 경로 공용). */
    fun isDuplicate(code: String): Boolean {
        val now = System.currentTimeMillis()
        synchronized(recent) {
            recent.entries.removeAll { now - it.value > 60_000 }
            if (recent.containsKey(code)) return true
            recent[code] = now
            return false
        }
    }
}
