package com.verbflash

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "verbflash")
data class VerbflashProperties(
    /** Seconds available to say the answer. */
    val answerTimeoutSeconds: Int = 10,
    /** Verbs file: "classpath:verbs.csv" or "file:/path/to/verbs.csv". */
    val verbsFile: String = "classpath:verbs.csv",
    /** Probability (0..1) that the prompt is in Italian (answer in English). */
    val italianToEnglishRatio: Double = 0.5,
    /** JSON file where the statistics are stored. */
    val statsFile: String = "data/stats.json",
)
