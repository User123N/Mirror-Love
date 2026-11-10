# Checklist antes de abrir MirrorLove al público

## Infraestructura
- [ ] Crear el proyecto Supabase en la región adecuada.
- [ ] Ejecutar `supabase/migrations/001_initial.sql` en SQL Editor.
- [ ] Confirmar que RLS está activo en `sessions` y `signals`.
- [ ] Confirmar que Realtime está habilitado para `sessions` y `signals`.
- [ ] Configurar Supabase Auth: correo, confirmación, Site URL y Redirect URLs.
- [ ] Crear sitio Netlify e importar el repositorio.
- [ ] Configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Netlify.
- [ ] Configurar TURN y probar conexiones desde redes móviles y Wi-Fi distintas.
- [ ] Activar HTTPS y un dominio propio.

## Pruebas de seguridad
- [ ] Verificar que la clave `service_role` no está en el frontend, variables `VITE_`, Git ni ZIP público.
- [ ] Verificar que una tercera cuenta no puede leer sesiones ni señales ajenas.
- [ ] Verificar que un código incorrecto, expirado o ya utilizado no permite entrar.
- [ ] Verificar que no se puede iniciar captura sin pulsar el botón y aceptar el selector del navegador.
- [ ] Verificar que detener desde la aplicación y desde el navegador finaliza la captura.
- [ ] Probar que una cuenta no puede reasignar el participante de una sesión.

## Operación
- [ ] Adaptar y publicar `PRIVACY.md` y `TERMS.md` con datos reales del responsable; son borradores.
- [ ] Definir correo/canal de soporte y proceso de reporte de abuso.
- [ ] Definir retención y eliminación de cuentas/datos.
- [ ] Ejecutar pruebas en Chrome, Edge, Firefox, Android y Safari/iOS (las capacidades de compartir pantalla varían).
- [ ] Configurar monitorización de errores y límites/costos de Supabase, Netlify y TURN.

**No anunciar como servicio 24/7 de captura en segundo plano.** Esta es una aplicación web de pantalla compartida iniciada y controlada por el usuario; el navegador y el sistema operativo pueden detenerla.
