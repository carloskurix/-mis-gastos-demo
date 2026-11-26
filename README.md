# Mis Gastos — versión para desplegar en la nube (gratis)

Registro personal de gastos: crear cuenta e iniciar sesión, agregar, editar
y borrar gastos (descripción, monto en MXN, categoría, fecha), total del
mes en grande, desglose por categoría, buscador y filtro, y cambio de mes.
Cada usuario ve solo sus propios gastos.

- **Tecnología:** Node.js 18+ sin framework (solo `http` + `pg`).
- **Base de datos:** Postgres real en Render cuando existe `DATABASE_URL`;
  en local (o si la base no responde) guarda en `data/mis-gastos.json`.
- **Seguridad:** contraseñas con PBKDF2 + sal, sesiones con token
  aleatorio que expira en 7 días, validación en cliente y servidor
  (monto mayor a cero, campos obligatorios, nada de fechas futuras).
- **Montos:** se guardan en centavos (enteros) para no perder precisión.
- **Diseño:** minimalista, móvil primero, buen contraste, usable con
  teclado y lector de pantalla (etiquetas y `aria-live`).

> Ojo: esto **no** se ha probado contra un Postgres real todavía. La
> primera prueba real será en Render después de desplegar. La base de
> datos gratis de Render dura **30 días**: si se vence, se crea otra
> y se vuelve a desplegar.

## 1. Probarlo en tu laptop (opcional)

1. Instala [Node.js 18 o más](https://nodejs.org) (botón LTS).
2. Descomprime este ZIP en una carpeta, por ejemplo `mis-gastos-codigo`.
3. En la terminal, entra a la carpeta y corre:
   ```
   node server.js
   ```
   (No necesitas instalar nada: sin `DATABASE_URL` no usa `pg`.)
4. Abre http://localhost:3000, crea tu cuenta y agrega un gasto.
5. Para detenerlo, presiona `Ctrl + C` en la terminal.

Los datos de prueba se guardan en `data/mis-gastos.json`. Este ZIP
viene limpio: 0 usuarios, 0 gastos, 0 sesiones.

## 2. Subirlo a GitHub (gratis)

1. Crea tu cuenta en https://github.com (botón **Sign up**).
2. Ya dentro, arriba a la derecha, **+ > New repository**.
3. Nombre del repositorio: **`mis-gastos-demo`**
4. Que sea **Public** (público), **sin** README, **sin** .gitignore
   y **sin** licencia (las tres casillas sin marcar).
5. **Create repository**.
6. En la página del repo, haz clic en **uploading an existing file**
   (o **Add file > Upload files**).
7. Sube **el contenido** de la carpeta descomprimida (los archivos
   `package.json`, `server.js`, `render.yaml`, `README.md` y las
   carpetas `public` y `data`), no la carpeta en sí. El archivo
   `render.yaml` tiene que quedar en la raíz del repo.
8. **Commit changes**.

## 3. Desplegarlo en Render (gratis)

1. Crea tu cuenta en https://render.com con **Sign up with GitHub**
   (usa la misma cuenta de GitHub del paso 2).
2. En el panel, arriba a la derecha: **New > Blueprint**.
3. Elige el repositorio **`mis-gastos-demo`** y dale a **Connect**.
4. Render lee `render.yaml` y crea dos cosas juntas: el servicio
   web **`mis-gastos-demo`** (plan Free) y la base de datos
   **`mis-gastos-db`** (plan Free, Postgres). La variable
   `DATABASE_URL` se conecta sola; `SESSION_SECRET` también se
   genera sola.
5. Dale a **Deploy Blueprint** y espera a que termine (tarda unos
   minutos la primera vez; el plan gratis se "duerme" si nadie lo
   usa y tarda unos segundos en despertar la primera visita).
6. Cuando diga **Live**, abre el link que te da Render, algo así:
   `https://mis-gastos-demo.onrender.com`

## 4. Verificar que quedó bien

1. Abre el link, crea tu cuenta y agrega un gasto de prueba.
2. Recarga la página: el gasto tiene que seguir ahí (así sabes que
   la base de datos real está guardando).
3. Pásame el link aquí y yo lo verifico contigo: creo una cuenta
   de prueba, agrego un gasto y confirmo que persiste.

## Archivos del proyecto

```
mis-gastos-codigo/
├── package.json        Solo depende de pg (Postgres)
├── server.js           API + servidor de archivos estáticos
├── render.yaml         Blueprint: web mis-gastos-demo + Postgres mis-gastos-db
├── README.md           Esta guía
├── data/
│   └── mis-gastos.json Datos locales (JSON) cuando no hay Postgres
└── public/
    ├── index.html      La página (registro, login, gastos)
    ├── styles.css      Diseño minimalista
    └── app.js          Lógica del navegador (llama a la API)
```

## API (para referencia)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | /api/register | Crea cuenta (nombre, correo, contraseña) |
| POST | /api/login | Inicia sesión, devuelve token (7 días) |
| POST | /api/logout | Cierra la sesión |
| GET | /api/me | Datos del usuario actual |
| POST | /api/change-password | Cambia la contraseña |
| GET | /api/categories | Lista de categorías |
| GET | /api/expenses?month=AAAA-MM&category=&q= | Gastos + total del mes + por categoría |
| POST | /api/expenses | Crea un gasto |
| PUT | /api/expenses/:id | Edita un gasto propio |
| DELETE | /api/expenses/:id | Borra un gasto propio |
