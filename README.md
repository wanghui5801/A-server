# <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjODg4ODg4Ij4KICAgIDxwYXRoIHN0cm9rZUxpbmVjYXA9InJvdW5kIiBzdHJva2VMaW5lam9pbj0icm91bmQiIHN0cm9rZVdpZHRoPSIxLjUiIGQ9Ik02LjUgMTJoMmwyLTYgMyAxOCAyLjUtMTJoMiIgLz4KICAgIDxwYXRoIHN0cm9rZUxpbmVjYXA9InJvdW5kIiBzdHJva2VXaWR0aD0iMS41IiBkPSJNMyAxMmgyTTE5IDEyaDIiIC8+CiAgICA8cGF0aCBzdHJva2VMaW5lY2FwPSJyb3VuZCIgc3Ryb2tlV2lkdGg9IjEuNSIgb3BhY2l0eT0iMC41IiBkPSJNMSAxMmgxTTIyIDEyaDEiIC8+CiAgICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI5IiBzdHJva2VXaWR0aD0iMS41IiBvcGFjaXR5PSIwLjIiIC8+CiAgICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI1IiBzdHJva2VXaWR0aD0iMS41IiBvcGFjaXR5PSIwLjQiIC8+Cjwvc3ZnPg==" width="32" height="32" align="center" /> Server Monitoring System

A comprehensive server monitoring system built with Astro + React, providing real-time monitoring capabilities for multiple servers.

## Quick Start Guide

### 1. Server Installation

```bash
# One-line server installation
curl -sSL https://raw.githubusercontent.com/wanghui5801/A-server/main/deploy.sh | bash

# Or download and inspect first (recommended)
curl -o deploy.sh https://raw.githubusercontent.com/wanghui5801/A-server/main/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

After installation, access the monitoring dashboard at:
- Development: `http://localhost:4321`
- Production: `http://<your-server-ip>:5000`

### 2. Client Installation

Install the monitoring client on each server you want to monitor:

```bash
# One-line client installation (replace with your values)
curl -sSL https://raw.githubusercontent.com/wanghui5801/A-server/main/setup-client.sh | bash -s -- <hostname> <server_ip>

# Example:
curl -sSL https://raw.githubusercontent.com/wanghui5801/A-server/main/setup-client.sh | bash -s -- client1 192.168.1.100

# Or download and inspect first (recommended)
curl -o setup-client.sh https://raw.githubusercontent.com/wanghui5801/A-server/main/setup-client.sh
chmod +x setup-client.sh
./setup-client.sh <hostname> <server_ip>

# Interactive mode (will prompt for hostname and server IP)
./setup-client.sh
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

## Production Deployment

We provide two scripts for easy deployment:

### Server Deployment (`deploy.sh`)

This script automates the server-side deployment process:

1. Make the script executable:
   ```bash
   chmod +x deploy.sh
   ```

2. Run the deployment script:
   ```bash
   ./deploy.sh
   ```

The script will:
- Install required dependencies (Node.js, Nginx, etc.)
- Set up PM2 for process management
- Configure Nginx as a reverse proxy
- Start both frontend and backend services
- Set up automatic startup on system boot

### Client Setup (`setup-client.sh`)

This script helps set up monitoring clients on target servers:

1. Make the script executable:
   ```bash
   chmod +x setup-client.sh
   ```

2. Run the setup script with parameters:
   ```bash
   ./setup-client.sh <hostname> <server_ip>
   ```
   Example:
   ```bash
   ./setup-client.sh client1 192.168.1.100
   ```

The script will:
- Install Node.js and required dependencies
- Set up the monitoring client
- Configure PM2 for process management
- Create necessary configuration files
- Start the monitoring service

## Usage Guide

1. After deployment, access the monitoring dashboard at:
   - Development: `http://localhost:4321`
   - Production: `http://<your-server-ip>:5000`

2. Log in to the dashboard using your credentials

3. The dashboard will display all connected clients automatically

4. Features available:
   - View real-time server metrics
   - Access SSH terminal for connected servers
   - Perform ping tests
   - View historical data

## Monitoring Client Management

Common PM2 commands for client management:

```bash
# Check client status
pm2 status astro-monitor-client

# View logs
pm2 logs astro-monitor-client

# Restart client
pm2 restart astro-monitor-client

# Stop client
pm2 stop astro-monitor-client
```

## Development Commands

- `npm run dev` - Start development server
- `npm run build` - Build production version
- `npm run preview` - Preview production build
- `npm run server` - Start backend server
- `npm run client` - Start monitoring client

## License

MIT
