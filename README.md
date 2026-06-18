# Calculadora de Subneteo y Enrutamiento Estático

PWA offline para clase de Redes. Calcula subneteo IPv4 paso a paso y genera rutas estáticas Cisco por IP de siguiente salto.

## Ejecutar localmente

```bash
python3 -m http.server 4173
```

Abrir:

```text
http://127.0.0.1:4173/index.html
```

## Desplegar en Coolify

1. En Coolify, entra a tu proyecto y selecciona **Create New Resource**.
2. Elige **Public Repository** o tu integración de GitHub.
3. Usa este repositorio:

```text
https://github.com/dev1206al/AppRedes-IPs.git
```

4. En **Build Pack**, selecciona **Static**.
5. En **Base Directory**, usa:

```text
/
```

6. Deja el servidor web como **Nginx**.
7. Configura tu dominio o subdominio.
8. Activa HTTPS/Force HTTPS si tu dominio ya apunta al miniserver.
9. Pulsa **Deploy**.

Para que la PWA pueda instalarse correctamente en iPhone, debe abrirse por HTTPS.

## Instalar en iPhone

1. Abrir la URL desplegada en Safari.
2. Tocar el botón de compartir.
3. Elegir **Agregar a pantalla de inicio**.
4. Abrir desde el ícono creado.
