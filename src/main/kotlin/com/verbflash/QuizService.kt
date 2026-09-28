package com.verbflash

import org.springframework.stereotype.Service
import java.text.Normalizer
import kotlin.random.Random

data class Question(
    val verbId: Int,
    val direction: Direction,
    val prompt: String,
    val promptLang: String,
    val answerLang: String,
    val timeoutSeconds: Int,
    /** Accepted answers: shown when the mic is off and an adult judges the answer. */
    val answers: List<String>,
)

data class AnswerResult(
    val correct: Boolean,
    val heard: String?,
    val expected: List<String>,
)

@Service
class QuizService(
    private val repository: VerbRepository,
    private val properties: VerbflashProperties,
) {

    fun nextQuestion(direction: Direction? = null, excludeVerbId: Int? = null): Question {
        val candidates = repository.verbs.filter { it.id != excludeVerbId }.ifEmpty { repository.verbs }
        val verb = candidates.random()
        val dir = direction
            ?: if (Random.nextDouble() < properties.italianToEnglishRatio) Direction.IT_TO_EN else Direction.EN_TO_IT
        val prompt = if (dir == Direction.IT_TO_EN) verb.italian.first() else verb.english.first()
        val answers = if (dir == Direction.IT_TO_EN) verb.english else verb.italian
        return Question(verb.id, dir, prompt, dir.promptLang, dir.answerLang, properties.answerTimeoutSeconds, answers)
    }

    /** [spoken] holds the alternatives returned by speech recognition: one correct match is enough. */
    fun check(verbId: Int, direction: Direction, spoken: List<String>): AnswerResult {
        val expected = expected(verbId, direction)
        val accepted = expected.map { normalize(it, direction) }.toSet()
        val match = spoken.firstOrNull { candidate ->
            val n = normalize(candidate, direction)
            // recognition sometimes adds words ("to become", "ok become"): accept if a word/sequence matches
            n in accepted || accepted.any { a -> " $n ".contains(" $a ") }
        }
        return AnswerResult(match != null, match ?: spoken.firstOrNull(), expected)
    }

    fun expected(verbId: Int, direction: Direction): List<String> {
        val verb = repository.findById(verbId) ?: throw NoSuchElementException("Verb $verbId does not exist")
        return if (direction == Direction.IT_TO_EN) verb.english else verb.italian
    }

    companion object {
        fun normalize(s: String, direction: Direction): String {
            var n = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
                .replace(Regex("\\p{M}"), "")
                .replace(Regex("[^a-z' ]"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
            if (direction == Direction.IT_TO_EN) n = n.removePrefix("to ")
            return n
        }
    }
}
