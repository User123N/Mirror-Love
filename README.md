# MirrorLove 24/7

Aplicación web de salas privadas para compartir una pantalla en tiempo real con otra persona que se une mediante invitación. La persona emisora inicia la captura manualmente desde el selector de pantalla del navegador y puede detenerla en cualquier momento.

## Incluye

- Registro e inicio de sesión con Supabase Auth.
- Creación de salas con código aleatorio de invitación de 8 caracteres.
- Unión a una sala mediante RPC protegida; el código no se puede consultar mediante una búsqueda pública de la tabla.
- Señalización WebRTC mediante Postgres Changes con políticas RLS.
- Compartir pantalla desde Chrome, Edge o Firefox actualizado en contexto HTTPS/localhost.
- Visualización simultánea en ambas direcciones: cada participante puede compartir su propia pantalla dentro de la misma sala.
- Vista del espectador, vista previa local, estado de conexión y cierre de sesión.
- Diseño adaptable a escritorio y móvil.
- Configuración opcional de TURN para redes restrictivas.

## Requisitos

- Node.js 20 o superior (recomendado).
- Proyecto Supabase.
- Cuenta Netlify para despliegue.

## Desarrollo local

1. Descomprime el proyecto y abre una terminal en la carpeta.
2. Instala dependencias:

   ```bash
   npm install
   ```

3. Copia `.env.example` a `.env` y configura:

   ```env
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICABLE_O_ANON
   ```

4. En Supabase → SQL Editor, ejecuta en orden `supabase/migrations/001_initial.sql` y `supabase/migrations/002_create_session_rpc.sql`. La segunda migración instala la función segura que crea salas y evita depender de un INSERT directo desde el navegador.
5. En Supabase → Authentication → URL Configuration, configura el Site URL local (`http://localhost:5173`) y añade esa URL a Redirect URLs.
6. Ejecuta:

   ```bash
   npm run dev
   ```

7. Abre `http://localhost:5173` en dos navegadores o dispositivos e inicia sesión con dos cuentas distintas.

## Despliegue en Netlify

1. Sube el contenido de esta carpeta a un repositorio Git.
2. En Netlify, importa el repositorio.
3. Build command: `npm run build`.
4. Publish directory: `dist`.
5. En Site configuration → Environment variables, añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
6. Opcionalmente añade `VITE_TURN_URL`, `VITE_TURN_USERNAME` y `VITE_TURN_CREDENTIAL` con credenciales TURN válidas.
7. Despliega el sitio.
8. En Supabase → Authentication → URL Configuration, establece el dominio HTTPS de Netlify como Site URL y Redirect URL.

`netlify.toml` ya contiene el comando de build, carpeta de publicación y fallback SPA.

## TURN y conectividad

La app permite que el emisor y el espectador compartan sus pantallas dentro de una misma sesión: el host negocia canales de vídeo/audio bidireccionales desde el inicio y el otro participante puede iniciar su propia captura cuando la conexión esté establecida. Cada persona controla y detiene su propia captura.

La app usa el servidor STUN público de Google como configuración inicial. STUN no garantiza conexión en todas las redes. Para un lanzamiento público fiable, configura un proveedor TURN seguro (por ejemplo, un servicio administrado o coturn propio) y añade sus credenciales como variables de entorno. No publiques credenciales TURN reutilizables en repositorios públicos; utiliza credenciales temporales o rotables cuando tu proveedor lo permita.

## Seguridad y privacidad

- Usa exclusivamente la clave publicable/anon de Supabase en el frontend. **Nunca** incluyas `service_role` en variables `VITE_`, código del navegador o Git.
- La tabla `sessions` y `signals` tienen RLS habilitado. Solo las dos cuentas participantes pueden leer la sala y sus mensajes de señalización.
- La función `join_session` asocia un espectador autenticado a una sala disponible sin exponer una consulta pública del código.
- La captura de pantalla requiere una acción del usuario y la confirmación del selector nativo del navegador. No existe modo oculto ni persistencia de captura después de cerrar la sesión.
- WebRTC puede transmitir directamente entre dispositivos; cuando se usa TURN, el tráfico puede retransmitirse por ese servidor.
- Para uso real, publica una política de privacidad y términos adecuados a tu jurisdicción, define un canal de soporte y revisa los controles de retención de datos del proyecto Supabase.

## Limitaciones de esta primera versión

- Es una aplicación web: no puede prometer captura de pantalla en segundo plano, con el navegador cerrado o después de que Android/iOS suspenda la pestaña.
- El navegador y el sistema operativo pueden detener la captura cuando el usuario cambia permisos, cierra la pestaña o bloquea el dispositivo.
- No hay TURN incluido porque las credenciales deben pertenecer al operador del despliegue. Sin TURN, algunas redes corporativas/móviles pueden impedir la conexión P2P.
- Esta versión no incluye aplicación móvil nativa, cobros, planes, grabación ni almacenamiento de vídeo.
- El botón de detener cierra la sala y detiene todas las pistas locales. El usuario también puede detener la captura desde la barra de compartir del navegador.

## Pruebas manuales previas a producción

- Crear dos cuentas independientes y confirmar el correo si está habilitada la verificación.
- Crear sala en el dispositivo A y unirse desde el dispositivo B.
- Confirmar que el host no puede iniciar hasta que se una el espectador.
- Iniciar la captura y comprobar que el navegador muestra el permiso nativo.
- Verificar vídeo y audio compartido (el audio depende del navegador y de la fuente elegida).
- Detener desde el navegador y desde la app; comprobar que la sala finaliza.
- Intentar leer sesiones/señales desde una tercera cuenta: debe ser denegado por RLS.
- Probar entre redes distintas con TURN configurado.

## Comandos

```bash
npm run typecheck
npm run build
```
