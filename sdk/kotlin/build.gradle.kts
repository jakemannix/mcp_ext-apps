import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    kotlin("multiplatform") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
    id("maven-publish")
}

group = "io.modelcontextprotocol"
version = "0.1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

kotlin {
    // JVM target for Android and server-side
    jvm {
        compilations.all {
            kotlinOptions.jvmTarget = "17"
        }
        testRuns["test"].executionTask.configure {
            useJUnitPlatform()
        }
    }

    // iOS targets
    iosX64()
    iosArm64()
    iosSimulatorArm64()

    // macOS targets
    macosX64()
    macosArm64()

    // WebAssembly (for potential browser use)
    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        browser()
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                // MCP SDK core types
                implementation("io.modelcontextprotocol:kotlin-sdk:0.6.0")

                // Kotlin serialization for JSON
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

                // Coroutines
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            }
        }

        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
            }
        }

        val jvmMain by getting {
            dependencies {
                // Android WebView support
                // Using compileOnly since WebView is provided by the Android framework
                compileOnly("androidx.webkit:webkit:1.8.0")
            }
        }

        val jvmTest by getting {
            dependencies {
                implementation("org.junit.jupiter:junit-jupiter:5.10.0")
                implementation("org.mockito.kotlin:mockito-kotlin:5.1.0")
                implementation("org.mockito:mockito-core:5.7.0")
                // Android WebView for testing
                compileOnly("androidx.webkit:webkit:1.8.0")
            }
        }
    }
}
