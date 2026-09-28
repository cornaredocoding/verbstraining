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
    /** Risposte accettate: servono per mostrarle quando il microfono è spento e il giudizio lo dà un adulto. */
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

    /** [spoken] contiene le alternative restituite dal riconoscimento vocale: basta che una sia giusta. */
    fun check(verbId: Int, direction: Direction, spoken: List<String>): AnswerResult {
        val expected = expected(verbId, direction)
        val accepted = expected.map { normalize(it, direction) }.toSet()
        val match = spoken.firstOrNull { candidate ->
            val n = normalize(candidate, direction)
            // il riconoscimento a volte aggiunge parole ("to become", "ok become"): accettiamo se una parola/sequenza combacia
            n in accepted || accepted.any { a -> " $n ".contains(" $a ") }
        }
        return AnswerResult(match != null, match ?: spoken.firstOrNull(), expected)
    }

    fun expected(verbId: Int, direction: Direction): List<String> {
        val verb = repository.findById(verbId) ?: throw NoSuchElementException("Verbo $verbId inesistente")
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
