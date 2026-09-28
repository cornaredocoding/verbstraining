package com.verbflash

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.core.io.DefaultResourceLoader
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class StatsServiceTest {

    @TempDir
    lateinit var dir: Path

    private val objectMapper: ObjectMapper = Jackson2ObjectMapperBuilder.json().build()
    private val repository = VerbRepository(DefaultResourceLoader(), VerbflashProperties())
    private val be = repository.verbs.first { it.english.first() == "be" }
    private val go = repository.verbs.first { it.english.first() == "go" }

    private fun service() = StatsService(
        repository, objectMapper, VerbflashProperties(statsFile = dir.resolve("stats.json").toString()),
    )

    @Test
    fun `computes percentages, best streak and most-missed ranking`() {
        val stats = service()
        stats.record(be, Direction.IT_TO_EN, true)
        stats.record(be, Direction.IT_TO_EN, true)
        val third = stats.record(go, Direction.EN_TO_IT, true)
        assertTrue(third.newRecord)
        stats.record(go, Direction.EN_TO_IT, false)
        stats.record(go, Direction.IT_TO_EN, false)

        val summary = stats.summary()
        assertEquals(5, summary.total)
        assertEquals(60, summary.percent)
        assertEquals(0, summary.currentStreak)
        assertEquals(3, summary.bestStreak)
        assertEquals(listOf("go"), summary.mostWrong.map { it.english })
        assertEquals(2, summary.mostWrong[0].wrong)
        assertEquals(67, summary.byDirection.first { it.direction == Direction.IT_TO_EN }.percent)
    }

    @Test
    fun `stats follow the key even when the translations change`() {
        service().record(be, Direction.IT_TO_EN, false)

        // same key, different main English form: e.g. the line was edited in the verbs file
        val renamed = Verb(be.key, listOf("to be"), be.italian)
        service().record(renamed, Direction.IT_TO_EN, false)

        val wrong = service().summary().mostWrong.single()
        assertEquals(2, wrong.wrong)
    }

    @Test
    fun `stats survive a restart and can be reset`() {
        service().record(be, Direction.IT_TO_EN, false)
        val reloaded = service()
        assertEquals(1, reloaded.summary().total)

        reloaded.reset()
        assertEquals(0, service().summary().total)
    }

    @Test
    fun `two instances on the same file see the same reset`() {
        val first = service()
        val second = service()
        first.record(be, Direction.IT_TO_EN, true)
        first.record(go, Direction.IT_TO_EN, false)

        second.reset()
        assertEquals(0, first.summary().total)
        assertTrue(first.summary().mostWrong.isEmpty())

        first.record(be, Direction.IT_TO_EN, true)
        assertEquals(1, second.summary().total)
    }
}
