# Decision Log — CapitalFlow

Sólo se registran decisiones técnicas importantes.

## DECISION-001 — El primer goal queda en el gate de hardening

**DECISION**

Adoptar `PASO-8A-WORKER-HARDENING-GATE` como único goal activo.

**CONTEXT**

La migración y los workers de Paso 8A existen, pero los tests pgTAP presentan defectos conocidos y no hay evidencia suficiente de validación local reproducible.

**OPTIONS**

1. Marcar Paso 8A completado por existencia de código.
2. Corregir primero harness, cobertura y gates locales.

**SELECTED**

Opción 2.

**RATIONALE**

`AGENTS.md` exige criterios de aceptación, tests relevantes y RLS; código escrito no equivale a `TESTED_LOCAL` ni a un gate confiable.

**SECURITY_IMPACT**

Preserva `private` y evita conceder privilegios generales a `service_role` sólo para inspeccionar tests.

**PRD_IMPACT**

Mantiene la automatización y backups dentro de límites verificables, sin declarar capacidades no validadas.

**REVERSIBILITY**

La decisión es documental y reversible; no modifica la implementación.

## DECISION-002 — La infraestructura local no se activa durante la instalación

**DECISION**

Instalar el sistema de goals sin ejecutar Docker, Supabase local ni el loop correctivo de Paso 8A.

**CONTEXT**

El encargo limita esta ejecución a crear el sistema persistente y validar sus archivos.

**OPTIONS**

1. Ejecutar pruebas de infraestructura inmediatamente.
2. Dejar el siguiente prompt como responsable de iniciar el loop correctivo.

**SELECTED**

Opción 2.

**RATIONALE**

Respeta el alcance explícito y evita confundir preparación documental con validación de integración.

**SECURITY_IMPACT**

No toca Docker, red, Supabase remoto, secretos ni producción.

**PRD_IMPACT**

Ninguno; sólo establece el proceso de ingeniería.

**REVERSIBILITY**

Documentación local, reversible mediante edición posterior.
