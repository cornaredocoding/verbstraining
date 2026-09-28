package com.verbflash

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** How many recent answers we keep for each verb. */
private const val RECENT_SIZE = 5

/** A verb is "mastered" when its last MASTERED_RUN answers are all correct. */
private const val MASTERED_RUN = 3

/** The trend compares the last TREND_WINDOW answers with the TREND_WINDOW before them. */
private const val TREND_WINDOW = 20

/** Below this many answers there is no meaningful trend yet. */
private const val TREND_MIN_ANSWERS = 10

/** The rolling chart shows the last ROLLING_SPAN answers, each point averaging ROLLING_WINDOW answers. */
private const val ROLLING_SPAN = 200
private const val ROLLING_WINDOW = 20

class Counter(var total: Int = 0, var correct: Int = 0) {
    fun add(ok: Boolean) {
        total++
        if (ok) correct++
    }
}

class VerbStats(
    var attempts: Int = 0,
    var wrong: Int = 0,
    /** Latest answers, oldest first. */
    val recent: MutableList<Boolean> = mutableListOf(),
)

/** One answer, as stored in the history used for the trend. */
class AnswerRecord(
    val at: Instant = Instant.now(),
    val verbKey: String = "",
    val direction: Direction = Direction.IT_TO_EN,
    val correct: Boolean = false,
)

/** Data stored on file. Verbs are stored by their stable key, so they survive changes to the translations. */
class StatsData(
    var since: Instant = Instant.now(),
    val overall: Counter = Counter(),
    val byDirection: MutableMap<Direction, Counter> = mutableMapOf(),
    var currentStreak: Int = 0,
    var bestStreak: Int = 0,
    var bestStreakAt: Instant? = null,
    val verbs: MutableMap<String, VerbStats> = mutableMapOf(),
    /** Every answer, oldest first: the source of the trend. */
    val answers: MutableList<AnswerRecord> = mutableListOf(),
)

data class StreakInfo(val currentStreak: Int, val bestStreak: Int, val newRecord: Boolean)

data class DirectionSummary(val direction: Direction, val total: Int, val correct: Int, val percent: Int?)

data class WrongVerb(
    val english: String,
    val italian: String,
    val wrong: Int,
    val attempts: Int,
    val errorPercent: Int,
    val recent: List<Boolean>,
)

data class DailyPoint(val date: LocalDate, val total: Int, val correct: Int, val percent: Int)

/** Accuracy of the last [window] answers compared with the [window] before them. */
data class Trend(val window: Int, val recentPercent: Int, val previousPercent: Int, val delta: Int)

data class StatsSummary(
    val since: Instant,
    val total: Int,
    val correct: Int,
    val percent: Int?,
    val currentStreak: Int,
    val bestStreak: Int,
    val bestStreakAt: Instant?,
    val byDirection: List<DirectionSummary>,
    val verbCount: Int,
    val verbsSeen: Int,
    val verbsMastered: Int,
    val mostWrong: List<WrongVerb>,
    /** Null until there are enough answers. */
    val trend: Trend?,
    /** Accuracy per day (local time), oldest first. */
    val daily: List<DailyPoint>,
    /** Rolling accuracy over the last answers: each value averages [rollingWindow] consecutive answers. */
    val rolling: List<Int>,
    val rollingWindow: Int,
    /** Answers in the history (may be fewer than [total] for stats recorded before the history existed). */
    val answersRecorded: Int,
)

@Service
class StatsService(
    private val repository: VerbRepository,
    private val objectMapper: ObjectMapper,
    properties: VerbflashProperties,
) {
    private val file: Path = Path.of(properties.statsFile)
    private val zone: ZoneId = ZoneId.systemDefault()

    // The file is re-read on every operation (no in-memory copy) so it stays the single source of truth,
    // even if two instances of the app are accidentally running or the file is edited by hand.

    @Synchronized
    fun record(verb: Verb, direction: Direction, correct: Boolean): StreakInfo {
        val data = load()
        data.overall.add(correct)
        data.byDirection.getOrPut(direction) { Counter() }.add(correct)

        val verbStats = data.verbs.getOrPut(verb.key) { VerbStats() }
        verbStats.attempts++
        if (!correct) verbStats.wrong++
        verbStats.recent.add(correct)
        while (verbStats.recent.size > RECENT_SIZE) verbStats.recent.removeAt(0)
        data.answers.add(AnswerRecord(Instant.now(), verb.key, direction, correct))

        var newRecord = false
        if (correct) {
            data.currentStreak++
            if (data.currentStreak > data.bestStreak) {
                data.bestStreak = data.currentStreak
                data.bestStreakAt = Instant.now()
                newRecord = true
            }
        } else {
            data.currentStreak = 0
        }
        save(data)
        return StreakInfo(data.currentStreak, data.bestStreak, newRecord)
    }

    @Synchronized
    fun summary(): StatsSummary {
        val data = load()
        val verbsByKey = repository.verbs.associateBy { it.key }
        val mostWrong = data.verbs
            .filter { (k, s) -> s.wrong > 0 && k in verbsByKey }
            .map { (k, s) ->
                val verb = verbsByKey.getValue(k)
                WrongVerb(
                    english = verb.english.first(),
                    italian = verb.italian.first(),
                    wrong = s.wrong,
                    attempts = s.attempts,
                    errorPercent = percent(s.wrong, s.attempts)!!,
                    recent = s.recent.toList(),
                )
            }
            .sortedWith(compareByDescending<WrongVerb> { it.wrong }.thenByDescending { it.errorPercent })

        val current = data.verbs.filterKeys { it in verbsByKey }
        return StatsSummary(
            since = data.since,
            total = data.overall.total,
            correct = data.overall.correct,
            percent = percent(data.overall.correct, data.overall.total),
            currentStreak = data.currentStreak,
            bestStreak = data.bestStreak,
            bestStreakAt = data.bestStreakAt,
            byDirection = Direction.entries.map { dir ->
                val c = data.byDirection[dir] ?: Counter()
                DirectionSummary(dir, c.total, c.correct, percent(c.correct, c.total))
            },
            verbCount = repository.verbs.size,
            verbsSeen = current.size,
            verbsMastered = current.values.count { s ->
                s.recent.size >= MASTERED_RUN && s.recent.takeLast(MASTERED_RUN).all { it }
            },
            mostWrong = mostWrong,
            trend = trend(data.answers),
            daily = daily(data.answers),
            rolling = rolling(data.answers),
            rollingWindow = ROLLING_WINDOW,
            answersRecorded = data.answers.size,
        )
    }

    private fun trend(answers: List<AnswerRecord>): Trend? {
        if (answers.size < TREND_MIN_ANSWERS) return null
        // with few answers, split what there is in two halves
        val window = minOf(TREND_WINDOW, answers.size / 2)
        val recent = answers.takeLast(window)
        val previous = answers.dropLast(window).takeLast(window)
        val recentPercent = percent(recent.count { it.correct }, recent.size)!!
        val previousPercent = percent(previous.count { it.correct }, previous.size)!!
        return Trend(window, recentPercent, previousPercent, recentPercent - previousPercent)
    }

    private fun daily(answers: List<AnswerRecord>): List<DailyPoint> =
        answers.groupBy { LocalDate.ofInstant(it.at, zone) }
            .toSortedMap()
            .map { (date, day) ->
                val correct = day.count { it.correct }
                DailyPoint(date, day.size, correct, percent(correct, day.size)!!)
            }

    private fun rolling(answers: List<AnswerRecord>): List<Int> =
        answers.takeLast(ROLLING_SPAN)
            .map { it.correct }
            .windowed(ROLLING_WINDOW) { w -> percent(w.count { it }, w.size)!! }

    @Synchronized
    fun reset() {
        save(StatsData())
    }

    private fun percent(part: Int, total: Int): Int? =
        if (total == 0) null else Math.round(part * 100.0 / total).toInt()

    private fun load(): StatsData =
        if (Files.exists(file)) objectMapper.readValue(file.toFile()) else StatsData()

    private fun save(data: StatsData) {
        file.toAbsolutePath().parent?.let { Files.createDirectories(it) }
        // atomic write: first to a temp file, then rename
        val tmp = file.resolveSibling("${file.fileName}.tmp")
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), data)
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }
}
