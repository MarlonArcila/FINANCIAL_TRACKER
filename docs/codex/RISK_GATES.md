# Risk Gates — CapitalFlow

## GREEN — autonomía local

Acciones locales, reversibles y sin secretos: leer documentación y código normal; `rg`, `find`, `sed`, `git diff`, `git status`; crear o editar código, tests y documentación; fixtures locales; archivos temporales del workspace; `npm run typecheck`; `npm run test:all`; `npm run build`; `git diff --check`; tests locales que no contacten servicios externos.

## YELLOW — auto-review/elevación posible

Acciones todavía limitadas a un entorno local y desechable, pero que pueden requerir elevación del sandbox: operaciones bloqueadas por bwrap; acceso al daemon Docker local; Supabase local mediante `capitalflow-local`; scripts locales fuera del sandbox. Antes de usar Supabase, confirmar que el destino es local y no usar `--linked` ni project refs remotos. La elevación no autoriza secretos ni proveedores externos.

## RED — intervención humana explícita

Leer, descubrir o imprimir secretos/credenciales; `.env`, `.env.local`, OAuth, service-role keys o historiales sensibles; Supabase remoto, `--linked`, `db push`, migraciones remotas, Vault o secrets set; deploy, staging/producción; Cron remoto; Google/Gmail/Drive, Microsoft/Outlook/Graph/OneDrive, Whop u OpenAI reales; OAuth real; `git push`, PR, merge o tags remotos; cambios de facturación; borrar datos del usuario, bases no desechables o infraestructura; cualquier operación irreversible.

## Regla de decisión

Ante duda, detenerse, explicar el límite y pedir intervención. Nunca convertir automáticamente un fallo local en un comando remoto ni reducir controles de seguridad para superar una prueba.
