# Guía de Onboarding para Desarrollo

¡Bienvenido/a al equipo! Este documento contiene todo lo necesario para configurar tu entorno local y comenzar a aportar valor al MeperPOS (POS).

## 1. Arquitectura a Alto Nivel

Nuestro sistema está compuesto por dos piezas principales:
- **Backend**: NestJS 11, Prisma 6 y PostgreSQL (Puerto `3001`).
- **Frontend**: Next.js 16 (App Router), React 19 y TailwindCSS v4 (Puerto `3000`).

---

## 2. Requisitos Previos

Antes de comenzar, asegúrate de tener instalados los siguientes componentes en tu máquina:
- [Node.js](https://nodejs.org/) (Recomendado v20 LTS o superior)
- [npm](https://www.npmjs.com/) (Viene incluido con Node.js)
- [PostgreSQL](https://www.postgresql.org/) (Versión 14 o superior)
- [Git](https://git-scm.com/)

---

## 3. Configuración del Entorno

### Clonar el Repositorio

```bash
git clone <url-del-repositorio>
cd MeperPOS
```

### Configuración del Backend

1. **Navegar al directorio del backend e instalar dependencias:**
   ```bash
   cd backend
   npm install
   ```

2. **Variables de entorno:**
   Crea un archivo `.env` en el directorio `/backend/` tomando como base el siguiente formato:
   ```env
   DATABASE_URL="postgresql://admin:admin123@localhost:5432/inventario_db"
   JWT_SECRET="your-jwt-secret"
   PORT=3001
   CORS_ORIGIN="http://localhost:3000"
   CLOUDINARY_CLOUD_NAME=tu_cloud_name
   CLOUDINARY_API_KEY=tu_api_key
   CLOUDINARY_API_SECRET=tu_api_secret
   ```
   *Nota: Solicita las credenciales de desarrollo de Cloudinary al líder técnico si es necesario probar la subida de imágenes.*

3. **Base de Datos (Prisma):**
   Asegúrate de que tu servicio local de PostgreSQL esté corriendo y la base de datos `inventario_db` exista (o el nombre que hayas configurado en el `DATABASE_URL`).
   ```bash
   # Ejecutar migraciones para sincronizar el esquema
   npx prisma migrate dev
   
   # Crear las dos organizaciones de prueba (Prueba PRO y Prueba BASIC) y la SuperAdmin local
   # Requiere SEED_TEST_ORG_PASSWORD (>=12) y SUPER_ADMIN_PASSWORD (>=10)
   npm run seed:apply
   ```

4. **Levantar el servicio:**
   ```bash
   npm run start:dev
   ```
   El backend estará disponible en `http://localhost:3001/api`.

### Configuración del Frontend

1. **Navegar al directorio del frontend e instalar dependencias:**
   ```bash
   cd ../frontend
   npm install
   ```

2. **Variables de entorno:**
   Crea un archivo `.env.local` en el directorio `/frontend/`. Por defecto, Next.js se comunicará con el backend local:
   ```env
   NEXT_PUBLIC_API_URL="http://localhost:3001/api"
   ```

3. **Levantar el entorno de desarrollo:**
   ```bash
   npm run dev
   ```
   El frontend estará disponible en `http://localhost:3000`.

---

## 4. Scripts y Comandos Útiles

### Backend (`/backend`)
| Comando | Descripción |
|---------|-------------|
| `npm run start:dev` | Inicia el servidor con recarga en caliente (hot-reload). |
| `npm run build` | Compila la aplicación para producción. |
| `npm run test` | Ejecuta la suite de pruebas unitarias (Jest). |
| `npm run test:e2e` | Ejecuta las pruebas End-to-End. |
| `npm run lint` | Ejecuta ESLint aplicando auto-fix donde sea posible. |
| `npx prisma studio` | Abre una GUI en el navegador para explorar los datos de la BD. |

### Frontend (`/frontend`)
| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia el servidor de Next.js en modo desarrollo. |
| `npm run build` | Crea el build optimizado para producción. |
| `npm run lint` | Ejecuta el linter estático sobre el código React/Next.js. |

---

## 5. Problemas Comunes (Troubleshooting)

### Error de conexión a la base de datos (Prisma)
**Síntoma:** `PrismaClientInitializationError: Can't reach database server`.
**Solución:** Verifica que el servicio de PostgreSQL está en ejecución y que las credenciales (`admin:admin123`) del `DATABASE_URL` en tu `.env` son correctas.

### Errores de CORS en el Frontend
**Síntoma:** Peticiones bloqueadas por política de CORS al intentar loguearse.
**Solución:** Asegúrate de que `CORS_ORIGIN="http://localhost:3000"` esté bien configurado en el `.env` del backend y que reiniciaste el servicio de NestJS.

### Cambios de Esquema no reflejados
**Síntoma:** Propiedades "missing" al consultar la API tras actualizar tu rama.
**Solución:** Alguien más pudo haber introducido cambios en la base de datos. Ejecuta `npx prisma generate` y `npx prisma migrate dev` para sincronizar.
