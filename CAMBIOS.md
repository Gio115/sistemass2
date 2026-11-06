# Cambios – Sistema El Mismísimo (versión simplificada + seguridad)

Este paquete trae **todos** los archivos que cambiaron respecto a tu proyecto original (seguridad + simplificación).
Copia las carpetas `public/` y `src/` **encima** de las de tu proyecto, deja `CAMBIOS.md` y `.gitignore` en la raíz y
reinicia el servidor. Tu base de datos (`data/`) no se toca.

| Archivo | Qué cambió |
|---|---|
| `public/index.html` | **Reescrito** con textos claros, botones grandes, pasos numerados en el cobro y cuadros de confirmación propios |
| `public/css/simple.css` | **Nuevo.** Todo el estilo "fácil de usar": letras grandes, contraste, botones de buen tamaño, celular/tableta |
| `public/css/main.css` | Solo se subió el tamaño de las letras que eran demasiado chicas (nada más) |
| `src/server.js`, `src/static-gzip.js` | **Velocidad.** Los archivos de la página viajan comprimidos (de ~300 KB a ~65 KB). `static-gzip.js` es nuevo. También responde con un mensaje claro cuando algo enviado es demasiado grande |
| `public/fonts/`, `public/js/vendor/` | **Nuevos.** La letra Outfit y la librería de gráficas ahora salen de tu propio sistema (antes se bajaban de internet) |
| `public/logo-small.jpg` | **Nuevo.** Versión liviana del logo (35 KB en vez de 100 KB) para pantalla. `logo.jpg` no se toca y se sigue usando en el ticket |
| `public/js/app.js` | Textos claros, confirmaciones, letra ajustable, cobro a prueba de errores, correcciones (ver abajo) y **selector de sucursal**, personal por sucursal y Ajustes > Sucursales |
| `public/img/bebidas/` | **Nuevo.** Dibujos de las bebidas (michelada, cerveza, tarro, refresco, cola, trago, botana y uno general) que reemplazan los emojis de las tarjetas del menú |
| `src/routes/pos.routes.js` | Catálogo sin costos ni recetas; cantidades validadas; fecha en el ticket de mesa; **fotos de productos** (lectura); **quitar mesas** (solo administrador); **elegir vidrio/lata** al vender y en mesas |
| `src/routes/admin.routes.js` | Contraseña mínima de 4 caracteres también en el servidor; **subir y quitar la foto de un producto**; guardar las opciones que elige el cliente |
| `src/db.js` | Tabla nueva `product_images` para las fotos y las tablas de **sucursales** (existencias por sucursal, personal por sucursal, productos pausados por sucursal). La **conversión de tu base de datos antigua** se hace sola, una vez, al arrancar (se crea "El Mismísimo" con todo lo que tenías y "VIP entre amigos" en cero). Tampoco vuelve a pisar NIT, teléfono ni dirección en cada reinicio. **Nuevo:** tabla `product_options` (opciones que elige el cliente) y, una sola vez, los tres productos del marinero y el insumo Gallo en lata (sección 14) |
| `src/routes/auth.routes.js` | Al entrar, trae las sucursales de la persona |
| `src/branches.js` | **Nuevo.** Sucursales: qué sucursal usa cada petición (el servidor la revisa siempre), existencias por sucursal y pausas por sucursal |
| `src/routes/inventory.routes.js` | **Reescrito por sucursal** (existencias, compras, mermas y movimientos de la sucursal elegida) + correcciones de seguridad de la entrega anterior |
| `src/options.js` | **Nuevo.** Opciones que elige el cliente (Gallo de vidrio o de lata): comprobar lo que llega, guardarlas y bajar del inventario la que se eligió (sección 14) |
| `src/db.js`, `src/auth.js` | **Nuevo (sección 15):** la carpeta de la base de datos se puede elegir (`DATA_DIR`) y en Hostinger se guarda fuera de la carpeta de publicación |
| `src/voids.js` | **Nuevo (sección 16).** Anular ventas: quién puede, devolver al inventario exactamente lo que bajó esa venta, dejar constancia y ajustar la caja |
| `src/routes/pos.routes.js` (anular) | Rutas nuevas `POST /api/pos/sales/void` y `GET /api/pos/shift/sales`; el corte de caja ya no cuenta ventas anuladas; **sin descuentos a mano** (sección 18) |
| `src/db.js` (lista del negocio), `src/routes/admin.routes.js` (precios) | **Sección 19.** Carga una sola vez los 47 productos de tu lista (con inventario en 0, pausados y en Q0); ruta nueva `POST /api/admin/products/prices` para ponerles precio de una vez; el aviso de "por agotarse" ignora insumos sin mínimo |
| `public/img/bebidas/cigarro.svg` | Dibujo nuevo para la sección Cigarros |
| `src/db.js` (menú de ejemplo), `src/routes/admin.routes.js`, `src/routes/inventory.routes.js` | **Sección 20.** Quita el menú de ejemplo y deja tu lista; "Quitar" un producto con ventas ahora lo oculta del Menú (columna nueva `archived`); borrar secciones e insumos ya no se traba por productos ocultos |
| `src/db.js` (sucursales del dueño y libreta), `src/routes/admin.routes.js`, `public/js/app.js`, `public/css/simple.css` | **Secciones 21 y 22.** Tus 7 sucursales, ocultar / mostrar una sucursal en Ajustes, y los precios, costos y recetas de tu libreta (Cimarrona y micheladas) |
| `public/js/app.js`, `public/css/simple.css`, `public/index.html` | **Sección 23.** Vender más simple: tarjetas con foto, nombre y precio, número redondo de lo que lleva el pedido y ✕ chica para quitar |
| `public/css/shell.css`, `public/css/tema.css`, `public/css/pantallas.css` (**nuevos**), `public/index.html`, `public/js/app.js`, `public/css/main.css` | **Sección 24.** Barra lateral de íconos a la izquierda, fondo claro (con botón para volver al oscuro en cada aparato) y Mesas, Inventario, Menú y Resumen más simples |
| `src/db.js` (segunda hoja de la libreta, conversión 8) | **Sección 25.** Precios y costos de la segunda hoja (cigarros, alitas, papas, sopas, octavos, azulitos, Vitafer, VB, marinero, Miche corona), clamato a Q 4.70 el litro y aderezo en las micheladas de Gallo |
| `public/index.html`, `public/js/app.js`, `public/css/pantallas.css`, `public/css/tema.css` | **Sección 26.** Cobro simple: solo el total, "¿Cómo paga el cliente?" (Efectivo / Tarjeta / Transferencia) y COBRAR; sin billetes, teclado, cambio ni nota. Título del cajón legible en fondo claro |
| `public/js/app.js`, `public/css/pantallas.css`, `public/css/shell.css` | **Sección 27.** Sin hueco en blanco entre las bebidas y la barra de abajo en el iPhone acostado (se mide la barra en vivo) y barra lateral que no se encima en pantallas bajitas |
| `public/css/main.css`, `public/css/simple.css`, `public/js/app.js`, `public/index.html` | **Sección 28.** Ticket y cuenta a 58 mm para la Vektor VT-POS-58Y (hoja de 46 mm centrada, fecha corta, sin Importe recibido / Cambio, logo invertido, el botón Imprimir imprime solo el ticket) |
| `public/js/escpos.js` (**nuevo**), `public/js/app.js`, `public/index.html`, `public/css/pantallas.css` | **Sección 29.** Imprimir de una vez, sin el cuadro de Android: modo "Directa (con RawBT)" para la térmica Bluetooth, cuadro "⚙️ Impresora" en cada aparato (directa o con vista previa, logo, tildes, Imprimir prueba) para el ticket y la cuenta de mesa |
| `src/db.js`, `src/fotos_dueno/` (**nueva**, 13 fotos) | **Sección 30.** Las fotos de productos que mandó el dueño se ponen solas (una sola vez, solo en productos sin foto) al arrancar la versión nueva |
| `src/db.js`, `src/branches.js`, `src/routes/inventory.routes.js`, `src/routes/admin.routes.js`, `public/index.html`, `public/js/app.js`, `public/css/pantallas.css`, `public/css/simple.css` | **Sección 31.** Control estricto de líquidos: **botella** en cada insumo, **"Llegó mercadería" por botella**, **📋 Contar inventario** (lo que debería haber contra lo que contaste, con la diferencia en quetzales y su historial) y el costo de la receta que se recalcula al momento. Columnas nuevas `pack_name` y `pack_size` en insumos y tablas nuevas `inventory_counts` e `inventory_count_lines` (se crean solas al arrancar; no se toca nada de lo que ya tienes) |
| `src/db.js` | **Sección 32.** Tu lista nueva del 29 de octubre: precios, azulitos con receta (esencia, licor, Sprite, Power), Jagger sola y Jaggerbomb (⅓ de Red Bull), alitas que bajan papas, Volteaditos, Cimarrona completa, **Vitafer en ml (shot y bote)**, Agua mineral; **copia de seguridad automática** y borrado de los 22 insumos que ningún producto usa (una sola vez al arrancar) |
| `src/db.js` | **Sección 33.** "Borra todo y deja solo lo que te mandé": el Menú queda con los 31 productos de tu lista y el inventario con los 27 insumos que usan (copia de seguridad automática, lo que ya tenía ventas se oculta en vez de borrarse, secciones vacías fuera) |
| `src/validate.js`, `.gitignore` | Correcciones de seguridad de la entrega anterior (sin cambios nuevos) |
| `src/routes/traspasos.routes.js` (**nuevo**), `src/db.js`, `src/server.js`, `public/index.html`, `public/js/app.js`, `public/css/pantallas.css` | **Sección 45.** Pasar mercadería de una tienda a otra, por botellas (solo administrador): botones **🚚 Pasar a otra tienda** y **📜 Ver traspasos** en Inventario. Tablas nuevas `inventory_transfers` e `inventory_transfer_lines`; el inventario existente no se modifica |
| `src/idempotencia.js`, `src/entrada.js`, `src/login-limite.js` (**nuevos**), `src/server.js`, `src/routes/auth.routes.js`, `src/routes/admin.routes.js`, `src/routes/pos.routes.js`, `src/routes/inventory.routes.js`, `src/db.js`, `public/js/app.js` | **Sección 46.** Revisión de errores, cobros dobles, datos absurdos, memoria y rendimiento: claves de reintento, tiempo máximo de red, revisión de lo que llega al servidor, límite de intentos de contraseña, cierre ordenado con respaldo completo, cabeceras de seguridad y mensajes claros. Tabla nueva `idempotency_keys` |

---

## 1. Simplificación: qué verá la gente

**Para todos**
- Botones con palabras, no solo íconos ("🚪 Salir", "➕ Agregar un producto"). Tamaño mínimo cómodo para tocar con el dedo.
- ~~Botón "A Letra" y botón "❓ Ayuda"~~ (se **quitaron** después a pedido tuyo; ver la sección 10).
- Mensajes de error en español normal ("El usuario o la contraseña no son correctos. Revísalos e inténtalo otra vez.").
- Todo lo peligroso pregunta antes, con un cuadro propio (ya no salen los cuadros feos del navegador): salir con pedido
  sin cobrar, vaciar pedido, cancelar una cuenta, borrar productos/insumos/personas.
  Borrar **todas las ventas** o **todo el menú** exige además escribir la palabra `BORRAR`.
- Se quitaron los botones de "acceso rápido de demostración" de la pantalla de inicio (mostraban las contraseñas de ejemplo).
- Casilla "Mostrar contraseña" en el inicio de sesión.

**Para el vendedor (lo principal)**
- Pestañas: **Vender · Mesas · Mi caja**.
- Aviso rojo "Tu caja está cerrada" con botón **Abrir caja** (no bloquea la venta, solo avisa).
- **El cobro ya no es una ventana:** al tocar COBRAR, el panel de la derecha (o el que sube desde abajo en tableta y celular) se convierte en la pantalla de cobro, con "← Volver" para regresar al pedido.
- Cobro en **3 pasos numerados**: 1 ¿Cómo paga? → 2 ¿Con cuánto paga? (botones "Paga justo", Q20, Q50, Q100, Q200, Q500 o teclado) → 3 Toca el botón verde.
- El **cambio** sale grande y verde ("Devuélvele al cliente: Q 60.00") justo debajo de los billetes y se queda visible. Si falta dinero sale en rojo "Todavía falta: Q 10.00" y el botón de cobrar se apaga.
- **Seguro contra errores de dedo:** si el cambio sería muy grande (ej. Q430 para una cuenta de Q40) pregunta "¿Está bien ese monto?" antes de cobrar.
- Teclado con "⌫ Borrar uno" y "🧹 Borrar todo y empezar de nuevo".
- Mesas: lo que se pidió sin guardar se guarda solo al tocar **Ver cuenta** o **Cobrar**, así la cuenta y el cobro siempre salen completos.
- Pantallas vacías con explicación ("Todavía no hay nada en el pedido — Toca una bebida para agregarla").

**Para el administrador**
- Cada pantalla tiene título y una línea que explica para qué sirve (Resumen, Inventario, Menú, Ventas hechas, Cortes de caja, Personal, Ajustes).
- Nombres entendibles: "Llegó mercadería" (compra), "Se perdió o se dañó algo" (merma), "Cortes de caja", "Personal".
- Producto nuevo: el formulario explica la receta con "Cuesta prepararla" y "Ganancia".
- "Se perdió o se dañó algo": la nota ahora es opcional (el motivo ya se elige en la lista).

## 2. Errores que aparecieron al probar y quedaron corregidos

- **Fecha vacía ("-") en el ticket de una cuenta de mesa** ya cobrada.
- **Horas en las tablas, el ticket y la cuenta** salían 6 horas adelantadas (SQLite guarda la hora en UTC); ahora se muestran en la hora del aparato.
- **Descargar ventas (CSV)** no funcionaba (el servidor no leía el permiso que mandaba el botón). Ahora baja bien, abre en Excel con tildes y con la hora local.
- **"Ver cuenta" de una mesa** podía imprimir una cuenta incompleta; ahora guarda primero lo pendiente. La impresión de la cuenta ocupa solo la hoja de la cuenta.
- **Cobrar una mesa** cobraba lo guardado e ignoraba bebidas nuevas sin guardar; ahora las guarda antes.
- **Contraseña corta:** el servidor ahora exige mínimo 4 caracteres (antes solo lo pedía la pantalla).
- El método de pago **Mixto** ya no se muestra (confundía); el servidor lo sigue aceptando para ventas antiguas.
- **El sistema no arrancaba en una instalación nueva** (sin carpeta `data/`): se caía con "FOREIGN KEY constraint failed" porque intentaba agregar la Cerveza Gallo y el Cabro antes de crear las secciones del menú. Ya arranca bien desde cero (esto también pasaba en el original; solo funcionaba porque venía con una base de datos de ejemplo).
- **Receta que se borraba al editar un producto.** Si el administrador abría el Menú sin pasar antes por Inventario, los ingredientes salían en blanco y al guardar se perdía la receta
  (el producto dejaba de descontar inventario). Ya se cargan siempre. Esto también pasaba en el sistema original.
- **No dejaba guardar productos con cantidades finas** (por ejemplo 0.025 litros de chamoy): el formulario las rechazaba. Ahora aceptan cualquier decimal (también en insumos, compras y mermas).

## 3. Velocidad: por qué se sentía trabada y qué se hizo

Se midió con una tableta lenta simulada (procesador 4 a 6 veces más lento y internet de 4G/3G):

- **Deslizar la lista de bebidas iba a ~21 cuadros por segundo** (se siente trabado; lo fluido es 60). La causa era el desenfoque
  de fondo ("blur") de los 17 cuadros emergentes, que se recalculaba en cada movimiento aunque estuvieran cerrados.
  Se quitó (el fondo ahora es un poco más oscuro) y los cuadros cerrados ya no se dibujan. **Ahora va a 60.**
  Esto ya venía así en tu sistema original.
- **Al abrir el sistema esperaba a internet** para bajar Chart.js y la letra de Google antes de mostrar nada.
  Ahora ambas salen de tu propio servidor (el vendedor ni siquiera descarga las gráficas: solo el administrador, al abrir Resumen).
  El sistema ya no depende de ningún sitio externo.
- **Nada viajaba comprimido.** Ahora sí (gzip, sin instalar nada extra).
- Resultados de la prueba (original → ahora): primera pantalla con 4G lento **~3.8 s → ~1.0 s**, con 3G **~7.1 s → ~2.2 s**; peso que se descarga **562 KB → 144 KB**;
  deslizar **25 → 61 cuadros/s**; tocar una bebida **~114 → ~46 ms**; abrir el cobro **~109 → ~66 ms**.
  (La parte de internet del "original" usa un tiempo estimado para los sitios externos, no medido en tu servidor real.)
- El servidor responde cada acción en ~1 ms en la prueba local; si en Hostinger notas esperas largas al guardar o cobrar,
  lo más probable es que venga del servidor (el plan de Hostinger) o de la conexión a internet de ese aparato.

## 4. Seguridad (entrega anterior, sigue vigente)

1. **Token de admin falsificable.** La clave ya no está en el código: usa la variable `JWT_SECRET` (mín. 32 caracteres);
   si no existe se genera una aleatoria en `data/.jwt_secret`.
2. **XSS (vendedor → admin).** Los textos que escribe la gente se escapan antes de mostrarse; el servidor limita el largo.
3. **El vendedor veía costos y modificaba inventario.** El catálogo ya no manda costos ni recetas; inventario, movimientos y mermas son solo de admin.
4. **Cantidades negativas.** Solo enteros de 1 a 999; `add-items` es atómico; `remove-item` no actúa en cuentas cerradas; `checkout` valida el método de pago.

## 5. Tableta y celular (nuevo)

- **Cobro dentro del panel de la derecha (sin ventana aparte).** Al tocar COBRAR el panel muestra: total, cómo paga, billetes, cambio, teclado y el botón verde.
  "← Volver" regresa al pedido. Si tocan otra bebida mientras cobran, vuelve al pedido para que nunca se cobre un total viejo.
  Las cuentas de mesa se cobran igual, desde el mismo panel.
- **COBRAR siempre a la vista en pantallas anchas (más de 900 px).** Antes el panel de la derecha se alargaba tanto como la lista de bebidas y el botón
  COBRAR quedaba muy abajo (había que deslizar toda la página; ya pasaba en tu sistema original). Ahora el panel ocupa la altura de la pantalla,
  la lista de bebidas y el pedido se deslizan por dentro y COBRAR no se mueve.

Se revisó cómo se ve el sistema en tabletas (Galaxy Tab S7, iPad y similares), de pie y acostadas, con la barra de arriba
visible y oculta (el botón "Ocultar barra" se quitó después, sección 24), y también en celulares.

- **Barra de arriba oculta:** los botones ya no se amontonan ni se cortan; si hace falta, se acomodan en dos filas.
- **Tarjetas de bebidas:** ya no se encima el texto (antes una fila fija de 175 px hacía que el nombre, el precio y "Quedan…" se pisaran).
  En pantallas bajitas se esconde la descripción larga para que quepan más bebidas.
- **Cobro en tableta (panel que sube desde abajo):** todo en una sola pantalla, sin bajar: a la izquierda el total y cómo paga, en el centro los billetes,
  el cambio y el monto, a la derecha el teclado. Si paga con tarjeta o transferencia se simplifica solo.
- **Pedido ("Ver pedido") en tableta acostada:** la lista de bebidas a la izquierda y el total con el botón COBRAR a la derecha
  (antes la lista se aplastaba hasta desaparecer en pantallas bajitas).
- **Cuenta de una mesa y Mesas:** botones en una sola fila, resumen de mesas en una fila, y el botón "Quitar" ya no se sale de su recuadro.
- **Celular:** el aviso del cambio ahora sale junto al botón COBRAR y ya no tapa los billetes; con letra grande los botones de
  forma de pago, mesas y cuentas no se salen de la pantalla; también se ve bien en celulares angostos (320 px).
- Se quitó el aro amarillo que aparecía alrededor de los cuadros emergentes al abrirlos.
- ~~**Consejo:** en tabletas con poca altura toca "Ocultar barra".~~ **Ya no aplica (sección 24):** ese botón se quitó; la barra de arriba ahora es delgada y siempre se ve.

## 6. Dibujos y fotos en lugar de emojis (nuevo)

- Cada tarjeta del menú muestra ahora un **dibujo** de la bebida en vez del emoji: michelada (vaso escarchado con limón), cerveza (botella),
  tarro de cerveza, refresco (vaso con popote), cola, trago (vaso con hielo) y botana (plato de cacahuates). Si el producto no encaja en ninguno, sale una copa.
- El dibujo se escoge **solo**, por la sección del producto ("Micheladas", "Cervezas", "Refrescos", "Tragos", "Botanas") y, si la sección tiene otro nombre,
  por el nombre de la bebida (Gallo, Cabro, Coca-Cola, Tequila…). No hay que hacer nada al agregar productos nuevos.
- Los dibujos son archivos `.svg` en `public/img/bebidas/` (livianos, se ven nítidos en cualquier pantalla y no se bajan de internet).
  **Para poner un dibujo propio** basta con reemplazar el archivo con el mismo nombre (por ejemplo `cerveza.svg`) y refrescar con Ctrl+F5.
- Si algún día falta un dibujo, la tarjeta vuelve a mostrar el emoji de antes (nunca una imagen rota).
- El tamaño se ajusta solo a la pantalla (computadora, tableta, celular) y al tamaño de letra elegido.
- Los emojis de los **botones** y de las **secciones** (🍹 Micheladas, 🛒 Pedido, etc.) se dejaron como están.

### Fotos reales de cada producto

Para usar la foto real de una bebida (la tuya, o una descargada de internet): **Menú → ✏️ Cambiar (o ➕ Agregar un producto) → 📷 Elegir foto → Guardar producto.**

- Desde un celular o tableta, "Elegir foto" deja escoger de la galería o tomar la foto en ese momento.
- La foto se **recorta y se achica sola** (cuadrada, 480 px, ~40–90 KB), así que no importa qué tan grande sea. Si la foto es alargada (una botella), se muestra **completa** y el fondo toma el color de sus bordes.
- La foto aparece en la tarjeta del menú un poco más grande que los dibujos, y como miniatura en la lista del Menú. "🗑️ Quitar foto" vuelve al dibujo.
- Los productos sin foto siguen con su dibujo; si una foto no carga, también se usa el dibujo.
- Las fotos se guardan **dentro de la base de datos** (`data/`), así que entran en tus respaldos y no se pierden al actualizar `public/` o `src/`.
- Solo el administrador puede subir o quitar fotos. Se aceptan solo JPEG de hasta 300 KB (la pantalla ya las prepara así); cualquier otra cosa se rechaza.
- Importante: las fotos de productos de marcas o de tiendas en internet tienen derechos de autor. Lo más seguro es usar fotos propias o las que te den tus proveedores.

## 7. Menú más simple (nuevo)

Antes, agregar un producto mostraba de golpe tipo, receta, ingredientes y costos, y la lista del Menú tenía 9 columnas. Ahora:

- **Agregar un producto = foto (opcional), nombre, sección y precio.** Eso es todo; toca 💾 Guardar. El botón queda siempre a la vista.
- **⚙️ Más opciones** (cerrado, no hace falta abrirlo): descripción, etiqueta (por ejemplo "⭐ Más vendida") y el inventario. Ahí eliges si quieres que el inventario baje solo:
  *No llevo inventario de este* (lo normal) · *Sí, se vende tal cual* (botella, lata) · *Sí, se prepara con receta* (ingredientes).
  Si no tocas nada, el producto se vende igual y no mueve el inventario. Al cambiar un producto que ya tiene descripción, etiqueta o inventario, esta parte se abre sola.
- **Lista del Menú corta:** solo producto (con su foto), precio y 3 botones. Va **agrupada por sección** y en el mismo orden de "Vender". Ya no hay columnas de costo, ganancia ni receta.
- **⏸️ Pausar / ▶️ Volver a vender:** si una bebida se acabó, se pausa (deja de salir en "Vender") sin borrarla, y se vuelve a activar con un toque. También está la casilla "Se vende ahora" al cambiar un producto.
- **🗑️ Quitar** un producto que ya tiene ventas **ya no da error**: queda pausado y las ventas se conservan. Los que nunca se vendieron se borran del todo.
- **Secciones del menú más simples:** solo se escribe el nombre. El dibujo (🍺, 🍹, 🥤…) se escoge solo y la sección nueva queda al final; con las flechas ⬆️ ⬇️ se cambia el orden. Ya no hay "Dibujo" ni "Posición". Si quitas una sección que tiene productos, el mensaje explica qué hacer.
- Al cambiar un producto "se vende tal cual", su costo ahora sigue al inventario elegido.
- Un producto "tal cual" sin inventario elegido se trata como "no llevo la cuenta" (antes la tarjeta decía "¡Se acabó!" por error).

## 8. Quitar mesas (nuevo)

Antes se podían crear mesas pero **no había ninguna forma de quitarlas**. Ahora:

- Cada mesa **libre** muestra un botón **🗑️ Quitar mesa** debajo de "ABRIR CUENTA". Pregunta "¿Quitar esta mesa?" antes de hacerlo.
- **Solo el administrador** lo ve y puede usarlo. El vendedor sigue pudiendo agregar mesas, pero no quitarlas.
- Una mesa **con cuenta abierta no se puede quitar** (no muestra el botón y el servidor también lo rechaza): primero se cobra o se cancela la cuenta.
- Las ventas y cuentas que ya se hicieron en esa mesa **no se pierden**: la mesa solo se oculta de la lista. Si la necesitas otra vez, se vuelve a agregar.
- No se puede abrir una cuenta ni transferir una cuenta a una mesa que ya fue quitada.

## 9. Sucursales: "El Mismísimo" y "VIP entre amigos" (nuevo)

El sistema ahora maneja **varias sucursales** (vienen dos: **El Mismísimo** y **VIP entre amigos**). Todo lo que ya tenías quedó en **El Mismísimo**; **VIP empieza en cero**.

**Qué es igual en las dos y qué es separado**

| Igual en todas | Separado por sucursal |
|---|---|
| Menú, precios, recetas, fotos, secciones | **Existencias** de cada insumo (la lista de insumos, sus costos y proveedores sí es una sola) |
| Datos del negocio (NIT, dirección, teléfono) y mensaje del ticket | **Compras y mermas**, y el historial de movimientos |
| | **Mesas**, **cajas / cortes** y **ventas** |
| | **"Pausar" un producto** (que se acabó en una y en la otra no) |

**Cómo se usa**

- **Arriba aparece un selector de sucursal** (solo si hay más de una). Todo lo que ves y haces (vender, mesas, inventario, caja, menú) es de la sucursal elegida. Se acuerda de la última que usaste mientras no salgas del sistema.
- **Cambiar de sucursal con un pedido sin cobrar** pregunta antes; si aceptas, el pedido se quita de la pantalla.
- **El administrador** tiene una opción más: **"Ambas sucursales"**. Sirve para los **reportes** (Resumen, Ventas hechas, Cortes de caja, Menú). Para Vender, Mesas, Inventario y abrir caja hay que elegir una sucursal; la pantalla lo pide con botones grandes.
- **Ventas hechas** y **Cortes de caja** muestran una columna **Sucursal**; el archivo de Excel también la trae y su nombre dice de cuál es (por ejemplo `Ventas_El_Mismisimo_VIP_entre_amigos_2026-10-26.csv`).
- **El ticket y la cuenta de la mesa** muestran **"Sucursal: …"** (los demás datos son los mismos en las dos).
- **Personal:** al agregar un vendedor se marcan **las sucursales donde trabaja** (una o varias). Un vendedor **solo ve y usa** las que le asignaste: no puede entrar a la otra ni cambiando nada en el navegador (el servidor lo rechaza). Con el botón **🏬 Sucursales** de cada vendedor se cambian después. Si tiene la caja abierta en una, no se le puede quitar hasta que la cierre. El vendedor con **una sola** sucursal no ve selector, solo una etiqueta con el nombre.
- **Ajustes → 🏬 Sucursales:** ahí se **agrega** una sucursal nueva y se **cambia el nombre** de las que hay. Una sucursal nueva empieza **sin existencias, sin mesas y sin personal**: agrégale sus mesas (en 🪑 Mesas), registra su mercadería (en 📦 Inventario → "Llegó mercadería") y asígnale vendedores.
- Una persona puede tener **su caja abierta en cada sucursal al mismo tiempo** (una por sucursal).

**Para que lo sepas**

- **No se pueden borrar sucursales**, solo agregarlas y cambiarles el nombre (así no se pierde ninguna venta).
- **Quitar un insumo** del inventario lo quita de **todas** las sucursales (la pantalla lo avisa). **Cambiar su nombre, costo o proveedor** también es para todas; **"avisar cuando quede menos de"** es de cada sucursal.
- **"Borrar los datos de prueba"** (Ajustes) borra de **todas** las sucursales; úsalo solo una vez, antes de empezar de verdad.
- Al actualizar, la base de datos se **convierte sola la primera vez** (una sola vez; no pierde nada). **Aun así, copia la carpeta `data` antes de actualizar** (sección "Lo que TIENES que hacer").
- Un error que se encontró de paso y quedó corregido: al **reiniciar el servidor se volvían a escribir NIT, teléfono y dirección de ejemplo** y reaparecían las cervezas de ejemplo que habías renombrado o quitado. Ya no pasa.

## 10. Barra de arriba más libre (nuevo)

Se **quitaron los botones "A Letra" y "❓ Ayuda"** de la barra de arriba: ocupaban espacio y casi no se usaban. También se quitó el cuadro de ayuda que abría el segundo.

- Si en algún aparato ya se había elegido letra **grande** o **muy grande**, **se conserva** tal cual (queda guardada en ese aparato y ya no hay botón para cambiarla).
- Con ese espacio libre, el selector de sucursal cabe sin apretarse. ("Ocultar barra" se quitó después, en la sección 24.)

## 11. En la computadora todo se ve más chico (nuevo)

Pediste que la página no se viera tan grande, que con el zoom del navegador al 80 % se sentía más cómoda. Ahora **en computadora (con mouse) la página ya sale así por sí sola**, equivalente a ese 80 %:

- Se ven **más productos a la vez** (6 por fila en una pantalla Full HD), cabe más del resumen y de las tablas sin bajar, y la barra de arriba queda más despejada.
- **Tabletas y celulares NO cambian**: ahí se usa el dedo y los botones tienen que seguir grandes. Tampoco cambia al **imprimir** el ticket.
- Solo aplica a pantallas de 1100 px de ancho o más con mouse. Una tableta con teclado y mouse conectados se sigue tratando como tableta si el sistema la reconoce táctil.
- **Importante:** pon el zoom de tu navegador otra vez en **100 %** (Ctrl + 0). Si lo dejas en 80 %, vas a ver todo al 64 % y se verá diminuto.
- Si quieres más chico o más grande, es un solo número en `public/css/simple.css`, al final del archivo (sección 36): `--ui-zoom: 0.8` (0.7 = más chico, 0.9 = más grande).
- Nota técnica: se hace con la propiedad `zoom` de CSS (la usan Chrome, Edge, Safari y Firefox desde la versión 126). En un navegador muy viejo que no la tenga, la página se ve como antes.

## 12. La imagen de cada bebida llena el recuadro de arriba y el nombre va encima (nuevo)

Pediste que la imagen fuera lo más grande y que las letras quedaran encima de la imagen. Ahora, en "Vender":

- **Computadora y tableta de pie:** la imagen ocupa **todo el ancho de la tarjeta, de borde a borde**, y el **nombre queda escrito encima** (con una sombra oscura abajo para que se lea sobre cualquier foto). Abajo van la descripción corta, el precio y lo que queda. La etiqueta (Nacional, Especial, Favorita...) queda en la esquina de arriba de la imagen.
- **Pantalla bajita** (computadora con la ventana baja): la imagen es un poco menos alta para que sigan viéndose dos filas de bebidas.
- **Celular y tableta/celular acostados:** la imagen va a la **izquierda, de arriba a abajo de la tarjeta**, y el nombre, el precio y lo que queda a la derecha (ahí se oculta la descripción larga y el letrero "Toca para agregar"). Así siguen cabiendo varias bebidas.
- Sirve igual para los dibujos de las bebidas y para las fotos reales. Los dibujos ya no tienen las esquinas redondeadas (para que llenen el recuadro).
- Un nombre muy largo se corta en 3 líneas con "..." sobre la imagen (en celular, en 4).
- Si la quieres más alta o más baja: es `aspect-ratio` del recuadro de la imagen al principio de la sección 37 de `public/css/simple.css`.

## 13. Barra de arriba del administrador en tableta, más ordenada (nuevo)

En la tablet la barra de pestañas se veía desordenada: las 9 pestañas se partían en dos filas disparejas y los botones (sucursal, caja, mostrar barra, pantalla completa, salir) quedaban sueltos en una tercera fila. Ahora:

- **Tableta acostada (de 901 a 1300 px de ancho):** las 9 pestañas van en **una sola fila**, todas del mismo ancho, con el ícono arriba y el nombre abajo. Los botones van en **su propia fila**, a la derecha, todos de la misma altura. La barra pasó de 3 filas a 2 (en una tablet de 1024 px de ancho bajó de 176 a 136 px de alto, y tanto con la barra de arriba oculta como visible).
- **Tableta de pie (de 701 a 900 px):** las pestañas se reparten parejas en dos filas (5 y 4), todas del mismo ancho, y los botones en su fila.
- **Computadora y celular, y la barra del vendedor, no cambian.**
- Al ver la **cuenta de una mesa en un celular muy angosto (320 px) con letra muy grande**, el botón "✕ Quitar" se salía del cuadro por unos pixeles; ya cabe.

## 14. El marinero y "Gallo de vidrio o de lata" (nuevo)

**Marinero = 1 litro de clamato (jugo de tomate).** Se vende de tres formas y el inventario baja según lo que se vende. Cuando una michelada lleva cerveza, **el cliente elige si la quiere de vidrio o de lata** y baja la que eligió.

**Tres productos nuevos** (aparecen solos, una sola vez, al arrancar con la versión nueva, en la sección "Micheladas & Preparados"):

| Producto | Precio | Qué baja del inventario al cobrar |
|---|---|---|
| Marinero (1 litro) | Q 10 | 1 L de clamato |
| Jugo Preparado Completo (1 litro) | Q 15 | 1 L de clamato + 0.04 L de limón + 0.03 L de salsas negras |
| Michelada con Medio Marinero | Q 15 | 0.5 L de clamato + 0.02 L de limón + 0.015 L de salsas negras + **1 Gallo, de vidrio o de lata (a elección)** |

- Si ya tienes cualquier producto con "marinero" en el nombre, **no se agrega ninguno** (se entiende que ya los hiciste tú). Lo que no quieras: Menú → "Pausar" o "Quitar". Precios y cantidades: Menú → "Cambiar".
- Se crea el insumo **"Cerveza Gallo 350ml Lata"** (si no existía) para llevar su inventario aparte del Gallo de vidrio. En tu base en uso **empieza en 0**: regístralo con "Llegó mercadería" en Inventario. (En una instalación nueva trae 48 de ejemplo.)
- No se toca ningún producto, precio ni inventario que ya tenías.

**Al vender:**
- En "Vender", al tocar la michelada sale **"¿Cuál quiere el cliente?"** con dos botones grandes: **Gallo de vidrio** y **Gallo de lata**, cada uno con cuánto queda. En la tarjeta dice "Eliges al tocar". Al elegir, se agrega al pedido; con Escape o la ✕ se cierra sin agregar nada.
- También se elige dentro de "✏️ Elegir escarchado y salsa" (arriba del escarchado, sin ninguna marcada de antemano; si no eliges, avisa y no agrega).
- Funciona igual al pedir **en una mesa**. En el pedido, la comanda, la cuenta y el ticket se lee, por ejemplo, **"Gallo de lata · Escarchado: Chamoy con Tajín"**.
- La misma bebida con distinta cerveza va en líneas separadas. El inventario baja **al cobrar** (como siempre), en la sucursal donde se vende.

**Para cualquier otro producto** (por ejemplo una cerveza que viene en vidrio y en lata): Menú → "Cambiar" → "Más opciones" → **"🍺 Que el cliente elija"** → "➕ Agregar opción". Cada opción lleva un nombre, qué insumo baja y cuánto (hasta 6 por producto). Cuestan lo mismo. Si el producto "se vende tal cual", la opción **reemplaza** al insumo de arriba (no baja los dos). En la lista del Menú se ve "🍺 Elige: Gallo de vidrio / Gallo de lata". El costo guardado del producto suma la opción más cara (para no inflar la ganancia).

**Reglas que cuida el servidor:** si el producto tiene opciones y no se eligió ninguna, no se cobra (mensaje claro); una opción de otro producto se rechaza; una sola opción no se acepta (no habría qué elegir); una cuenta de mesa abierta que ya tenía "Gallo de lata" se cobra bien aunque cambies el nombre de la opción (se conserva su número); si quitas las opciones de un producto con una cuenta abierta, se cobra igual y solo no se descuenta esa cerveza; no se puede borrar un insumo que usa una opción; el vendedor solo ve el nombre y cuánto queda de cada opción (nunca el insumo, la cantidad ni el costo).

**Las carretas son sucursales nuevas.** No hizo falta programar nada: Ajustes → Sucursales → agregar. Misma carta y mismos precios; existencias, mesas, caja y ventas aparte. Para cada carreta: (1) agrégala, (2) en Personal marca qué vendedores trabajan ahí, (3) con la carreta elegida arriba, registra su mercadería inicial en Inventario (clamato, limón, salsas, Gallo de vidrio y de lata), (4) abre caja y vende. Todo se hace al momento: no hay "preparado de antes", se descuenta cuando se vende.

**Corrección que salió al probar:** en una mesa, si agregabas una bebida igual a otra que **ya estaba guardada en la cuenta**, la nueva se sumaba a la línea vieja en pantalla y **no se guardaba** (la cuenta quedaba con una de menos). Ahora lo nuevo siempre va en una línea aparte.

## 15. Subirlo a Hostinger sin perder los datos (nuevo)

La base de datos es **un solo archivo** (`mismisimo.db`, SQLite) y antes se guardaba dentro de la carpeta del proyecto (`data`). En Hostinger (Node.js Web App) **cada vez que publicas una versión se crea una carpeta nueva** (`.../domains/<tu-dominio>/hbuilds/...`), así que una base guardada ahí se habría perdido al actualizar. Ahora:

- Si existe la variable de entorno **`DATA_DIR`**, la base se guarda en esa carpeta.
- Si no, y el sistema detecta que corre en Hostinger (`.../domains/<dominio>/hbuilds/...`), la guarda **al lado**, en **`.../domains/<tu-dominio>/mismisimo-data`**, que no se borra al publicar.
- En cualquier otra parte (tu computadora) sigue en la carpeta `data`, igual que antes.
- Si la carpeta elegida no se puede usar, el sistema arranca igual con `data` y **avisa fuerte** en el registro (en ese caso los datos sí podrían perderse al publicar).
- Al iniciar escribe en el registro `Los datos del negocio se guardan en: ...`, para que puedas ver dónde quedó.
- La clave secreta de las sesiones (`.jwt_secret`) también va a esa carpeta si no defines `JWT_SECRET`.
- `package.json` trae un `build` vacío (no hay nada que compilar) por si Hostinger pide uno.

Probado simulando la estructura de carpetas de Hostinger: la base queda fuera de la carpeta de publicación, una 2.ª publicación en otra carpeta usa **la misma** base (con los mismos 23 productos), `DATA_DIR` manda sobre todo, y con una ruta inválida arranca con aviso. **No se probó en un Hostinger real**: antes de usarlo de verdad, haz la prueba de "cambiar un dato, volver a publicar y ver que sigue" (está en la guía que te di).

## 16. Anular una venta por error o inconveniente (nuevo)

**Qué hace:** si se cobró algo por error (producto equivocado, cobro duplicado, el cliente ya no la quiso), se **anula** la venta. La venta **no se borra**: queda marcada **ANULADA**, con **quién** la anuló, **cuándo** y **por qué**.

- **Dónde se anula:**
  - Justo después de cobrar: en el ticket aparece **🚫 Anular esta venta**.
  - Vendedor: **Mi caja → 🧾 Ver mis ventas (o anular una por error)**: lista de las ventas de su caja abierta, cada una con **Anular**.
  - Administrador: **Ventas hechas**: cada venta válida tiene **🚫 Anular**; las anuladas salen tachadas, con la etiqueta ANULADA y el motivo. Hay un filtro **Estado** (todas / solo válidas / solo anuladas).
- **Motivo obligatorio** (mínimo 3 letras): hay botones rápidos (Error al cobrar, El cliente ya no la quiso, Producto equivocado, Cobro duplicado) o se escribe otro.
- **Quién puede:** el administrador, cualquier venta (también de una caja ya cerrada). El **vendedor solo sus propias ventas de su caja abierta**; si la caja ya se cerró, debe pedírselo al administrador. El servidor lo revisa siempre (no basta con esconder el botón).
- **Inventario:** vuelve **exactamente** lo que bajó esa venta (se leen los movimientos de esa venta), aunque después hayas cambiado la receta, una presentación (vidrio / lata) o un precio. En el historial de inventario queda la devolución con la palabra **ANULACIÓN**.
- **Ya no cuenta** en: ventas de hoy y del mes, ganancia, lo más vendido, "cómo pagan los clientes", resumen de la caja ni el **corte de caja** (el efectivo esperado se calcula solo con ventas válidas). El **Resumen** muestra aparte cuántas anuladas hubo hoy y por cuánto, para que el administrador las vea.
- **Caja ya cerrada** (solo el administrador): baja el conteo y monto de ventas de ese corte, **pero no reescribe el efectivo contado ni la diferencia**; deja anotado en el corte qué venta se anuló.
- **No se puede anular dos veces** (ni tocando el botón muy rápido).
- **Excel:** la lista trae las columnas nuevas *Estado, Anulada el, Anulada por, Motivo de la anulación*.
- El ticket de una venta anulada se puede volver a abrir y dice **VENTA ANULADA**, el motivo y quién la anuló.

## 17. Tableta: una sola barra delgada y el pedido siempre se ve (nuevo)

Queja vista en los videos: en una tableta, la barra del navegador + la barra del sistema + las pestañas dejaban la **lista de lo pedido en una rayita de 27 píxeles** y el botón de cobrar se salía de la pantalla.

- **Tabletas táctiles con poca altura** (acostadas, hasta ~860 px de alto): la barra de arriba se esconde y queda **una sola barra de 3 rem** con el botón **☰ (nombre de la pantalla) ▾**, que despliega las pestañas; a la derecha quedan sucursal, caja, pantalla completa y Salir. Se cierra al elegir una pantalla, al tocar fuera o con Escape. En computadora (mouse) y en tabletas de pie todo sigue como antes.
- **El pedido** (panel de la derecha) se compactó en pantallas bajitas: sin las filas de Subtotal y Descuento, el recuadro de la mesa en una línea ("Mesa 1 · Juan" y **Quitar mesa**), lo ya guardado en la cuenta con nombre y precio arriba, totales y botones más bajos, y la **lista tiene un alto mínimo propio** (con el panel desplazable si hace falta). Medido: en 1024×620 la lista pasó de 27 px a **190 px**, y el botón **COBRAR** queda siempre dentro de la pantalla.

## 18. Sin descuentos a mano; promociones como productos (nuevo)

- **Se quitó el campo "Descuento en Q".** El servidor además **ignora** cualquier descuento que llegue por fuera, así que no hay forma de rebajar un cobro a mano. Las ventas viejas con descuento se siguen viendo igual.
- **Cubetazos** (al arrancar con esta versión, una sola vez, en la sección de cervezas): **Cubetazo de Gallo (6 cervezas)**, **Cubetazo Mixto (3 Gallo + 3 Gallo Light)** y **Cubetazo de Corona (6 cervezas)**. Cada uno baja del inventario las 6 cervezas. Si ya tienes un producto con "cubetazo" en el nombre, no agrega ninguno. Si no existía el insumo **Gallo Light** (o Corona), lo crea en 0 existencias.
- **El precio inicial es lo que costarían las 6 cervezas sueltas** (sin promoción). **Ponle tu precio de promoción en Menú.**

## 19. Tu lista de productos ya está cargada (nuevo)

Al arrancar con esta versión (una sola vez) se agregan al **Menú** los productos de la lista que mandaste, con el **inventario en 0**:

- **Cervezas Frías:** Gallo light bot 12 oz, Gallo lata 12 oz, Coronita, Busch lata, Monte Carlo bot 12 oz, Tecate, Pacifico y **Cubetazo de Gallo Light (6 cervezas)**.
- **Micheladas & Preparados:** Miche gallo lata, Miche corona, Miche coronita, Miche mineral y Marinero bot 250 ml.
- **Tragos & Licores:** Bacardi vip, Jagger onza (se cuenta en onzas), Venado XI 1/2 bot, Tequila Santo bot, Octavo variedad, Mezcal, Cubata normal, Cubata largas y Vodka Azulito.
- **Refrescos & Sin Alcohol:** Adrenalina, Red Bull, Jugo V8 lata, Coca lata, Sprite, Pepsitas, Gaseosa lata, Cimarrona, Agua pura bot, Gatorade, Gatorade pequeño, Power, Hidra, Vitafer y Azul sin licor.
- **Botanas & Snacks:** Lays, Sopa Laky variedad, Sopa sin preparar, Alitas Pío Lindo, Chiclets y Bon Bon.
- **Cigarros** (sección nueva, con su propio dibujo): Cigarros This sueltos, Cigarros This, Modern suelto y Modern.

**Lo que NO se repitió** porque ya lo vendías: *Gallo bot 12 oz* y *Corona bot 12 oz* (ya están como "Cerveza Gallo 350ml Bien Fría" y "Corona Extra 355ml"), *Coca vidrio* ("Coca-Cola 500ml Vidrio"), *Marinero preparado* ("Jugo Preparado Completo (1 litro)") y *GALLO CUBETAZO* ("Cubetazo de Gallo (6 cervezas)"). Si prefieres los nombres cortos de tu lista, cámbiales el nombre en Menú → ✏️ Cambiar.

**Cómo quedan:**
- **Sin precio y pausados.** No mandaste precios, así que todo entra en **Q0 y pausado**: no aparece en "Vender" y no se puede vender por error en Q0. Para ponerles precio hay un botón nuevo en **Menú → 💲 Poner precios (número)**: una lista corta con un cuadrito de precio por producto (Enter pasa al siguiente). Al guardar, **los que tengan precio se activan solos**; los que dejes en blanco siguen pausados. El botón desaparece cuando ya no queda ninguno sin precio. Solo sirve para productos en Q0 (no cambia precios que ya pusiste).
- **Inventario en 0** en las dos sucursales, un insumo por producto (se llenan con **Llegó mercadería**). Las existencias de lo que ya tenías (Gallo, Gallo light, Gallo lata, Corona, Coca) no se tocan: se reutilizan los mismos insumos, no se duplican.
- **Costos en 0** (se desconocen): pon el costo de cada insumo en Inventario para que la ganancia salga bien.
- **Recetas:** los cubetazos y las micheladas por cerveza (Miche gallo lata, Miche corona, Miche coronita) bajan **la cerveza** del inventario y nada más, porque no se sabe qué más lleva cada una (clamato, limón, salsas...); agrégalo en Menú → ✏️ Cambiar → Más opciones. Los tragos y preparados (Cubata, Mezcal, Vodka Azulito, Azul sin licor, Miche mineral, Alitas) **no bajan inventario** hasta que les pongas receta.
- **"Gallo lata 12 oz":** en tu lista decía "12 pz"; lo puse como **una lata** (12 oz). Si en realidad es un paquete de 12, avísame y se cambia.
- **Si vendes antes de registrar la mercadería**, el sistema deja vender y el inventario queda en negativo (por ejemplo -2) hasta que registres la compra; al registrarla, queda en lo que de verdad hay.
- **Avisos del Resumen:** el cuadro "insumos por agotarse" ahora solo avisa de los insumos a los que **sí les pusiste un mínimo**, para que no se llene con los 36 insumos nuevos en 0.

## 20. El Menú queda solo con tu lista (nuevo)

Pediste dejar únicamente los productos de tu lista. Al arrancar con esta versión (una sola vez):

- **Se quitan los 17 productos de ejemplo** que traía el sistema: Michelada Clásica, Clamato Preparado, Gomichela Loca, Mangochela Tropical, Tarro Barril Preparado, Victoria, Modelo Especial, Negra Modelo, Michelob Ultra, Squirt, Peñafiel Agua Mineral, Rusa Refrescante, Shot Tequila, Cuba Libre Bacardí, Cacahuates Preparados, Cerveza Cabro y Michelada con Gallo Orgullo. **Solo se quitan los que tienen exactamente ese nombre de ejemplo**: lo que tú hayas creado o renombrado no se toca.
- **Se renombran como en tu lista** (mismo precio, receta e historial) los 4 que ya existían: *Cerveza Gallo 350ml Bien Fría* → **Gallo bot 12 oz**, *Corona Extra 355ml* → **Corona bot 12 oz**, *Coca-Cola 500ml Vidrio* → **Coca vidrio**, *Jugo Preparado Completo (1 litro)* → **Marinero preparado**. Estos 4 traían el precio del ejemplo (Gallo Q18, Corona Q45, Coca Q30, Marinero preparado Q15); en la sección 22 reciben los precios reales de tu libreta (menos Marinero preparado, que sigue en Q15: **revísalo**).
- **Si un producto de ejemplo ya tenía ventas o cuentas de mesa**, no se borra de la base de datos (se perdería la historia de esas ventas): se **oculta** del Menú y de "Vender", y sus ventas siguen apareciendo en Ventas hechas, Resumen y cortes igual que antes.
- **El inventario no se toca.** Los insumos de ejemplo (Victoria, Modelo, Barril, Squirt, etc.) y sus existencias siguen en Inventario; quítalos tú ahí si no los usas (se pueden quitar si ningún producto los usa).
- **Se dejaron 4 que tú pediste antes y no estaban en la muestra:** *Cubetazo Mixto*, *Cubetazo de Corona*, *Marinero (1 litro)* y *Michelada con Medio Marinero* (con Gallo de vidrio o de lata). El *Cubetazo de Gallo* sí está en tu lista (GALLO CUBETAZO). Si no quieres alguno de los 4, quítalo en Menú con 🗑️ Quitar.
- **"🗑️ Quitar" ahora quita de verdad del Menú** un producto que ya se vendió: antes quedaba en la lista como "Pausado" para siempre; ahora se oculta (las ventas se conservan). Quitar una sección o un insumo que solo usaban productos ocultos también funciona.
- Para ver el menú de ejemplo (demostraciones o pruebas) se arranca con la variable `MANTENER_MENU_EJEMPLO=1`; sin ella el sistema siempre lo limpia.

## 21. Tus 7 sucursales (nuevo)

Al arrancar con esta versión (una sola vez) las sucursales quedan **exactamente como las mandaste**, en este orden: **Cruce, Predio, Pista, Estadio, VIP entre amigos, Queens Abajo y Queens Arriba.**

- **"VIP entre amigos" es la misma de antes**: conserva todo lo que ya tenía (ventas, cajas, existencias).
- Las **6 nuevas** nacen con **inventario en 0** y **sin mesas**; comparten el mismo menú y los mismos precios.
- **"El Mismísimo"** era el nombre del negocio, no una sucursal, así que queda **oculta**. **No se borra nada**: sus ventas, cajas, mesas y existencias se conservan. Si tuviera una **caja abierta o una mesa con cuenta**, se deja visible para que no se pierda ese dinero: ciérrala y luego ocúltala desde Ajustes.
- Los **vendedores** que se quedarían sin ninguna sucursal pasan a **Cruce** (la primera). Cámbialo en **Personal → 🏬 Sucursales** (ahí marcas en cuáles trabaja cada persona).
- **Ajustes → Sucursales** ahora tiene **🙈 Ocultar** y **👁️ Mostrar** (no borra nada; se puede volver a mostrar). No deja ocultar una sucursal con la **caja abierta**, con una **mesa con cuenta** ni la **última visible**, y avisa si algún vendedor se queda sin sucursal para entrar. Lo oculto no sale en el selector de arriba ni en los reportes de "Todas las sucursales".

## 22. Precios de tu libreta y lo que explicaste en el video (nuevo)

Con la libreta "Inventarios. Estadio" se cargaron **precio de venta** y **costo** (una sola vez; **solo en productos que todavía estaban en Q0 o con el precio de ejemplo**: lo que ya hayas cambiado tú no se pisa, y los productos pasan a verse en "Vender"):

| Producto | Venta | Costo |
|---|---|---|
| Gallo bot 12 oz / Gallo light bot 12 oz | Q10 | Q5.94 |
| Corona bot 12 oz (tu "Corona grande") | Q15 | Q7.00 |
| Coronita | Q7.50 | Q4.45 |
| Busch lata | Q7.50 | Q4.04 |
| Monte Carlo bot 12 oz | Q20 | Q10.20 |
| Gaseosa lata (tu "Aguas lata") | Q7 | Q3.21 |
| Coca lata / Coca vidrio | Q7 | Q4.58 / Q3.33 |
| Cimarrona | Q15 | Q5.00 |
| Miche gallo lata / **Miche light** / **Miche gallo vidrio** | Q25 | Q13.52 / Q12.21 / Q12.21 |
| **Michelob** y **Smirnoff** (no estaban en tu lista, sí en la libreta) | Q20 | Q8.12 / (sin costo) |

**Lo que baja del inventario (lo que explicaste en el video):**
- **Cimarrona** → **una Agua Mineral** completa (insumo nuevo "Agua Mineral"; el insumo "Cimarrona" vacío que se había creado se quitó).
- **Miche gallo lata** → **medio marinero** (0.5 L de clamato) **+ una Gallo lata**.
- **Miche light** → **medio marinero + una Gallo Light**.
- **Miche gallo vidrio** → **medio marinero + una Gallo de vidrio**.

**Costos que no estaban escritos y salieron de tus números** (revísalos en Inventario): el medio marinero cuesta Q6.27 (12.21 − 5.94), o sea **Q12.54 el litro de clamato**, y la **Gallo lata** Q7.25 (13.52 − 6.27). Con eso los tres micheladas salen justo en Q13.52, Q12.21 y Q12.21 como en tu libreta. Los costos y ganancias de los productos que usan clamato (Marinero, Marinero preparado, Michelada con Medio Marinero) se recalcularon.

**Lo que NO se aplicó / hay que confirmar:**
- La columna **"Precio cliente"** (9.166, 10, 15) no se aplicó: no sé qué significa. (Si es el precio por cerveza dentro de un cubetazo: 55 ÷ 6 = 9.166, o sea cubetazo de Gallo a Q55; dime y lo pongo.)
- Los **3 cubetazos** traían un precio de ejemplo (6 cervezas × el precio de ejemplo: Q108 y Q270): como la cerveza ya cuesta Q10 y Q15, quedaron **pausados en Q0** hasta que me digas su precio (o ponlo en Menú → 💲 Poner precios).
- **"Aguas lata"** lo tomé como **Gaseosa lata**. Si es otra cosa, avísame.
- **Smirnoff**: en la libreta el costo se lee "10.?"; quedó **sin costo**. Michelob y Smirnoff se pueden quitar en Menú si no los quieres.
- **Gallo lata 12 oz** no tiene precio de venta en la libreta (solo se usa en la michelada); sigue pausada.
- **Miche corona, Miche coronita y Miche mineral** no tienen "medio marinero" en su receta (el video explicó solo las de Gallo). Si llevan, se agrega en Menú → ✏️ Cambiar → Más opciones, o me avisas.
- **Michelada con Medio Marinero** (Q15, con Gallo de vidrio o lata a elegir) sigue ahí de antes; ahora hay micheladas aparte a Q25. Si ya no la quieres, quítala en Menú.

## 23. Vender más simple, como pidió el cliente (nuevo)

El cliente quiere una pantalla de venta **más simple**, como la foto que mandó. Primer paso, solo en **Vender**:

- **Cada tarjeta es foto, nombre y precio.** Se quitaron la descripción, el aviso de existencias ("Quedan 5", "¡Se acabó!"), el "Toca para agregar" y las etiquetas. El nombre completo sigue disponible para el lector de pantalla.
- **Un número redondo** en la esquina de la tarjeta dice cuántos lleva ya el pedido, y la tarjeta se marca con un borde. Sube y baja con los toques, con el **+** y el **−** del pedido, y se borra al **Vaciar** o **Cobrar**. Sigue ahí si buscas o cambias de sección.
- **Las micheladas** conservan su botoncito redondo con el lápiz (escarchado y salsa) y las que tienen vidrio o lata siguen preguntando al tocar.
- **El pedido** quita con una **✕** chica en vez del botón "Quitar".
- **Las existencias bajas se siguen viendo** en Inventario y en el Resumen; solo salen de las tarjetas. Nunca se bloqueaba una venta por existencias en cero, así que no cambia nada al cobrar.
- Si quieren de vuelta el aviso de "Se acabó" en las tarjetas, es un cambio chico.

## 24. Barra lateral, fondo claro y pantallas más simples (nuevo)

El cliente respondió que **sí** quiere el fondo claro, la barra lateral y simplificar las demás pantallas, pensando sobre todo en que **sea fácil para el vendedor**. Todo se hizo sin tocar el servidor ni la base de datos (solo la pantalla).

**Barra lateral de íconos (a la izquierda)**
- Las pestañas de arriba pasaron a una **columna de íconos con su nombre** debajo, como en la foto. El vendedor ve **Vender, Mesas y Mi caja**; el administrador ve además Resumen, Inventario, Menú, Ventas hechas, Cortes de caja, Personal y Ajustes.
- Arriba queda una **barra delgada** con el logo, la sucursal, el estado de la caja, el nombre y "Salir". **Siempre se ve**: se quitaron el botón **"Ocultar barra"** y el menú **☰** de las tabletas (ya no hacen falta; las secciones 10, 13 y 17 que los mencionan quedan reemplazadas por esta).
- En celular la barra lateral es más angosta y el selector de sucursal ocupa su propia fila.
- En tableta de pie y celular, el pedido sigue subiendo desde abajo, a la derecha de la barra.

**Fondo claro**
- El sistema abre con **fondo claro** (blanco y gris suave, con el ámbar de siempre para los botones y los precios).
- Abajo de la barra lateral hay un botón **🌙 Oscuro / ☀️ Claro**. **Se elige en cada aparato** y se recuerda ahí: si el cajero lo prefiere oscuro en su tableta, queda oscuro en esa tableta y no cambia las demás.
- Se cuidó que los textos, las etiquetas de mesa, los avisos, el cobro, las gráficas y todos los cuadros emergentes se lean bien en los dos fondos.

**Mesas** – cada mesa es una tarjeta con su **nombre, un estado en palabras (🟢 Libre / 🟠 Con cuenta / 🟡 Pidieron la cuenta), el total en grande, a nombre de quién está, cuántos minutos lleva y cuántos productos**. La mesa libre trae un solo botón grande, **ABRIR CUENTA**; la que tiene cuenta trae **Ver pedido** y **Cobrar**. Los filtros de arriba muestran **cuántas mesas hay en cada estado** y hay un letrero con **cuánto falta por cobrar**. Se quitó el botón de "pre-cuenta" de la tarjeta (la cuenta se imprime desde adentro de la mesa). **Quitar mesa** (solo administrador) quedó discreto, para que no se toque por error junto a "Abrir cuenta".

**Inventario** – una lista limpia: **nombre, cantidad que hay, estado (con color si queda poco) y qué hacer**, con un **buscador** y el filtro **"Se está acabando"** con su número. Los datos que casi nadie mira (avisar si baja de, costo, valor total, proveedor y el valor del inventario) se ven al tocar **"📊 Ver costos y más"**. "Agregar un insumo", "Llegó mercadería" y "Se perdió o se dañó algo" siguen arriba, igual que antes.

**Menú** – **buscador** y filtros **Todos / A la venta / Pausados** con su número; los productos siguen agrupados por sección y cada fila trae foto, nombre, precio y los botones **Cambiar, Pausar y Quitar**. Arriba: "Secciones del menú", "Poner precios" (mientras haya productos en Q0) y "Agregar un producto". El cuadro "Cambiar" (receta, opciones, foto, costos) es el mismo de antes.

**Resumen** – arriba los números del día (**ventas de hoy, ganancia aproximada y ventas del mes**), luego **"Se está acabando"** y **"Lo más vendido"**. Las **gráficas** (ventas hora por hora y cómo pagan los clientes) quedan dentro de un cuadro que se abre solo si se quiere verlas.

**Qué tiene que saber el dueño**
- Si el cliente prefiere el fondo oscuro de antes, no hay que cambiar nada: se toca el botón de la barra lateral en cada aparato (o me avisas y lo dejo oscuro de fábrica).
- Los avisos de existencias "Quedan 5 / Se acabó" ya no salen en las tarjetas de Vender (sección 23), pero **siguen en Inventario y Resumen**. Si los quieren de vuelta en las tarjetas, es un cambio chico.
- No hay información que se pierda ni base de datos que cambiar: es solo la pantalla.

## 25. Segunda hoja de precios ("Inventario.") (nuevo)

El cliente mandó una **segunda foto de la libreta** (Producto / Precio costo / Precio venta). Se cargó con una conversión nueva (versión 8 de la base de datos) que corre **sola, una vez**, al arrancar con esta versión. **No pisa lo que ya cambiaste:** a un producto que ya existe solo se le pone precio y costo si todavía estaba en Q 0.

| En la libreta | En el sistema | Venta | Costo |
|---|---|---|---|
| Cigarros This (unidad) | Cigarros This sueltos | Q 2 | Q 0.45 |
| Cigarros This "3x5" | **Nuevo:** Cigarros This (3 por Q5) (lleva 3 sueltos) | Q 5 | Q 1.35 |
| Cigarros Modern (unidad) | Modern suelto | Q 1 | Q 0.45 |
| VB | **Nuevo:** VB (en Cervezas Frías, con su propio insumo) | Q 5 | Q 3.08 |
| Alitas, chapas | Alitas Pío Lindo | Q 70 | Q 40.12 |
| Papas | Lays | Q 20 | Q 7.12 |
| Sopa preparada | Sopa Laky variedad | Q 15 | Q 6.16 |
| Sopa s/con agua | Sopa sin preparar | Q 10 | Q 4.66 |
| Octavos | Octavo variedad | Q 14 | Q 8.00 |
| Azulitos c/alcohol | Vodka Azulito | Q 25 | Q 11.11 |
| Azulitos s/alcohol | Azul sin licor | Q 20 | Q 9.20 |
| Vitafer | Vitafer | Q 20 | Q 6.00 |
| Marinero | Marinero (1 litro) | Q 10 | Q 4.70 |
| Marinero preparado | Marinero preparado | Q 15 | Q 8.52 |
| Michel Corona | Miche corona | Q 30 | Q 13.17 |

**Cómo se hizo para que los costos salgan como en la libreta**
- **El clamato pasa a Q 4.70 el litro** (antes venía con un costo de ejemplo de Q 12.54 o Q 42): con eso el Marinero cuesta Q 4.70.
- **El aderezo del marinero preparado** (limón + salsas) se ajustó para que cueste Q 3.82 y el **Marinero preparado salga en Q 8.52**, igual que la libreta.
- **Miche corona** lleva medio marinero + aderezo + una Corona (Q 13.17). Las micheladas de Gallo (lata, light y vidrio) ahora **también llevan el aderezo**; les sale Q 12.11 / 12.11 / 13.42 contra Q 12.21 / 12.21 / 13.52 de la libreta (**10 centavos de diferencia**, por el redondeo de los insumos).
- Alitas, Vodka Azulito y Azul sin licor ahora **se venden tal cual con su propio insumo** (empiezan en 0 en todas las sucursales; regístralos en "Llegó mercadería"). Las **existencias de lo que ya tenías no se tocaron**.
- Lo que no traía precio sigue **pausado en Q 0**: cajetillas de Cigarros This y Modern, Miche coronita y Miche mineral.

**Lo que supuse (corrígeme si no es así):** Papas = Lays · Alitas, chapas = Alitas Pío Lindo · Sopa preparada = Sopa Laky variedad · Sopa s/con agua = Sopa sin preparar · "3x5" = tres cigarros This por Q 5 · **"VB" no lo conozco**: lo puse como una cerveza en Cervezas Frías.

## 26. Cobro más simple: solo "¿Cómo paga el cliente?" (nuevo)

El cliente dijo que en el cobro **sobra todo** menos con qué va a pagar. Ahora la pantalla de cobro trae solo:
- **El total** en grande.
- **¿Cómo paga el cliente?** con tres botones grandes, uno debajo del otro: **💵 Efectivo, 💳 Tarjeta, 📱 Transferencia** (Efectivo ya viene marcado).
- **← Volver** y el botón verde **✅ COBRAR**.

Se quitaron: "¿Con cuánto paga?", los billetes de Q 10 / 20 / 50 / 100, el teclado numérico, el cambio, el aviso de "cambio enorme" y la nota del pedido.

**Qué tiene que saber el dueño**
- Una venta en efectivo queda guardada **por el total exacto** (recibido = total, cambio = 0). El corte de caja y el Resumen **no cambian**.
- **Ya no hay calculadora de cambio**: el vendedor lo calcula de cabeza. Si lo extrañan, se puede volver a poner como algo opcional (que no estorbe) — avísame.
- Funciona igual al cobrar una mesa. Se ve bien en computadora, tableta, celular, de pie y acostados, con letra normal, grande y muy grande, en fondo claro y oscuro.
- De paso se corrigió que, en el fondo claro, el título **"Cobrar" / "Pedido" del cajón** que sube desde abajo (celular y tableta de pie) no se leía.

## 27. Sin hueco en blanco en el iPhone acostado y barra lateral que no se encima (nuevo)

El cliente mandó un video del **iPhone acostado** con un hueco en blanco entre las bebidas y la barra de abajo (total y COBRAR). Se reprodujo en la prueba y se encontró la causa: la página mide su altura de una forma y la barra de abajo se pega a la pantalla de otra, y en el iPhone con Safari no coinciden (~60 px de diferencia), así que el espacio que se reservaba para la barra "a ojo" quedaba de más.

- **Se mide la barra en vivo** (cuánto tapa de la zona de las bebidas) y se deja exactamente ese espacio, se vuelva a medir al girar el celular, cambiar el tamaño de la letra o abrir/cerrar la barra del navegador. La lista de bebidas llega hasta la barra.
- **La lista de bebidas ya no se reserva el espacio otra vez por dentro:** al llegar al final de la lista, la última fila queda pegada arriba de la barra (antes sobraba casi 80 px).
- **Barra lateral en pantallas bajitas:** los nombres se encimaban ("Ventas hechas" con "Cortes de caja") y el botón **Oscuro / Claro** se montaba sobre los demás. Ahora cada botón mantiene su tamaño, la barra se **desliza** si no caben todos y, en celular acostado, los botones son un poco más compactos para que se vean más.
- No cambia nada del servidor ni de la base de datos: es solo la pantalla.
- Si en su iPhone todavía ven algo raro, que manden otro video o una captura y el modelo del teléfono.

## 28. Ticket y cuenta para la impresora térmica de 58 mm (Vektor VT-POS-58Y) (nuevo)

El cliente usará la **Vektor Tech VT-POS-58Y** (térmica de 58 mm, USB + Bluetooth). Antes el ticket estaba hecho para papel de 80 mm; ahora:

- **Ticket y cuenta a 58 mm:** el papel mide 58 mm pero la térmica imprime unos **48 mm** (de los 5 a los 53 mm). La hoja del ticket mide 46 mm y va **centrada**, para que nada se corte en las orillas. Letra de 10 px, columnas Cant / Descripción / Importe, productos largos en dos renglones.
- **Más corto y claro:** la fecha sale como `28/10/26 18:01`, "Atendido por" pasó a "Cajero", se quitó "POS" del letrero de abajo, y **ya no dice "Importe recibido" ni "Cambio entregado"** (con el cobro simple, sección 26, siempre eran el total y Q 0.00; si una venta vieja sí trae cambio, esas dos líneas siguen apareciendo).
- **El botón "Imprimir ticket" ahora imprime solo el ticket** (una hoja aparte pegada al `<body>`): ya no salen el cuadro de "Venta hecha", fondos grises ni hojas en blanco. El **logo** (blanco sobre negro) se **invierte al imprimir**: letras negras sobre papel blanco, así no gasta papel ni calor.
- **En pantalla** el ticket se ve más grande (vista previa) y al imprimir sale a su tamaño real.

**Cómo conectarla (según el aparato donde se vende)**
- **Computadora con Windows, por USB:** instala el controlador de la impresora, ponle **papel de 58 mm** y **márgenes en 0**, y elígela en el cuadro de imprimir (en "Más opciones": escala 100 %). Es lo más sencillo y lo que se probó (hasta el PDF a 58 mm; no con la impresora real).
- **Android (tableta o celular):** con el cuadro de imprimir del sistema (vista previa) o, mejor, **de una vez con RawBT** (sección 29).
- **iPhone / iPad:** el navegador solo imprime a impresoras AirPrint, y estas térmicas casi nunca lo son. Si el cajero usa iPhone, hay que imprimir desde una computadora o una tableta Android que esté junto a la impresora, o usar un Android (sección 29).

## 29. Imprimir de una vez, sin el cuadro de Android (impresión directa con RawBT) (nuevo)

Antes, al tocar **Imprimir ticket** en la tableta Android salía el cuadro de impresión del sistema (vista previa, elegir impresora y papel y volver a tocar Imprimir). Chrome **no deja saltarse ese cuadro**, así que se agregó otra forma: el sistema arma el ticket en el "idioma" de las térmicas (ESC/POS) y se lo entrega a la app **RawBT**, que lo manda por Bluetooth a la impresora. Sale de una vez.

- **Cada aparato elige cómo imprime.** En el ticket y en la cuenta de mesa hay un renglón **"⚙️ Impresora: con vista previa · cambiar"**. Abre el cuadro **Impresora de este equipo** con dos opciones: **Directa (con RawBT)** y **Con vista previa** (como hasta ahora). La opción de siempre sigue siendo la de arranque: **no cambia nada** para quien no la active. Se guarda en ese aparato (otra tableta, el celular o la compu pueden imprimir distinto).
- **Opciones de la directa:** *Imprimir el logo* (viene marcado), *Imprimir tildes y ñ* (viene **apagado**: sale "Michelada Clasica"; si la impresora las entiende, se marca y salen "Clásica" y "Mismísimo") y **🧪 Imprimir prueba**, que imprime un ticket de muestra con todas las letras para ver cómo sale antes de vender.
- **Qué sale (32 letras por renglón, papel de 58 mm):** logo, nombre y datos del negocio, sucursal, folio, fecha corta, cajero, mesa y cliente, productos con sus notas (los nombres largos pasan a otro renglón), subtotal y descuento, **TOTAL en letra grande**, forma de pago (y recibido / cambio solo si la venta vieja lo trae), mensaje de gracias y papel de sobra para romper. Una venta anulada lleva su letrero. La **cuenta de mesa** sale igual, con "CUENTA DE CONSUMO (Todavía no está pagada)" y "TOTAL A PAGAR".
- **Solo Android.** En computadora o iPhone la opción Directa aparece apagada con su aviso; si de todos modos se pidiera, se abre el cuadro de imprimir normal y se avisa.
- **Preparación (una sola vez por aparato; también está dentro del cuadro, en "¿Cómo la preparo?"):** 1) instalar **RawBT** desde Play Store (gratis); 2) vincular la impresora por Bluetooth en los ajustes de Android; 3) en RawBT: Ajustes → Agregar impresora → Bluetooth → elegirla → **Probar**; 4) en RawBT poner papel de **58 mm**; 5) en el sistema: ⚙️ Impresora → Directa → **Imprimir prueba**.
- **Si algo sale mal:** letras raras → desmarcar "tildes"; logo raro → desmarcar "logo"; no sale nada → revisar RawBT / Bluetooth o volver a "Con vista previa" (sigue funcionando igual). En el video el cuadro de Android decía papel **"80mm Roll"**: en la vista previa hay que elegir **58 mm** (en la directa ya no importa).
- **No se usó Bluetooth directo desde Chrome (Web Bluetooth)** porque solo sirve con impresoras de Bluetooth de bajo consumo y la "BlueTooth Printer_768A" del video parece ser de Bluetooth clásico; RawBT sirve con ambos tipos.
- **No incluye** corte de papel ni abrir cajón. En iPhone / iPad no es posible imprimir directo.

## 30. Fotos de tus productos (nuevo)

Mandaste 13 fotos con su nombre. Las **recorté en cuadrado y las achiqué a 480 px** (unos 55 KB cada una, igual que lo hace la pantalla del Menú) y quedaron guardadas en la carpeta `src/fotos_dueno/`. **No tienes que subirlas una por una:** el sistema las pone solo **la primera vez que arranca la versión nueva** (al subir el ZIP a Hostinger y reiniciar).

| Tu foto | Producto del Menú donde quedó | Estado del producto |
|---|---|---|
| Miche Gallo Lata | Miche gallo lata | a la venta |
| Miche gallo (botella) | Miche gallo vidrio | a la venta |
| Smirnoff | Smirnoff | a la venta |
| Tequila Santo | Tequila Santo bot | pausado (Q 0) |
| 10 ML de Vitafer | Vitafer | a la venta |
| Sopa preparada | Sopa Laky variedad | a la venta |
| JaggerBomb | Jagger onza | pausado (Q 0) |
| Botella de Pacífico en la mano (venía sin nombre) | Pacifico | pausado (Q 0) |
| Miche Coronita | Miche coronita | pausado (Q 0) |
| Cimarrona | Cimarrona | a la venta |
| Bote de Vitafer | **todavía no existe** | espera |
| Miche pacifico | **todavía no existe** | espera |
| Miche Montecarlo | **todavía no existe** | espera |
| Alitas | **no llegó la foto** (mandaste 3 fotos en el segundo grupo y 4 nombres) | — |

- **Reglas:** la foto se pone **solo si el producto no tiene foto** (nunca pisa una que ya hayas puesto); se pone **una sola vez** (si después tocas "🗑️ Quitar foto", no vuelve a aparecer); y los productos **pausados** (Q 0) ya la tienen lista para cuando les pongas precio y salgan en "Vender".
- **Los 3 que no existen** (Bote de Vitafer, Miche pacifico, Miche Montecarlo): crea el producto en **Menú → ➕ Agregar un producto** con ese nombre (no importan mayúsculas, tildes ni espacios) y su foto se pone sola **en el siguiente arranque** del sistema (al reiniciar la aplicación en Hostinger). Si prefieres que yo los cree con su receta, dime el precio.
- **Si una foto quedó en un producto equivocado** (por ejemplo, la de JaggerBomb está en "Jagger onza" y la de 10 ML en "Vitafer"): Menú → **Cambiar** → **Quitar foto** o **Elegir foto**.
- Las fotos se guardan dentro de la base de datos (carpeta `data`), así que entran en tus respaldos como las demás.

## 31. Control estricto de líquidos: botella, compra por botella y conteo (nuevo)

Pediste controlar los líquidos al detalle (por ejemplo un azulito: ¾ de Sprite, media Smirnoff y un shot de vodka). Las recetas ya descontaban lo que lleva cada bebida; lo que faltaba era **medir bien lo que entra** y **comprobar que lo que dice el sistema es lo que hay de verdad**. Ahora son cuatro piezas que se usan juntas:

1. **Receta con decimales.** Cada ingrediente baja del inventario en **su propia medida** (oz, piezas, litros, gramos) y acepta decimales: ¾ = `0.75`, media = `0.5`, un shot = `1.5` oz. Antes el cuadro "Cuesta prepararla" **no se actualizaba** al cambiar un ingrediente o su cantidad (solo al agregar o quitar); ahora se recalcula al momento, y cada renglón muestra **cuánto cuesta ese ingrediente** (ej. `oz · Q 11.24`) y, si viene en botella, **cuánto trae una** (`1 botella = 25.36 oz`).
2. **Botella (o caja, lata, paquete) en cada insumo.** En **Inventario → ✏️ Cambiar** (o al agregar uno) hay un recuadro **"¿Lo compras en botella, caja o paquete?"**: pones el nombre (botella) y **cuánto trae** (750 ml, 1 L, 8.4 oz… en la medida que quieras; el sistema lo pasa a la medida del insumo) y, si quieres, **lo que cuesta cada una**: el costo por onza sale solo (Q 190 ÷ 25.36 oz). En la lista de Inventario aparece debajo de la cantidad: `≈ 3 botellas + 9.5 oz`.
3. **Llegó mercadería por botella.** Si el insumo tiene botella, el cuadro pregunta **"¿Cuántas botellas llegaron?"** y **"Costo de cada botella"**; el sistema suma las onzas (3 botellas = 76.08 oz), recalcula el costo por onza y te muestra antes de guardar cuánto se suma y el total de la compra. Se puede anotar media botella (`0.5`). También puedes anotar "por oz" como antes.
4. **📋 Contar inventario** (botón nuevo en Inventario). Sirve para **cerrar el día** o la semana:
   - Te muestra cada insumo con lo que **debería haber** (`2 botellas + 8 oz`) y tú escribes lo que **contaste**: para lo que viene en botella, **botellas cerradas** + **lo que queda en la abierta** (en oz); para lo demás, la cantidad. Lo que dejes vacío no se cuenta (puedes contar solo los licores con el filtro "💧 Solo licores y líquidos" o buscar por nombre). Los licores y líquidos salen primero.
   - Al escribir ves **al instante** la diferencia de cada uno (`Faltan 30.36 oz (≈ 1.2 botella) · −Q 227.46`, `Sobran 1 pza · +Q 4.00`, `✔ Cuadra`) y abajo el total: **cuánto dinero falta, cuánto sobra y la diferencia**.
   - Dos botones: **💾 Solo anotar** (deja el conteo en el historial y **no cambia** las existencias) y **✅ Anotar y corregir** (pregunta "¿Corregir el inventario?" y deja las existencias **exactamente como las contaste**; cada corrección queda en el historial de movimientos como "ajuste" con el número del conteo).
   - **🕘 Conteos anteriores:** lista con fecha, quién contó, cuántos insumos, si se corrigió y cuánto faltó o sobró; al tocar uno ves el detalle línea por línea. El valor en quetzales se guarda con **el costo de ese día**, así el historial no cambia aunque después cambie el costo.
   - Es **por sucursal** (cuenta la que elegiste arriba) y **solo el administrador** puede contar.
   - **Ojo:** la diferencia se calcula con lo que dice el sistema **en el momento de guardar**. Lo ideal es contar al cerrar, cuando ya no se vende.

**Cómo armar el azulito del ejemplo (con tus números reales, estos son de muestra):**
1. **Inventario → Agregar un insumo nuevo:** `Vodka Smirnoff` · tipo *Licores* · medida **onzas (oz)** · botella de **750 ml** · lo que cuesta cada una (tu precio).
2. **Llegó mercadería:** cuántas botellas tienes ahora (o hazlo con **Contar inventario**: `2` botellas + `8` oz, y toca "Anotar y corregir").
3. **Menú → Agregar un producto → Más opciones → "Se prepara con receta":** ➕ un ingrediente por cada cosa que lleva: *Sprite* `0.75` (¾ de lata), *Vodka Smirnoff* (las onzas que lleve, por ejemplo `0.5` o `1.5` para un shot) y lo demás. Abajo ves **cuánto cuesta prepararlo y la ganancia**.
4. Cada azulito que se venda baja ¾ de Sprite y esas onzas de licor; **Contar inventario** al cerrar te dice si coincide con lo que hay en la barra.

**Vender también la botella completa:** crea el producto con **receta** y un solo ingrediente con la cantidad de **una botella** (`25.36` oz, el renglón te recuerda cuánto es). Así venderla baja la botella entera de las mismas onzas con que se hacen los tragos.

**Para pasar un licor que hoy cuentas en piezas (Smirnoff, Vodka Azulito…) a onzas:** crea el insumo nuevo en onzas (paso 1), cambia el producto "tal cual" a **receta** con la botella entera (`25.36` oz) o con los tragos que lleva, cuenta cuántas tienes y, cuando ningún producto use el insumo viejo, quítalo. **No se puede cambiar la medida de un insumo que ya está en el Menú** (el sistema lo rechaza y explica por qué): si pasara de piezas a onzas sin avisar, "1 botella" se volvería "1 onza" en todas las recetas. En un insumo que no está en el Menú sí se puede, y te avisa que hagas un conteo para corregir las existencias.

**Lo que NO hace:** no adivina derrames ni tragos servidos de más (eso lo muestra la diferencia del conteo; los derrames conocidos se anotan en "Se perdió o se dañó algo"); un producto que "se vende tal cual" sigue bajando **1** del insumo por venta (para onzas, usa receta como arriba); no traslada mercadería entre sucursales.

**Para armarte las recetas reales necesito de ti** (puedes mandarlo cuando puedas, no hace falta todo junto): nombre y tamaño de la presentación de cada licor que vas a medir (Smirnoff, vodka, Jagger…), cuánto lleva cada trago o bebida (el azulito, Adrenalina, Bacardi…), el tamaño del Sprite y del energizante y lo que cuesta cada uno.

## 32. Tu lista nueva: precios, azulitos, Jagger, alitas, Vitafer en ml y limpieza del inventario (nuevo)

Cargué la lista que mandaste el 29 de octubre. **Pasa sola, una vez, la primera vez que arranca la versión nueva** (subes el ZIP y reinicias). **Antes de tocar nada el sistema guarda una copia completa de tu base** en la carpeta de datos: `respaldo_antes_de_lista3_<fecha>.db`. Si esa copia no se pudo guardar, **no se cambia nada** y se vuelve a intentar al reiniciar; y si algo fallara a mitad de camino, la base queda exactamente como estaba (todo o nada).

**Precios y qué baja del inventario** (todo baja del **mismo insumo** que se descuenta cuando ese producto se vende solo):

| Producto | Precio | Qué baja al venderlo |
|---|---|---|
| Gallo lata | Q 12 | 1 Gallo **lata** (el Gallo de **vidrio** sigue aparte, Q 10, con su propio insumo) |
| Corona | Q 15 | 1 Corona |
| Ultra (Michelob) | Q 20 | 1 Michelob |
| Pacífico | Q 15 | 1 Pacífico |
| Mineral (**Agua mineral**, nuevo) | Q 10 | 1 agua mineral |
| Gaseosas (Coca vidrio, Coca lata, Gaseosa lata, Sprite, Pepsitas) | Q 10 | 1 de la suya (**las gaseosas subieron de Q 7 a Q 10**) |
| Red Bull solo | Q 20 | 1 Red Bull |
| **Jagger sola** (antes "Jagger onza") | Q 25 | **2 oz** de Jagger |
| **Jaggerbomb** (nuevo) | Q 45 | 2 oz de Jagger + **⅓ de Red Bull** |
| Marinero preparado | Q 20 (antes 15) | 1 L de clamato + 0.04 L de limón + 0.03 L de salsas |
| Porción de papas (Lays) | Q 20 | 1 Lays |
| **Alitas** | Q 70 | 1 alitas **+ 1 Lays** (las papas bajan del mismo insumo que la porción de papas) |
| **Volteaditos** (nuevo) | Q 25 | 1 gaseosa lata + 1 octavo |
| Octavo | Q 14 | 1 octavo |
| **Azulito con licor** | Q 30 | 2 oz de **esencia azul** + 1½ oz de **licor del azulito** + ½ Sprite (chaparrita) + ⅓ de Power |
| **Azulito sin licor** | Q 25 | lo mismo, sin el licor |
| **Cimarrona** | Q 15 | 1 agua mineral + 0.03 L de limón + 3 g de sal |

**Vitafer: por cantidad y por botella, del mismo líquido.** Ahora hay un insumo **"Vitafer (líquido)"** que se cuenta en **ml** y trae su **bote de 500 ml**. **"Vitafer 10 ml"** (Q 20) baja 10 ml y **"Bote de Vitafer"** baja 500 ml: 50 shots = 1 bote. El costo sale de tu libreta (Q 6 el shot = **Q 0.60 el ml**, Q 300 el bote). En **Llegó mercadería** puedes anotar "3 botes" y en **Contar inventario** "1 bote + 120 ml".

**Lo que se borró del inventario.** Me pediste borrar todo lo demás que no me hubieras dicho. Borré **19 insumos de ejemplo** que ningún producto del Menú usa (barril, chamoy, pulpas, tequila, ron, polvos, gomitas, cacahuates, Victoria, Modelo, Negra Modelo, Michelob Ultra de ejemplo, Squirt, Peñafiel, Cabro y el Vodka Smirnoff Red de ejemplo) **más 3 que reemplacé**: el "Vitafer" en piezas, el "Vodka Azulito" y el "Azul sin licor" (los azulitos y el Vitafer ahora llevan receta en onzas / ml). Son **22 en total**. **El detalle de lo que se borró, con lo que tenía de existencias, queda en `inventario_borrado_lista3.txt`** (al lado del respaldo). Los insumos de los productos que tú ya me habías dado en tus listas anteriores se quedaron en esta sección; **la sección 33 los quitó también** (dejó solo lo de tu lista).

**Lo que dejé en pausa, sin precio, para que no se venda por error:** **Bote de Vitafer**, **Miche pacifico** y **Miche Montecarlo** (ya llevan su receta: medio marinero + aderezo + su cerveza, y sus fotos). Ponles precio en **Menú → 💲 Poner precios** y se activan solos.

**Mi interpretación (corrígeme lo que no sea):**
- **"Jagger 20onz" = 2 oz** (20 oz serían casi una botella entera por Q 25). El Jaggerbomb lleva esas mismas 2 oz más ⅓ de Red Bull.
- **Cimarrona:** supuse **0.03 L de limón** y **3 g de sal** por vaso. La sal es un insumo nuevo (en gramos).
- **"Licor" del azulito:** creé el insumo **"Licor del azulito"** en onzas (si es vodka u otro, cámbiale el nombre en Inventario). **Esencia azul** también es nuevo, en onzas.
- **Sprite y Power** son los insumos que ya tenías, en piezas: ½ Sprite y ⅓ Power por azulito.
- Los **costos de esencia, licor, Power, Sprite, Jagger y Red Bull están en Q 0** (no los sé): ponlos en Inventario y el costo de cada bebida se recalcula solo. Mientras tanto los azulitos conservan el costo de tu libreta (Q 11.11 y Q 9.20).
- **"Michelada con jugo entero":** no la creé porque no sé qué lleva ni cuánto cuesta. Dime y la armo.
- **Michelada con la cerveza que el cliente quiera:** ya hay una por cada cerveza (Gallo lata, Gallo vidrio, Gallo light y Corona con su precio; Coronita, Pacífico y Monte Carlo esperan el suyo); al pedirla baja **la misma cerveza** que si se vende sola.
- La foto del **Jaggerbomb** estaba puesta en "Jagger onza": la pasé al Jaggerbomb.
- **Las existencias de los insumos nuevos empiezan en 0**: usa **Contar inventario** para dejarlas bien (azulitos, Jagger, Vitafer en ml, sal...).

## 33. El Menú queda solo con tu lista (nuevo)

> **Ojo (sección 34):** esto solo se aplica a un menú que todavía trae mis productos. **Si tú ya armaste tu propio menú, no se toca nada.**

Dijiste: *"Veo muchas cosas en el menú, borra todo y deja solo lo que te mandé"*. Al arrancar la versión nueva (**una sola vez**) el sistema:

1. **Guarda una copia completa de tu base** antes de tocar nada: `respaldo_antes_de_menu_solo_lista_<fecha>.db` (en la carpeta de datos). Si no se puede guardar, **no se cambia nada**; si algo falla a mitad de camino, la base queda exactamente como estaba.
2. **Deja en el Menú solo estos 31 productos** (27 a la venta y 4 esperando precio):
   - **Micheladas y preparados:** Miche gallo lata, Miche gallo vidrio, Miche light, Miche corona, Marinero preparado, Azulito con licor, Azulito sin licor, Cimarrona, y esperando precio: Miche coronita, Miche pacifico, Miche Montecarlo.
   - **Cervezas:** Gallo lata, Gallo de vidrio, Corona, Michelob (Ultra), Pacífico.
   - **Refrescos:** Agua mineral, Coca vidrio, Coca lata, Gaseosa lata, Sprite, Pepsitas, Red Bull, Vitafer 10 ml, y esperando precio: Bote de Vitafer.
   - **Tragos:** Jagger sola, Jaggerbomb, Volteaditos, Octavo.
   - **Botanas:** Lays (papas) y Alitas.
3. **Borra todo lo demás** (en una base como la de demostración fueron 37 productos): los cubetazos, Coronita, Busch, Monte Carlo, Tecate, Gallo light suelto, Marinero (1 litro), Michelada con Medio Marinero, Miche mineral, Marinero de 250 ml, Bacardi, Venado, Tequila Santo, Mezcal, Cubatas, Adrenalina, V8, Agua pura, Gatorade, Power, Hidra, Sopas, Chiclets, Bon Bon, los cigarros, Smirnoff, VB. **Si un producto ya tiene ventas o está en una cuenta de mesa abierta, no se borra: se oculta** (ya no sale en el Menú ni en "Vender", pero las ventas viejas, los tickets y los reportes se conservan).
4. **Quita las secciones que quedaron vacías** (Cigarros) y **los insumos que ya ningún producto usa**. El inventario queda con los **27 insumos** de tu lista (cervezas, gaseosas, clamato, limón, salsas, Jagger, Red Bull, Power, esencia, licor del azulito, sal, Vitafer en ml, alitas, papas, mineral…). **Lo que se borró y lo que tenía de existencias queda en `menu_borrado_solo_lista.txt`.**
5. Las fotos de los productos quitados se van con ellos; **si algún día vuelves a crear uno** (por ejemplo Smirnoff), **su foto vuelve sola** en el siguiente arranque.

**Micheladas:** como pediste "michelada con la cerveza que el cliente quiera", dejé las 7 que ya tenían precio o foto. Si quieres menos o más, dime cuáles.

**Si quitamos algo que querías:** se vuelve a agregar en **Menú → Agregar un producto** (y su insumo en Inventario). Y la copia de seguridad trae todo lo de antes.

## 34. Tu base es la base: el sistema la respeta y arranca con ella (nuevo)

Dijiste: *"Simplemente usa la BD que te di, eso es TODO"*. La base de tu compu (la carpeta `data` completa que mandaste el 29 de octubre por la noche: `mismisimo.db` + su archivo `-wal`, donde estaban los últimos cambios) es ahora el punto de partida del sistema, y ninguna conversión mía la toca:

1. **Tu base viaja dentro del sistema** como punto de partida: `src/base_inicial/base_inicial.sqlite`, **igual a la tuya con el `-wal` ya unido** (16 productos, 13 insumos, 16 recetas, 16 fotos, existencias de VIP, usuarios y las 4 ventas de prueba). Tiene extensión `.sqlite` a propósito, porque los ZIP excluyen todo lo que termina en `.db` para no llevarse la base de nadie.
2. **Si el sistema ya tiene una base (como tu compu), no se toca nada.** La limpieza de la sección 33 ya **no se aplica cuando el menú ya es el que armaste tú** (cuando quedan menos de 15 de los 31 productos de mi lista; tu base tiene 3): solo se marca la versión 10, no se borra ni se cambia nada y la consola lo dice (`no se aplicó porque el menú ya es el que armó el dueño`). Con tu base real se comprobó **tabla por tabla** que no cambia ni una fila. (Antes de este arreglo, el ZIP de la sección 33 habría borrado casi todo tu menú: sobre la primera copia incompleta habría borrado 6 productos, ocultado 2 y borrado 5 insumos.)
3. **Carpeta nueva, sin base:** si abres el sistema en una carpeta que no tiene `data` (o no tiene `mismisimo.db`), **arranca con tu base** en vez del menú de ejemplo. Pasa **una sola vez**; si ya hay una base, la inicial **nunca** se vuelve a copiar (lo que cambies se queda). Si la inicial estuviera dañada, avisa y empieza con una base de ejemplo en vez de caerse.
4. **Regla desde ahora:** lo que yo cargue por conversión **no borra ni pisa lo que ya armaste**; cada cambio de datos se prueba contra tu base antes de mandártelo.
5. **Hostinger:** si ya tiene su base en `mismisimo-data`, **no cambia nada** (la inicial solo se usa cuando no hay base). Para que Hostinger arranque con la tuya: **apaga la app**, **mueve a otra carpeta los 3 archivos** `mismisimo.db`, `mismisimo.db-wal` y `mismisimo.db-shm` de `mismisimo-data` (siempre los tres juntos; no los borres) y vuelve a iniciar. Ojo: eso reemplaza lo que Hostinger tenga hoy. Si dejas uno de los tres, **mira la sección 35**.
6. **Por qué la primera copia que mandaste estaba incompleta:** el sistema guarda los cambios más recientes en `mismisimo.db-wal`, no en `mismisimo.db`. Con la carpeta completa se vio que `mismisimo.db` solo llegaba a las 4:14 pm y que **el `-wal` traía lo demás hasta las 9:45 pm** (6 productos y 5 insumos más). Ya está todo unido. Para mandar o respaldar la base: copia siempre `mismisimo.db` **junto con** `mismisimo.db-wal` (o cierra el sistema primero, y queda todo en un solo archivo). El archivo `.jwt_secret` no hace falta y es una clave privada: no lo mandes.

**Cosas que vi en tu base (por si no son lo que querías):**
- El **Vitafer** tiene costo de Q 7.50 por botella, así que el shot sale en Q 0.15 de costo contra Q 25 de precio. Parece un costo de ejemplo; cámbialo en Inventario.
- Todas las existencias están en **VIP entre amigos**; las otras 7 sucursales están en 0. Hay una caja abierta (Q 200 de fondo) con la única venta de prueba que no está anulada (Cimarrona, Q 25).
- El usuario **vendedor** solo trabaja en El Mismísimo y Cruce (no en VIP): para vender en VIP entra el administrador, o márcale VIP en **Personal**.
- "Gallo 350ML Lata" tiene su michelada pero **no hay producto suelto** para venderla sola (solo la de vidrio). El **Shot El Santo** baja 0.0133 de una botella de Tequila El Santo (Q 50): costo de Q 0.66 por shot.

## 35. Error "database disk image is malformed" al cobrar en Hostinger (nuevo)

**Qué pasó (video del 30 de octubre, 12:29 am):** en Hostinger, al tocar COBRAR salía *"No se pudo cobrar. database disk image is malformed"*. El menú se veía bien (leer funcionaba) pero guardar la venta (escribir) fallaba.

**Causa:** no es un error de la venta, es del archivo de la base. SQLite guarda los cambios más recientes en dos archivos junto a `mismisimo.db`: `mismisimo.db-wal` y `mismisimo.db-shm`. Si se cambia `mismisimo.db` a mano (o con la app encendida) y **se queda el `-wal` / `-shm` de la base anterior**, SQLite los junta con la base nueva y la **mezcla**. Se reprodujo aquí: la base quedó con decenas de errores en `integrity_check` (cuentas de mesa con datos inválidos, etc.). No hay forma de saber desde fuera qué se hizo exactamente en tu Hostinger, pero esta es la causa que sí produce ese síntoma.

**Cómo arreglarlo si ya te pasó (sin esperar nada):**
1. Detén la app Node.js en Hostinger.
2. En la carpeta `mismisimo-data` mueve a otra carpeta (no los borres) los **3 archivos**: `mismisimo.db`, `mismisimo.db-wal` y `mismisimo.db-shm`.
3. Inicia la app: arranca limpia con tu base completa.

**Qué cambió en el sistema para que no vuelva a pasar:**
1. **Sin base y con restos viejos:** al poner la base inicial, si quedó un `-wal` o `-shm` de otra base, **los aparta solo** (quedan como `mismisimo.db-wal.huerfano-<fecha>`; no se borran) y avisa en el registro.
2. **Con base y con un `-wal` de otra base:** antes de abrir la base la revisa **solo para leer** (sin tocarla). Si con su `-wal` está mala y **sin él** está sana, aparta el `-wal` y el `-shm` y avisa (`La base estaba MEZCLADA...`). **Un `-wal` bueno no se toca**: si el sistema se apaga de golpe (se va la luz, se cierra la ventana negra), el `-wal` guarda las ventas más recientes y se conservan todas.
3. **Base realmente dañada:** al arrancar se hace una revisión rápida; si falla, el registro dice con letras grandes `LA BASE DE DATOS ESTÁ DAÑADA O MEZCLADA` y qué hacer, y **`/api/health` (la dirección `tu-sitio/api/health`) dice `REVISAR`** en lugar de `ok`. No se toca nada.
4. Se corrigió un detalle de la sección 34: al poner la base inicial quedaban dos archivos sueltos (`mismisimo.db.copiando-wal` y `-shm`). Ya se limpian.

**Regla para cambiar la base a mano (en Hostinger o en tu compu):** con la app **apagada**, mueve o cambia **los tres archivos juntos** (`mismisimo.db`, `-wal`, `-shm`), nunca solo uno. Y para respaldar, copia los tres (o apaga el sistema primero y copia solo `mismisimo.db`).

## 36. Medir en ml, sin tanto royo: botón "🔄 Pasar a ml" (nuevo)

**Lo que pediste (30 de octubre):** que a la hora de medir el producto sea más fácil en ml, y lo mismo al agregarlo a las recetas.

**Qué hay ahora**
1. **Medidas simples.** Un insumo nuevo se mide en **ml** (líquidos: licor, jugo, Clamato), en **piezas** (lo que se vende entero) o en **gramos**. Al elegir el *Tipo* el sistema sugiere la medida (Licores → ml, Cerveza → piezas, Escarchados → gramos). Los insumos que ya estaban en litros u onzas siguen funcionando igual.
2. **Botón "🔄 Pasar a ml".** Sale en cada insumo por pieza, litro u onza (en la tabla de **Inventario** y dentro de **✏️ Cambiar**; también si en un insumo que ya existe eliges "ml"). Escribes **cuántos ml trae una pieza** (hay botones de 250, 350, 500, 750 y 1000; en litros y onzas no pide nada) y **antes de cambiar te muestra qué va a pasar**: lo que hay, el costo por ml, la botella o paquete, las recetas que se ajustan y los productos que se vendían "tal cual". Tocas **Pasar a ml** y listo.
3. **Todo se convierte solo y las bebidas cuestan lo mismo.** Se convierten: las existencias de **todas las sucursales**, el "avisar cuando quede menos de", el costo (Q 7.50 la pieza de 500 ml pasa a **Q 0.015 por ml**), el tamaño de la botella o paquete, las cantidades de las **recetas**, las **opciones del cliente** (vidrio / lata) y el **historial** (así, anular una venta de antes de la conversión devuelve los ml correctos, no "1"). Un producto que se vendía **"tal cual"** pasa a llevar una receta de los ml de una pieza (se descuenta exactamente lo mismo que antes).
4. **Seguridad.** Antes de tocar nada se guarda una **copia de seguridad completa** (`respaldo_antes_de_pasar_a_ml_<insumo>_<fecha>.db` en tu carpeta de datos; no la borres hasta revisar). Todo se hace **todo o nada**, y el sistema comprueba que **el costo de cada bebida y el valor del inventario queden iguales**; si algo no cuadra, **se deshace todo** y no cambia nada.
5. **Recetas en ml.** En el Menú la ayuda de la receta dice que los líquidos se anotan en ml (un shot = 45 ml, media botella de 750 = 375). El costo por ml se ve con decimales (**Q 0.015 por ml**) y, si el insumo tiene botella, la receta recuerda "1 botella = 750 ml".
6. **"Se vende tal cual" ya no va con insumos en ml** (cada venta bajaría 1 ml en vez de la botella): esos insumos salen apagados con la explicación, y el servidor también lo impide. Una botella en ml se vende con una **receta** que lleva los ml de la botella (500 ml, por ejemplo).
7. En la pantalla de **Vender**, si una opción del cliente (vidrio / lata) usa un insumo en ml, "Quedan N" cuenta **cuántas ventas alcanzan** (2,000 ml con 355 ml por venta = 5), no los ml.

**Lo que NO se convierte:** los **gramos** (son peso, no líquido) y las botanas / polvos no muestran el botón.

**Ejemplo con tu base (Vitafer, 500 ml por pieza):** 50 piezas → **25,000 ml**; avisar con menos de 10 → **5,000 ml**; costo Q 7.50 → **Q 0.015 por ml**; paquete de 20 → **10,000 ml**; el shot de 0.02 → **10 ml**; "Vitafer Botella" (tal cual) → receta de **500 ml**. Todas tus bebidas cuestan lo mismo que antes. Si el insumo no tiene botella (Tequila El Santo), el cuadro ofrece guardar "1 pieza" como **botella** de esos ml para anotar compras ("llegaron 2 botellas").

**Dato que me falta:** no sé cuántos ml trae cada pieza tuya (Jagger, Tequila, Marinero, etc.); los escribes tú al pasarlos a ml (en la etiqueta viene).

## 37. Tus tragos y micheladas ya están en ml, solos (nuevo)

**Lo que pediste (30 de octubre):** revisar la base y pasar todas las medidas de tragos y micheladas a ml.

**Qué hace el sistema al arrancar con la versión nueva (una sola vez, versión 11).** Solo si reconoce **tu inventario** (tus insumos por nombre), pasa a ml todos los que estaban en piezas. Es el mismo botón "🔄 Pasar a ml" de la sección 36, pero ya hecho. Lo que **no** toca: las **Alitas** y las **Papas** (se venden por pieza) y todo lo que ya estaba en ml.

| Insumo | ml por pieza | Antes → ahora (en VIP) |
|---|---|---|
| Marinero | 250 | 24 → 6,000 ml |
| Gallo 350ML vidrio / lata | 350 | 24 → 8,400 ml |
| Vitafer | 500 | 50 → 25,000 ml |
| Mineral | 355 | 23.5 → 8,342.5 ml |
| JaggerMeiter | 700 | 15 → 10,500 ml |
| Red Bull | 250 | 24 → 6,000 ml |
| Smirnoff, Pacífico Sola, Monte Carlo | 355 | 24 → 8,520 ml |
| Tequila El Santo | 750 | 25 → 18,750 ml |

**Cómo quedaron tus bebidas (el costo de cada una es el mismo de antes):** cada **michelada** lleva **250 ml de Marinero** + su cerveza de **350 ml** (Gallo) o **355 ml** (Pacífico, Monte Carlo); **Shot de Vitafer** 10 ml; **Vitafer Botella** 500 ml; **Shot El Santo** 10 ml; **JaggerBomb** 49 ml de Jagger + 82.5 ml de Red Bull; **Cimarrona** 177.5 ml de Mineral; las cervezas y refrescos sueltos, 350 o 355 ml (lo que trae la botella). Cada insumo guarda su **botella en ml** (ver la sección 39: el inventario cuenta botellas, no paquetes).

**Los tamaños los tomé de lo que me contestaste:** Marinero 250 ml, Jagger 700 ml, Pacífico / Monte Carlo / Smirnoff 355 ml. Gallo 350, Vitafer 500, Mineral 355, Red Bull 250 y Tequila 750 son los tamaños normales de esas marcas. **Si alguno no es el tuyo**, corrígelo en **Inventario → ✏️ Cambiar** (y en **Menú → la receta**).

**Seguridad.** Antes de tocar nada se guarda la copia **`respaldo_antes_de_pasar_a_ml_<fecha>.db`** (tu base completa de antes). Todo se hace **todo o nada** y el sistema comprueba que **el costo de cada bebida y el valor del inventario queden iguales**; si algo no cuadra, **no cambia nada**, sigue funcionando en piezas y vuelve a intentar al reiniciar. Se escribe también la nota **`medidas_en_ml.txt`** (en tu carpeta de datos) con lo que se convirtió. Si tu base no es la tuya (la de demostración o una instalación nueva con otros insumos), **no se aplica**.

## 38. "📦 Llegó mercadería" en 3 pasos (nuevo)

**Lo que pediste (30 de octubre):** el registro de mercancía estaba muy confuso; que sea mucho más simple.

**Cómo es ahora** (Inventario → **📦 Llegó mercadería**):
1. **¿Qué llegó?** Eliges el producto (en la lista ves cuánto hay: "Gallo 350ML vidrio · hay 8,400 ml").
2. **¿Cuánto llegó?** Escribes **un número** y tocas **cómo lo contaste**: en **botellas** (o latas, paquetes…) si el insumo lo tiene, o en **ml / piezas**. Ahí mismo te dice la cuenta: "24 botellas = 8,400 ml. Hay 8,400 → habrá 16,800 ml".
3. **¿Cuánto pagaste en total?** (opcional). Escribes lo que pagaste por **todo** y el sistema calcula solo lo que cuesta cada paquete, botella, ml o pieza ("Cada botella sale a Q 6.50"). Si lo dejas vacío, el costo **se queda como estaba**.

Tocas **✅ Guardar** y sale una línea verde ("✔ Gallo 350ML vidrio: llegaron 24 botellas · ahora hay 16,800 ml"). El cuadro **sigue abierto** para anotar el siguiente producto sin volver a entrar; al terminar tocas **Terminar**. Con **Enter** también guarda.

**Lo que quité de la pantalla:** los botones "por botella / por medida", las preguntas de "costo por paquete / por unidad" y los campos de factura y nota (siguen disponibles, escondidos en **"Factura o nota (no hace falta)"**). No cambia nada en cómo se guardan las cantidades y los costos: es la misma cuenta de antes, pero ya hecha por el sistema.

## 39. El inventario cuenta BOTELLAS, no paquetes (nuevo)

**Lo que pediste (30 de octubre):** que el inventario muestre la cantidad de **botellas** en vez de paquetes.

**Qué pasaba:** al pasar tus insumos a ml (sección 37) la presentación de cada uno quedó como el *paquete* de antes (24 botellas de 350 ml = 8,400 ml), por eso la tabla decía "≈ 1 paquete".

**Qué hace ahora el sistema al arrancar (una sola vez, versión 12):** la presentación de cada insumo pasa a ser **una botella de su tamaño** (o **una lata**, en el Gallo de lata). Así:
- **Inventario:** "Gallo 350ML vidrio · 8,400 ml · **≈ 24 botellas**"; Jagger 10,500 ml = **≈ 15 botellas**; Vitafer 25,000 ml = **≈ 50 botellas**; Mineral 8,342.5 ml = **≈ 23 botellas + 177.5 ml**; Tequila **≈ 25 botellas**.
- **Llegó mercadería** cuenta en botellas: si llegaron 24 cervezas escribes **24 botellas**.
- **Recetas y Contar inventario** también hablan de botellas ("1 botella = 350 ml").

**Qué NO cambia:** las existencias, los costos, las recetas, las ventas y el historial quedan **exactamente iguales** (solo cambia el nombre y el tamaño de la presentación; el sistema lo comprueba antes de confirmar). Las **Alitas** y las **Papas** siguen contándose en paquetes. Si tú ya le pusiste otra presentación a un insumo (por ejemplo "caja"), **no se toca**.

**Seguridad:** se guarda la copia **`respaldo_antes_de_botellas_<fecha>.db`** y se anota en `medidas_en_ml.txt` lo que cambió (antes 1 paquete = 8,400 ml → ahora 1 botella = 350 ml). Si algo falla, no cambia nada y el sistema arranca igual.

**Lo que supuse:** que cada paquete era de botellas iguales (por eso Gallo 350 ml × 24 = 8,400). El **Jagger** traía 7 por paquete (4,900 ml) y queda en botellas de 700 ml. Si algún tamaño no es el tuyo, cámbialo en **Inventario → ✏️ Cambiar** (Presentación).

## 40. Los azulitos, con receta en ml y con vodka (nuevo)

**Lo que pediste (31 de octubre):** los azulitos de nuevo (tu receta del 29 de octubre) en ml; el licor es **vodka Absolut**, la esencia viene de **250 ml** y los tamaños del Sprite y el Power los buscara en internet.

**Qué agrega el sistema al arrancar (una sola vez, versión 13).** Solo **agrega**: no cambia ni borra nada de lo que ya tienes (se compara tabla por tabla antes de confirmar).

| Producto | Precio | Receta (en ml) |
|---|---|---|
| **Azulito con licor** | Q 30 | 59 ml esencia azul (2 oz) + 44 ml vodka (1½ oz) + 118.5 ml Sprite (½ chaparrita) + 167 ml Power (⅓) |
| **Azulito sin licor** | Q 25 | lo mismo, sin el vodka |

Quedan en la sección **Micheladas & Bebidas**, con el costo de tu libreta (Q 11.11 y Q 9.20) hasta que pongas los costos de cada insumo.

**4 insumos nuevos, en ml y con su botella, con existencias en 0 en todas las sucursales:**
| Insumo | Botella | De dónde salió el tamaño |
|---|---|---|
| Esencia azul | 250 ml | tu dato |
| Vodka Absolut | 750 ml | tamaño normal de la botella de Absolut (también existe de 1 L) |
| Sprite | 237 ml | **supuesto** mío: la chaparrita; en Coca-Cola Guatemala solo encontré 600 ml y 2 L |
| Power | 500 ml | **supuesto** mío: no encontré el tamaño |

**Lo que supuse y tienes que confirmar:** el tamaño del **Sprite chaparrita** (237 ml) y del **Power** (500 ml). Si no son, cámbialos en **Inventario → ✏️ Cambiar** (Presentación) y en **Menú → ✏️ Cambiar → la receta** (118.5 ml de Sprite = la mitad de la chaparrita; 167 ml de Power = la tercera parte). Los **costos** de los 4 insumos están en Q 0 (no los sé; el precio de la Absolut que vi en internet no era confiable): ponlos en Inventario.

**Para empezar a venderlos:** anota lo que tienes en **📦 Llegó mercadería** (esencia, vodka, Sprite, Power). Los azulitos salen con el dibujo normal (no tengo foto de ellos; puedes subirla en **Menú → ✏️ Cambiar**).

**Seguridad:** copia `respaldo_antes_de_azulitos_<fecha>.db` y una nota en `medidas_en_ml.txt`. Si ya tenías un producto "Azulito con licor" o "Azulito sin licor", o un insumo "Sprite" / "Power" / "Esencia azul" / "Vodka Absolut" en otra medida, **no se agrega nada y no se toca lo tuyo**. Si ya tienes alguno de esos insumos en ml, se usa el tuyo.

## 41. Velocidad: "Ventas hechas" ya no tarda, cobros más ligeros y una prueba de velocidad (nuevo)

**Lo que pediste (3 de noviembre):** "tarda mucho en cargar algunas cosas… y ya no podemos tocar nada del inventario", con dos videos: el botón **COBRAR** que se queda en "Cobrando…" varios segundos con 8 bebidas, y el cambio de **Vender a Mesas** que tarda unos 3 segundos en la tableta.

**El inventario no se tocó.** Ni una cuenta, ni una receta, ni una tabla. Lo comprobé así: corrí la versión anterior (la que ya tienes) y la nueva con **exactamente las mismas operaciones** sobre una copia de tu base (el cobro de tu video con micheladas y personalizado, cada producto del menú, errores de cobro, una mesa con su cobro, una anulación, dos compras, una merma y el cierre de caja) y comparé: **136 existencias, 64 movimientos de inventario, 24 ventas, 28 renglones, cajas, insumos, recetas y lo que muestran Inventario, Catálogo y Resumen quedaron idénticos**.

**Lo que encontré y arreglé (medido con una base de 60 mil ventas, mucho más que las que tienes hoy):**

| Pantalla / acción | Antes | Ahora |
|---|---|---|
| **Ventas hechas** (servidor) | 3 000 ms | **4 ms** |
| **Ventas hechas** con un filtro de fechas | 2 100 ms | **2 ms** |
| **Ventas hechas** en el navegador con tableta lenta simulada | 3 500 ms | **325 ms** |
| **Cobrar** una venta (servidor) | 8.7 ms | **1.7 ms** |
| **Resumen** | 190–270 ms | **~100 ms** (casi todo es el "Top 5 de siempre", que crece con las ventas) |
| Lista de ventas (peso que viaja) | 44 KB | **3.4 KB** |
| Descargar Excel/CSV de ventas | 4.3 MB | **0.5 MB** |

Qué se cambió:
1. **Índice de los productos de cada venta** (`sale_items`). Era la causa de que "Ventas hechas" se pusiera cada vez más lenta: por cada venta la base buscaba a ciegas entre todos los renglones del historial. Es un índice nuevo (como un índice de libro): no cambia ningún dato y **no está en tablas de inventario**.
2. **"Ventas hechas" y "Resumen" ya no revisan todo el historial**: eligen primero las 100 ventas que tocan y filtran por fecha de forma que la base use su índice. Probé 23 combinaciones de filtros (fechas, fechas mal escritas, tarjeta, anuladas, cajero, búsqueda, cada sucursal y "Ambas") contra la versión anterior sobre la base de 60 mil ventas: **72 respuestas idénticas**.
3. **Guardar cada cobro es más ligero:** cuenta los tickets del día por rango (misma numeración), y la base ahora no espera a que el disco del servidor confirme cada escritura (`synchronous = NORMAL`, el modo recomendado con WAL). La base **no se daña** aunque se corte de golpe (lo probé matando el servidor a la mala a media venta: 8 ventas confirmadas siguen ahí con sus movimientos de inventario completos). Lo único que cambia: si se va la luz **del servidor** en ese instante exacto, podría perderse el último cobro (por eso siguen los respaldos).
4. **Las listas grandes viajan comprimidas** (ventas, movimientos, turnos, Excel). En datos móviles o WiFi flojo se nota. El contenido es idéntico.
5. **Sonido del cobro:** se creaba un "reproductor de audio" nuevo en cada venta (lento en tabletas y los navegadores solo permiten unos pocos); ahora se reutiliza uno.
6. **Tocar COBRAR en una mesa con productos nuevos sin guardar (tu tercer video):** antes el sistema hacía **dos viajes seguidos** al servidor antes de abrir el cobro (guardar en la mesa y luego pedir otra vez la lista completa de mesas). Ahora el servidor devuelve la mesa ya actualizada y se hace **un solo viaje** (la lista completa se refresca por detrás). Con internet lento simulado (cada petición tarda 1.2 s): **2.5 s → 1.3 s**. Lo guardado, el total, la venta y el estado de la mesa quedan igual (comparado contra la versión anterior). Las **cuentas abiertas de tus mesas no se tocan**: probé abrir cuentas con la versión anterior (12, 42 y 3 productos, una con la cuenta pedida), arrancar la nueva sobre la misma base y quedaron **idénticas fila por fila**, y la de 42 productos se cobró bien.
7. **El servidor avisa en su registro** cuando una petición tarda más de 1.5 s (`[LENTO] POST /api/pos/sale tardó 5230 ms`), para ver cuál se atora.

**Lo que NO pude reproducir, y qué hacer:** (tus 3 videos tienen algo en común: **cada vez que el toque necesita al servidor, tarda 3–5 s**; los toques que no lo necesitan, no.) En mis pruebas el cobro de 8 bebidas tarda **10 ms en el servidor** (con una sola escritura al disco) y **~200 ms en pantalla** aun con una tableta simulada 6 veces más lenta y 80 ms de internet; cambiar de Vender a Mesas tarda **~60 ms**. O sea: con lo que tengo, el programa no explica los 5 segundos del cobro ni los 3 del cambio de pantalla de tus videos. Lo que queda por descartar está **fuera** del programa: el disco o el procesador del servidor de Hostinger (el ajuste 3 ya ayuda si era el disco), el internet de la tableta, o la propia tableta. Para saberlo sin adivinar agregué la **Prueba de velocidad**:

> Abre en la tableta (en el navegador, con la misma red de siempre): **`https://TU-DOMINIO/api/health?velocidad=1`**

Dura ~10 segundos y mide: 📶 cuánto tarda cada petición en ir y volver, ⬇️ la descarga, 📱 la velocidad de la tableta, y 💾🖥️🗄️ el disco, el procesador y la base del servidor. Al final dice con palabras qué está lento (🔴 / 🟠 / ✅). **Mándame una captura** (de preferencia cuando se ponga lenta) y con eso te digo dónde está. También `…/api/health` normal sigue igual y debe decir `"base_datos":"ok"`.

**Mientras tanto, para la tableta:** cierra las demás aplicaciones y pestañas del navegador; si el cobro se atora, prueba el mismo cobro desde tu celular con datos móviles para saber si es la tableta o el WiFi.

## 42. Recargo del 5 % al cobrar con tarjeta (nuevo)

**Lo que pediste (4 de noviembre):** "al cobrar con tarjeta se añada un 5 % al precio", sin tocar el inventario.

**Cómo funciona:**
- Solo cuando se paga con **💳 Tarjeta**: la cuenta sube 5 %. Con **efectivo, transferencia y mixto** el precio es el de siempre.
- Vale igual para el **cobro normal de Vender** y para el **cobro de una mesa**.
- En el cobro, al tocar Tarjeta, el total grande cambia solo (ejemplo: cuenta Q 60 → **Q 63.00**) y debajo dice *"Cuenta Q 60.00 + recargo por tarjeta (5%) Q 3.00"*. Si el cliente cambia de idea y toca Efectivo o Transferencia, vuelve a Q 60.
- El **ticket** (en pantalla, para imprimir y para la térmica/RawBT) trae una fila nueva **"Recargo tarjeta 5%: Q 3.00"** entre el subtotal y el TOTAL. Las ventas en efectivo no traen esa fila.
- Con tarjeta **nunca hay cambio**: se cobra exacto el total con recargo.
- El recargo se redondea al centavo (Q 15 × 2.5 % = 0.375 → **Q 0.38**).
- **Se puede cambiar el porcentaje** en **Ajustes → "Recargo al pagar con tarjeta (%)"**: de **0 a 50**. **0 = sin recargo** (lo apaga). Al guardar, las pantallas abiertas ya usan el valor nuevo sin recargar. Solo el administrador puede cambiarlo.
- Cada venta **guarda su recargo** (columna nueva `card_surcharge`). Las ventas de antes quedan con 0 y **no cambian ni un centavo**; si después cambias el porcentaje, las ventas ya hechas conservan el que tenían.

**Cómo cuadran los reportes:**
- El **total de la venta incluye el recargo** (una venta de Q 60 con tarjeta ahora vale Q 63). Eso suma en **Ventas hechas**, **Resumen**, **cierre de caja** (lo cobrado con tarjeta sale completo, con recargo) y la **descarga de Excel/CSV**.
- En el **Excel de ventas** hay una columna nueva **"Recargo tarjeta"** (entre *Descuento* y *Total*) para que veas cuánto fue.
- El **efectivo esperado en caja NO cambia**: sigue siendo fondo + lo cobrado solo en efectivo (la tarjeta nunca entra al cajón).
- Si **anulas** una venta con tarjeta, se devuelve todo (el recargo incluido) y el inventario se devuelve igual que siempre.
- ⚠️ La **"Ganancia de hoy"** del Resumen es (lo cobrado − costo de lo vendido); como lo cobrado ahora incluye el recargo, esa ganancia lo suma también. Si el 5 % es lo que te cobra el banco por la tarjeta, esa parte no es ganancia real; si prefieres que el Resumen lo reste o lo muestre aparte, dímelo y lo ajusto.

**El inventario no se tocó:** el recargo es solo dinero; vender con efectivo o con tarjeta baja **exactamente lo mismo** del inventario (probado venta contra venta), y anular devuelve lo mismo. No se tocó ninguna receta, existencia, costo ni tabla del inventario.

**Qué cambió en el sistema:** `src/recargo.js` (cálculo), `src/db.js` (dos columnas nuevas, se agregan solas al arrancar: `sales.card_surcharge` y `system_settings.card_surcharge_percent`, con valor 5), `src/routes/pos.routes.js` (cobro y cobro de mesa), `src/routes/admin.routes.js` (Ajustes y Excel) y las pantallas de Vender, ticket y Ajustes.

**Compatibilidad:** si una tableta se quedó con la página vieja abierta y manda el total sin recargo con tarjeta, **el servidor igual cobra el total con recargo** (la pantalla vieja no puede dejar pasar un cobro sin el 5 %). Para que vean el cambio en pantalla, que recarguen la página.

## 43. Cortes de caja con todo el detalle (nuevo)

**Lo que pediste (5 de noviembre):** que los cortes de caja se vean detallados, y rápido.

**Cómo se usa:** en **Cortes de caja** (solo administrador), toca cualquier corte (la fila entera, o "🔍 Ver detalle") y se abre una ventana con:
- **Cuadre del efectivo:** dinero inicial + ventas en efectivo = lo que debería haber; lo que se contó; y si **cuadró, faltó o sobró** (en rojo o verde).
- **Lo que se cobró, por forma de pago:** efectivo, tarjeta (con cuánto fue **recargo**), transferencia y mixto, cada uno con su número de ventas; el **total vendido**, el **ticket promedio** y los **descuentos** si hubo.
- **Ventas anuladas:** cuántas y por cuánto (no suman al total). Si alguna se anuló **después del cierre**, lo avisa: el conteo de ese día no se cambia, igual que siempre.
- **Notas del corte** (lo que se escribió al cerrar y las anotaciones de anulaciones posteriores).
- **Qué se vendió:** cada producto con sus unidades y lo que sumó (lo anulado no cuenta).
- **Cada venta:** hora, folio, mesa, qué llevaba, forma de pago y total; las anuladas salen tachadas con su motivo y quién la anuló.

Funciona también con una caja **abierta** (muestra cuánto debería haber en ese momento y avisa que aún no se cuenta). Se abre con el dedo, el mouse o la tecla Enter, y se acomoda en el celular sin salirse de la pantalla.

**Qué cambió:** solo se **agregó** una consulta nueva (`GET /api/admin/shifts/:id`, solo administrador y respetando la sucursal elegida) y la ventana en pantalla. La lista de cortes, el cierre de caja, las ventas y el **inventario no se tocaron** (no se escribe nada: es solo lectura). No hay cambios en la base de datos.

## 44. El sistema pide mucho menos internet (nuevo)

**Lo que dijiste (5 de noviembre):** "necesito 200 Mb/s para que cargue bien, siento que es demasiado".

**Lo que medí (con tu base y tus fotos reales, simulando WiFi de 8 Mb/s y de 2 Mb/s con retraso):**
- El sistema **no necesita velocidad**: abierto por **primera vez** en un aparato bajaba **~770 KB** en total y, ya guardado, **~4 KB**. Una conexión de 200 Mb/s baja eso en una fracción de segundo; si el sistema "se siente lento" sin esa velocidad, el problema casi seguro **no es la cantidad de datos** sino el **retraso (latencia) de la señal WiFi** o del aparato. Por eso la prueba `/api/health?velocidad=1` (ver sección 41) desde la tableta del local sigue siendo lo que nos dice dónde está el cuello.
- Cada toque (cobrar, cambiar a Mesas…) ya hacía **una sola petición** al servidor; no había nada que recortar ahí. Y no hay nada que se baje solo cuando el sistema está quieto (0 KB en un minuto).
- Lo que SÍ pesaba o se repetía: (1) las **fotos del menú**: 560 KB de los 770 KB, porque se guardan a 480 px pero se ven a 96 px; (2) al **abrir o recargar** la página, el aparato hacía **31 pedidos** de "¿cambió algo?" (casi sin datos, pero cada uno cuesta un viaje de ida y vuelta, y con WiFi flojo eso se nota); (3) el menú se pedía **dos veces** al entrar; (4) el programa esperaba a descubrir un archivo interno antes de pedirlo.

**Qué se hizo:**
- **Miniaturas de las fotos (solo para mostrar):** en Vender y en la lista del menú se carga una copia de máx. 256 px (que se ve igual, incluso en pantallas de alta definición). Tus 16 fotos pasan de **560 KB a 207 KB (−63 %)**. **La foto original NO se toca**: sigue guardada tal cual y es la que se ve al editar el producto. Si una foto no se puede reducir (o falta la pieza que reduce), se manda la original y todo sigue funcionando. Las miniaturas se preparan al encender el servidor.
- **Archivos con versión:** los estilos y el programa se piden con una huella de su contenido y el aparato los guarda 1 año; ya **no pregunta "¿cambió algo?"** en cada apertura. Si subes una versión nueva, la huella cambia sola y la primera apertura baja lo nuevo (no hay que hacer nada especial). La página principal **siempre** pregunta si hay versión nueva.
- **El programa se pide desde el primer instante** (en paralelo con los estilos) en vez de esperar.
- **El menú se pide una sola vez** al entrar.

**Resultado medido (misma base, mismas fotos):**
| Con WiFi 8 Mb/s y 120 ms | Antes | Ahora |
|---|---|---|
| Primera vez en un aparato: bajada total | 766 KB | **414 KB** |
| Primera vez: de iniciar sesión a ver Vender con todas sus fotos | 1.1 s | **0.8 s** |
| Volver a abrir (ya guardado) | 0.78 s | **0.51 s** |

| Con WiFi flojo 2 Mb/s y 300 ms | Antes | Ahora |
|---|---|---|
| Primera vez: ver la pantalla de entrada | 1.8 s | **1.4 s** |
| Primera vez: de iniciar sesión a ver Vender con todas sus fotos | 3.5 s | **2.1 s** |
| Volver a abrir (ya guardado) | 1.86 s | **1.18 s** |

(Lo que queda al volver a abrir son los viajes inevitables: preguntar si hay versión nueva de la página, confirmar la sesión y pedir el menú y la caja.)

**Qué cambió en el sistema:** `src/static-gzip.js` (versiones y guardado), `src/miniaturas.js` (nuevo), la ruta de la foto (`?m=1`), `index.html` (precarga del programa), el arranque en `app.js` y **una dependencia nueva muy pequeña** (`jpeg-js`, solo JavaScript, 124 KB) que Hostinger instala sola con el resto. No se tocó la base de datos, el inventario ni ninguna foto guardada.

## 45. Pasar mercadería de una tienda a otra, por botellas (nuevo)

**Lo que pediste (5 de noviembre):** "una opción de mover inventario entre tiendas, preferiblemente si es por botellas".

**Cómo se usa (solo el administrador, y solo si hay más de una tienda activa):**
1. Entra a **Inventario**. Arriba verás **🚚 Pasar a otra tienda** y **📜 Ver traspasos** (los vendedores no los ven).
2. Arriba aparece **"Sale de"** (la tienda en la que estás) y **"Va para"** (eliges la otra). Si te equivocas de sentido, toca **↔ Al revés**.
3. Busca el producto y escribe **cuántas botellas** (o piezas) quieres pasar. Si prefieres contar en la medida pequeña (ml, onzas…), toca el botón de la unidad y escribe en esa medida. **Todo** pasa todo lo que hay de ese producto.
4. Abajo ves el resumen de lo que va a pasar. Toca **🚚 Pasar**. El sistema avisa si pides más de lo que hay en la tienda de salida (no deja pasar de más) y, al terminar, te dice cuánto quedó en cada tienda y avisa si algo quedó por acabarse.
5. **📜 Ver traspasos** muestra el historial: folio (`TR-0001`, `TR-0002`…), fecha, quién lo hizo, de dónde a dónde, qué se pasó y la nota.

**Qué hace por dentro:** descuenta de la tienda de salida y suma en la de llegada **en un solo paso** (o pasa todo, o no pasa nada). Cada lado deja su movimiento de tipo "ajuste" con el folio del traspaso, así que se ve en el historial de movimientos de cada tienda. Las ventas no se ven afectadas.

**Qué NO cambia:** las existencias, los movimientos, las recetas y los precios que ya tienes **quedan exactamente igual** al actualizar (se comparó con la versión anterior sobre tu base). Solo se agregan dos tablas nuevas para guardar el historial de traspasos. **Reiniciar datos** (en Ajustes) también limpia esas tablas.

---

## 46. Revisión de errores, memoria y rendimiento (nuevo)

**Lo que pediste (5 de noviembre):** "una revisión de bugs, errores, fugas de memoria y todo lo que pueda afectar el rendimiento".

**Qué se encontró y se arregló:**
1. **Cobro doble por mala señal.** Si el internet se cortaba justo al cobrar, el aparato podía reintentar y registrar **dos ventas**. Ahora cada cobro (y cada compra, merma, conteo, traspaso y "guardar pedido de mesa") viaja con una **clave de reintento**: si llega repetido, el servidor devuelve la respuesta de la primera vez en lugar de hacerlo otra vez. Las claves duran 2 días y se limpian solas (tabla nueva `idempotency_keys`).
2. **Pantalla "congelada" esperando al servidor.** Las llamadas ahora tienen un **tiempo máximo** (60 s en consultas, 30 s en cobros y similares) y avisan con un mensaje claro en vez de quedarse cargando para siempre.
3. **Datos absurdos.** Se mandaron más de 500 peticiones raras al servidor (números donde van nombres, listas vacías, valores negativos o enormes, cuerpos vacíos…): antes **554 terminaban en "error del servidor"**; ahora **0**, y cada una da un mensaje claro. Precios, nombres, categorías y roles de usuario se validan también en el servidor.
4. **Adivinar contraseñas.** Después de **8 intentos fallidos** con el mismo usuario desde la misma red, el sistema espera 5 minutos. Un cajero que se equivoca no bloquea a los demás. Un intento correcto borra el contador.
5. **Contraseñas de fábrica.** Si el administrador entra con `admin123`, el sistema le avisa que la cambie (Personal). **Revísalo en tu sitio publicado.**
6. **Apagado ordenado y respaldo completo.** Al apagar o reiniciar, el sistema termina lo que estaba haciendo y pasa todo lo reciente a `mismisimo.db`; además lo hace solo cada 5 minutos. Así, **copiar solo `mismisimo.db`** (un respaldo) ya incluye las últimas ventas. Aun así, lo más seguro es apagar el sistema y copiar la carpeta `data` completa.
7. **Un error suelto ya no tumba el sistema** en plena venta: se anota en el registro y sigue funcionando. Si no puede abrir su puerto, se apaga con un aviso claro.
8. **Cabeceras de seguridad** (que nadie meta el sistema dentro de otra página, que el navegador no adivine tipos de archivo, que no se mande la dirección completa a otros sitios). No cambian cómo se ve nada.
9. **Mensajes claros:** una dirección de la API que no existe responde con un aviso (antes devolvía la página principal y la pantalla se confundía); "Reiniciar datos" con ventas ya no da error técnico, responde 409 con una explicación.
10. **Consultas repetidas.** El Resumen ya no pregunta al servidor mientras la pestaña está oculta ni apila consultas si una anterior sigue en curso.

**Memoria y rendimiento (medido):**
- 30,000 peticiones seguidas: la memoria pasó de **224 MB a 226 MB (+1.9 MB)** → no hay fuga. Los nodos de pantalla (DOM) también se mantienen planos al abrir y cerrar cuadros muchas veces.
- Con una base de **60 mil ventas**, "Ventas hechas" sigue en **4 ms** (antes 43 ms) y nada de lo demás se volvió más lento.
- El servidor ocupa unos 210–225 MB de memoria en uso estable; es normal para Node con la base abierta. No se cambió.

**Revisado y sin problema:** todas las pantallas se revisaron buscando texto sin escapar (XSS): limpio.

**Lo que NO se cambió, a propósito:**
- **Vender más de lo que hay** sigue permitido (puede dejar existencias en negativo): así lo diseñamos para no frenar una venta. Es por diseño.
- El **folio del ticket** usa la fecha en hora universal (UTC), así que cerca de la medianoche de Guatemala puede mostrar el día siguiente. Es solo cosmético.

---

## 47. Corrección urgente: error 503 en Hostinger al subir la sección 44/45/46 (nuevo)

**Qué pasó (6 de noviembre, 10:53):** al subir la versión nueva, el sitio mostró **503 Service Unavailable**. El registro de Hostinger decía `ERR_REQUIRE_ASYNC_MODULE: require() cannot be used on an ESM graph with top-level await`.

**Causa:** Hostinger arranca el sistema con `require()` (`lsnode.js`). El archivo de miniaturas de fotos (`src/miniaturas.js`, sección 44) cargaba su pieza `jpeg-js` con una espera al nivel principal del archivo, y `require()` no admite eso: el sistema ni llegaba a abrir. En mi computadora arrancaba bien porque ahí se inicia con `node` directo, que sí lo admite. **No tuvo que ver con tu base ni con tus datos.**

**Arreglo:** `miniaturas.js` ahora carga `jpeg-js` sin esa espera (`createRequire`). Si la pieza faltara, el sistema arranca igual y manda las fotos originales. Revisé que **no quede ninguna otra espera de ese tipo** en el código.

**Prueba nueva (desde ahora se hace siempre):** instalación limpia desde el ZIP de HOSTINGER (`npm ci`) y arranque **cargándolo con `require()`, igual que Hostinger**, con tu base: responde `"base_datos":"ok"`, con y sin `jpeg-js`. Las miniaturas siguen funcionando (48/48).

## 48. Lo que no tiene stock en la tienda no se puede vender (nuevo)

**Lo que pediste (6 de noviembre):** "el producto que no haya en el inventario de la tienda que salga que no tiene stock y que no deje venderlo".

**Cómo se ve en Vender:**
- El producto sin existencias en **esa tienda** sale apagado, con una marca roja **"Sin stock"**. Al tocarlo no se agrega y un aviso dice qué falta (por ejemplo: *«Azulito con licor» no tiene stock en esta tienda. Falta: Esencia azul.*).
- Si hay poco, el pedido **no deja pasar de lo que alcanza**: el botón **+** y los toques en la tarjeta se detienen y avisan *«De X solo quedan 3»*.
- En los productos con **vidrio o lata**, cada presentación se revisa por separado: la que no hay sale apagada ("¡Se acabó!") y el producto solo sale "Sin stock" cuando no hay ninguna.
- Cada tienda tiene su propio inventario, así que lo que se ve y se permite depende de la tienda elegida arriba.

**Cómo se decide si "hay":** se usa **exactamente lo mismo que se descuenta al cobrar**: la receta (todos sus ingredientes; si **falta uno**, el producto no se puede preparar), el insumo de la presentación elegida (vidrio/lata) o, en los que se venden tal cual, la pieza del inventario. Un producto que no está ligado a ningún insumo no se bloquea. Las medidas en ml o en botellas con decimales se comparan sin errores de redondeo.

**El servidor también lo exige** (no solo la pantalla): si el pedido no alcanza, el cobro **no se guarda nada** y responde con el motivo. Se suma el pedido completo: dos micheladas que usan el mismo clamato se revisan juntas. Si otro aparato acaba de vender lo último, el cobro se frena con un aviso y el menú se actualiza solo.

**Mesas:**
- Al **agregar** algo a una mesa se revisa igual. Lo que ya está pedido en las cuentas abiertas **queda apartado** (se descuenta al cobrar), así que dos mesas no pueden pedir la última botella ni una venta directa llevársela.
- **Cobrar** la cuenta de una mesa **siempre se puede**: lo pedido ya se sirvió y se descuenta como siempre.

**Apagarlo si algún día hace falta:** en **Ajustes → 📦 Cuando se acaba algo** hay una casilla *"No dejar vender lo que no tiene stock en la tienda"* (viene marcada). Si la quitas y guardas, vuelve a funcionar como antes (se vende aunque el inventario diga cero).

**Qué NO cambia:** el inventario no se toca. Lo que sí se vende descuenta **exactamente igual** que antes (se comparó con la versión anterior). Solo se agrega una opción nueva en la configuración del negocio.

**Ojo con esto, porque cambia cómo se trabaja:**
- Con tu inventario actual, en **VIP** solo los **2 Azulitos** quedan sin stock (les falta esencia azul, vodka, Sprite o Power). En las demás tiendas, **mientras no registres su mercadería** (Inventario → *Llegó mercadería*, o pasándola con *🚚 Pasar a otra tienda*), **todo saldrá "Sin stock"**.
- Si un insumo menor está en cero porque no lo llevas contado (hielo, sal, escarchado…), **bloqueará todo lo que lo use**. El aviso dice cuál es; regístralo con algo de existencias o quita ese insumo de la receta.

## 49. "Mi caja" ya no se traba: se abre al instante (nuevo)

**Lo que contaste (6 de noviembre):** al tocar **Mi caja** la pantalla tardaba y parecía que se trababa.

**Qué la hacía lenta:**
- El cuadro de la caja **esperaba la respuesta del servidor antes de abrirse**. Con WiFi flojo o con el sitio ocupado no pasaba nada (ni un aviso) hasta que llegaba la respuesta, así que parecía trabado y la gente tocaba otra vez.
- Para sumar las ventas del turno, el servidor **revisaba todas las ventas del negocio** (no tenía un índice por turno). Con pocas ventas casi no se nota, pero crece con los meses; y esa misma consulta se hace al entrar, al cambiar de tienda, al tocar Mi caja y al cerrar la caja.

**Qué cambia:**
- **El cuadro se abre al instante** y dice *"⏳ Consultando tu caja…"* mientras llega la respuesta; después se llena solo con "Abrir mi caja" o "Cerrar mi caja". Medido con 1.5 segundos de retraso de internet: **antes tardaba 1.51 s en aparecer; ahora aparece en menos de 0.5 s**.
- **Un segundo toque mientras consulta no hace nada** (no se abren dos cuadros ni se piden dos veces los datos).
- **Sin internet:** el cuadro se cierra solo y avisa *"No se pudo consultar la caja…"* (antes no quedaba claro); al volver el internet, Mi caja funciona normal, no queda trabada.
- **El servidor busca las ventas del turno con un índice** (`idx_sales_shift`): al arrancar se crea solo, tarda un instante y **no cambia ningún dato** (ni de ventas, ni de caja, ni de inventario).

**Qué NO cambia:** los totales, el efectivo esperado, abrir/cerrar la caja y "Ver mis ventas" funcionan igual que antes.

## 50. Más liviano para la tableta + instalable como app (nuevo)

**Lo que pediste (6 de noviembre):** la tableta (Redmi Pad 2) se sentía lenta y trabada aunque el internet es de 100 Mbps; no se puede gastar en equipo nuevo, así que el sistema tiene que pedir menos a la tableta.

**Qué mostró la medición:** la captura de `/api/health?velocidad=1` dio **97 ms** de ida y vuelta, el servidor casi sin trabajo (0.1 ms para guardar, 9 ms de procesador, 1.4 ms para leer la base) y la tableta en **1106 ms** en su prueba (lo normal es menos de 400). O sea: no era el internet ni el servidor, era el trabajo que le tocaba hacer a la tableta. Para encontrarlo se **simuló una tableta con el procesador 6 veces más lento**, con tu base, y se midió qué hace el procesador al abrir y en cada pantalla.

**Lo que más pesaba (y ya no):**
- **Avisos que "latían" sin parar.** Los avisos rojos de insumos agotados (Inventario, Resumen) y las mesas con "cuenta pedida" tenían una animación infinita de sombra. Eso obliga a la tableta a **redibujar la pantalla 60 veces por segundo, todo el tiempo**, aunque nadie toque nada, y como tus tiendas nuevas tienen muchos insumos en cero, eran decenas a la vez. Ahora son un **aro fijo** (se ven igual de claros, sin moverse).
- **Animaciones de entrada** al abrir un cuadro y en la tarjeta de entrada: quitadas (los cuadros aparecen de una vez).
- **Mi caja** (sección 49): ahora abre al instante.

**Antes → ahora (tableta simulada 6× más lenta, con tu base):**
- Inventario abierto sin tocar nada: procesador al **33 %** → **0.1 %** (60 redibujos por segundo → 0).
- Resumen abierto sin tocar nada: **17 %** → **0 %**.
- Trabajo al abrir Inventario: **1,122 ms → 183 ms** (84 % menos); dibujo de la pantalla **954 ms → 48 ms**.
- Trabajo al entrar y ver el Resumen: **1,835 ms → 1,032 ms**.
- Las demás pantallas (Vender, Mesas, Menú, Ventas, Cortes, Personal, Ajustes) ya estaban quietas (0–1.5 %) y siguen igual.

**Instalarlo como app (nuevo):**
- Se agregó el ícono y los datos para que Chrome lo ofrezca como app. En cada tableta: abre el sitio en **Chrome → menú ⋮ → "Instalar aplicación"** (o "Agregar a la pantalla de inicio"). Queda el ícono **"El Mismísimo"** y **se abre en pantalla completa, sin la barra ni las pestañas del navegador** (menos cosas compitiendo por la memoria).
- Los **archivos del sistema** (página, estilos, programa, letra, íconos) se guardan en la tableta: abre más rápido y pide menos internet. **Si el WiFi se cae, la pantalla igual abre**, pero para vender, cobrar o ver el inventario **sí hace falta internet** (los datos nunca se guardan en la tableta: ventas, caja e inventario siempre vienen del servidor).
- **Se actualiza solo:** cuando subes una versión nueva, la página se pide primero al servidor y cada archivo trae su "huella"; al cambiar, se baja el nuevo y se borra el viejo. No hay que borrar nada ni usar Ctrl+F5.
- Solo se activa en tu sitio (https). En la computadora local (`localhost`) no se instala nada, así que probar en local sigue como siempre.

**Qué NO cambia:** ventas, caja, inventario, tickets, mesas y todos los datos funcionan igual.

**Límites:** las cifras vienen de una tableta simulada (no de la Redmi Pad 2 real). La prueba de "Velocidad de este aparato" mide el procesador de la tableta, así que ese número (1106 ms) **no va a bajar**; lo que debe cambiar es cómo se siente: pantallas quietas, sin trabarse, y Mi caja inmediata.

## 51. "Entrando…" tarda: ahora se ve quién se demora (nuevo)

**Lo que contaste (6 de noviembre):** en una tableta (usuario *pista*) el botón se queda en **"Entrando…"** muchísimo tiempo. Con el DNS cambiado fue peor (se quitó); con el DNS automático seguía igual.

**Qué se sabe:** "Entrando…" es **una sola petición** al servidor (la del login). La prueba de velocidad de antes dio 97 ms de ida y vuelta y el servidor casi sin trabajo, así que el atraso está en **lo que hace el login** (verificar la contraseña en el servidor), en **enviar datos (POST)** o en **abrir la conexión** (buscar el dominio y la conexión segura). No se podía saber cuál sin medirlo en esa tableta.

**Qué se agregó para saberlo (y para que no se cuelgue):**
- **El botón cuenta los segundos:** a los 3 segundos dice *"Entrando… 3 s"*, *"4 s"*… (así se ve que sigue esperando y cuánto lleva). Si pasan **45 segundos** sin respuesta, se corta y avisa que revises el WiFi (antes podía quedarse esperando para siempre).
- **El servidor avisa cuánto tardó él** en cada respuesta (cabecera `Server-Timing`). Con eso se separa el tiempo del servidor del tiempo de la red.
- **La prueba de velocidad** (`tu-sitio/api/health?velocidad=1`) tiene filas nuevas:
  - **🔌 Abrir la conexión (la primera vez):** cuánto tardó en buscar el dominio (DNS), conectar, la conexión segura y la respuesta del servidor.
  - **📤 Enviar datos al servidor (como al entrar):** compara enviar datos contra pedirlos (no cuenta como intento de entrar ni toca nada).
  - **🔐 Servidor: verificar una contraseña (lo que cuesta entrar):** lo normal es menos de 300 ms.
  - **🚪 Último "Entrar" en este aparato:** cuánto tardó en total, cuánto fue del servidor y cuánto de la red, con el veredicto en palabras.

**Cómo usarlo:** en la tableta con el problema, (1) entra al sistema una vez (aunque tarde); (2) abre `tu-sitio/api/health?velocidad=1` en el mismo Chrome; (3) mándame la captura. Ahí se ve si el atraso es del **dominio/conexión**, de **enviar datos**, del **servidor** o de la **red**.

**Qué NO cambia:** el inicio de sesión, las contraseñas y los permisos funcionan igual.

## Lo que TIENES que hacer

- **Sección 51 (Entrando… lento):** sube el ZIP (HOSTINGER) y reinicia. En la tableta con el problema: entra una vez, abre `tu-sitio/api/health?velocidad=1` y mándame la captura (ahí se ve si tarda el dominio, la conexión, enviar datos o el servidor). Deja el DNS privado en **Automático**.
- **Sección 50 (más liviano + app):** sube el ZIP (HOSTINGER) y reinicia; no hay nada que migrar. En **cada tableta**: (1) abre el sitio en Chrome y recarga una vez; (2) menú ⋮ → **Instalar aplicación** (o *Agregar a la pantalla de inicio*); (3) de ahí en adelante ábrela con el ícono **El Mismísimo**. Después, entra a *Inventario* y déjala quieta unos segundos: no debe calentarse ni trabarse. Si quieres comparar, vuelve a abrir `tu-sitio/api/health?velocidad=1` y mándame la captura.
- **Sección 49 (Mi caja rápida):** sube el ZIP (HOSTINGER) y reinicia; no hay nada que migrar (solo se crea un índice al arrancar). Pide que **recarguen la página** en cada aparato (si ya está abierta, seguirá con la versión vieja). Toca **Mi caja** con el WiFi del local: el cuadro debe aparecer de inmediato.
- **Sección 48 (sin stock):** sube el ZIP (HOSTINGER) y reinicia (se agrega sola una opción en la configuración; tus datos no cambian). **Antes de abrir el local**, entra a **Vender** en cada tienda y mira qué sale como **Sin stock**: registra la mercadería que falta (Inventario → *Llegó mercadería*). Si un insumo que no cuentas (hielo, sal…) bloquea productos, ponle existencias o quítalo de la receta. Si algún día necesitas vender sin revisar el inventario: **Ajustes → 📦 Cuando se acaba algo** y quita la marca. Pide que **recarguen la página** en cada aparato.
- **Sección 47 (503 en Hostinger):** sube este ZIP (HOSTINGER) y reinicia: corrige el error que dejó el sitio en 503. Abre `tu-sitio/api/health` y confirma `"base_datos":"ok"`. Tus datos no se tocaron.
- **Secciones 45 y 46 (pasar entre tiendas + revisión):** (1) **Antes de actualizar copia la carpeta `data`** (con el sistema apagado). (2) Sube el ZIP (HOSTINGER) y reinicia; se agregan solas tres tablas nuevas y tus ventas e inventario **no cambian**. (3) Abre `tu-sitio/api/health` y confirma `"base_datos":"ok"`. (4) Pide que **recarguen la página** en cada aparato (Ctrl+F5 o cerrar y abrir). (5) **Cambia las contraseñas `admin123` y `vendedor123`** en Personal si siguen activas: el sistema ahora avisa al administrador al entrar. (6) Prueba un traspaso chico: en Inventario toca **🚚 Pasar a otra tienda**, pasa 1 botella y revisa **📜 Ver traspasos** y las existencias de las dos tiendas. (7) Sigo esperando la captura de `tu-sitio/api/health?velocidad=1` desde la tableta del local.
- **Sección 44 (menos internet):** sube el ZIP (HOSTINGER) y reinicia; Hostinger instalará solo la pieza nueva `jpeg-js` junto con las demás. Verifica que Vender cargue y que las fotos se vean. Pide que **recarguen la página** una vez en cada aparato (la primera vez bajarán todo de nuevo; desde la segunda ya sale del aparato). Si algún día cambias una foto y ves la vieja, es la copia guardada del aparato: se actualiza sola al cambiarla. **Si Hostinger NO instala `jpeg-js`, no pasa nada grave**: el sistema manda las fotos originales como antes (solo pesan más). Tu conexión real: si el sistema sigue lento en el local, abre `/api/health?velocidad=1` en la tableta y mándame la captura.
- **Sección 43 (detalle de cortes):** sube el ZIP (HOSTINGER) y reinicia; no cambia la base. Entra a **Cortes de caja**, toca un corte y revisa que lo cobrado por efectivo, tarjeta y transferencia coincida con lo que tú recuerdas de ese día. Pide a quien use el sistema que **recargue la página** una vez.
- **Sección 42 (recargo 5 % con tarjeta):** sube el ZIP (HOSTINGER) y reinicia. Se agregan solas dos columnas (el recargo de cada venta y el porcentaje, que arranca en **5**); tus ventas e inventario **no cambian**. Después: (1) en **Ajustes** confirma que dice **5** en "Recargo al pagar con tarjeta (%)" (ahí lo cambias o pones 0 para apagarlo); (2) haz una venta de prueba con tarjeta y revisa que el total suba 5 % y que el ticket muestre "Recargo tarjeta 5%"; (3) **anúlala** para que no te ensucie el día. Avisa a los vendedores que **recarguen la página** de cada tableta/celular. **Copia la carpeta `data` antes de actualizar**, como siempre.
- **Sección 41 (velocidad):** sube el ZIP (HOSTINGER) y reinicia. No hay nada que migrar y **el inventario queda igual** (se agrega solo un índice al arrancar). Después de reiniciar: (1) abre `tu-sitio/api/health` y confirma `"base_datos":"ok"`; (2) abre **`tu-sitio/api/health?velocidad=1`** en la tableta y mándame la captura si algo se ve lento; (3) prueba **Ventas hechas**: debe abrir al instante.
- **Sección 40 (azulitos):** sube el ZIP y reinicia; aparecen **Azulito con licor (Q 30)** y **Azulito sin licor (Q 25)** con receta en ml y 4 insumos nuevos en 0. Anota en **Llegó mercadería** lo que tienes de esencia, vodka Absolut, Sprite y Power, **confirma los ml del Sprite chaparrita (237) y del Power (500)** y ponles costo en Inventario. Si el Sprite o el Power no son de esos tamaños, cambia la botella en **✏️ Cambiar** y la receta en el **Menú**.
- **Sección 39 (botellas en vez de paquetes):** sube el ZIP y reinicia; el inventario pasa a contar botellas solo (se guarda `respaldo_antes_de_botellas_…db`). Revisa en **Inventario** que los números cuadren con las botellas que tienes (Gallo 24, Jagger 15, Vitafer 50…). Si una cerveza o refresco es de **lata** y no de botella, cámbialo en **✏️ Cambiar** (Presentación).
- **Sección 37 (tus tragos en ml) y 38 (Llegó mercadería en 3 pasos):** sube el ZIP y reinicia. Tus insumos pasan solos a ml (se guarda `respaldo_antes_de_pasar_a_ml_…db`, no la borres hasta revisar y lee `medidas_en_ml.txt`). **Revisa en Inventario que los tamaños sean los tuyos** (Marinero 250, Gallo 350, Vitafer 500, Mineral 355, Jagger 700, Red Bull 250, cervezas 355, Tequila 750) y, si alguno no, cámbialo en **✏️ Cambiar** y en la receta. Luego prueba **📦 Llegó mercadería** con una compra de verdad y dime si todavía algo te confunde.
- **Sección 36 (medir en ml):** sube el ZIP. En **Inventario** toca **🔄 Pasar a ml** en los líquidos que quieras (Vitafer, Jagger, Tequila…), escribe cuántos ml trae cada pieza (viene en la etiqueta), revisa lo que te muestra y confirma. Tus bebidas cuestan lo mismo y se guarda una copia de seguridad (`respaldo_antes_de_pasar_a_ml_…db`; no la borres hasta revisar). Después las recetas nuevas escríbelas directo en ml. Lo que se vende entero (cervezas, latas) puedes dejarlo en piezas.
- **Sección 35 (error "malformed" en Hostinger):** si en Hostinger ya te salió, apaga la app, mueve los 3 archivos `mismisimo.db`, `mismisimo.db-wal` y `mismisimo.db-shm` de `mismisimo-data` a otra carpeta y vuelve a iniciar (sube antes el ZIP nuevo). Después de publicar, abre `tu-sitio/api/health`: debe decir `"base_datos":"ok"`.
- **Sección 34 (tu base):** puedes subir este ZIP encima de tu carpeta sin miedo: tu menú y tu inventario **no se tocan**. Sigue copiando la carpeta `data` de vez en cuando como respaldo (con el sistema apagado). Si agregas algo más y quieres que lo incluya, mándame de nuevo la carpeta `data` (con el sistema cerrado).
- **Sección 33 (menú solo con tu lista):** *si tu base ya tiene el menú que armaste tú (sección 34), esto no se aplica y puedes saltarte este punto.* Si no, sube el ZIP y reinicia. Se guarda la copia `respaldo_antes_de_menu_solo_lista_…db` (**no la borres hasta revisar**) y el Menú queda con tu lista. Revisa en **Menú** que esté todo lo que querías y ponle precio al **Bote de Vitafer**, **Miche coronita**, **Miche pacifico** y **Miche Montecarlo**. Si falta algo o sobra una michelada, dime.
- **Sección 32 (tu lista nueva):** sube el ZIP y reinicia. Al arrancar se guarda solo la copia `respaldo_antes_de_lista3_…db` (**no la borres hasta revisar**) y se carga tu lista. Entra a **Inventario** y pon el **costo** de la esencia azul, el licor del azulito, el Power, el Sprite, el Jagger y el Red Bull; haz un **📋 Contar inventario** para dejar bien las existencias de lo nuevo (empiezan en 0). Ponle precio al **Bote de Vitafer**, **Miche pacifico** y **Miche Montecarlo**. **Dime:** si "Jagger 20onz" son 2 oz, cuánto limón y sal lleva la Cimarrona, qué lleva la "michelada con jugo entero".
- **Sección 31 (líquidos):** sube el ZIP, abre **Inventario**, entra a **✏️ Cambiar** en cada licor que quieras medir en onzas y ponle su **botella** (o crea el insumo nuevo en oz, como explica la sección), y haz tu primer **📋 Contar inventario** al cerrar. Mándame las cantidades reales de tus bebidas (azulito, Adrenalina, etc.) para dejarte las recetas armadas.
- **Sección 30 (fotos):** sube el ZIP y reinicia la aplicación; las fotos aparecen solas. Crea los productos **Bote de Vitafer**, **Miche pacifico** y **Miche Montecarlo** (o dime sus precios y los creo) y manda la foto de las **Alitas**.
- **Sección 29 (imprimir de una vez):** en cada tableta o celular Android que use la térmica, instala **RawBT**, agrega la impresora (Bluetooth) y en el sistema toca **⚙️ Impresora → Directa → Imprimir prueba**. Si algo sale raro, desmarca tildes o logo; si no sale nada, vuelve a "Con vista previa". **Sube el ZIP nuevo a Hostinger**: el de tu video todavía tenía el ticket de 80 mm en dos hojas.
- Revisa en **Menú** los precios (los de tu libreta ya están puestos; ver sección 22), ponles precio a los 3 cubetazos y quita lo que no quieras de los 5 que dejé.
- **Fondo claro u oscuro:** el sistema abre en claro (como la foto del cliente). Cada aparato puede cambiarlo con el botón de abajo en la barra lateral y lo recuerda. Enséñale ese botón al vendedor que lo prefiera oscuro (sección 24).
- Entra a **Menú → 💲 Poner precios** y escribe el precio de lo que quieras vender (lo demás se queda pausado).
- Registra el inventario inicial en **Inventario → Llegó mercadería** y, cuando puedas, el costo de cada insumo.

- Entra a **Menú** y ponle **tu precio de promoción** a los 3 cubetazos (vienen al precio de 6 cervezas sueltas). Registra en Inventario las cervezas **Gallo Light** (y Corona si no las tenías).

- Revisa el **costo del clamato** en Inventario: la segunda hoja de la libreta lo dejó en **Q 4.70 el litro** (sección 25). Si tu litro cuesta otra cosa, cámbialo y los costos de marineros y micheladas se recalculan solos.
- **Sección 25:** confirma mis suposiciones (Papas = Lays, Alitas = Alitas Pío Lindo, sopas, "3x5" = 3 cigarros por Q 5) y dime qué es **VB**. Registra en Inventario las existencias de lo nuevo (alitas, azulitos, VB, cigarros), que empieza en 0.
- **Sección 26:** el cobro ya no calcula el cambio; el vendedor lo hace de cabeza. Si lo extrañan, avísame.
- Registra en Inventario ("Llegó mercadería") las **latas de Gallo** que tienes, en cada sucursal.
- En Hostinger define la variable de entorno **`JWT_SECRET`**:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- **Cambia las contraseñas** `admin123` y `vendedor123` en la pestaña Personal.
- **Antes de actualizar, copia la carpeta `data`** (es tu base de datos) a un lugar seguro. El sistema la convierte sola al arrancar con la versión nueva; la copia es por si algo saliera mal.
- Entra a **Personal** y marca en cuáles sucursales trabaja cada vendedor (los de antes pasan a **Cruce**) y agrega a los de las demás.
- En cada sucursal que use mesas, agrega sus mesas (empiezan sin mesas), y registra la mercadería inicial en **Inventario → Llegó mercadería** (empieza en cero).
- Al actualizar, las sesiones abiertas se cierran: cada quien vuelve a entrar.
- En tu computadora pon el zoom del navegador en **100 %** (Ctrl + 0); la página ya viene a tamaño cómodo (sección 11).
- El archivo `README.md` es el original y aún menciona botones y pantallas viejas; no afecta el funcionamiento.

## Verificación realizada

- **"Entrando…" con diagnóstico (sección 51):** 13 comprobaciones de pantalla del botón (cuenta los segundos desde el 3.º, corta a los 45 s con aviso, guarda el tiempo del último "Entrar", clave mala sigue mostrando su mensaje y entrar normal sigue igual) y 30 + 14 de la prueba de velocidad con las filas nuevas (10 filas; contraseña, enviar datos, abrir la conexión y último "Entrar"). El servidor manda `Server-Timing` en las respuestas de `/api` sin cambiar el contenido. **Inventario idéntico:** la misma venta hecha en la versión anterior y en esta, sobre tu base, deja **exactamente** los mismos descuentos, cajas y reportes, con el bloqueo de stock apagado **y** encendido (con existencias de sobra). Todo lo anterior se volvió a pasar completo (Mi caja, app instalable, sin stock, traspasos, cobros, mesas, seguridad, vender en computadora y celular) y sigue igual. El ZIP de Hostinger se cargó con `require()` tras instalar limpio, y el LISTO arrancó sobre tu base (versión 13) con `"base_datos":"ok"`.
- **Más liviano + app (sección 50):** medición en una tableta simulada **6 veces más lenta** con tu base (antes → ahora): procesador con Inventario abierto y quieto **33 % → 0.1 %**, con Resumen **17 % → 0 %**, trabajo al abrir Inventario **1,122 → 183 ms**, dibujo **954 → 48 ms**; las otras 7 pantallas quietas (0–1.5 %). **21 comprobaciones de la app instalable** (servidor y pantalla, con Chrome real): el servidor entrega el manifiesto, `sw.js` (siempre pregunta si hay versión nueva) y los 3 íconos; **en `localhost` sin pedirlo no se instala nada**; con el guardado activo se **guardan la página, estilos y programa**, se arma un pedido y **se cobra** (la venta queda en la base), **no se guarda ningún dato** (nada de `/api/` en lo guardado) y `/api/health` sale del servidor; **sin internet la aplicación abre** desde lo guardado pero **la API falla** (no inventa datos) y al volver el internet todo sigue normal; al cambiar un estilo cambia su huella, se baja el nuevo y **se borra el viejo**; Chrome la da por **instalable (0 errores de instalación)**; 0 errores de consola. Se repitió la regresión completa **sin fallas**: Mi caja 20, velocidad 30 + 14, red liviana 48, sin stock 69 + 66, tu base 31, azulitos 10, mesas abiertas "todo igual", traspasos 56, reintentos 27 + 17, seguridad 28, administrador 22, inventario **idéntico** (2 pruebas), ticket 23, directo 48, Vender 35, cobro 61, 7 sucursales 25, mesas 6 + 41 + 41.
- **Mi caja rápida (sección 49):** 20 comprobaciones de pantalla sobre **tu base** (computadora y celular): con **1.5 s de retraso de internet** el cuadro aparece en **menos de 0.5 s** (la versión anterior tardaba **1.51 s**, se probó lado a lado), dice "Consultando tu caja…", un segundo toque no pasa nada raro, después muestra "Abrir mi caja" o "Cerrar mi caja" con el dinero inicial, "Ver mis ventas" abre bien, **sin internet** avisa y no queda un cuadro vacío, y al volver el internet funciona otra vez; 0 errores de consola. El índice nuevo no cambia datos: **velocidad 30 + 14, red liviana 48, tu base 31/31, inventario idéntico en las dos pruebas, mesas abiertas "todo igual"**.
- **Sin stock (sección 48):** 69 comprobaciones del servidor y 66 de pantalla (computadora y celular) sobre **tu base**: el producto sin existencias en la tienda sale "Sin stock" y no se agrega; el servidor también lo rechaza y **no guarda nada**; lo pedido en mesas queda apartado; **cobrar una mesa nunca se bloquea**; los ingredientes compartidos se suman; la casilla de Ajustes lo apaga y lo enciende. Se comparó **versión anterior vs nueva** (ventas, mesa, anulación, compra, merma): **existencias, movimientos, insumos, recetas y opciones idénticos**, con el bloqueo apagado y con existencias suficientes. Tu base queda **sin cambios** (solo una opción nueva en la configuración, encendida): 31/31. Se repitió toda la regresión: traspasos 56, claves de reintento 27 y 17, seguridad 28, ticket 23, directo 48, cobro 61, Vender 35, 7 sucursales 25, mesas 6 + 41 + 41, administrador 22, azulitos 10 y migración a ml 38 (las pruebas viejas ahora apagan el bloqueo porque su base de pruebas no tiene botellas).

- **Pasar entre tiendas (sección 45):** 56 comprobaciones del servidor sobre tu base (solo administrador, por botellas y por unidad pequeña, "Todo", al revés, no pasar de más, mismo origen y destino, tienda inexistente, renglones y cantidades raros, insumos repetidos que se juntan, "pasar todo" deja el origen en cero exacto, historial por tienda y folios, movimientos con folio, el resto del inventario idéntico) y 58 de pantalla (tableta y celular: botones solo para administrador con más de una tienda, buscar, escribir botellas, Todo, resumen, confirmar, historial). Inventario existente comparado con la versión anterior: **IGUAL**.
- **Revisión (sección 46):** 27 comprobaciones de claves de reintento (mismo cobro repetido = una sola venta, también tras reiniciar el servidor) y 17 de pantalla con la red cortada a propósito; 28 de seguridad (límite de intentos, cabeceras, 404 de API, cuerpos raros); 554 peticiones absurdas → **0 errores del servidor** y la base íntegra; 30,000 peticiones → memoria **+1.9 MB**; velocidad igual o mejor con 60 mil ventas; y la serie completa de pruebas anteriores (cobro, mesas, líquidos, sucursales, tickets, recargo, cortes, velocidad, azulitos, ml) pasa igual. Una prueba vieja (`vender_simple_ui` con la base actual) ya fallaba antes de estos cambios y no afecta nada.
- **Menos internet (sección 44):** 48 comprobaciones sobre tu base y tus 16 fotos reales (servidor y pantalla, tableta y celular), más medición con WiFi simulado de 8 y de 2 Mb/s. Página con huella en estilos y programa, `no-cache` en la página y 304 si no cambió; versión correcta = guardado 1 año, versión equivocada o sin versión = pregunta siempre; el programa es **idéntico** salvo la línea que importa `escpos.js`; si cambia un estilo, cambia solo su huella; las gráficas, la letra y el logo conservan su guardado de antes; un aparato sin gzip recibe todo normal. Fotos: cada miniatura es un JPEG válido de máx. 256 px (560 KB → 207 KB), sin `&m=1` o con otro valor se manda la **original byte por byte**, fotos raras (un PNG, un archivo dañado) se mandan tal cual sin error, una foto cambiada genera su miniatura nueva, **tus fotos en la base quedaron exactamente iguales**, y **sin `jpeg-js` instalado el servidor arranca y manda las originales**. En pantalla: el menú se pide **una sola vez** al entrar, las tarjetas y la lista del menú muestran las miniaturas sin fotos rotas, y al volver a abrir los estilos, el programa y las fotos salen del aparato con **0 bytes** de internet; 0 errores de consola. Toda la regresión anterior se repitió **sin fallas** (inventario, mesas abiertas y base: idénticos).
- **Detalle de cortes (sección 43):** 39 comprobaciones sobre tu base real, servidor y pantalla (tableta y celular). Los cortes que ya existen en tu base: el total de cada uno es la suma de sus ventas, las formas de pago suman lo mismo, y lo guardado al cerrarlos coincide. Corte nuevo con efectivo, tarjeta, transferencia y mixto: cada forma de pago separada, recargo de Q 3 aparte, anulada fuera del total, "debería haber" = inicial + efectivo (abierta y cerrada), Q -5 de diferencia, notas, unidades por producto, anulación **después del cierre** avisada sin reescribir el conteo. Un vendedor y una persona sin sesión **no** pueden verlo; un corte de otra sucursal no se ve; id inválido da error claro. En pantalla: la fila abre el detalle (toque y Enter), el cuadre, las formas de pago, las anuladas y las notas se ven bien y **nada se sale del ancho en celular**; 0 errores de consola. Toda la regresión anterior se repitió **sin fallas**.
- **Recargo 5 % con tarjeta (sección 42):** 43 comprobaciones del servidor sobre **tu base real** y 35 de pantalla (tableta y celular). Servidor: al actualizar, las ventas de antes quedan **exactamente iguales** (recargo 0), el inventario y sus movimientos **idénticos**, la versión de la base sigue en 13 y el porcentaje arranca en 5; efectivo, transferencia y mixto **sin recargo**; tarjeta **+5 %** (Q 60 → Q 63, mesa de Q 90 → Q 94.50) aunque una pantalla vieja mande el total sin recargo, sin cambio; el redondeo a centavo (Q 15 × 2.5 % → Q 0.38); **cobrar con efectivo o con tarjeta baja exactamente lo mismo del inventario** y anular devuelve lo mismo; la caja suma lo cobrado con tarjeta con su recargo y el **efectivo esperado no cuenta la tarjeta**; anular una venta con tarjeta devuelve todo; Ajustes rechaza porcentajes inválidos (-1, 51, texto, listas), 0 apaga el recargo, guardar otros datos sin mandar el porcentaje **no lo borra** y un vendedor no puede cambiarlo; "Ventas hechas", el ticket abierto después y el Excel (columna "Recargo tarjeta") cuadran. Pantalla: al tocar Tarjeta el total sube y explica "Cuenta + recargo por tarjeta (5%)", al volver a Efectivo o Transferencia regresa a la cuenta, el ticket en pantalla y el de impresora térmica traen la fila "Recargo tarjeta 5%", el ticket en efectivo no, la mesa cobra con recargo, y en Ajustes el campo muestra 5, guarda 10 y 0, y **el cobro ya usa el valor nuevo sin recargar la página**; nada se sale del ancho en celular; 0 errores de consola. **Comparación versión anterior vs nueva** con las mismas 24 ventas, mesa, anulación, compra, merma: ventas de efectivo y transferencia **idénticas**, las de tarjeta = subtotal + 5 %, **existencias (136 filas), movimientos de inventario (64), insumos, recetas y opciones idénticos**. Se repitió **toda** la regresión anterior (41, 41, 6, 30, 14, 64, 129, 82, 41, 107, 25, 22, 23, 48, 59, 69, 61, 35, 30, 20, 61, 52, 38, 33, 10, 24, 69, 22 y mesas abiertas "todo igual"). Cuatro pruebas viejas se actualizaron por el 5 % (el cobro con tarjeta de Q 20 ahora es Q 21; "Ventas hechas" trae una columna más; y dos que comparaban "ninguna tabla cambió" ahora ignoran solo las 2 columnas nuevas del recargo): **todas pasan**. **No se probó con una terminal de tarjeta real.**
- **Velocidad (sección 41):** 30 comprobaciones del servidor (índice nuevo y sin migración, la base ya en versión 13 queda en 13, el inventario y las tablas no cambian al arrancar, respuestas comprimidas e idénticas, errores 400/401 iguales con compresión, cobrar con compresión, prueba de velocidad sin dejar archivos, apagón brusco con 8 ventas confirmadas sin perder ninguna, instalación nueva) y 14 de la página de la prueba (tableta, celular, tableta lenta con internet lento; sin errores), 6 de cobrar una mesa con internet lento (versión anterior contra nueva) y las 41 + 41 del vendedor en tableta y celular (mesas, guardar, cobrar mesa con pedido sin guardar). **Versión anterior contra nueva con las mismas operaciones sobre tu base: inventario (existencias y movimientos), ventas, cajas, insumos y recetas idénticos.** 72 respuestas de Ventas hechas y Resumen idénticas con 60 mil ventas. Después se repitieron todas las pruebas de antes (versiones 8, 9, 10, líquidos, ml, botellas, azulitos, compra en 3 pasos, cobro simple, administrador): **todas bien**.
Pruebas automáticas con un navegador simulado (Chromium) contra el servidor, en tableta, celular y computadora:

- **42 comprobaciones del vendedor** (se repitieron en tres tamaños: tableta común 1024×768, tableta bajita 843×526 y celular 390×844): entrar con contraseña mala y buena, abrir caja, vender en efectivo (**con cambio, dinero insuficiente y aviso de cambio enorme hasta la sección 25; desde la sección 26 el cobro ya no los trae y esas pruebas se cambiaron por las del cobro simple**), tarjeta, abrir mesa, guardar, ver cuenta e imprimirla, cobrar mesa con pedido sin guardar, cancelar cuenta,
  salir con pedido pendiente, y que el cobro se abra dentro del panel (sin ventana), que "Volver" regrese al pedido y que el botón COBRAR quede a la vista. **42 de 42 bien en los tres tamaños.**
- **22 comprobaciones del administrador:** resumen, insumo nuevo, compra, merma, producto a Q 12.75, borrar con confirmación,
  persona nueva (contraseña corta rechazada), desactivar, ajustes, descarga CSV, borrar ventas con la palabra BORRAR. **22 de 22 bien.**
- **29 comprobaciones de seguridad:** tokens falsos, permisos del vendedor, cantidades inválidas, métodos de pago inválidos, textos largos. **29 de 29 bien.**
- Texto con código malicioso (`<img onerror…>`) en nombre de cliente, producto y categoría: se muestra como texto, no se ejecuta.
- Sin errores en la consola del navegador ni cuadros nativos del navegador durante las pruebas; ninguna petición a sitios externos.
- Las comprobaciones se repitieron después de los cambios de velocidad y de los de tableta: siguen todas bien (42, 22, 29 y el de código malicioso).
- **Revisión de pantallas automática + capturas:** 12 tamaños de tableta (de 843×526 a 1366×1024, de pie y acostada) con la barra visible y oculta, celulares
  (de 320 a 412 px de ancho y acostado), pantallas anchas (de 1024 a 1920 px), con letra normal, grande y muy grande. Se buscó texto encimado, texto cortado, botones fuera de la pantalla
  y cuadros que se salen, en: Vender, pedido, cobro (con cambio hasta la sección 25; después, cobro con Efectivo/Tarjeta/Transferencia), Mesas, cuenta de una mesa, caja y las 7 pantallas del administrador. **0 problemas.**
- Al deslizar la lista de bebidas se mantienen ~60 cuadros por segundo, también con fotos puestas en todos los productos.
- **Menú simplificado:** 44 comprobaciones de la pantalla nueva (agregar con 4 datos, "Más opciones", pausar y volver a vender, inventario en sus 3 formas, quitar con y sin ventas, secciones nuevas, orden con flechas, quitar sección con productos), también sobre una instalación nueva. **Todas bien.**
- **Quitar mesas:** 40 comprobaciones (solo administrador, mesa con cuenta abierta rechazada, ventas viejas intactas, no se puede abrir ni transferir a una mesa quitada, confirmación en pantalla, celular con letra muy grande). **Todas bien.** Después se repitieron ventas, caja, seguridad, Menú, fotos y pantallas de tableta/celular: sin problemas.
- **Fotos de productos:** 27 comprobaciones del servidor (sin sesión 401, vendedor 403, PNG o HTML disfrazados de JPEG 400, foto de 400 KB 413 con mensaje, producto inexistente 404, reemplazar, quitar, borrar el producto borra su foto, el catálogo no trae los bytes)
  y 29 de pantalla (elegir, vista previa, guardar, reabrir, quitar, archivo que no es foto, foto alta/ancha/cuadrada, producto nuevo con foto, el menú del vendedor muestra las fotos, y si una foto falla vuelve el dibujo). **Todas bien.**
- **Dibujos de las bebidas:** las 20 bebidas de prueba muestran su dibujo (0 imágenes rotas, 0 peticiones a sitios externos) en 7 tamaños de pantalla con letra normal y muy grande;
  se repitieron las 42 + 22 + 29 comprobaciones y la revisión de pantallas (tabletas, celulares, pantallas anchas, letra normal, grande y muy grande): **0 problemas**.
- La pantalla "Secciones del menú" del administrador se cortaba en celulares con letra muy grande; ahora cada sección se muestra en su propia tarjeta. Revisión de pantallas del administrador (cuadros de producto con foto, insumos, compras, mermas, personal, secciones) en tabletas, celulares y pantallas anchas: **0 problemas**.
- **Sucursales (servidor):** 142 comprobaciones sobre una base de datos antigua con ventas, cajas, mesas y movimientos: cada vendedor solo entra a sus sucursales (403 si pide otra o pide "Ambas"), cabecera inventada o con código rechazada, ventas / existencias / mesas / cajas / compras / mermas aisladas por sucursal, "Ambas" solo en reportes, pausar por sucursal, personal con sucursales, no quitar una sucursal con la caja abierta, insumos nuevos y sucursal nueva. **142 de 142 bien.**
- **Conversión de la base de datos antigua:** 51 comprobaciones (se arranca tres veces seguidas: no duplica nada, no cambia ni una venta ni una existencia, los vendedores de antes quedan en El Mismísimo, no se pisan NIT ni teléfono, no reaparecen cervezas de ejemplo). **51 de 51 bien.** Además se abrió esa base convertida en pantalla: mismo inventario, mismas mesas, mismas ventas y mismo total en El Mismísimo; VIP en cero (12 de 12 bien).
- **Sucursales (pantalla):** 89 comprobaciones, también sobre una instalación nueva: selector y cambio de sucursal (con pedido pendiente pregunta), caja y ventas de cada una por separado, mesa nueva en VIP, mercadería de VIP sin tocar El Mismísimo, ticket y cuenta de mesa con la sucursal, pausar solo en VIP, "Ambas" (reportes sí; Vender, Mesas e Inventario piden elegir), archivo de Excel, personal con casillas de sucursales, agregar y renombrar sucursales, barra de arriba oculta, vendedor con una sola sucursal, y un vendedor al que le quitan una sucursal mientras trabaja. **89 de 89 bien.**
- Se repitieron todas las pruebas de antes (40 de mesas, 42 + 42 del vendedor, 22 del administrador, 29 de seguridad, 44 del Menú, 29 de fotos y la del código malicioso): **todas bien**. En una instalación nueva la prueba del archivo de Excel marca "falla" solo porque todavía no hay ventas que bajar.
- **Revisión de pantallas con las sucursales** (tabletas, celulares, pantallas anchas, barra normal y oculta, letra normal y grande, incluyendo "Ambas", la pantalla de elegir sucursal y los cuadros nuevos): **0 problemas**. La barra de arriba sigue en una sola fila en tableta y computadora; en celular el selector ocupa una fila propia.
- **Tamaño nuevo en computadora (sección 11):** revisión de pantallas en 7 tamaños de computadora (de 1100×700 a 1920×1080, con mouse), barra normal y oculta, letra normal, grande y muy grande, vendedor y administrador, incluyendo "Ambas", los cuadros nuevos y todos los cuadros de inventario y menú: **0 problemas**. Los cuadros emergentes cubren toda la pantalla, el ticket al imprimir no cambia de tamaño, y las tabletas y celulares (táctiles) se ven igual que antes. Después se repitieron todas las pruebas de antes (40, 43, 43, 22, 29, 44, 29, 89 + 89, 142, 12, 51 y las de tabletas y celulares): **todas bien**.
- **Imagen grande y barra nueva (secciones 12 y 13):** se repitieron todas las pruebas de antes (40, 43, 43, 22, 29, 44, 29, 89 + 89, 142, 12 y 51: **todas bien**) y la revisión de pantallas en computadora (7 tamaños, letra normal y muy grande, vendedor y administrador), tabletas (acostadas y de pie, barra visible y oculta, letra normal, grande y muy grande) y celulares (de 320 a 412 px, de pie y acostados): **0 problemas**. Antes de entregar se vio con capturas cómo queda la tarjeta en computadora, pantalla bajita, tableta de pie, tableta acostada y celular.
- **Marinero y vidrio/lata (sección 14):** 83 comprobaciones del servidor (se repiten en base con datos, base antigua e instalación nueva): precios Q10/Q15/Q15, cuánto baja cada producto (1 L, 1 L + limón + salsas, 0.5 L + una Gallo), vidrio y lata descuentan cada uno lo suyo, sin elegir se rechaza sin descontar nada, opción inventada o de otro producto rechazada, venta en otra sucursal solo baja las existencias de esa sucursal, mesa (agregar no descuenta, cobrar sí), renombrar una opción con la cuenta abierta, quitar las opciones con la cuenta abierta, producto "tal cual" con opciones (baja solo la elegida), costo, vendedor sin permiso (403), no borrar un insumo usado por una opción, pausar por sucursal. **83 de 83 bien.**
  Pantallas: 76 comprobaciones (tableta, celular, 320 px con letra muy grande, pantallas bajitas, Menú del administrador en computadora, tableta de pie y celular; también en instalación nueva): elegir, Escape, Enter, personalizar sin elegir, mesa con la misma bebida dos veces, ticket, inventario, crear / renombrar / quitar opciones. **76 de 76 bien.** Nombres de opciones con código malicioso se muestran como texto (9 de 9) y la conversión de la base antigua (65 comprobaciones: no cambia ni un producto, receta, insumo ni existencia de antes, no se duplica al reiniciar, y si ya tenías un "marinero" no agrega nada) pasó entera.
  Se repitieron todas las pruebas de antes (40, 43, 43, 22, 29, 44, 29, 89 + 89, 142, 12 y 51→65) y la revisión de pantallas de tabletas y celulares: **0 problemas**. Al revisar con capturas se corrigió el cuadro de "Personalizar" en celulares muy angostos con letra muy grande (se salían el escarchado y el botón "Cancelar").
- **Anular ventas (sección 16):** 66 comprobaciones del servidor: el inventario vuelve exacto (receta + producto directo + presentación lata), también en cuentas de mesa, en la otra sucursal y **aunque se haya cambiado la receta después**; no se anula dos veces; vendedor solo lo suyo y de su caja abierta (403 en otra caja cerrada, de otro cajero o de otra sucursal); el administrador sí en caja cerrada y el corte queda anotado sin reescribir lo contado; motivo obligatorio y con código malicioso guardado como texto; resumen, mes, lo más vendido, formas de pago, resumen de caja y corte de caja excluyen lo anulado; Excel con columnas nuevas. **66 de 66 bien.**
  Pantallas: 46 comprobaciones (vendedor en tableta y administrador en computadora; ticket recién hecho, lista "Ventas de mi caja", "Ventas hechas" con filtro, Resumen, Excel con fecha en hora local, celular de 360 px, menú desplegable de la tableta, sin descuento). **46 de 46 bien.**
- **Cubetazos y sin descuento (secciones 17 y 18):** 17 comprobaciones (3 productos con receta 6 / 3+3 / 6, precios, bajan el inventario correcto y vuelve exacto al anular, el descuento mandado por fuera se ignora en venta y en mesa). **17 de 17 bien.**
- **Lista de productos y "Poner precios" (sección 19):** 69 comprobaciones del servidor en **tres escenarios** (base limpia, base antigua con datos e instalación nueva, 69 de 69 en cada una): se crean los 47 productos en su sección, en Q0 y pausados; no salen en "Vender" ni se pueden vender a la fuerza; no se repiten los que ya existían ni se duplican los insumos (Gallo, Gallo light, lata, Corona, Coca); inventario en 0 en las dos sucursales; recetas correctas (cubetazo de Gallo Light = 6, micheladas = 1 cerveza); la ruta de precios rechaza precios inválidos, al vendedor, más de 500 y es todo o nada; los precios puestos se activan solos y aparecen en "Vender"; no cambia precios ya puestos. Pantallas: 38 comprobaciones (computadora, tableta y celular: abrir el cuadro, escribir con teclado, Enter pasa al siguiente, no se sale de la pantalla, el botón desaparece al terminar). **38 de 38.** La prueba de migración de la base antigua (66 comprobaciones) se actualizó con las cifras nuevas y pasa completa.
- **Menú solo con tu lista (sección 20):** 41 comprobaciones en 5 escenarios (base limpia, base antigua con ventas, instalación nueva, con la variable de demostración y "Quitar" un producto vendido): queda exactamente la lista (51) + los 5 de antes (4 que pediste antes y el cubetazo de Gallo) y ningún producto de ejemplo; los 4 renombrados conservan precio e insumo; el inventario no cambia; los productos de ejemplo con ventas se ocultan y el historial (ventas, totales, líneas) queda igual; lo que el dueño creó o renombró no se toca; reiniciar no repite nada ni hace reaparecer lo que el dueño borra; se puede borrar la sección o el insumo de un producto oculto. **41 de 41.**
- **7 sucursales, libreta de precios y recetas (secciones 21 y 22):** 89 comprobaciones del servidor (base de demostración, base antigua con una caja abierta, instalación nueva y la variable de pruebas): quedan las 7 sucursales en orden, VIP es la misma, El Mismísimo se oculta sin perder ventas, mesas, cajas ni existencias, las nuevas nacen con todos los insumos en 0, el vendedor entra a Cruce y no puede entrar a la oculta; los precios y costos de la libreta quedan exactos; **vender 2 Cimarrona + 3 micheladas baja 2 aguas minerales, 1.5 L de clamato y las 3 cervezas correctas solo en esa sucursal, y anular la venta lo devuelve todo**; lo que el dueño ya había puesto no se pisa; reiniciar no cambia nada; ocultar / mostrar con todas sus reglas. **89 de 89 bien.** Pantallas: 25 comprobaciones (selector de 7, Vender con los 18 productos, cobro que baja la mineral, Ajustes con ocultar y mostrar y confirmación, celular sin desbordes, vendedor de una sola sucursal). **25 de 25 bien.** Se repitieron todas las pruebas de antes.
- **Barra lateral, fondo claro y pantallas simples (secciones 23 y 24):** 45 comprobaciones nuevas de pantalla (administrador en computadora, vendedor en celular y tableta de pie): la barra con las 9 pantallas del administrador y las 3 del vendedor, pegada a la izquierda y sin movimiento de lado; ya no existen "Ocultar barra" ni el menú ☰; abre en fondo claro, el botón pasa a oscuro y claro, se recuerda al recargar y **otro aparato no se entera**; Mesas (conteos, ABRIR CUENTA, Ver pedido y Cobrar, filtros), Inventario (buscador, "Se está acabando", "Ver costos y más"), Menú (filtros y buscador), Resumen (gráficas en un cuadro que se abre); el pedido de la tableta de pie queda a la derecha de la barra. **45 de 45 bien.** La tarjeta de Vender (foto, nombre, precio, número redondo y lápiz): 35 de 35.
  Se repitieron todas las pruebas de antes contra la pantalla nueva: mesas 40, ventas del vendedor 43, anular 66 + 45, administrador 22, seguridad 29, Menú 44, fotos 29, sucursales 88 (pantalla) + 142 (servidor) + 66 (conversión), vidrio/lata 83 + 75 (también instalación nueva), cubetazos 17, lista y precios 69 + 38 (también instalación nueva y base antigua), menú de ejemplo fuera 41, 7 sucursales 105 + 25. **Todas bien.** Las pruebas viejas que buscaban el menú ☰, "Ocultar barra" o el contador de mesas se actualizaron a la pantalla nueva.
  **Revisión de pantallas (nada encimado, cortado ni fuera de la pantalla)** con la barra lateral, en fondo claro **y** oscuro: tabletas acostadas y de pie, celulares de 320 a 412 px y acostados, pantallas anchas y computadoras de 1100×700 a 1920×1080, letra normal, grande y muy grande, vendedor y administrador (incluyendo "Ambas" y todos los cuadros emergentes): **0 problemas** en las 15 tandas.
- **Segunda hoja de precios y cobro simple (secciones 25 y 26):**
  **Servidor:** 82 comprobaciones de la conversión 8 (base de demostración, una base con lo que el dueño ya había cambiado, base antigua con ventas, instalación nueva y la variable de pruebas): los 15 productos de la hoja quedan con su precio y costo, el clamato en Q 4.70, el aderezo en Q 3.82, el Marinero preparado en Q 8.52, las micheladas con su receta, lo que no trae precio sigue pausado, **no se pisa un precio que ya habías puesto**, las existencias de antes no se tocan, se vende de verdad (cigarros, VB, Miche corona) y baja del inventario lo correcto, **anular esa venta lo devuelve todo (aderezo incluido)** y se arranca dos veces sin duplicar nada.
  **Pantalla:** 61 comprobaciones del cobro nuevo en computadora, tableta acostada, tableta de pie y celular, en fondo claro y oscuro (solo hay Efectivo / Tarjeta / Transferencia, no hay billetes ni teclado ni cambio ni nota, los botones están a la vista y son grandes, el título se lee) y **ventas reales** con los tres métodos: se guarda una venta, por Q 20 exactos, con el método elegido, recibido = total y cambio 0.
  Se repitieron todas las pruebas de antes: mesas 40, vidrio/lata 83 + 75 (2 veces), anular 66 + 45, cubetazos 17, lista de productos 69 (3 bases) + 38, vendedor 41 (3 tamaños), administrador 22, seguridad 29, Menú 44, fotos 29, sucursales 88 (pantalla) + 142 + 107 (servidor) + 66 (conversión), limpieza 41, barra lateral y fondo claro 45, vender simple 35 y sucursales en pantalla 25: **todas bien** (se actualizaron solo los números esperados: ahora "Vender" muestra 31 productos con precio en vez de 18).
- **Hueco en blanco y barra lateral (sección 27):** 81 comprobaciones nuevas en 10 tamaños de celular y tableta de pie (con letra normal, grande y muy grande): la lista llega hasta la barra sin hueco y sin quedar tapada, al final de la lista la última bebida queda pegada arriba de la barra, y **también cuando la página mide 54 px menos que la pantalla** (como en el iPhone del video; antes el hueco era de unos 65 px, ahora de 10). Se repitieron todas las pruebas de antes (mesas 40, vidrio/lata 83 + 75, anular 66 + 45, cubetazos 17, lista 69 + 38, vendedor 41 en 3 tamaños, administrador 22, seguridad 29, Menú 44, fotos 29, sucursales 88 + 142 + 107 + 66, limpieza 41, segunda hoja 82, barra lateral 45, vender simple 35, sucursales en pantalla 25, cobro simple 61) y las **15 revisiones de tamaños de pantalla: 0 problemas**. Con letra grande en un celular muy bajito y acostado la barra de abajo ocupa media pantalla (ya era así).
- **Ticket a 58 mm (sección 28):** 23 comprobaciones nuevas en computadora, tableta, celular y celular angosto (320 px): el ticket trae folio, fecha corta, cajero, productos, total y forma de pago; ya no dice "Importe recibido" ni "Cambio"; la vista previa cabe en el cuadro sin salirse; el botón Imprimir arma la hoja y manda imprimir **una sola vez**; al imprimir todo lo demás queda oculto; el PDF a **58 mm** trae el ticket completo y nada de la pantalla del sistema, cabe en **una hoja**, el contenido queda entre los **7 y 51 mm** (la térmica imprime de 5 a 53 mm) y el fondo sale blanco. Se repitieron vendedor 41 + 41, anular 45, vidrio/lata 75, sucursales 88 + 25, administrador 22, barra lateral 45, hueco en blanco 81, vender simple 35 y cobro simple 61: **todas bien**. **No se probó con la impresora real** (solo el PDF a 58 mm).
- **Impresión directa con RawBT (sección 29):** 48 comprobaciones nuevas en tableta Android simulada, celular y compu: el cuadro "Impresora" (se abre encima del ticket, se recuerda al recargar, Directa apagada en aparatos que no son Android), **ticket, cuenta de mesa y ticket de prueba** mandan un enlace de RawBT con el formato documentado por RawBT (`intent:base64,…#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`) **sin abrir el cuadro del sistema**; los bytes se **decodificaron uno por uno con un intérprete ESC/POS** y se comprobó que ningún renglón pasa de las 32 letras, que están folio, cajero, productos, total (letra grande), forma de pago y gracias, que con "tildes" sale la tabla de caracteres de español y sin ellas todo en letras simples, que el logo llega en 320 puntos y se lee bien (MICHELADAS / El Mismísimo), que sin logo no se manda dibujo, que termina con papel de sobra, que **un doble toque seguido saca un solo ticket** y que si algo falla al armar el ticket se abre el cuadro normal y avisa. El cuadro "Impresora" se revisó en 5 tamaños (compu, tableta, celular, celular angosto y acostado) en fondo claro y oscuro: a la vista, sin desbordes y con buen contraste. Se repitieron vendedor 41 + 41, anular 45, vidrio/lata 75, sucursales 88 + 25, administrador 22, barra lateral 45, hueco en blanco 81, vender simple 35, cobro simple 61 y ticket 23: **todas bien**. **No se probó con la impresora real ni con la app RawBT** (no hay Android aquí): lo que se comprobó es lo que el sistema le entrega a RawBT. Por eso el modo "Con vista previa" sigue siendo el de arranque y se puede volver a él con un toque.
- **Fotos del dueño (sección 30):** 22 comprobaciones del servidor: las 13 fotos son JPEG cuadrados de 480 px (menos de 300 KB); en una base antigua que se convierte quedan puestas **10 fotos exactamente en los 10 productos esperados y cada una es la suya** (bytes idénticos al archivo); las 3 sin producto esperan; Vender las muestra y el catálogo no trae los bytes; al reiniciar no se repite ni cambia nada; **una foto que puso el administrador no se pisa**; una foto quitada con "Quitar foto" **no reaparece**; los productos creados después (con mayúsculas, tildes o espacios distintos) reciben su foto **en el siguiente arranque**; con la variable del menú de ejemplo no se pone nada; instalación nueva bien. Se repitieron fotos 27 (servidor) + 29 (pantalla), conversión 66, limpieza 41, 7 sucursales 107 + 25, segunda hoja 82, vender simple 35, vendedor 41, administrador 22, sucursales 88, cobro 61, ticket 23 e impresión directa 48: **todas bien**.
- **Control estricto de líquidos (sección 31):** 59 comprobaciones del servidor: la botella (nombre y tamaño en oz, ml, L, piezas o gramos, se guarda en la medida del insumo), cuántas botellas + cuántas oz quedan, **llegó mercadería por botella** (3 botellas de 25.36 oz = 76.08 oz, el costo por oz sale de lo que cuesta cada botella, media botella vale), **conteo físico** (lo que debía haber contra lo contado, la diferencia en cantidad y en quetzales con el costo de ese día, "solo anotar" no mueve las existencias y "anotar y corregir" las deja exactas con un movimiento "ajuste", historial con detalle, por sucursal, solo administrador, números inválidos rechazados), recetas con **decimales** (¾ = 0.75, 1.5 oz) que bajan exacto al vender y **vuelven exactos al anular**, y que **no se puede cambiar la medida de un insumo que ya está en el Menú**. **59 de 59.**
  Pantalla: 69 comprobaciones (el recuadro de botella, el cálculo en vivo de cada diferencia, el total de faltante y sobrante, anotar sin y con corrección, el historial, la receta que ahora **recalcula su costo al momento** y muestra cuánto cuesta cada ingrediente). **69 de 69.**
  **Revisión de pantallas de los cuadros nuevos** (Contar inventario con diferencias, conteos anteriores y su detalle, insumo con botella, llegó mercadería por botella, receta con botella) en 12 tamaños (tabletas, celulares de 320 a 412 px, acostados, computadoras de 1100×700 a 1920×1080), fondo claro y oscuro, letra normal y muy grande: 288 estados. La primera pasada encontró 3 cosas reales y se corrigieron: el detalle de un conteo se cortaba en celular (ahora cada insumo es una tarjeta), los botones "Conteos anteriores" y el filtro se salían con letra muy grande, y la fila de receta se apretaba en tabletas con letra muy grande (el ingrediente ocupa su propia fila). **Después de corregir: 0 problemas.** Se repitieron además los 15 grupos de revisión de pantallas, el vendedor (3 tamaños), el administrador, la seguridad, vidrio/lata, anular, cubetazos, lista de precios, sucursales, fotos, ticket e impresión directa: **todo bien**.
- **Tu lista nueva (sección 32):** 129 comprobaciones del servidor, sobre la base de demostración, una **base antigua con ventas** y una **instalación nueva**: la copia de seguridad se guarda antes de cambiar nada y trae la base de antes completa (abre sin errores); el texto de lo borrado trae las existencias y la sucursal; se borran **exactamente los 22 insumos** que ningún producto usaba, no queda ningún insumo sin uso ni llave rota, y **ni un producto ni una venta de antes se pierde**; los 23 precios de la lista quedan exactos; **cada receta baja exactamente lo que dice** (azulito con licor: 2 oz de esencia, 1.5 oz de licor, ½ Sprite, ⅓ de Power; Jagger sola 2 oz; Jaggerbomb 2 oz + ⅓ de Red Bull; alitas: 1 alitas + 1 papas; Volteaditos: 1 soda + 1 octavo; Cimarrona: 1 mineral + 0.03 L de limón + 3 g de sal; 1 shot de Vitafer = 10 ml); **50 shots de Vitafer = 1 bote = 500 ml**; **2 Gallo lata sueltas + 3 micheladas de gallo lata bajan 5 del MISMO insumo** (y lo mismo con Gallo de vidrio, papas de alitas + papas sueltas, Jagger sola + Jaggerbomb), y se comprobó que **cada ingrediente de cada receta (20 pares) es el mismo insumo que descuenta el producto cuando se vende solo**; anular una venta con fracciones (⅓, ½, 1.5) devuelve el inventario exacto; "Contar inventario" y "Llegó mercadería" funcionan con el Vitafer en ml y por bote; reiniciar no repite nada ni deshace lo que el dueño cambie; con las variables de demostración y de pruebas no se toca nada; **si la limpieza falla a mitad de camino la base queda exactamente como estaba** (y se reintenta al reiniciar). **129 de 129.**
  Se repitieron las pruebas de las conversiones anteriores (libreta 82, limpieza 41, 7 sucursales 107, fotos 22), las de líquidos (59 + 69), ticket 23, impresión directa 48, cobro 61, Vender 35 y sucursales en pantalla 25 (solo cambió el número de productos con precio en Vender: de 31 a **40**) y la revisión de pantallas con el menú nuevo en celular con letra muy grande, tableta, computadora y administrador: **0 problemas**.
- **Menú solo con tu lista (sección 33):** 64 comprobaciones del servidor: sobre una base con **ventas y una cuenta de mesa abierta**, con copia de seguridad (versión 9 completa, abre sin errores), el Menú queda con **exactamente los 31 productos** (27 con su precio y a la venta, 4 pausados en Q0), no queda ninguno de lo demás, el inventario queda con **exactamente los 27 insumos** que se usan, sin secciones vacías, sin llaves rotas y con la base sana; **lo que ya tenía ventas o estaba en una cuenta abierta se oculta en vez de borrarse** y las ventas, renglones, totales, tickets, el Resumen y la cuenta de mesa quedan intactos; las fotos de lo que se queda siguen (10) y la de un producto quitado vuelve sola si se crea otra vez; el texto de lo borrado trae existencias; "Vender" muestra 27 productos y se puede vender lo que quedó (azulito, michelada light, Vitafer, alitas con papas) bajando lo correcto; reiniciar no repite nada; **desde la versión 8 directo a la 10** (dos copias de seguridad), con las variables de pruebas no se toca nada, **si falla a mitad de camino la base queda como estaba** y se reintenta, y también sobre una base antigua con ventas y una instalación nueva. **64 de 64.**
  Se repitieron las pruebas de la lista nueva (129), de las conversiones anteriores (libreta 82, limpieza 41, 7 sucursales 107, fotos 22), de líquidos (59 + 69), ticket 23, impresión directa 48, cobro 61, sucursales en pantalla 25 (ahora con **27** productos en Vender) y Vender 35, y la revisión de pantallas con el menú nuevo (celular con letra muy grande, tableta, computadora, vendedor y administrador): **todo bien, 0 problemas**.
- **Tu base real (sección 34):** 30 comprobaciones del servidor con **tu base completa (con el `-wal` unido)**: el sistema arranca con ella y **ninguna tabla cambia ni una fila** (productos, insumos, recetas, existencias, ventas, fotos, usuarios; solo se marca la versión 10), no se crea copia ni nota de borrado, "Vender" en VIP muestra tus 16 productos con sus precios, **se vende de todo en una sola venta** (cada michelada y su cerveza suelta bajan **del mismo insumo**: Gallo de vidrio, Pacífico y Monte Carlo; JaggerBomb baja 0.07 de Jagger y 0.33 de Red Bull; 5 shots de Vitafer; Cimarrona = media mineral; 3 shots de El Santo; alitas con papas) y **anular devuelve el inventario exacto**, el Menú, el Inventario y el Resumen del administrador abren bien, y reiniciar no cambia nada. En una **carpeta nueva sin base** arranca con tu base (16 productos, 13 insumos, 16 recetas, 16 fotos, usuarios y existencias), **no se vuelve a copiar** al reiniciar (un precio cambiado se queda) y no deja archivos temporales; si la base inicial estuviera dañada avisa y empieza con una de ejemplo. La base que viaja en el sistema es **idéntica byte por byte** a tu base ya unida. **30 de 30.** Se repitieron: menú solo con tu lista 64 (sobre una base sin limpiar sigue limpiando igual), lista nueva 129, libreta 82, limpieza 41, 7 sucursales 107 + 25, fotos 22, ticket 23, impresión directa 48, líquidos 59 + 69, cobro 61 y Vender 35: **todas bien**. No se repitió la revisión de tamaños de pantalla porque no cambió ninguna pantalla.
- **Base mezclada (sección 35):** 20 comprobaciones del servidor: con una base vieja apagada de golpe (su `-wal` de 1.7 MB con ventas sin pasar a la base) se prueba (A) que **sin base y con esos restos** arranca con la base inicial, aparta el `-wal` y el `-shm` (quedan guardados), la base sale **sana**, con sus 16 productos y 13 insumos, **se cobra sin error**, `/api/health` dice `ok` y no quedan archivos temporales; (B) que **con tu base subida a mano y el `-wal` viejo** avisa que estaba mezclada, aparta los dos archivos, la base queda sana con todo lo tuyo (16 productos, 13 insumos, 4 ventas, existencias) y se cobra sin error; (C) que **un `-wal` bueno (apagado de golpe) NO se aparta** y la venta hecha antes del apagón sigue ahí; (D) que con una base **realmente dañada** `/api/health` dice `REVISAR`, el registro lo dice fuerte y no se toca ni se borra nada. **20 de 20.** Se repitieron la prueba con tu base (30) y las de regresión: menú solo con tu lista 64, lista nueva 129, libreta 82, limpieza 41, 7 sucursales 107 + 25, fotos 22, ticket 23, impresión directa 48, líquidos 59 + 69, cobro 61 y Vender 35: **todas bien**.
- **Medir en ml (sección 36):** 61 comprobaciones del servidor y 52 de pantalla, sobre **tu base real**. Servidor: la vista previa no cambia nada; los ml mal escritos (0, negativos, texto, más de 100,000) se rechazan con mensaje claro; **Vitafer a 500 ml** deja 50 → 25,000 ml, mínimo 5,000, costo Q 0.015 por ml, paquete 10,000 ml, el shot en 10 ml y "Vitafer Botella" como receta de 500 ml; **el costo de tus 16 bebidas y el valor del inventario quedan idénticos**; vender después baja los ml correctos (2 botellas = 1,000 ml, 3 shots = 30 ml) y **anular una venta hecha antes de convertir devuelve 500 ml, no 1**; Tequila (sin botella) con 750 ml guarda su botella y convierte las **dos sucursales** con existencias; litros (×1,000) y onzas (×29.5735) se convierten solos, con recetas y opciones del cliente; los gramos se rechazan; volver a convertir se rechaza; el vendedor y quien no entró no pueden; **si algo falla a la mitad se deshace todo** (se probó con una falla forzada: nada cambió y la copia de seguridad sí quedó); no se puede crear ni editar un "tal cual" con un insumo en ml. Pantalla: el botón aparece donde corresponde y no en botanas, la vista previa en vivo muestra lo que hay, el costo, el paquete, las recetas y los productos "tal cual", el botón se apaga con valores malos, la fila queda en ml con "Q 0.015 por ml", elegir "ml" en un insumo que ya existe abre la conversión, el insumo nuevo sugiere su medida según el tipo y calcula el costo por ml (botella de 750 ml a Q 190 = Q 0.253333), y en el Menú la receta de Vitafer Botella muestra 500 ml a Q 7.50. **Celular chico (320), celular (390), tableta (768) y computadora: sin que nada se salga a los lados**, botón de confirmar fijo y grande, 0 errores de consola. **61 de 61 y 52 de 52.** Se repitieron todas las anteriores (menú solo con tu lista 64, lista nueva 129, libreta 82, limpieza 41, 7 sucursales 107 + 25, fotos 22, ticket 23, impresión directa 48, líquidos 59 + 69, cobro 61, Vender 35, tu base 30 y base mezclada 20): **todas bien**. La primera pasada encontró dos cosas y se corrigieron: un ejemplo de la ayuda de la receta (¾ = 0.75) que había quitado, y una prueba de la versión 10 que fallaba a veces porque dos copias de seguridad hechas en el mismo segundo se llamaban igual (ahora la segunda lleva `-2`).
- **Tus tragos en ml (sección 37):** 38 comprobaciones del servidor con **tu base real**: se convierten exactamente tus 11 insumos (las Alitas y las Papas no), con los tamaños de la tabla; **el costo de tus 16 bebidas y el valor del inventario quedan idénticos**; cada michelada baja 250 ml de Marinero y su cerveza; una venta, una anulación (devuelve los ml correctos) y una compra después de convertir cuadran al ml; si el Vitafer ya estaba en ml no se vuelve a convertir; **si algo falla a la mitad se deshace todo** (se probó forzando un error) y el sistema sigue arrancando en piezas; con la base de demostración **no se aplica**, y una carpeta nueva arranca con tu base ya en ml; solo se guarda **un** respaldo y la nota `medidas_en_ml.txt`.
- **Llegó mercadería en 3 pasos (sección 38):** 69 comprobaciones de pantalla con tu base (ya en ml): el inventario dice "≈ 24 botellas" (Mineral "≈ 23 botellas + 177.5 ml"); al abrir solo se ve el paso 1; cerveza y licor se cuentan en **botellas (o latas) o ml**, las botanas en paquetes o piezas, un insumo sin presentación solo en piezas; la cuenta en pantalla (24 botellas = 8,400 ml, hay 8,400 → habrá 16,800) coincide con lo guardado; **con costo**, el costo por ml queda en 6.50 / 350; **sin costo, el costo no se toca**; Enter guarda; sin elegir nada, con cantidad 0 o negativa **no guarda nada**; la factura y la nota se guardan; el cuadro sigue abierto para anotar varios seguidos y el movimiento queda en la sucursal correcta; en **celular de 320 y 390, tableta y computadora** no se sale de la pantalla, todo mide 40 px o más para tocar con el dedo y el botón Guardar se alcanza. Se actualizaron las pruebas viejas que usaban la pantalla anterior (líquidos 69, administrador 22) y pasan.
- **Botellas en vez de paquetes (sección 39):** 24 comprobaciones del servidor con **tu base real**: parte de la versión 11 (como la tienes hoy) y pasa a la 12 con la base sana; los **10 insumos** pasan a **una botella de su tamaño** (la lata de Gallo, "lata"); Tequila, Alitas y Papas no cambian; **ni una existencia, costo, mínimo, receta, opción, movimiento, producto ni venta cambia** (se compara tabla por tabla); se guarda **una sola** copia de seguridad (abre sin errores, con la presentación de antes) y la nota; comprar **24 botellas a Q14** suma 8,400 ml y deja el costo en Q14 por botella; Mineral queda en 23.5 botellas; al reiniciar **no se repite**; si el dueño ya puso otra presentación ("caja"), o el paquete no es de botellas exactas, o el insumo no tiene presentación, **no se toca**; si algo falla a la mitad (se probó forzando un error) **se deshace todo** y el sistema arranca igual, y al reiniciar sin la falla se aplica; con la base de demostración no se aplica; una carpeta nueva ya arranca con botellas.
- **Azulitos (sección 40):** 33 comprobaciones del servidor y 10 de pantalla con **tu base real**: parte de la versión 12 (como la tienes hoy) y pasa a la 13 con la base sana; se agregan **4 insumos en ml** (esencia 250, vodka 750, Sprite 237, Power 500, sin costo y con existencias en 0 en las **8 sucursales**) y los **2 azulitos** con su receta exacta en ml; **ni un insumo, existencia, producto, costo, receta, opción, movimiento ni venta de antes cambia** (se compara tabla por tabla); una sola copia de seguridad (abre sin errores, versión 12, sin azulitos) y la nota; "Vender" en VIP pasa de 16 a **18 productos**; anotar mercadería suma 250 / 750 / 2,844 / 3,000 ml; **vender 2 azulitos con licor y 1 sin licor baja 177 ml de esencia, 88 ml de vodka, 355.5 ml de Sprite y 501 ml de Power**, y **anular esa venta devuelve todo**; al reiniciar **no se repite**; si algo falla a la mitad (se probó forzando un error) **se deshace todo** y el sistema arranca igual, y al reiniciar sin la falla se agrega; si ya existe su "Azulito con licor" (con otro precio), o un "Sprite" en piezas, **no se agrega nada y no se toca lo suyo**; si ya tiene un "Sprite" en ml se usa ese sin duplicarlo; con la base de demostración no se aplica; una carpeta nueva ya trae los azulitos. En pantalla: Inventario con los 4 insumos (y "≈ 12 botellas" de Sprite tras anotarlo), Menú con la receta en ml y Vender con los 2 azulitos a Q 30 y Q 25.
- **No se probó en un Hostinger real**, ni con una impresora térmica real, ni en aparatos físicos (las tabletas y celulares son simulados en el navegador). Una tableta real con la barra del navegador abierta puede tener menos altura que la simulada: si ves algo apretado, avísame el modelo de la tableta.

## Pendiente (no incluido)

- **Impresión directa con corte de papel y abrir cajón**, y directa en computadora con Windows por USB (hoy la computadora usa el cuadro de imprimir normal). En iPhone / iPad no es posible. La directa de Android (sección 29) ya está.

- (Resuelto en la sección 45: ya se puede pasar mercadería entre tiendas, por botellas.)
- El administrador no puede cerrar la caja de otra persona; por eso no se puede quitar una sucursal a quien la tiene abierta.
- Zona horaria del servidor (UTC vs Guatemala), corte de caja con pagos mixtos,
  costos desactualizados en recetas ya guardadas y los puntos menores de la revisión (5 al 11).
- (Resuelto en la sección 48: lo que no tiene stock en la tienda ya no se puede vender; se puede apagar en Ajustes.)
- (Resuelto en la sección 18: ya no hay descuentos a mano.)
- Un vendedor con mala intención podría anular y quedarse con el dinero: por eso cada anulación deja nombre, hora y motivo y el Resumen muestra las anuladas de hoy. Si quieres que **solo el administrador** pueda anular, se cambia en un punto del servidor.
