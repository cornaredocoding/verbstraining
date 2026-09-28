package com.verbflash

/** Un verbo con tutte le forme accettate in inglese e in italiano (la prima è quella "principale"). */
data class Verb(
    val id: Int,
    val english: List<String>,
    val italian: List<String>,
)

enum class Direction(val promptLang: String, val answerLang: String) {
    IT_TO_EN("it-IT", "en-US"),
    EN_TO_IT("en-US", "it-IT"),
}
