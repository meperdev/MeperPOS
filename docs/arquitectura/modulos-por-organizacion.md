# Módulos por organización

La disponibilidad de un módulo se configura por organización y solo el SuperAdmin puede cambiarla. La primera capacidad controlada es **Vehículos**; los demás módulos existentes todavía no usan este mecanismo.

## Configurar vehículos

1. Inicia sesión como SuperAdmin y abre el detalle de una organización.
2. En **Módulos**, activa o desactiva **Vehículos**.
3. Cuando está activo, un administrador puede abrir un cliente y agregar o editar sus vehículos, con placa y modelo. El campo de placa anterior sigue disponible por compatibilidad.

Desactivar el módulo impide acceder a sus operaciones y oculta la placa anterior en clientes y en exportaciones de clientes. No elimina vehículos ni placas. Al reactivarlo, los datos vuelven a estar disponibles. Los permisos de usuario y los límites del plan son controles separados.

## Compatibilidad y datos anteriores

- Si una organización no tiene una configuración explícita para vehículos, el módulo se considera activo para preservar el comportamiento anterior. El SuperAdmin puede desactivarlo por organización.
- La migración crea un vehículo vinculado por cada placa anterior no vacía; conserva la placa anterior y deja el modelo vacío. No impone unicidad de placa, porque los datos existentes podían contener duplicados.
- Cambiar la placa anterior o la placa de su vehículo vinculado sincroniza ambos valores en una transacción. Si se vacía la placa anterior, el vehículo se conserva con su modelo y deja de estar vinculado a ese campo.
- El formato de exportación de clientes conserva su columna anterior de placa cuando el módulo está activo. Esa columna representa la placa vinculada al campo anterior, no la lista completa de vehículos.
- La configuración se guarda en `OrganizationModule`, separada de los ajustes editables por el negocio. Las rutas de administración requieren `SUPER_ADMIN`; las rutas de vehículos requieren una organización, el módulo activo y los roles indicados en [la matriz de autorización](../authorization-matrix.md).

## Alcance actual

Este cambio no convierte inventario, ventas, nómina ni reportes en módulos configurables. Tampoco modifica el plan comercial ni borra información al desactivar vehículos. La migración debe validarse y desplegarse siguiendo el procedimiento de base de datos del entorno; las pruebas locales no la aplican a la base del negocio.
