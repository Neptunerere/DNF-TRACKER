FROM node:22-alpine
WORKDIR /app
COPY services/market/package*.json ./
RUN npm ci
COPY services/market/tsconfig.json ./
COPY services/market/src ./src
USER node
CMD ["npm", "run", "api"]
