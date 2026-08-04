# Vite bakes VITE_API_URL into the compiled JS bundle at build time, and
# that bundle runs in the *browser* on the host machine -- not inside the
# Docker network -- so it must point at a host-reachable address (the
# backend's mapped port), not an internal service name like "backend:4000".
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
