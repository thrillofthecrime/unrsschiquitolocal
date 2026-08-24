FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    UNRSS_DB=/data/unrsschiquito.db

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# La base vive en /data, afuera de la imagen: actualizar el contenedor no la toca.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node

EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
