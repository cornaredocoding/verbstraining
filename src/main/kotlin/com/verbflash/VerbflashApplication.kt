package com.verbflash

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication

@SpringBootApplication
@ConfigurationPropertiesScan
class VerbflashApplication

fun main(args: Array<String>) {
    runApplication<VerbflashApplication>(*args)
}
