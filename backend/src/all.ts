// Runs the worker and the API in one process, for hosts whose free tier has no
// background workers (Render). Imported in order so migrations don't race.
await import('./worker.js');
await import('./server.js');
