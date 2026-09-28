package com.verbflash

/** A verb with all its accepted English and Italian forms (the first one is the "main" form). */
data class Verb(
    val id: Int,
    val english: List<String>,
    val italian: List<String>,
)

enum class Direction(val promptLang: String, val answerLang: String) {
    IT_TO_EN("it-IT", "en-US"),
    EN_TO_IT("en-US", "it-IT"),
}
