# VerbFlash

Giochino per imparare i verbi inglesi a voce. Spring Boot (Kotlin) + pagina web statica.

## Avvio

    mvn spring-boot:run

poi apri **http://localhost:8080** con **Google Chrome** (serve il riconoscimento vocale del browser) e consenti il microfono.

## Configurazione (`src/main/resources/application.yml`)

| proprietà | default | significato |
|---|---|---|
| `verbflash.answer-timeout-seconds` | 10 | secondi per rispondere (modificabile anche dalle impostazioni nella pagina) |
| `verbflash.verbs-file` | `classpath:verbs.csv` | file dei verbi, es. `file:/Users/me/verbi.csv` |
| `verbflash.italian-to-english-ratio` | 0.5 | probabilità di domanda in italiano |

Si possono passare anche da riga di comando:

    mvn spring-boot:run -Dspring-boot.run.arguments="--verbflash.answer-timeout-seconds=15"

## Lista dei verbi

Una riga per verbo, `inglese;italiano`; più risposte accettate separate da `|`:

    get;ottenere|prendere|ricevere
