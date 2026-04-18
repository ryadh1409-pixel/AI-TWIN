FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production --legacy-peer-deps
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
