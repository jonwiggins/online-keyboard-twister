# Online Twister

Online multiplayer party game inspired by keyboard twister. Players join with a shared code, and each turn the active player must press and hold a new key within ten seconds. Release any assigned key and you are eliminated—last player holding wins.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm run dev
   ```
3. Open <http://localhost:3000> in your browser.

## Gameplay Flow

- **Create a game:** Enter your name and press “Create & Join” to generate a game code. Share it with friends.
- **Join a game:** Enter your name and the host’s code to join the lobby. Everyone receives a unique color.
- **Start:** The host can begin as soon as at least one player is in the lobby—solo rounds are supported.
- **Turns:** When it’s your turn, a keyboard key highlights. Press and hold it within ten seconds; the key is added to your set.
- **Stay alive:** Keep every assigned key held down across turns. Releasing any required key or missing the timer eliminates you.
- **Victory:** The game ends as soon as only one player remains.
- **Play again:** After a match, the host can hit “Play Again” to reset the lobby for another round.

## Scripts

- `npm run dev` — starts the server with development logging.
- `npm run start` — runs the server with `NODE_ENV=production`.

## Tech Stack

- **Server:** Node.js, Express, Socket.IO
- **Client:** Vanilla JavaScript modules, Socket.IO client, custom styling

## Notes

- Game sessions are kept in-memory; restarting the server clears active games.
- Keyboard events only register when the browser tab is focused. Encourage players to stay on the game tab.
