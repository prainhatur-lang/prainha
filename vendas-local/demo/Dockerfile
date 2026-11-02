# Servidor de DEMONSTRAÇÃO do Concilia: o mesmo vendas-local das lojas, rodando
# na nuvem com um cardápio de exemplo. Quem baixa o app na maquininha digita o
# código "demo" em "Buscar empresa" e entra com login teste / PIN 1234.
# Build a partir da pasta vendas-local:  fly deploy . --config demo/fly.toml
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY facelib ./facelib
COPY demo ./demo
ENV TZ=America/Sao_Paulo NODE_ENV=production
EXPOSE 8790
CMD ["sh", "demo/iniciar.sh"]
