# client/Dockerfile (example)
FROM node:20-bullseye AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bullseye AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next .next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
RUN npm ci --production
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
