import { createServer } from "./server";

const server = createServer();
console.log(`Listening on ${server.url}`);
