package com.verbflash

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QuizServiceTest {

    private val repository = VerbRepository(
        org.springframework.core.io.DefaultResourceLoader(),
        VerbflashProperties(),
    )
    private val service = QuizService(repository, VerbflashProperties())
    private val become = repository.verbs.first { it.english.first() == "become" }
    private val drive = repository.verbs.first { it.english.first() == "drive" }

    @Test
    fun `accepts the English answer with a leading to`() {
        assertTrue(service.check(become.id, Direction.IT_TO_EN, listOf("To become")).correct)
    }

    @Test
    fun `one correct recognition alternative is enough`() {
        val result = service.check(drive.id, Direction.EN_TO_IT, listOf("guardare", "Guidare"))
        assertTrue(result.correct)
        assertEquals("Guidare", result.heard)
    }

    @Test
    fun `rejects wrong answers and words containing the right one`() {
        val be = repository.verbs.first { it.english.first() == "be" }
        assertFalse(service.check(be.id, Direction.IT_TO_EN, listOf("become")).correct)
        assertFalse(service.check(drive.id, Direction.EN_TO_IT, emptyList()).correct)
    }

    @Test
    fun `accepts hesitations before or after the answer`() {
        assertTrue(service.check(become.id, Direction.IT_TO_EN, listOf("ok become")).correct)
        assertTrue(service.check(drive.id, Direction.EN_TO_IT, listOf("ehm guidare")).correct)
    }

    @Test
    fun `rejects a list of guesses containing the right one`() {
        assertFalse(service.check(drive.id, Direction.EN_TO_IT, listOf("guardare guidare")).correct)
        assertFalse(service.check(become.id, Direction.IT_TO_EN, listOf("go come become do")).correct)
    }

    @Test
    fun `accepts multi-word answers`() {
        val email = repository.verbs.first { it.english.first() == "email" }
        assertTrue(service.check(email.id, Direction.EN_TO_IT, listOf("Mandare una mail")).correct)
        val getUp = repository.verbs.first { it.english.first() == "get up" }
        assertTrue(service.check(getUp.id, Direction.IT_TO_EN, listOf("to get up")).correct)
    }

    @Test
    fun `parses alternatives and comments`() {
        val verbs = VerbRepository.parse(listOf("# commento", "", "begin | start ; iniziare|cominciare"))
        assertEquals(1, verbs.size)
        assertEquals(listOf("begin", "start"), verbs[0].english)
        assertEquals(listOf("iniziare", "cominciare"), verbs[0].italian)
    }

    @Test
    fun `ignores accents and punctuation`() {
        assertEquals("perche no", QuizService.normalize("Perché, no?", Direction.EN_TO_IT))
    }
}
