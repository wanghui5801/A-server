# Server Monitoring System

A server monitoring system based on Astro + React, including both server and client components.

## Features

- Real-time monitoring of server CPU, memory, and disk usage
- Support for multiple client monitoring
- Ability to send ping commands to specific clients
- Beautiful data visualization interface

## Tech Stack

- Frontend: Astro + React + TailwindCSS + Chart.js
- Backend: Node.js + Express + Socket.IO
- Database: SQLite

## Project Structure

```
.
├── src/                # Frontend source code
│   ├── components/     # React components
│   ├── layouts/        # Astro layouts
│   └── pages/          # Astro pages
├── server/            # Backend server
└── client/            # Monitoring client
```

## Installation

1. Clone the project:

```bash
git clone <repository-url>
cd <project-name>
```

2. Install dependencies:

```bash
npm install
```

## Running

1. Start the backend server:

```bash
npm run server
```

2. Start the frontend development server:

```bash
npm run dev
```

3. Run the client on servers to be monitored:

```bash
npm run client
```

## Usage Guide

1. Visit `http://localhost:4321` to open the monitoring dashboard
2. The dashboard will automatically display all connected clients
3. Select a client and enter target IP to perform ping tests

## Development

- `npm run dev` - Start development server
- `npm run build` - Build production version
- `npm run preview` - Preview production version

## License

MIT
