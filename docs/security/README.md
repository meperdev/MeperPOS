# Auditoría continua de ciberseguridad — MeperPOS

Espacio de trabajo de la auditoría de seguridad OWASP-based de MeperPOS. **Nada de esto es un cambio al producto**: solo documentación de auditoría, generada en el worktree `.worktrees/security-audit` (rama `audit/security`).

## Documentos

| Archivo | Contenido |
|---|---|
| `AUDIT_PLAN.md` | Reglas obligatorias, marco (OWASP ASVS / Top 10 / API Top 10 / CWE), las 8 fases, criterios de severidad |
| `ARCHITECTURE.md` | Arquitectura descubierta: stack, 35 controladores y sus guards, flujo auth, modelo de roles, aislamiento multi-tenant, controles existentes, límites de confianza, matriz de riesgos |
| `FINDINGS.md` | Hallazgos con ID SEC-XXX, formato estándar (severidad, estado, ubicación, evidencia, escenario, impacto, validación, remediación, regresión) |
| `PROGRESS.md` | Estado por fase, qué se investigó/verificó, incertidumbres, próximas acciones |

## Resumen de hallazgos (FASE 0)

| ID | Título | Severidad | Estado |
|---|---|---|---|
| SEC-001 | ADMIN crea usuarios OWNER y resetea contraseñas de cualquier cuenta | CRÍTICA | **corregido** (verificado) |
| SEC-002 | Fallbacks Prisma sin scoping de tenant + writes post-check | ALTA | potencial |
| SEC-003 | Path traversal en borrado de imágenes; uploads sin validar | ALTA | potencial |
| SEC-004 | Credenciales por defecto (seed/compose) + Postgres expuesto | ALTA | confirmado (estático) |
| SEC-005 | Refresh sobrevive al logout (grace window) + sin CSRF | ALTA | **corregido** (verificado) |
| SEC-006 | CSP inoperante (unsafe-inline en producción) | MEDIA | confirmado (estático) |
| SEC-007 | Login CSRF / fijación de sesión | MEDIA | confirmado (dinámico parcial) |
| SEC-008 | Imports sin validación de tipo | MEDIA | confirmado (estático) |
| SEC-009 | Sin límite observable de tamaño de body | MEDIA | no verificado |
| SEC-010 | Throttler en memoria sin Redis | BAJA | confirmado (estático) |

## Reglas de la auditoría (resumen)

1. Solo código/entornos autorizados; trabajo en este worktree, sin tocar lógica de MeperPOS.
2. Análisis estático y pruebas locales primero; nada de pruebas contra producción.
3. Confirmado solo con evidencia reproducible; los estados estáticos se marcan explícitamente.
4. Sin secretos reales en los informes (se citan ubicaciones, no valores).
5. Remediación (FASE 7) solo con autorización explícita del dueño.
6. Continuidad: cada sesión arranca leyendo `PROGRESS.md` y sigue desde las próximas acciones pendientes.

## Cómo continuar una sesión

1. Leer `PROGRESS.md` (estado y próximas acciones) y `FINDINGS.md` (detalle pendiente de PoC).
2. Verificar si el código citado en los hallazgos abiertos cambió desde la última sesión.
3. Continuar desde el primer ítem pendiente de "Próximas acciones recomendadas".
4. Al cerrar la sesión, actualizar `PROGRESS.md` con lo investigado/encontrado/verificado/pendiente.
