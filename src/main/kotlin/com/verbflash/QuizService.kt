package com.verbflash

import org.springframework.stereotype.Service
import java.text.Normalizer
import kotlin.random.Random

data class Question(
    val verbKey: String,
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

    fun nextQuestion(direction: Direction? = null, excludeVerbKey: String? = null): Question {
        val candidates = repository.verbs.filter { it.key != excludeVerbKey }.ifEmpty { repository.verbs }
        val verb = candidates.random()
        val dir = direction
            ?: if (Random.nextDouble() < properties.italianToEnglishRatio) Direction.IT_TO_EN else Direction.EN_TO_IT
        val prompt = if (dir == Direction.IT_TO_EN) verb.italian.first() else verb.english.first()
        val answers = if (dir == Direction.IT_TO_EN) verb.english else verb.italian
        return Question(verb.key, dir, prompt, dir.promptLang, dir.answerLang, properties.answerTimeoutSeconds, answers)
    }

    /** [spoken] holds the alternatives returned by speech recognition: one correct match is enough. */
    fun check(verbKey: String, direction: Direction, spoken: List<String>): AnswerResult {
        val expected = expected(verbKey, direction)
        val accepted = expected.map { normalize(it, direction) }.toSet()
        // the whole utterance must match: saying several verbs in a row ("go come make do") is not accepted
        val match = spoken.firstOrNull { candidate -> stripFillers(normalize(candidate, direction)) in accepted }
        return AnswerResult(match != null, match ?: spoken.firstOrNull(), expected)
    }

    fun expected(verbKey: String, direction: Direction): List<String> {
        val verb = findVerb(verbKey)
        return if (direction == Direction.IT_TO_EN) verb.english else verb.italian
    }

    fun findVerb(verbKey: String): Verb =
        repository.findByKey(verbKey) ?: throw NoSuchElementException("Verb '$verbKey' does not exist")

    companion object {
        /** Hesitations or extra words that recognition may add before/after the answer ("ok become", "ehm guidare"). */
        private val FILLERS = setOf(
            "to", "ok", "okay", "um", "uh", "uhm", "er", "erm", "eh", "ehm", "mh", "mmh", "allora", "beh", "cioe",
        )

        fun stripFillers(s: String): String {
            val words = s.split(" ").filter { it.isNotEmpty() }
                .dropWhile { it in FILLERS }
                .dropLastWhile { it in FILLERS }
            return words.joinToString(" ")
        }

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
