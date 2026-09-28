# VerbFlash

A tiny game to learn English verbs by speaking them out loud. Spring Boot (Kotlin) + a static web page.

## Running

    mvn spring-boot:run

then open **http://localhost:8080** in **Google Chrome** (the browser's speech recognition is required) and allow microphone access.

## Configuration (`src/main/resources/application.yml`)

| property | default | meaning |
|---|---|---|
| `verbflash.answer-timeout-seconds` | 10 | seconds to answer (can also be changed from the settings on the page) |
| `verbflash.verbs-file` | `classpath:verbs.csv` | verbs file, e.g. `file:/Users/me/verbs.csv` |
| `verbflash.italian-to-english-ratio` | 0.5 | probability of an Italian prompt |
| `verbflash.stats-file` | `data/stats.json` | file where statistics are stored |

They can also be passed on the command line:

    mvn spring-boot:run -Dspring-boot.run.arguments="--verbflash.answer-timeout-seconds=15"

## Verb list

One verb per line, `english;italian`; multiple accepted answers separated by `|`:

    get;ottenere|prendere|ricevere
