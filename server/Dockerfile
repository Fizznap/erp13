FROM node:18-alpine

# Install dependencies required by some libs (if needed)
RUN apk add --no-cache build-base python3

WORKDIR /usr/src/app

# copy package info first to leverage Docker cache
COPY package*.json ./
RUN npm ci --production

# copy rest
COPY . .

# expose server port
EXPOSE 3001

# default prod start; override in compose for dev
CMD ["node", "src/index.js"]
