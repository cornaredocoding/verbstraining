package com.verbflash

import org.springframework.core.io.ResourceLoader
import org.springframework.stereotype.Component

/**
 * Reads the verbs from a text file. Format of each line:
 *   english;italian
 * Multiple accepted forms are separated by "|", e.g.:  get|obtain;ottenere|prendere
 * Blank lines and lines starting with "#" are ignored.
 */
@Component
class VerbRepository(resourceLoader: ResourceLoader, properties: VerbflashProperties) {

    val verbs: List<Verb> = resourceLoader.getResource(properties.verbsFile)
        .inputStream.bufferedReader(Charsets.UTF_8)
        .useLines { lines -> parse(lines.toList()) }

    init {
        require(verbs.isNotEmpty()) { "No verbs found in ${properties.verbsFile}" }
    }

    fun findById(id: Int): Verb? = verbs.getOrNull(id)

    companion object {
        fun parse(lines: List<String>): List<Verb> =
            lines.map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .mapIndexed { index, line ->
                    val parts = line.split(";")
                    require(parts.size == 2) { "Invalid line (expected 'english;italian'): $line" }
                    Verb(index, splitAlternatives(parts[0]), splitAlternatives(parts[1]))
                }

        private fun splitAlternatives(s: String) = s.split("|").map { it.trim() }.filter { it.isNotEmpty() }
    }
}
