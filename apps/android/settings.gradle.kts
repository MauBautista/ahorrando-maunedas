pluginManagement {
    includeBuild("build-logic")
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ahorrando-maunedas"

// Modules of SDD 05 §2. Allowed dependencies are checked by `checkModuleDependencies`.
include(":app")
listOf("model", "pricing", "database", "network", "auth", "sync", "data", "camera", "designsystem", "ui")
    .forEach { include(":core:$it") }
listOf("auth", "home", "purchases", "catalog", "scan", "shelf", "photo", "settings", "tracking")
    .forEach { include(":feature:$it") }
