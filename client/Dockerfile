FROM node:22-alpine

WORKDIR /usr/src/app

# Install dependencies (including devDeps needed for the build)
COPY package*.json ./
RUN npm ci

# Copy source and build for production
COPY . .
RUN npm run build

# Expose the frontend port
EXPOSE 3000

# Production entry point: Node.js HTTP server wrapping the Nitro SSR handler
CMD ["node", "docker-server.js"]
