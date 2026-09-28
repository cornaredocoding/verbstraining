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
    fun `accetta la risposta inglese anche con il to davanti`() {
        assertTrue(service.check(become.id, Direction.IT_TO_EN, listOf("To become")).correct)
    }

    @Test
    fun `basta che una delle alternative del riconoscimento sia giusta`() {
        val result = service.check(drive.id, Direction.EN_TO_IT, listOf("guardare", "Guidare"))
        assertTrue(result.correct)
        assertEquals("Guidare", result.heard)
    }

    @Test
    fun `rifiuta risposte sbagliate e parole che contengono quella giusta`() {
        val be = repository.verbs.first { it.english.first() == "be" }
        assertFalse(service.check(be.id, Direction.IT_TO_EN, listOf("become")).correct)
        assertFalse(service.check(drive.id, Direction.EN_TO_IT, emptyList()).correct)
    }

    @Test
    fun `parsing con alternative e commenti`() {
        val verbs = VerbRepository.parse(listOf("# commento", "", "begin | start ; iniziare|cominciare"))
        assertEquals(1, verbs.size)
        assertEquals(listOf("begin", "start"), verbs[0].english)
        assertEquals(listOf("iniziare", "cominciare"), verbs[0].italian)
    }

    @Test
    fun `ignora accenti e punteggiatura`() {
        assertEquals("perche no", QuizService.normalize("Perché, no?", Direction.EN_TO_IT))
    }
}
