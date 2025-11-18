FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src ./src

WORKDIR /app/src
CMD ["node", "server.js"]

