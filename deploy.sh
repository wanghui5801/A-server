#!/bin/bash

# 设置错误时退出
set -e

echo "开始部署生产环境..."

# 检查是否已安装必要的软件
check_requirements() {
    command -v git >/dev/null 2>&1 || { echo "需要安装 git"; exit 1; }
    command -v curl >/dev/null 2>&1 || { echo "需要安装 curl"; exit 1; }
    
    # 检查 Node.js 版本
    if command -v node >/dev/null 2>&1; then
        node_version=$(node -v | cut -d "v" -f 2)
        required_version="20.0.0"
        if [ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]; then
            echo "Node.js 版本必须 >= 20.0.0，当前版本: $node_version"
            return 1
        fi
    else
        echo "需要安装 Node.js >= 20.0.0"
        return 1
    fi
    
    command -v npm >/dev/null 2>&1 || { echo "需要安装 npm"; exit 1; }
    command -v nginx >/dev/null 2>&1 || { echo "需要安装 nginx"; exit 1; }
}

# 安装依赖
install_dependencies() {
    echo "正在安装系统依赖..."
    
    # 安装 Node.js 20.x
    echo "配置 Node.js 20.x 源..."
    if [ -f /etc/debian_version ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get update
        sudo apt-get install -y git nodejs nginx python3 make g++ sqlite3 python3-pip
        # 安装编译原生模块所需的依赖
        sudo apt-get install -y build-essential
    elif [ -f /etc/redhat-release ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
        sudo yum update -y
        sudo yum install -y git nodejs nginx python3 make gcc-c++ sqlite-devel python3-pip
        # 安装编译原生模块所需的依赖
        sudo yum groupinstall -y "Development Tools"
    fi

    # 更新 npm 到最新版本
    sudo npm install -g npm@latest

    # 安装全局依赖
    sudo npm install -g pm2
    sudo npm install -g typescript
    sudo npm install -g node-gyp
}

# 克隆项目
clone_project() {
    echo "克隆项目代码..."
    if [ -d "A-server" ]; then
        echo "更新已存在的代码..."
        cd A-server
        git pull
    else
        git clone https://github.com/wanghui5801/A-server.git
        cd A-server
    fi
}

# 设置环境变量
setup_env() {
    echo "配置环境变量..."
    # 获取服务器IP
    SERVER_IP=$(curl -s http://ipinfo.io/ip)
    
    # 创建或更新前端 .env 文件
    cat > .env << EOF
PUBLIC_API_URL=/api
VITE_API_URL=/api
NODE_ENV=production
EOF

    # 创建或更新后端 .env 文件
    cat > .env.production << EOF
NODE_ENV=production
PORT=3000
PUBLIC_API_URL=http://${SERVER_IP}:5000
EOF

    # 创建或更新 astro.config.mjs
    cat > astro.config.mjs << EOF
import { defineConfig } from 'astro/config';
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
  build: {
    assets: 'assets'
  },
  vite: {
    define: {
      'process.env.PUBLIC_API_URL': JSON.stringify('/api')
    }
  }
});
EOF
}

# 创建必要的目录和设置权限
setup_directories() {
    echo "创建必要的目录..."
    # 创建日志目录
    mkdir -p logs
    # 创建数据库目录
    mkdir -p data
    # 设置权限
    sudo chown -R $USER:$USER .
    sudo chmod -R 755 .
    sudo chmod -R 777 logs data
    
    # 确保数据库目录存在于正确位置
    mkdir -p dist/server
    ln -sf $(pwd)/data $(pwd)/dist/server/data
}

# 安装项目依赖
setup_project() {
    echo "安装项目依赖..."
    # 清理 node_modules 和锁文件，确保干净安装
    rm -rf node_modules package-lock.json
    npm cache clean --force
    
    # 设置 npm 配置以处理原生模块
    npm config set python python3
    
    # 安装依赖
    NODE_ENV=production npm install
    
    # 重新构建原生模块
    npm rebuild
}

# 构建项目
build_project() {
    echo "构建项目..."
    # 构建前端
    NODE_ENV=production npm run build
    
    # 构建后端
    NODE_ENV=production npm run build:server
    
    # 确保构建目录权限正确
    sudo chown -R $USER:$USER dist
}

# 配置 PM2
setup_pm2() {
    echo "配置 PM2..."
    
    # 创建 PM2 配置文件
    tee ecosystem.config.js > /dev/null <<EOF
module.exports = {
  apps: [
    {
      name: 'astro-monitor-server',
      script: './dist/server/index.js',
      instances: 1,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        PUBLIC_API_URL: 'http://${SERVER_IP}:5000'
      },
      error_file: "./logs/server-err.log",
      out_file: "./logs/server-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      node_args: '--max-old-space-size=2048'
    },
    {
      name: 'astro-monitor-frontend',
      script: 'npx',
      args: 'serve dist -l 4321',
      instances: 1,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PUBLIC_API_URL: '/api'
      },
      error_file: "./logs/frontend-err.log",
      out_file: "./logs/frontend-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    }
  ]
}
EOF

    # 安装serve包用于托管静态文件
    npm install -g serve

    # 启动服务
    pm2 delete all 2>/dev/null || true
    pm2 start ecosystem.config.js
    
    # 保存 PM2 配置，确保服务器重启后自动启动
    pm2 save
    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER
}

# 配置 Nginx
setup_nginx() {
    echo "配置 Nginx..."
    # 备份默认配置
    sudo mv /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup 2>/dev/null || true
    
    # 创建主 Nginx 配置
    sudo tee /etc/nginx/nginx.conf > /dev/null <<EOF
user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 768;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    include /etc/nginx/conf.d/*.conf;
}
EOF

    # 创建应用配置
    sudo tee /etc/nginx/conf.d/astro-monitor.conf > /dev/null <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

upstream frontend {
    server localhost:4321;
}

upstream backend {
    server localhost:3000;
}

server {
    listen 5000 default_server;
    server_name _;
    client_max_body_size 50M;
    
    # 全局 CORS 设置
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;
    add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range' always;

    # API 请求
    location /api/ {
        proxy_pass http://backend/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        
        # 增加超时时间
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }

    # WebSocket 连接
    location /socket.io/ {
        proxy_pass http://backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # 前端请求
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # 静态文件缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            proxy_pass http://frontend;
            expires 30d;
            add_header Cache-Control "public, no-transform";
        }
    }
}
EOF

    # 创建 Nginx 日志目录
    sudo mkdir -p /var/log/nginx
    sudo chown -R www-data:www-data /var/log/nginx

    # 测试 Nginx 配置
    sudo nginx -t

    # 重启 Nginx
    sudo systemctl restart nginx
}

# 检查服务状态
check_service() {
    echo "检查服务状态..."
    
    # 检查 PM2 服务状态
    if ! pm2 list | grep -q "astro-monitor-server\|astro-monitor-frontend"; then
        echo "错误: PM2 服务未正常运行"
        exit 1
    fi
    
    # 检查 Nginx 状态
    if ! systemctl is-active --quiet nginx; then
        echo "错误: Nginx 服务未正常运行"
        exit 1
    fi
    
    # 检查端口
    if ! netstat -tuln | grep -q ":5000 "; then
        echo "错误: 5000 端口未正常监听"
        exit 1
    fi
    
    if ! netstat -tuln | grep -q ":3000 "; then
        echo "错误: 3000 端口未正常监听"
        exit 1
    fi

    if ! netstat -tuln | grep -q ":4321 "; then
        echo "错误: 4321 端口未正常监听"
        exit 1
    fi
    
    echo "所有服务正常运行！"
}

# 主函数
main() {
    check_requirements
    install_dependencies
    clone_project
    setup_env
    setup_directories
    setup_project
    build_project
    setup_nginx
    setup_pm2
    check_service
    
    echo "部署完成！"
    echo "服务已经在以下端口启动："
    echo "- 主入口：http://${SERVER_IP}:5000"
    echo "- 后端服务：http://${SERVER_IP}:3000"
    echo "- 前端服务：http://${SERVER_IP}:4321"
    echo ""
    echo "查看服务状态："
    echo "所有服务：pm2 status"
    echo "后端日志：pm2 logs astro-monitor-server"
    echo "前端日志：pm2 logs astro-monitor-frontend"
    echo "Nginx 状态：sudo systemctl status nginx"
    echo "Nginx 错误日志：sudo tail -f /var/log/nginx/error.log"
    echo "Nginx 访问日志：sudo tail -f /var/log/nginx/access.log"
    echo ""
    echo "Node.js 版本：$(node -v)"
    echo "NPM 版本：$(npm -v)"
}

# 运行主函数
main