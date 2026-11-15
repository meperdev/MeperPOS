# Módulos por organización

La disponibilidad de un módulo se configura por organización y solo el SuperAdmin puede cambiarla. El catálogo vive en `backend/src/business-modules/module-catalog.ts`: agregar una capacidad nueva es agregar una entrada ahí, sin ruta ni pantalla nuevas. Hoy el catálogo contiene **Vehículos**.

## Configurar módulos

1. Inicia sesión como SuperAdmin y abre el detalle de una organización.
2. En **Módulos** aparece el catálogo completo, cada capacidad con su estado y su interruptor.
3. Cuando **Vehículos** está activo, un administrador puede abrir un cliente y agregar o editar sus vehículos, con placa y modelo. El campo de placa anterior sigue disponible por compatibilidad.

Desactivar un módulo impide acceder a sus operaciones y oculta sus datos en las respuestas y en las exportaciones afectadas. No elimina nada. Al reactivarlo, los datos vuelven a estar disponibles. Los permisos de usuario y los límites del plan son controles separados.

## Rutas

- `GET /api/admin/organizations/:organizationId/modules` devuelve el catálogo completo con el estado de esa organización. Solo `SUPER_ADMIN`.
- `PATCH /api/admin/organizations/:organizationId/modules/:moduleId` activa o desactiva un módulo del catálogo. Solo `SUPER_ADMIN`; un identificador fuera del catálogo responde 400. El cuerpo acepta únicamente un booleano JSON: `{"enabled": true}` o `{"enabled": false}`. Cadenas como `"false"`, números, `null`, objetos, arreglos o un cuerpo sin `enabled` responden 400 con el error de validación y no cambian la configuración.
- `GET /api/business-modules` devuelve el catálogo con el estado de la organización del usuario autenticado.

El listado de organizaciones incluye `enabledModules` con los identificadores activos de cada una, resuelto en una sola consulta para no hacer una lectura por fila.

## Compatibilidad y datos anteriores

- Si una organización no tiene una configuración explícita para vehículos, el módulo se considera activo para preservar el comportamiento anterior. El SuperAdmin puede desactivarlo por organización.
- La migración crea un vehículo vinculado por cada placa anterior no vacía; conserva la placa anterior y deja el modelo vacío. No impone unicidad de placa, porque los datos existentes podían contener duplicados.
- Cambiar la placa anterior o la placa de su vehículo vinculado sincroniza ambos valores en una transacción. Si se vacía la placa anterior, el vehículo se conserva con su modelo y deja de estar vinculado a ese campo.
- El formato de exportación de clientes conserva su columna anterior de placa cuando el módulo está activo. Esa columna representa la placa vinculada al campo anterior, no la lista completa de vehículos.
- La configuración se guarda en `OrganizationModule`, separada de los ajustes editables por el negocio. Las rutas de administración requieren `SUPER_ADMIN`; las rutas de vehículos requieren una organización, el módulo activo y los roles indicados en [la matriz de autorización](../authorization-matrix.md).

## Alcance actual

Solo **Vehículos** está en el catálogo; inventario, ventas, nómina y reportes todavía no son módulos configurables. Tampoco se modifica el plan comercial ni se borra información al desactivar vehículos. La migración debe validarse y desplegarse siguiendo el procedimiento de base de datos del entorno; las pruebas locales no la aplican a la base del negocio.
