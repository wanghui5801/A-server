#!/bin/bash

# 设置错误时退出
set -e

# 添加颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}开始部署生产环境...${NC}"

# 检查基本系统要求
check_requirements() {
    command -v git >/dev/null 2>&1 || { echo -e "${YELLOW}需要安装 git${NC}"; exit 1; }
    command -v curl >/dev/null 2>&1 || { echo -e "${YELLOW}需要安装 curl${NC}"; exit 1; }
    command -v nginx >/dev/null 2>&1 || { echo -e "${YELLOW}需要安装 nginx${NC}"; exit 1; }
    
    # 检查 Node.js 版本
    if command -v node >/dev/null 2>&1; then
        node_version=$(node -v | cut -d "v" -f 2)
        required_version="20.0.0"
        if [ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]; then
            echo -e "${YELLOW}Node.js 版本必须 >= 20.0.0，当前版本: $node_version${NC}"
            install_nodejs
        fi
    else
        echo -e "${YELLOW}需要安装 Node.js >= 20.0.0${NC}"
        install_nodejs
    fi
}

# 仅在需要时安装 Node.js
install_nodejs() {
    echo "安装 Node.js 20.x..."
    if [ -f /etc/debian_version ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get update
        sudo apt-get install -y nodejs
    elif [ -f /etc/redhat-release ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
        sudo yum install -y nodejs
    fi
}

# 安装系统依赖
install_dependencies() {
    echo -e "${YELLOW}正在安装系统依赖...${NC}"
    
    if [ -f /etc/debian_version ]; then
        sudo apt-get install -y python3 make g++ sqlite3 python3-pip build-essential
    elif [ -f /etc/redhat-release ]; then
        sudo yum install -y python3 make gcc-c++ sqlite-devel python3-pip
        sudo yum groupinstall -y "Development Tools"
    fi

    # 安装全局依赖
    sudo npm install -g typescript tsx pm2
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
PUBLIC_API_URL=http://localhost:3000
NODE_ENV=production
EOF
}

# 安装项目依赖
setup_project() {
    echo "安装项目依赖..."
    # 清理 node_modules 和锁文件，确保干净安装
    rm -rf node_modules package-lock.json dist
    npm cache clean --force
    
    # 安装依赖
    npm install
}

# 创建日志目录
setup_directories() {
    echo "创建日志目录..."
    mkdir -p logs
    # 设置适当的日志目录权限（755足够PM2写入日志）
    chmod 755 logs
}

# 创建 PM2 配置文件
create_pm2_config() {
    echo "创建 PM2 配置文件..."
    cat > ecosystem.config.js << EOF
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
      interpreter: 'node_modules/.bin/tsx',  // 使用本地安装的 tsx
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

# 构建项目
build_project() {
    echo -e "${YELLOW}构建项目...${NC}"
    # 构建前端
    NODE_ENV=production npm run build
    
    # 确保构建目录权限正确
    sudo chown -R $USER:$USER dist
    
    # 停止现有PM2进程（如果存在）
    pm2 stop a-server-frontend 2>/dev/null || true
    pm2 stop a-server-backend 2>/dev/null || true
    pm2 delete a-server-frontend 2>/dev/null || true
    pm2 delete a-server-backend 2>/dev/null || true
    
    # 使用PM2配置文件启动服务
    pm2 start ecosystem.config.js
    pm2 save
    
    # 等待服务启动
    echo -e "${YELLOW}等待服务启动...${NC}"
    sleep 5
}

# 配置 Nginx
setup_nginx() {
    echo "配置 Nginx..."
    
    # 创建配置文件
    sudo tee /etc/nginx/sites-available/astro-monitor <<EOF
server {
    listen 5000;
    server_name ${SERVER_IP};

    # 前端部分
    location / {
        proxy_pass http://127.0.0.1:4321/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

    # 删除默认配置（如果存在）
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # 删除旧的配置（如果存在）
    sudo rm -f /etc/nginx/sites-enabled/astro-monitor
    sudo rm -f /etc/nginx/conf.d/astro-monitor.conf
    
    # 创建软链接到 sites-enabled
    sudo ln -s /etc/nginx/sites-available/astro-monitor /etc/nginx/sites-enabled/

    # 确保 nginx 用户有正确的权限
    sudo chown -R www-data:www-data /etc/nginx/sites-available/astro-monitor
    sudo chmod 644 /etc/nginx/sites-available/astro-monitor

    # 测试 Nginx 配置
    sudo nginx -t

    # 重启 Nginx
    sudo systemctl restart nginx
}

# 检查服务状态
check_service() {
    echo -e "${YELLOW}检查服务状态...${NC}"
    
    # 检查前端PM2进程
    if ! pm2 show a-server-frontend > /dev/null 2>&1; then
        echo -e "${YELLOW}错误: 前端服务未正常运行${NC}"
        exit 1
    fi
    
    # 检查后端PM2进程
    if ! pm2 show a-server-backend > /dev/null 2>&1; then
        echo -e "${YELLOW}错误: 后端服务未正常运行${NC}"
        exit 1
    fi
    
    # 检查 Nginx 状态
    if ! systemctl is-active --quiet nginx; then
        echo -e "${YELLOW}错误: Nginx 服务未正常运行${NC}"
        exit 1
    fi
    
    # 检查端口
    if ! netstat -tuln | grep -q ":5000 "; then
        echo -e "${YELLOW}错误: 5000 端口未正常监听${NC}"
        exit 1
    fi
    
    if ! netstat -tuln | grep -q ":3000 "; then
        echo -e "${YELLOW}错误: 3000 端口未正常监听${NC}"
        exit 1
    fi
    
    if ! netstat -tuln | grep -q ":4321 "; then
        echo -e "${YELLOW}错误: 4321 端口未正常监听${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}所有服务正常运行！${NC}"
}

# 主函数
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
    
    echo -e "${GREEN}部署完成！${NC}"
    echo -e "${GREEN}服务已经在 5000 端口启动${NC}"
    echo -e "${GREEN}可以通过 http://${SERVER_IP}:5000 访问${NC}"
    echo ""
    echo -e "${YELLOW}查看服务状态：${NC}"
    echo "前端日志：pm2 logs a-server-frontend"
    echo "后端日志：pm2 logs a-server-backend"
    echo "或者查看日志文件："
    echo "前端错误日志：tail -f logs/frontend-error.log"
    echo "前端输出日志：tail -f logs/frontend-output.log"
    echo "后端错误日志：tail -f logs/backend-error.log"
    echo "后端输出日志：tail -f logs/backend-output.log"
    echo "Nginx 状态：sudo systemctl status nginx"
    echo "Nginx 错误日志：sudo tail -f /var/log/nginx/error.log"
    echo "Nginx 访问日志：sudo tail -f /var/log/nginx/access.log"
    echo ""
    echo -e "${YELLOW}停止服务：${NC}"
    echo "运行 'pm2 stop all' 来停止所有服务"
    echo ""
    echo -e "${YELLOW}Node.js 版本：$(node -v)${NC}"
    echo -e "${YELLOW}NPM 版本：$(npm -v)${NC}"
}

# 运行主函数
main