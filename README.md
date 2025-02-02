<div align="center">
  <div style="display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 24px;">
    <img src="./public/monitor-icon.svg" width="64" height="64" alt="Server Monitor Icon" style="min-width: 64px;" />
    <h1 style="margin: 0; font-size: 42px; line-height: 1.2;">A-Server</h1>
  </div>

  <p>
    <img src="https://img.shields.io/badge/Astro-3.0+-blueviolet.svg?logo=astro" alt="Astro Version" />
    <img src="https://img.shields.io/badge/React-18.0+-blue.svg?logo=react" alt="React Version" />
    <img src="https://img.shields.io/badge/Node.js-20.0+-green.svg?logo=node.js" alt="Node.js Version" />
    <img src="https://img.shields.io/badge/TypeScript-5.0+-blue.svg?logo=typescript" alt="TypeScript Version" />
    <a href="https://hub.docker.com/r/xhh1128/a-server"><img src="https://img.shields.io/docker/image-size/xhh1128/a-server/latest?logo=docker" alt="Docker Image Size" /></a>
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License" />
    <img src="https://img.shields.io/badge/Tested%20on-Debian%2011+-red.svg?logo=debian" alt="System Compatibility" />
  </p>
  
  <p>A comprehensive server monitoring system built with Astro + React, providing real-time monitoring capabilities for multiple servers.</p>
</div>

## Quick Start Guide

### System Requirements

> ⚠️ **Note**: Currently only tested on Debian 11 and above. Support for other Linux distributions is not guaranteed.

### 1. Docker Deployment (Recommended)

[![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://hub.docker.com/r/xhh1128/a-server)

```bash
docker pull xhh1128/a-server:latest
docker run -d -p 8080:8080 --name a-server-container xhh1128/a-server:latest
```

Access the monitoring dashboard at `http://localhost:8080`

### 2. Server Installation

```bash
curl -o deploy.sh https://raw.githubusercontent.com/wanghui5801/A-server/main/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

Access the monitoring dashboard at `http://<your-server-ip>:8080`

### 3. Client Installation

```bash
curl -o setup-client.sh https://raw.githubusercontent.com/wanghui5801/A-server/main/setup-client.sh
chmod +x setup-client.sh
./setup-client.sh <hostname> <server_ip>
```

The installation scripts will automatically:
1. Check and install system requirements
2. Set up the necessary environment
3. Configure the services
4. Start the monitoring system

## Features

- 🔄 Real-time monitoring of server metrics:
  - CPU usage
  - Memory utilization
  - Disk usage
  - Network status
- 🖥️ Multi-server monitoring support
- 📊 Beautiful data visualization with Chart.js
- 🔐 Secure SSH terminal access
- 🔍 Ping command functionality
- 📱 Responsive design for all devices

## Tech Stack

- **Frontend**: 
  - Astro
  - React
  - TailwindCSS
  - Chart.js
- **Backend**: 
  - Node.js
  - Express
  - Socket.IO
- **Database**: SQLite
- **Deployment**: PM2

## Project Structure

```
.
├── src/              # Frontend source code
│   ├── components/   # React components
│   ├── pages/        # Astro pages
│   └── layouts/      # Astro layouts
├── server/           # Backend server
│   └── index.ts      # Main server file
├── client/           # Monitoring client
│   └── index.ts      # Client implementation
├── setup-client.sh   # Client setup script
└── deploy.sh         # Server deployment script
```

## Prerequisites

- Node.js >= 20.0.0
- npm or yarn
- Git
- For production: Nginx

## Development Setup

1. Start the backend server:
   ```bash
   npm run server
   ```

2. Start the frontend development server:
   ```bash
   npm run dev
   ```

3. Access the development server at `http://localhost:4321`

## Deployment

### Using Docker

```bash
# Using pre-built image
docker pull xhh1128/a-server:latest
docker run -d -p 8080:8080 --name a-server-container xhh1128/a-server:latest

# Or build your own image
docker build -t a-server .
docker run -d -p 8080:8080 --name a-server-container a-server
```

### Manual Deployment

Use the deployment script:
```bash
chmod +x deploy.sh
./deploy.sh
```

## Configuration

- Frontend and API port: 8080 (configurable)
- Environment variables can be configured in `.env` file

## License

MIT License - see the [LICENSE](LICENSE) file for details
