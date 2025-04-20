FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy app source
COPY . .

# Make the reset script executable
RUN chmod +x reset-config.sh

# Expose Vite's default port
EXPOSE 5173

# Reset config file then run Vite dev server
CMD ["sh", "-c", "npm run dev"]
