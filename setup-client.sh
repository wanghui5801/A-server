#!/bin/bash

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run this script as root (use sudo ./setup-client.sh)"
    exit 1
fi

# Interactive parameter input
if [ "$#" -ne 2 ]; then
    echo "No arguments provided. Starting interactive mode..."
    read -p "Enter hostname (e.g., client1): " HOSTNAME
    read -p "Enter server IP (e.g., 192.168.1.100): " SERVER_IP
    if [ -z "$HOSTNAME" ] || [ -z "$SERVER_IP" ]; then
        echo "Error: hostname and server IP are required"
        echo "Usage: $0 <hostname> <server_ip>"
        echo "Example: $0 client1 192.168.1.100"
        exit 1
    fi
else
    HOSTNAME=$1
    SERVER_IP=$2
fi

# Function to install or update Node.js 20
install_node() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Detect Linux distribution
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            case "$ID" in
                "ubuntu"|"debian")
                    # Ubuntu/Debian systems
                    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
                    apt-get install -y nodejs make gcc g++ python3 python3-pip unzip
                    ;;
                "centos"|"rhel"|"fedora")
                    # CentOS/RHEL/Fedora systems
                    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
                    yum install -y nodejs make gcc gcc-c++ python3 python3-pip unzip
                    ;;
                "opensuse"|"sles")
                    # OpenSUSE systems
                    zypper install -y nodejs20 make gcc gcc-c++ python3 python3-pip unzip
                    ;;
                "arch"|"manjaro")
                    # Arch Linux/Manjaro systems
                    pacman -Sy --noconfirm nodejs npm make gcc python3 python-pip unzip
                    ;;
                *)
                    echo "Unsupported Linux distribution: $ID"
                    echo "Please install Node.js 20 manually"
                    exit 1
                    ;;
            esac
        else
            echo "Cannot detect Linux distribution"
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        if ! command -v brew &> /dev/null; then
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        fi
        brew install node@20 unzip
        brew link node@20
    else
        echo "Unsupported operating system"
        exit 1
    fi
}

# Install tcping and dependencies
install_tcping() {
    # Install dependencies
    apt-get update
    apt-get install -y wget unzip

    # Install tcping script
    echo "Installing tcping..."
    
    # Detect architecture
    ARCH=$(uname -m)
    
    # Set download URL based on architecture
    if [ "$ARCH" = "x86_64" ]; then
        TCPING_URL="https://github.com/nodeseeker/tcping/releases/download/v1.4.5/tcping-linux-amd64.zip"
    elif [[ "$ARCH" = "aarch64" || "$ARCH" = "arm64" || "$ARCH" = "armv8" ]]; then
        TCPING_URL="https://github.com/nodeseeker/tcping/releases/download/v1.4.5/tcping-linux-arm.zip"
    else
        echo "Unsupported architecture: $ARCH"
        exit 1
    fi
    
    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    cd $TMP_DIR || exit 1
    
    # Download and install tcping
    wget -O tcping.zip "$TCPING_URL"
    unzip tcping.zip
    chmod +x tcping
    
    # Use sudo to move files and create symlink
    sudo install -m 755 tcping /usr/local/bin/tcping
    sudo ln -sf /usr/local/bin/tcping /usr/bin/tcping
    
    # Clean up
    cd - || exit 1
    rm -rf "$TMP_DIR"
}

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Installing Node.js 20..."
    install_node
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        echo "Node.js version is below 20. Updating to Node.js 20..."
        install_node
    fi
fi

# Install tcping and its dependencies
echo "Installing tcping and dependencies..."
install_tcping

# Install PM2 globally
echo "Installing PM2..."
# Clean npm cache and remove existing PM2 installation
npm cache clean -f
rm -rf /usr/lib/node_modules/pm2
rm -rf /usr/local/lib/node_modules/pm2
# Try to install PM2 with error handling
if ! npm install pm2@latest -g; then
    echo "First PM2 installation attempt failed, trying alternative method..."
    # Second attempt with different approach
    if ! npm install pm2@latest -g --force; then
        echo "Error: Failed to install PM2. Please try manually with: npm install pm2@latest -g --force"
        exit 1
    fi
fi

# Create work directory and download files
WORK_DIR="$HOME/astro-monitor-client"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "Creating project files..."

# Create package.json with necessary dependencies
cat > package.json << 'EOL'
{
  "name": "astro-monitor-client",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "tsx client/index.ts"
  },
  "dependencies": {
    "@types/debug": "^4.1.12",
    "@types/node": "^20.10.5",
    "axios": "^1.6.2",
    "debug": "^4.3.4",
    "socket.io-client": "^4.7.2",
    "tsx": "^4.6.2",
    "typescript": "^5.3.3",
    "winston": "^3.11.0"
  }
}
EOL

# Create tsconfig.json
cat > tsconfig.json << 'EOL'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["client/**/*"],
  "exclude": ["node_modules"]
}
EOL

# Create client directory and index.ts
mkdir -p client
curl -L -o client/index.ts https://raw.githubusercontent.com/wanghui5801/A-server/main/client/index.ts

# Create configuration file
echo "Creating configuration file..."
cat > client/config.json << 'EOL'
{
  "hostname": "${HOSTNAME}",
  "serverUrl": "http://${SERVER_IP}:8080"
}
EOL

# Use envsubst to replace variables
envsubst < client/config.json > client/config.json.tmp && mv client/config.json.tmp client/config.json

# Install dependencies
echo "Installing dependencies..."
npm install

# Configure PM2 log rotation
echo "Configuring PM2 log rotation..."
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size '10M'
pm2 set pm2-logrotate:retain '7'
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat 'YYYY-MM-DD_HH-mm-ss'
pm2 set pm2-logrotate:workerInterval '3600'
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

# Start the application with PM2
echo "Starting application with PM2..."
# Escape the hostname for the command line
ESCAPED_HOSTNAME=$(printf '%q' "$HOSTNAME")
pm2 start "npx tsx client/index.ts \"$SERVER_IP:8080\" $ESCAPED_HOSTNAME" --name "astro-monitor-client"

# Configure PM2 service
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Setting up PM2 startup service..."
    pm2 startup
    pm2 save
    
    echo "Service has been installed and started with PM2"
    echo "To check status: pm2 status"
    echo "To view logs: pm2 logs astro-monitor-client"
    echo "To restart: pm2 restart astro-monitor-client"
    echo "To stop: pm2 stop astro-monitor-client"
else
    echo "PM2 service started successfully"
    echo "To check status: pm2 status"
    echo "To view logs: pm2 logs astro-monitor-client"
    echo "To restart: pm2 restart astro-monitor-client"
    echo "To stop: pm2 stop astro-monitor-client"
fi

echo "Setup completed successfully!"
echo "Hostname: $HOSTNAME"
echo "Server IP: $SERVER_IP"
