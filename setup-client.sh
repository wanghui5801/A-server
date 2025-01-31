#!/bin/bash

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
                    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                    sudo apt-get install -y nodejs make gcc g++ python3 python3-pip
                    ;;
                "centos"|"rhel"|"fedora")
                    # CentOS/RHEL/Fedora systems
                    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                    sudo yum install -y nodejs make gcc gcc-c++ python3 python3-pip
                    ;;
                "opensuse"|"sles")
                    # OpenSUSE systems
                    sudo zypper install -y nodejs20 make gcc gcc-c++ python3 python3-pip
                    ;;
                "arch"|"manjaro")
                    # Arch Linux/Manjaro systems
                    sudo pacman -Sy --noconfirm nodejs npm make gcc python3 python-pip
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
        brew install node@20
        brew link node@20
    else
        echo "Unsupported operating system"
        exit 1
    fi
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

# Install PM2 globally
echo "Installing PM2..."
sudo npm install pm2@5.3.1 -g

# Create work directory and download files
WORK_DIR="$HOME/astro-monitor-client"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "Downloading files..."
curl -L -o client.zip https://github.com/wanghui5801/A-server/archive/main.zip
unzip -q client.zip
mv A-server-main/client .
mv A-server-main/package.json .
mv A-server-main/tsconfig.client.json .
rm -rf A-server-main client.zip

# Create configuration file
echo "Creating configuration file..."
cat > client/config.json << EOL
{
  "hostname": "$HOSTNAME",
  "serverUrl": "http://$SERVER_IP:3000"
}
EOL

# Install dependencies
echo "Installing dependencies..."
npm install

# Start the application with PM2
echo "Starting application with PM2..."
pm2 start "npx tsx client/index.ts $SERVER_IP:3000 $HOSTNAME" --name "astro-monitor-client"

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
