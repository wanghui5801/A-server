#!/bin/bash

# Create deployment directory
mkdir -p deploy/client

# Copy necessary files
cp client/index.ts package.json tsconfig.client.json deploy/client/

# Create archive
cd deploy
tar -czf client.tar.gz client/

echo "Deployment package created: $(pwd)/client.tar.gz"
echo ""
echo "Usage Instructions:"
echo "1. Upload client.tar.gz to target machine:"
echo "   scp client.tar.gz user@target-ip:~/monitor-client/"
echo ""
echo "2. Install necessary system dependencies on target machine:"
echo "   # For Debian/Ubuntu systems:"
echo "   sudo apt-get update"
echo "   sudo apt-get install -y make gcc g++ python3 python3-pip"
echo ""
echo "   # For CentOS/RHEL systems:"
echo "   sudo yum update"
echo "   sudo yum groupinstall 'Development Tools'"
echo "   sudo yum install python3 python3-pip"
echo ""
echo "3. Execute on target machine:"
echo "   mkdir -p ~/monitor-client"
echo "   cd ~/monitor-client"
echo "   tar -xzf client.tar.gz"
echo "   cd client"
echo "   # If npm version is too old, update npm first"
echo "   npm install -g npm@latest"
echo "   npm install"
echo "   npm install -g tsx"
echo "   tsx index.ts <server-ip-address> <custom-hostname>"
echo ""
echo "Example:"
echo "   tsx index.ts 192.168.1.100:3000 client-1"
echo ""
echo "Notes:"
echo "1. Ensure Node.js is installed (recommended version >= 14)"
echo "2. If encountering permission issues, use sudo for relevant commands"
echo "3. If experiencing issues with dependency installation, try:"
echo "   npm install --unsafe-perm=true" 