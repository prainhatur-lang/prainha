pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // SDK Cielo LIO (Order Manager) vendorado no projeto — repo Maven local
        // em lio-app/sdk/ (com/cielo/lio/order-manager + cielo/smart/event-tracker).
        // Vendorado (em vez de ~/.m2) pra qualquer máquina buildar sem setup extra.
        maven { url = uri("sdk") }
    }
}
rootProject.name = "ConciliaLio"
include(":app")
