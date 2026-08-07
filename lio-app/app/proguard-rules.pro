# R8 do app da LIO.
# Shrink SIM (remove classes não usadas — ex.: LinkifyCompat, que cita WebView),
# ofuscação NÃO: nomes legíveis deixam a certificação da Cielo inspecionar o
# APK e ver que não há WebView em lugar nenhum.
-dontobfuscate

# Nossas classes (activities vêm do manifest; mantém tudo por clareza — é minúsculo).
-keep class com.prainha.lio.** { *; }

# SDK Cielo LIO (Order Manager 2.5.5): comunicação AIDL com o serviço de
# pagamento do terminal + serialização Gson dos domínios. R8 não pode
# remover/alterar nada do SDK — senão o checkout falha em runtime.
-keep class cielo.** { *; }
-dontwarn cielo.**
# Gson (dependência transitiva do SDK) usa reflection nos modelos.
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**
-keepattributes Signature, *Annotation*
