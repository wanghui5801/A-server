#!/bin/bash

# Exit on error
set -e

# Add color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting production deployment...${NC}"

# Check basic system requirements
check_requirements() {
    command -v git >/dev/null 2>&1 || { echo -e "${YELLOW}Git installation required${NC}"; exit 1; }
    command -v curl >/dev/null 2>&1 || { echo -e "${YELLOW}Curl installation required${NC}"; exit 1; }
    command -v nginx >/dev/null 2>&1 || { echo -e "${YELLOW}Nginx installation required${NC}"; install_nginx; }
    
    # Check Node.js version
    if command -v node >/dev/null 2>&1; then
        node_version=$(node -v | cut -d "v" -f 2)
        required_version="20.0.0"
        if [ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]; then
            echo -e "${YELLOW}Node.js version must be >= 20.0.0, current version: $node_version${NC}"
            install_nodejs
        fi
    else
        echo -e "${YELLOW}Node.js >= 20.0.0 installation required${NC}"
        install_nodejs
    fi
}

# Install Nginx
install_nginx() {
    echo -e "${YELLOW}Installing Nginx...${NC}"
    if [ -f /etc/debian_version ]; then
        sudo apt-get update
        sudo apt-get install -y nginx
    elif [ -f /etc/redhat-release ]; then
        sudo yum install -y epel-release
        sudo yum install -y nginx
    fi
    
    echo -e "${GREEN}Nginx installation completed${NC}"
}

# Install Node.js only when needed
install_nodejs() {
    echo "Installing Node.js 20.x..."
    if [ -f /etc/debian_version ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get update
        sudo apt-get install -y nodejs
    elif [ -f /etc/redhat-release ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
        sudo yum install -y nodejs
    fi
}

# Install system dependencies
install_dependencies() {
    echo -e "${YELLOW}Installing system dependencies...${NC}"
    
    if [ -f /etc/debian_version ]; then
        sudo apt-get install -y python3 make g++ sqlite3 python3-pip build-essential
    elif [ -f /etc/redhat-release ]; then
        sudo yum install -y python3 make gcc-c++ sqlite-devel python3-pip
        sudo yum groupinstall -y "Development Tools"
    fi

    # Install global dependencies
    sudo npm install -g typescript tsx pm2
}

# Clone project
clone_project() {
    echo "Cloning project code..."
    if [ -d "A-server" ]; then
        echo "Updating existing code..."
        cd A-server
        git pull
    else
        git clone https://github.com/wanghui5801/A-server.git
        cd A-server
    fi
}

# Setup environment variables
setup_env() {
    echo "Configuring environment variables..."
    # Get server IP
    SERVER_IP=$(curl -s http://ipinfo.io/ip)
    
    # Create or update frontend .env file
    cat > .env << EOF
PUBLIC_API_URL=http://localhost:3000
NODE_ENV=production
EOF
}

# Install project dependencies
setup_project() {
    echo "Installing project dependencies..."
    # Clean node_modules and lock file for clean installation
    rm -rf node_modules package-lock.json dist
    npm cache clean --force
    
    # Install dependencies
    npm install
}

# Create log directory
setup_directories() {
    echo "Creating log directory..."
    mkdir -p logs
    # Set appropriate log directory permissions (755 is sufficient for PM2 to write logs)
    chmod 755 logs
}

# Create PM2 configuration file
create_pm2_config() {
    echo "Creating PM2 configuration file..."
    cat > ecosystem.config.cjs << EOF
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
      interpreter: 'node_modules/.bin/tsx',  // Use locally installed tsx
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
}

# Build project
build_project() {
    echo -e "${YELLOW}Building project...${NC}"
    # Build frontend
    NODE_ENV=production npm run build
    
    # Ensure correct build directory permissions
    sudo chown -R $USER:$USER dist
    
    # Stop existing PM2 processes (if any)
    pm2 stop a-server-frontend 2>/dev/null || true
    pm2 stop a-server-backend 2>/dev/null || true
    pm2 delete a-server-frontend 2>/dev/null || true
    pm2 delete a-server-backend 2>/dev/null || true
    
    # Start services using PM2 config file
    pm2 start ecosystem.config.cjs
    pm2 save
    
    # Wait for services to start
    echo -e "${YELLOW}Waiting for services to start...${NC}"
    sleep 5
}

# Configure Nginx
setup_nginx() {
    echo "Configuring Nginx..."
    
    # Create configuration file
    sudo tee /etc/nginx/sites-available/astro-monitor <<EOF
server {
    listen 8080;
    server_name ${SERVER_IP};

    # Enable URL decoding
    proxy_set_header Accept-Encoding "";
    sub_filter_once off;

    # Set larger buffer size for handling long URLs
    large_client_header_buffers 4 32k;
    
    location / {
        proxy_pass http://127.0.0.1:4321/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Original-URI \$request_uri;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Special location for monitored-clients with encoded URLs
    location ~ "^/api/monitored-clients/(.+)$" {
        # Explicitly decode the URI
        set \$decoded_uri \$1;
        proxy_pass http://127.0.0.1:3000/api/monitored-clients/\$decoded_uri;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Original-URI \$request_uri;
        proxy_set_header Accept-Encoding "";
    }

    # General API location
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Original-URI \$request_uri;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # WebSocket location
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Origin "";
        
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
EOF

    # Remove default config (if exists)
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Remove old config (if exists)
    sudo rm -f /etc/nginx/sites-enabled/astro-monitor
    sudo rm -f /etc/nginx/conf.d/astro-monitor.conf
    
    # Create symlink to sites-enabled
    sudo ln -s /etc/nginx/sites-available/astro-monitor /etc/nginx/sites-enabled/

    # Ensure nginx user has correct permissions
    sudo chown -R www-data:www-data /etc/nginx/sites-available/astro-monitor
    sudo chmod 644 /etc/nginx/sites-available/astro-monitor

    # Test Nginx configuration
    sudo nginx -t

    # Restart Nginx
    sudo systemctl restart nginx
}

# Check service status
check_service() {
    echo -e "${YELLOW}Checking service status...${NC}"
    
    # Check frontend PM2 process
    if ! pm2 show a-server-frontend > /dev/null 2>&1; then
        echo -e "${YELLOW}Error: Frontend service is not running properly${NC}"
        exit 1
    fi
    
    # Check backend PM2 process
    if ! pm2 show a-server-backend > /dev/null 2>&1; then
        echo -e "${YELLOW}Error: Backend service is not running properly${NC}"
        exit 1
    fi
    
    # Check Nginx status
    if ! systemctl is-active --quiet nginx; then
        echo -e "${YELLOW}Error: Nginx service is not running properly${NC}"
        exit 1
    fi
    
    # Check ports
    if ! netstat -tuln | grep -q ":8080 "; then
        echo -e "${YELLOW}Error: Port 8080 is not listening${NC}"
        exit 1
    fi
    
    if ! netstat -tuln | grep -q ":3000 "; then
        echo -e "${YELLOW}Error: Port 3000 is not listening${NC}"
        exit 1
    fi
    
    if ! netstat -tuln | grep -q ":4321 "; then
        echo -e "${YELLOW}Error: Port 4321 is not listening${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}All services are running properly!${NC}"
}

# Main function
main() {
    check_requirements
    install_dependencies
    clone_project
    setup_env
    setup_directories
    setup_project
    create_pm2_config
    build_project
    setup_nginx
    check_service
    
    echo -e "${GREEN}Deployment completed!${NC}"
    echo -e "${GREEN}Service is running on port 8080${NC}"
    echo -e "${GREEN}You can access it at http://${SERVER_IP}:8080${NC}"
    echo ""
    echo -e "${YELLOW}View service status:${NC}"
    echo "Frontend logs: pm2 logs a-server-frontend"
    echo "Backend logs: pm2 logs a-server-backend"
    echo "Or check log files:"
    echo "Frontend error log: tail -f logs/frontend-error.log"
    echo "Frontend output log: tail -f logs/frontend-output.log"
    echo "Backend error log: tail -f logs/backend-error.log"
    echo "Backend output log: tail -f logs/backend-output.log"
    echo "Nginx status: sudo systemctl status nginx"
    echo "Nginx error log: sudo tail -f /var/log/nginx/error.log"
    echo "Nginx access log: sudo tail -f /var/log/nginx/access.log"
    echo ""
    echo -e "${YELLOW}Stop services:${NC}"
    echo "Run 'pm2 stop all' to stop all services"
    echo ""
    echo -e "${YELLOW}Node.js version: $(node -v)${NC}"
    echo -e "${YELLOW}NPM version: $(npm -v)${NC}"
}

# Run main function
main