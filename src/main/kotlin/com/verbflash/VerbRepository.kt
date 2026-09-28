package com.verbflash

import org.springframework.core.io.ResourceLoader
import org.springframework.stereotype.Component

/**
 * Legge i verbi da un file di testo. Formato di ogni riga:
 *   inglese;italiano
 * Più forme accettate si separano con "|", es:  get|obtain;ottenere|prendere
 * Righe vuote e righe che iniziano con "#" vengono ignorate.
 */
@Component
class VerbRepository(resourceLoader: ResourceLoader, properties: VerbflashProperties) {

    val verbs: List<Verb> = resourceLoader.getResource(properties.verbsFile)
        .inputStream.bufferedReader(Charsets.UTF_8)
        .useLines { lines -> parse(lines.toList()) }

    init {
        require(verbs.isNotEmpty()) { "Nessun verbo trovato in ${properties.verbsFile}" }
    }

    fun findById(id: Int): Verb? = verbs.getOrNull(id)

    companion object {
        fun parse(lines: List<String>): List<Verb> =
            lines.map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .mapIndexed { index, line ->
                    val parts = line.split(";")
                    require(parts.size == 2) { "Riga non valida (atteso 'inglese;italiano'): $line" }
                    Verb(index, splitAlternatives(parts[0]), splitAlternatives(parts[1]))
                }

        private fun splitAlternatives(s: String) = s.split("|").map { it.trim() }.filter { it.isNotEmpty() }
    }
}
