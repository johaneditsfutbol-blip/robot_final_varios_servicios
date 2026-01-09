# Usamos una imagen oficial de Puppeteer que ya trae Chrome instalado
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Trabajamos como usuario root para evitar problemas de permisos al instalar dependencias
USER root

# Directorio de trabajo
WORKDIR /usr/src/app

# Copiamos archivos de configuración
COPY package*.json ./

# Instalamos dependencias
RUN npm install

# Copiamos el resto del código
COPY . .

# Exponemos el puerto (Railway usa este puerto internamente)
EXPOSE 3000

# Comando de inicio
CMD [ "node", "index.js" ]
