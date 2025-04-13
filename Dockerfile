# Build stage
FROM node:20 AS builder
WORKDIR /app
# Install required system packages - improved OpenSSL installation
RUN apt-get update -y && \
    apt-get install -y openssl libssl-dev procps ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install -g bun concurrently http-server && bun install
RUN npm i @prisma/client prisma

# Copy source files
COPY . .

# Create necessary directories and copy static files
RUN mkdir -p res/styles
RUN cp -f src/styles/leaflet.css res/styles/

# Copy the schema.prisma file with binary targets
COPY ./server/prisma/schema.prisma ./server/prisma/schema.prisma

# Generate Prisma client with the correct binary targets
RUN cd server && npx prisma generate

# Make sure the build script has the right environment
RUN echo "Building application..."
RUN NODE_ENV=production bun run build

# Production stage
FROM node:20-slim
WORKDIR /app
# Install required system packages - improved OpenSSL installation
RUN apt-get update -y && \
    apt-get install -y openssl libssl-dev procps ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
RUN npm install -g bun && bun install
RUN npm i @prisma/client prisma concurrently http-server

# Generate Prisma client again for production with the correct binary targets
RUN cd server && npx prisma generate

EXPOSE 5173 3000

# Create a startup script to handle DB initialization
COPY --from=builder /app/docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

# Use the startup script as entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "start"]