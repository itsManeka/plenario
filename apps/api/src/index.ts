import { app } from "./app";

const port = Number(process.env.API_PORT ?? 8787);

export default { port, fetch: app.fetch };

console.log(`plenario api ouvindo em :${port}`);
