package com.sjinvest.otp

/** 공용 상수 — 저장소 키, 인증 키워드, 보험사 목록. */
object Otp {
    const val PREFS = "sj_otp"
    val KEYWORDS = listOf("인증", "OTP", "verification", "코드", "보안", "승인", "본인확인", "인증번호")
    val INSURERS = listOf(
        "삼성화재", "현대해상", "DB손해보험", "KB손해보험", "메리츠", "흥국", "롯데손해보험",
        "한화손해보험", "NH농협", "MG손해보험", "하나손해보험", "AXA", "캐롯", "삼성생명",
        "한화생명", "교보생명", "라이나"
    )
}
