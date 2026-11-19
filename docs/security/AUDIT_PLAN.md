# Plan de auditoría de seguridad — MeperPOS

Estado del plan: **FASE 0 en curso**. Este documento define el alcance, las fases y las reglas de la auditoría continua. El progreso vivo está en `PROGRESS.md`; los hallazgos en `FINDINGS.md`.

## Reglas obligatorias (acordadas con el dueño del sistema)

1. Auditar solo código y entornos con acceso autorizado (worktree `.worktrees/security-audit`, rama `audit/security`).
2. Análisis estático y pruebas locales primero.
3. Nada de ataques, escaneos intrusivos ni pruebas destructivas contra producción.
4. No modificar código de MeperPOS sin autorización explícita (FASE 7 requiere aprobación).
5. No exponer secretos reales: se enmascaran valores y se reporta solo la existencia/ubicación.
6. No alterar datos comerciales reales; pruebas solo con datos ficticios.
7. Una vulnerabilidad se declara **confirmada** solo con evidencia reproducible.
8. Clasificación de cada hallazgo: confirmada / potencial / mala práctica / no verificada.
9. Herramientas nuevas requieren autorización previa con justificación.
10. Nada de cambios en despliegues ni infraestructura de producción.

## Marco de referencia

OWASP ASVS, OWASP Top 10, OWASP API Security Top 10, CWE, Zero Trust y mínimo privilegio, buenas prácticas SaaS multi-tenant. Prioridad: vulnerabilidades explotables y fallas de lógica de negocio sobre cuestiones cosméticas.

## Fases

| Fase | Alcance | Estado |
|---|---|---|
| FASE 0 | Reconocimiento: estructura real, módulos, endpoints, flujos auth, límites de confianza, controles existentes, inventario de superficie de ataque, mapa de arquitectura + matriz de riesgos + top-5 riesgos prioritarios | **en curso** |
| FASE 1 | Autenticación y autorización: login/logout, JWT/cookies/sesiones, expiración y revocación, hashing de contraseñas, guards y decoradores NestJS, escalamiento de privilegios, acceso horizontal/vertical | pendiente |
| FASE 2 | Aislamiento multi-tenant (prioridad máxima): IDOR/BOLA, organizaciónId desde el cliente, scoping Prisma en consultas complejas y operaciones masivas, sucursales, reportes/estadísticas | pendiente |
| FASE 3 | Backend y API: inyección SQL, validación de entradas, mass assignment, BOLA/BFLA, rate limiting, fuga de información, manejo de excepciones, CORS, SSRF, subida de archivos, endpoints administrativos, condiciones de carrera | pendiente |
| FASE 4 | Integridad comercial: manipulación de precios, cantidades, descuentos no autorizados, ventas duplicadas, inventario negativo, operaciones simultáneas, transacciones incompletas, totales enviados por el cliente vs recálculo del servidor | pendiente |
| FASE 5 | Frontend: XSS, protección de rutas, manejo de tokens, secretos expuestos, variables públicas, dependencia indebida de validación de cliente, encabezados | pendiente |
| FASE 6 | Infraestructura y dependencias: Railway, Vercel, PostgreSQL, variables de entorno, npm, configuración de producción, logs, CI/CD, permisos de despliegue | pendiente |
| FASE 7 | Verificación y remediación (solo con autorización): solución mínima segura, cambios aislados, pruebas de regresión, verificación de corrección | bloqueada hasta autorización |

## Criterios de severidad

- **CRÍTICA**: explotable de forma remota sin privilegios o con privilegios mínimos; expone datos cross-tenant, dinero o toma de control de cuenta/tenant.
- **ALTA**: explotable con autenticación de bajo privilegio o requiere condiciones favorables; expone datos del propio tenant o corrompe registros comerciales.
- **MEDIA**: requiere acceso previo o condiciones específicas; defensa en profundidad debilitada.
- **BAJA**: mala práctica con impacto limitado o explotabilidad improbable.
- **INFORMATIVA**: observación de endurecimiento (hardening) sin explotabilidad directa conocida.

## Continuidad entre sesiones

Al comenzar cualquier sesión: leer `docs/security/` completo → reconstruir estado → verificar si el código relacionado a hallazgos pendientes cambió → continuar desde el siguiente objetivo pendiente. No reiniciar de cero sin razón técnica.
