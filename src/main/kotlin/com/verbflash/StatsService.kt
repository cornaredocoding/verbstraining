package com.verbflash

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant

/** How many recent answers we keep for each verb. */
private const val RECENT_SIZE = 5

/** A verb is "mastered" when its last MASTERED_RUN answers are all correct. */
private const val MASTERED_RUN = 3

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

/** Data stored on file. Verbs are keyed by their main English form, so they survive changes to the verbs file. */
class StatsData(
    var since: Instant = Instant.now(),
    val overall: Counter = Counter(),
    val byDirection: MutableMap<Direction, Counter> = mutableMapOf(),
    var currentStreak: Int = 0,
    var bestStreak: Int = 0,
    var bestStreakAt: Instant? = null,
    val verbs: MutableMap<String, VerbStats> = mutableMapOf(),
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
)

@Service
class StatsService(
    private val repository: VerbRepository,
    private val objectMapper: ObjectMapper,
    properties: VerbflashProperties,
) {
    private val file: Path = Path.of(properties.statsFile)

    // The file is re-read on every operation (no in-memory copy) so it stays the single source of truth,
    // even if two instances of the app are accidentally running or the file is edited by hand.

    @Synchronized
    fun record(verb: Verb, direction: Direction, correct: Boolean): StreakInfo {
        val data = load()
        data.overall.add(correct)
        data.byDirection.getOrPut(direction) { Counter() }.add(correct)

        val verbStats = data.verbs.getOrPut(key(verb)) { VerbStats() }
        verbStats.attempts++
        if (!correct) verbStats.wrong++
        verbStats.recent.add(correct)
        while (verbStats.recent.size > RECENT_SIZE) verbStats.recent.removeAt(0)

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
        val verbsByKey = repository.verbs.associateBy(::key)
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
        )
    }

    @Synchronized
    fun reset() {
        save(StatsData())
    }

    private fun key(verb: Verb) = verb.english.first()

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
