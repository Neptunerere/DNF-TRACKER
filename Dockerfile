FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node app ./app
COPY --chown=node:node public ./public
COPY --chown=node:node .openai ./.openai
COPY --chown=node:node next.config.ts tsconfig.json vite.config.ts ./
COPY --chown=node:node --chmod=755 docker/web-entrypoint.sh /usr/local/bin/web-entrypoint
RUN mkdir -p /app/.vinext /app/.wrangler /app/.next && chown -R node:node /app
EXPOSE 3000
USER node
ENTRYPOINT ["/usr/local/bin/web-entrypoint"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
