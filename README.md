<div align="center">
  <div style="margin-bottom: 20px">
    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-default, #24292f)" style="color: var(--color-fg-default, #24292f)" xmlns="http://www.w3.org/2000/svg">
      <style>
        @media (prefers-color-scheme: dark) {
          svg { stroke: var(--color-fg-default, #c9d1d9) }
        }
      </style>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6.5 12h2l2-6 3 18 2.5-12h2">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite"/>
      </path>
      <path stroke-linecap="round" stroke-width="1.5" d="M3 12h2M19 12h2">
        <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite"/>
      </path>
      <path stroke-linecap="round" stroke-width="1.5" opacity="0.5" d="M1 12h1M22 12h1">
        <animate attributeName="opacity" values="0.2;0.5;0.2" dur="2s" repeatCount="indefinite"/>
      </path>
      <circle cx="12" cy="12" r="9" stroke-width="1.5" opacity="0.2">
        <animate attributeName="opacity" values="0.1;0.3;0.1" dur="2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="12" cy="12" r="5" stroke-width="1.5" opacity="0.4">
        <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  </div>
  <h1>Server Monitoring System</h1>
  <p>A comprehensive server monitoring system built with Astro + React, providing real-time monitoring capabilities for multiple servers.</p>
</div>

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
