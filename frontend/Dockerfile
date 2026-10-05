FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# L'adresse de l'API est intégrée au site lors de la compilation
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S memprot && adduser -S memprot -G memprot
COPY --from=build /app/public ./public
COPY --from=build --chown=memprot:memprot /app/.next/standalone ./
COPY --from=build --chown=memprot:memprot /app/.next/static ./.next/static
USER memprot
EXPOSE 3000
CMD ["node", "server.js"]
