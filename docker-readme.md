# A-Server Monitor

[![Docker Pulls](https://img.shields.io/docker/pulls/xhh1128/a-server)](https://hub.docker.com/r/xhh1128/a-server)
[![Docker Image Size](https://img.shields.io/docker/image-size/xhh1128/a-server/latest)](https://hub.docker.com/r/xhh1128/a-server)
[![Docker Stars](https://img.shields.io/docker/stars/xhh1128/a-server)](https://hub.docker.com/r/xhh1128/a-server)

A comprehensive server monitoring system built with Astro + React, providing real-time monitoring capabilities for multiple servers.

## Quick Start

```bash
# Pull the image
docker pull xhh1128/a-server:latest

# Run the container
docker run -d \
  -p 8080:8080 \
  -p 3000:3000 \
  --name a-server-container \
  xhh1128/a-server:latest

# Access the application
# Frontend: http://localhost:8080
# API: http://localhost:3000
```

## Features

- 🔄 Real-time monitoring of server metrics
  - CPU usage
  - Memory utilization
  - Disk usage
  - Network status
- 🖥️ Multi-server monitoring support
- 📊 Beautiful data visualization
- 🔐 Secure SSH terminal access
- 🔍 Ping command functionality
- 📱 Responsive design

## Supported Tags

- `latest`: Latest stable release
- `x.y.z`: Specific version release (e.g., `1.0.0`)

## Environment Variables

- `NODE_ENV`: Production environment (default: `production`)
- `PUBLIC_API_URL`: API URL (default: `http://localhost:8080`)

## Ports

- `8080`: Frontend and API gateway
- `3000`: Backend API service

## Source Code

Visit our [GitHub repository](https://github.com/wanghui5801/A-server) for more information. 