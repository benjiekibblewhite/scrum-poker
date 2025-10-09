# Scrum Poker

A real-time web application for conducting Planning Poker sessions during Agile estimations, allowing distributed teams to vote simultaneously and reveal their estimates together.

## Architecture

```mermaid
graph TD
    Client[Browser Client] -->|WebSocket| Server[Node.js Server]
    Server -->|Session State| Client
    Server -->|Store| Database[PostgreSQL Database]
    Database -->|Fetch| Server
```

### Components

- **Frontend (Browser Client)**:

  - Pure HTML and JavaScript
  - WebSocket client for real-time updates
  - Proxy object for reactive updates when state changes

- **Backend (Node.js Server)**:
  - Express.js web server for static file serving
  - WebSocket server for real-time communication
  - PostgreSQL database for persistent storage
  - Prisma ORM for database access
  - Maintains vote state (hidden/revealed)
  - Handles user joins/disconnects and vote updates

## Setup

1. Clone the repository:

```bash
git clone https://github.com/yourusername/scrum-poker.git
cd scrum-poker
```

2. Install dependencies:

```bash
npm install
```

3. Set up your environment variables:

   - Create a `.env` file in the project root
   - Add your PostgreSQL connection string: `DATABASE_URL="postgresql://username:password@localhost:5432/scrum_poker?schema=public"`

4. Run database migrations:

```bash
npm run prisma:migrate
```

5. Start the development server:

```bash
npm run dev
```

6. Open `http://localhost:3000` in your browser (port may vary if 3000 is in use)

## Development

- Run in development mode with hot reload: `npm run dev`
- Generate Prisma client after schema changes: `npm run prisma:generate`
- Run database migrations: `npm run prisma:migrate`
- View and edit your database: `npm run prisma:studio`
- Build TypeScript for production: `npm run build`
- Start production server: `npm start`
