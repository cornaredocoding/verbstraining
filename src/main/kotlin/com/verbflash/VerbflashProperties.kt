package com.verbflash

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "verbflash")
data class VerbflashProperties(
    /** Secondi a disposizione per pronunciare la risposta. */
    val answerTimeoutSeconds: Int = 10,
    /** File dei verbi: "classpath:verbs.csv" oppure "file:/percorso/verbi.csv". */
    val verbsFile: String = "classpath:verbs.csv",
    /** Probabilità (0..1) che la domanda sia in italiano (risposta in inglese). */
    val italianToEnglishRatio: Double = 0.5,
    /** File JSON dove vengono salvate le statistiche. */
    val statsFile: String = "data/stats.json",
)
