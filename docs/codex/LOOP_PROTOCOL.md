# CapitalFlow — Goal Loop Engineering

## Propósito

Este protocolo mantiene el desarrollo alineado con `AGENTS.md`, el PRD, la arquitectura, el backlog técnico y el estado real del repositorio. Un goal es una unidad acotada de trabajo local, verificable y documentada. La automatización reduce aprobaciones para cambios locales reversibles, pero nunca relaja las barreras de seguridad.

## Ciclo obligatorio

`DISCOVER → PLAN → IMPLEMENT → STATIC VALIDATE → TEST → INSPECT → FIX → RETEST → DOCUMENT → GATE`

### DISCOVER

Leer las fuentes de verdad aplicables; inspeccionar código, migraciones, tests, `git status` y `git diff`; identificar dependencias, invariantes y riesgos. No modificar archivos durante esta fase.

### PLAN

Registrar objetivo, alcance, archivos esperados, invariantes, límites de seguridad, pruebas, aceptación, rollback y criterio GO/NO-GO en `ACTIVE_GOAL.md`.

### IMPLEMENT

Hacer cambios mínimos y coherentes, reutilizando la arquitectura existente. No duplicar mecanismos ni debilitar controles para satisfacer un test.

### STATIC VALIDATE

Ejecutar, cuando corresponda, `npm run typecheck`, `git diff --check` y las validaciones locales deterministas definidas por el repositorio.

### TEST

Ejecutar sólo pruebas locales sin secretos, proveedores externos, producción ni infraestructura remota. Los tests de integración requieren infraestructura local explícitamente confirmada.

### INSPECT / FIX / RETEST

Leer cada error, separar causa de implementación y causa de entorno, corregir la causa raíz y repetir primero la prueba fallida. No ocultar fallos ni cambiar un test correcto sólo para hacerlo pasar. Para un mismo fallo hay como máximo tres intentos sustancialmente diferentes; lecturas, confirmaciones y typos no cuentan.

### DOCUMENT

Actualizar sólo documentación afectada por cambios reales. Distinguir siempre entre `IMPLEMENTED`, `TESTED_LOCAL`, `VALIDATED_INTEGRATION`, `DEPLOYED` y `PRODUCTION_VERIFIED`.

### GATE

Cada goal termina con exactamente un estado: `GO`, `NO-GO`, `BLOCKED_EXTERNAL`, `BLOCKED_SECRET`, `BLOCKED_INFRASTRUCTURE` o `BLOCKED_HUMAN_DECISION`.

## Autonomía y límites

Se puede continuar automáticamente mientras el fallo sea local, reproducible, reversible, esté dentro del repositorio y no implique secretos, infraestructura remota, producción, proveedores reales o decisiones humanas. Se permite solicitar elevación del sandbox para una operación local legítima cuando el auto-review pueda evaluarla.

Se debe detener y solicitar intervención explícita antes de leer secretos, usar Supabase remoto o `--linked`, hacer `db push`, desplegar, modificar Cron remoto, tocar proveedores/OAuth reales, ejecutar operaciones destructivas o publicar en Git remoto. Nunca se leen `.env`, `.env.local`, credenciales ni historiales sensibles.

## Preservación

Antes y después de cada goal se revisan `git status --short` y `git diff --check`. No se usan `reset`, `restore`, `clean`, `stash`, rebase, commit o push sin autorización explícita. Los cambios existentes pertenecen al trabajo del usuario y se preservan.

## Estado de finalización

Un goal sólo puede marcarse `GO` cuando sus criterios de aceptación y validaciones aplicables pasan. Código escrito por sí solo es `IMPLEMENTED`, no una validación del gate.
