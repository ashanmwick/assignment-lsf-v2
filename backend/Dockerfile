# Single image, reused for three different roles via the `command:` override
# in docker-compose.yml: run-once migration, run-once seed, and the long-
# running API server. Runs TypeScript directly through tsx (the same way
# `npm run dev` / `npm run seed` already do locally) rather than adding a
# separate compiled-JS build step -- one execution model everywhere, simple
# enough for this project's scope.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4000

CMD ["npx", "tsx", "src/server.ts"]
