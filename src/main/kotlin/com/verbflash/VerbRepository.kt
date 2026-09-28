package com.verbflash

import org.springframework.core.io.ResourceLoader
import org.springframework.stereotype.Component

/**
 * Reads the verbs from a text file. Format of each line:
 *   key;english;italian
 * Multiple accepted forms are separated by "|", e.g.:  get;get|obtain;ottenere|prendere
 * The key must be unique and never change: statistics are stored by key.
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

    private val byKey: Map<String, Verb> = verbs.associateBy { it.key }

    fun findByKey(key: String): Verb? = byKey[key]

    companion object {
        fun parse(lines: List<String>): List<Verb> =
            lines.map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .map { line ->
                    val parts = line.split(";").map { it.trim() }
                    require(parts.size == 3 && parts.all { it.isNotEmpty() }) {
                        "Invalid line (expected 'key;english;italian'): $line"
                    }
                    Verb(parts[0], splitAlternatives(parts[1]), splitAlternatives(parts[2]))
                }
                .also { verbs ->
                    val duplicates = verbs.groupBy { it.key }.filterValues { it.size > 1 }.keys
                    require(duplicates.isEmpty()) { "Duplicate verb keys: $duplicates" }
                }

        private fun splitAlternatives(s: String) = s.split("|").map { it.trim() }.filter { it.isNotEmpty() }
    }
}
