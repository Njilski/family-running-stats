# Familiens Løbeklub — Cloud Run image
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Copenhagen

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run injects PORT (defaults to 8080)
EXPOSE 8080
CMD ["node", "server.js"]
