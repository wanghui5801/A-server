# Build stage
FROM node:20-slim AS builder

# Set working directory
WORKDIR /build

# Copy all project files
COPY . .

# Install dependencies
RUN npm install

# Build project
RUN npm run build

# Runtime stage
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    python3-pip \
    build-essential \
    curl \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# Install global dependencies
RUN npm install -g typescript tsx pm2

# Copy build artifacts and necessary files from builder
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/server ./server

# Create necessary directories
RUN mkdir -p logs

# Set environment variables
ENV NODE_ENV=production
ENV PUBLIC_API_URL=http://localhost:8080

# Create PM2 configuration file
COPY <<EOF /app/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'a-server-frontend',
      script: 'dist/server/entry.mjs',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4321'
      },
      watch: false,
      max_memory_restart: '1G',
      error_file: 'logs/frontend-error.log',
      out_file: 'logs/frontend-output.log'
    },
    {
      name: 'a-server-backend',
      script: 'tsx',
      args: 'server/index.ts',
      interpreter: 'node_modules/.bin/tsx',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      watch: false,
      max_memory_restart: '1G',
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-output.log'
    }
  ]
};
EOF

# Configure Nginx
RUN rm -f /etc/nginx/sites-enabled/default && \
    mkdir -p /etc/nginx/sites-available && \
    mkdir -p /etc/nginx/sites-enabled

# Create Nginx configuration
COPY <<EOF /etc/nginx/sites-available/astro-monitor
server {
    listen 8080;

    location / {
        proxy_pass http://127.0.0.1:4321/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Dedicated location for WebSocket
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        
        # WebSocket specific settings
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Origin "";
        
        # WebSocket timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
EOF

# Create symlink
RUN ln -s /etc/nginx/sites-available/astro-monitor /etc/nginx/sites-enabled/

# Set correct permissions
RUN chown -R www-data:www-data /etc/nginx/sites-available/astro-monitor && \
    chmod 644 /etc/nginx/sites-available/astro-monitor

# Create startup script
COPY <<EOF /app/start.sh
#!/bin/bash
# Ensure nginx configuration is valid and start
nginx -t && service nginx start || exit 1

# Start application
exec pm2-runtime start ecosystem.config.cjs
EOF

RUN chmod +x /app/start.sh

# Expose ports
EXPOSE 3000 8080

# Start services
CMD ["/app/start.sh"] 