#!/bin/bash

# 交互式输入参数
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

# 检查Node.js版本或安装Node.js 20
install_node() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs make gcc g++ python3 python3-pip
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

# 检查Node.js版本
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

# 创建工作目录并下载文件
WORK_DIR="$HOME/astro-monitor"
# mkdir -p "$WORK_DIR"
# cd "$WORK_DIR"

# echo "Downloading files..."
# curl -L -o client.zip https://github.com/wanghui5801/A-server/archive/main.zip
# unzip -q client.zip
# mv A-server-main/client .
# mv A-server-main/package.json .
# mv A-server-main/tsconfig.client.json .
# rm -rf A-server-main client.zip

# 创建配置文件
cat > client/config.json << EOL
{
  "hostname": "$HOSTNAME",
  "serverUrl": "http://$SERVER_IP:3000"
}
EOL

# 安装依赖
npm install

# 创建启动脚本
cat > start.sh << EOL
#!/bin/bash
export NODE_ENV=production
npx tsx client/index.ts "$SERVER_IP:3000" "$HOSTNAME"
EOL

chmod +x start.sh

# 创建systemd服务（仅限Linux系统）
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    sudo tee /etc/systemd/system/astro-monitor-client.service << EOL
[Unit]
Description=Astro Monitor Client
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$WORK_DIR
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:$PATH
ExecStart=$WORK_DIR/start.sh
Restart=always
RestartSec=10
MemoryLimit=200M

[Install]
WantedBy=multi-user.target
EOL

    sudo systemctl daemon-reload
    sudo systemctl enable astro-monitor-client
    sudo systemctl start astro-monitor-client
    
    echo "Service has been installed and started"
    echo "To check status: sudo systemctl status astro-monitor-client"
else
    echo "To start the client, run: ./start.sh"
fi

echo "Setup completed!"
echo "Hostname: $HOSTNAME"
echo "Server IP: $SERVER_IP"
