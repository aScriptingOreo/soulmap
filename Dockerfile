# Build stage
FROM node:20 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
RUN npm install -g bun && bun install
COPY . .
RUN bun run build

# Production stage
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package.json bun.lockb ./
RUN npm install -g bun && bun install --production
EXPOSE 5173
CMD ["bun", "run", "serve"]