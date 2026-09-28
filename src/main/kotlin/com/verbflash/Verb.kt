package com.verbflash

/**
 * A verb with all its accepted English and Italian forms (the first one is the "main" form).
 * [key] is a stable identifier used by the API and the statistics, independent of the translations.
 */
data class Verb(
    val key: String,
    val english: List<String>,
    val italian: List<String>,
)

enum class Direction(val promptLang: String, val answerLang: String) {
    IT_TO_EN("it-IT", "en-US"),
    EN_TO_IT("en-US", "it-IT"),
}
