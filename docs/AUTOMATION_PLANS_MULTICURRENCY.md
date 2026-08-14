# Planes, automatización y multi-moneda — diseño del MVP

**Corte:** 13 de agosto de 2026

## 1. Estrategia de producto: semanal vs anual

El plan semanal debe funcionar como una prueba pagada de la propuesta de valor, no como una versión deliberadamente frustrante. Por eso conserva la automatización esencial. El anual concentra la capa de inteligencia que interpreta, explica y simula decisiones.

| Capacidad | Semanal | Anual |
| --- | --- | --- |
| PWA + APK Android | Sí | Sí |
| Captura automática de notificaciones autorizadas | Sí | Sí |
| Gmail + Outlook | Sí | Sí |
| Auto-contabilización por confianza | Sí | Sí |
| Aprendizaje de cuenta/categoría tras correcciones | Sí | Sí |
| Registro manual | Sí | Sí |
| Metas, inversiones manuales y categorías | Sí | Sí |
| Multi-moneda y conversión informativa | Sí | Sí |
| Asesor determinista | Sí | Sí |
| Exportación y controles de privacidad | Sí | Sí |
| Explicaciones personalizadas con IA | No | Sí |
| Escenarios conversacionales con IA | No | Sí |
| Lectura narrativa de hábitos/anomalías con IA | No | Sí |
| Ideas de aceleración de metas con IA | No | Sí |
| Explicación educativa riesgo/horizonte con IA | No | Sí |

La UI marca el anual como `RECOMENDADO · EXPERIENCIA COMPLETA`. La autorización del backend también comprueba que la membresía activa sea anual antes de ejecutar `ai-advisor`, de modo que la restricción no dependa del frontend.

### Packaging y precio recomendado para probar

- Tratar el semanal como **prueba pagada / reversión de riesgo**, no como plan económico de largo plazo.
- Mostrar el anual primero o con mayor jerarquía visual, más el equivalente mensual y el ahorro frente a 52 renovaciones semanales.
- Como hipótesis inicial de pricing, probar que el anual cueste aproximadamente **28–32 pagos semanales** (aprox. 38–46 % menos que mantener el semanal durante 52 semanas). Ajustarlo con conversión, churn, CAC y disposición a pagar del piloto.
- CTA semanal: `Probar 1 semana`. CTA anual: `Activar año + IA`.
- No limitar número de movimientos, Gmail/Outlook ni automatización en semanal: son la prueba de valor que debe convencer al usuario de quedarse.

## 2. Principio de automatización

El objetivo operativo interno es que, después del onboarding y aprendizaje inicial, la intervención humana sea excepcional y tienda a cero. La referencia de 5 % o menos sirve únicamente como criterio de ingeniería/QA. No se muestra al usuario ni se utiliza como promesa comercial. La telemetría equivalente vive en `private.automation_metrics_30d` y solo puede consultarla el rol de servicio.

### Automatización de una detección

1. Android, Gmail u Outlook producen un evento sanitizado.
2. El parser extrae dirección, monto, moneda, comercio, fecha y confianza.
3. Ruido, OTP y detecciones con confianza extremadamente baja se descartan automáticamente.
4. La huella idempotente evita contabilizar duplicados.
5. Se resuelve la cuenta mediante una regla aprendida por emisor/paquete o, si solo existe una cuenta compatible con la moneda, por inferencia inequívoca.
6. Se resuelve la categoría mediante reglas aprendidas, heurísticas y, opcionalmente, la categoría `Otros`.
7. Se calcula `automation_score`.
8. Si supera `auto_post_min_confidence`, se crea la transacción automáticamente.
9. Si falta una decisión inequívoca, la candidata permanece en `pending` con `review_reason`.
10. Una corrección humana puede crear nuevas reglas de cuenta y categoría para reducir futuras intervenciones.

### Revisión humana necesaria o prudente

- Consentimiento inicial de Android, Gmail y Outlook.
- Checkout y gestión de la suscripción.
- Creación/configuración inicial de cuentas y monedas.
- Primera asignación cuando una fuente puede corresponder a varias cuentas de la misma moneda.
- Detecciones ambiguas o con confianza insuficiente.
- Corrección de un falso positivo o categoría incorrecta.
- Decisiones semánticas: metas, prioridades, tolerancia al riesgo y parámetros de inversión.
- Aportes, retiros y valoraciones de inversiones cuando no existe una fuente automática fiable.
- Cualquier acción que realmente mueva dinero o contrate un producto financiero: el tracker nunca la ejecuta por el usuario.

### Calibración protegida

Antes de liberar el modo plenamente autónomo, `onboarding-policy.ts` reserva solo las primeras 3–5 señales útiles como ejemplos de confirmación. Las demás señales claras pueden seguir procesándose. Las confirmaciones se contabilizan server-side antes de re-evaluar pendientes, evitando que una carrera del frontend libere ejemplos todavía reservados.

## 3. Configuración de automatización

`financial_preferences` añade:

- `auto_post_enabled`: activa/desactiva la contabilización automática.
- `auto_post_min_confidence`: umbral mínimo para auto-publicar, por defecto 0.94.
- `auto_review_min_confidence`: por debajo de este valor se descarta automáticamente como detección no fiable, por defecto 0.70.
- `learn_from_reviews`: aprende reglas de las correcciones del usuario.
- `auto_use_other_category`: permite usar una categoría genérica cuando el movimiento es inequívoco pero la categoría específica no lo es.

El usuario controla si permite auto-registro, aprendizaje y fallback seguro a `Otros`; los umbrales numéricos permanecen internos para evitar trasladarle decisiones técnicas. Para el piloto deben mantenerse conservadores y ajustarse con telemetría privada y falsos positivos/negativos por emisor.

## 4. Modelo de aprendizaje sin IA

Dos conjuntos de reglas reducen intervención sin enviar datos a un modelo:

- `account_assignment_rules`: asocia un `app_package` o remitente normalizado con una cuenta elegida previamente.
- `categorization_rules`: asocia comercios/patrones con categorías confirmadas por el usuario.

Las reglas son específicas por usuario y tienen RLS. La aplicación prioriza reglas aprendidas sobre heurísticas generales.

## 5. Multi-moneda

Cada perfil contiene:

- `base_currency`: moneda en la que se consolida el dashboard.
- `enabled_currencies`: monedas que el usuario desea utilizar.

Cuentas, movimientos, metas e inversiones conservan su moneda nativa. El dashboard no suma directamente monedas diferentes: primero agrega por moneda y luego convierte cada agregado a la moneda base usando una tasa de referencia.

Las transacciones pueden conservar también `base_currency`, `base_amount_minor`, `fx_rate`, `fx_source` y `fx_rate_at` cuando se necesita fijar una conversión histórica.

### Servicio de conversión

`fx-rate` acepta `base`, `quote` y opcionalmente `amountMinor`. La implementación de referencia admite:

- `google_finance_web` (predeterminado): adaptador experimental que consulta la cotización pública visible de Google Finance y la almacena temporalmente en caché;
- `frankfurter`: alternativa configurable mediante `FX_PROVIDER` para entornos donde se prefiera un proveedor documentado.

La caché predeterminada es de 30 minutos y se controla con `FX_RATE_CACHE_MINUTES`.

### Advertencia obligatoria en UI

> Conversión informativa basada en la cotización visible en Google Finance al momento de la consulta. Google indica que algunas cotizaciones pueden retrasarse hasta 20 minutos y que la información es solo de referencia. No equivale a la tasa efectiva de tu banco, tarjeta o casa de cambio; pueden existir spread, comisiones e impuestos.

La fuente, fecha/hora y advertencia se devuelven junto con cada tasa para que el frontend no pueda ocultarlas accidentalmente.

## 6. Telemetría interna de autonomía

`private.automation_metrics_30d` puede calcular para QA detecciones totales, auto-contabilizadas, descartadas, resueltas manualmente y pendientes. Solo `service_role` tiene permiso de lectura.

Estos datos sirven para ajustar parsers, reglas, deduplicación y umbrales. **No existe ningún componente de dashboard, ajustes u onboarding que muestre porcentaje de automatización o intervención.** El éxito se evalúa internamente y el objetivo de diseño es reducir preguntas repetidas hasta acercarse a intervención cero.

### Aprendizaje progresivo

Después de aceptar una excepción, CapitalFlow aprende reglas privadas fuente→cuenta y comercio→categoría y reevalúa automáticamente pendientes recientes. Crear una nueva cuenta también dispara esa reevaluación. Gmail/Outlook realizan la primera sincronización al finalizar OAuth y Android puede descubrir señales financieras localmente con allow-list vacía.

## 7. Archivos principales

- `supabase/migrations/202608130002_automation_multicurrency_plans.sql`
- `supabase/functions/_shared/automation.ts`
- `supabase/functions/_shared/ingestion.ts`
- `supabase/functions/transaction-confirm/index.ts`
- `supabase/functions/fx-rate/index.ts`
- `supabase/functions/ai-advisor/index.ts`
- `apps/web/src/components/CandidateReview.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/SubscriptionPage.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/lib/data.ts`
- `packages/core/src/money.ts`
- `packages/core/test/fx.test.mjs`
- `apps/web/src/lib/data.ts` (`loadAdvisorSnapshot`) para precargar el asesor desde el tracker.


## 8. Onboarding y cuentas por plan

El onboarding persistente configura moneda(s), cuenta principal, al menos Gmail u Outlook, permiso Android cuando corresponda y 3–5 asociaciones reales cuando existan señales. Si no hay suficientes ejemplos, no bloquea indefinidamente el acceso: sigue aprendiendo con futuras excepciones.

| Capacidad de cuentas | Semanal | Anual |
| --- | --- | --- |
| Cuenta principal | Sí | Sí |
| Cuentas de viaje/trabajo/proyecto | No | Sí |
| Archivar/restaurar secundarias | No | Sí |
| Backup de cuentas activas/archivadas | No | Sí |

La restricción se aplica en `account-manage` y en un trigger PostgreSQL.
