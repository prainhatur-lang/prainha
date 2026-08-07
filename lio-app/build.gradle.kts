plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false
}

// Build dir FORA do SSD externo (exFAT): o macOS materializa xattrs como
// arquivos AppleDouble (._*) em volumes sem suporte nativo, e o AGP quebra
// no parse de resources ("._layout is not a directory"). Redirecionar
// pra home (~, APFS) resolve de vez. Em Linux/CI isso também funciona.
subprojects {
    layout.buildDirectory.set(
        File(System.getProperty("user.home"), ".concilia-lio-build/${project.name}")
    )
}
