package com.verbflash

import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class AnswerRequest(
    val verbKey: String,
    val direction: Direction,
    val spoken: List<String> = emptyList(),
    /** Set when the mic is off: an adult judges the answer with the buttons. */
    val selfAssessed: Boolean? = null,
)

data class AnswerResponse(
    val correct: Boolean,
    val heard: String?,
    val expected: List<String>,
    val currentStreak: Int,
    val bestStreak: Int,
    val newRecord: Boolean,
)

data class CheckResponse(val correct: Boolean)

data class ConfigResponse(val answerTimeoutSeconds: Int, val verbCount: Int)

@RestController
@RequestMapping("/api")
class QuizController(
    private val quizService: QuizService,
    private val properties: VerbflashProperties,
    private val repository: VerbRepository,
    private val statsService: StatsService,
) {

    @GetMapping("/config")
    fun config() = ConfigResponse(properties.answerTimeoutSeconds, repository.verbs.size)

    @GetMapping("/question")
    fun question(
        @RequestParam(required = false) direction: Direction?,
        @RequestParam(required = false) exclude: String?,
    ) = quizService.nextQuestion(direction, exclude)

    @PostMapping("/answer")
    fun answer(@RequestBody request: AnswerRequest): AnswerResponse {
        val result = request.selfAssessed
            ?.let { AnswerResult(it, null, quizService.expected(request.verbKey, request.direction)) }
            ?: quizService.check(request.verbKey, request.direction, request.spoken)
        val streak = statsService.record(quizService.findVerb(request.verbKey), request.direction, result.correct)
        return AnswerResponse(
            result.correct, result.heard, result.expected,
            streak.currentStreak, streak.bestStreak, streak.newRecord,
        )
    }

    /** Checks without recording: used on partial recognition results, to stop listening as soon as the answer is right. */
    @PostMapping("/check")
    fun check(@RequestBody request: AnswerRequest) =
        CheckResponse(quizService.check(request.verbKey, request.direction, request.spoken).correct)

    @GetMapping("/stats")
    fun stats() = statsService.summary()

    @DeleteMapping("/stats")
    fun resetStats() = statsService.reset()

    @ExceptionHandler(NoSuchElementException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun notFound(e: NoSuchElementException) = mapOf("error" to e.message)
}
