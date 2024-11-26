# Build stage
FROM node:20 AS builder
WORKDIR /app
COPY package.json ./
RUN npm install -g bun http-server && bun install
COPY . .
RUN bun run build

# Production stage
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package.json ./
RUN npm install -g bun && bun install
EXPOSE 5173
CMD ["bun", "dev"]