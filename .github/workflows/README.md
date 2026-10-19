# Fleet Dispatch Portal (Node.js 24 compatible)

## Windows 11 setup
1. Extract this ZIP into its own folder, e.g. `D:\Aaqib\fleet-dispatch-portal`.
2. Open that extracted folder. Confirm `package.json` and `server.js` are visible.
3. Click the File Explorer address bar, type `cmd`, and press Enter.
4. Run: `npm.cmd install`
5. Run: `npm.cmd start`
6. Open `http://localhost:3000` in your browser.

This version updates `better-sqlite3` to the v12 line for Node.js 24 compatibility. Keep the terminal open while using the portal. Back up `fleet.db` regularly before real business use, and configure a strong `JWT_SECRET` and secure admin credentials before public deployment.
