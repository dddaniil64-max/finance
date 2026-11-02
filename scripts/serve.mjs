import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "public");
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json" };
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = normalize(join(root, path === "/" ? "index.html" : path));
    if (!file.startsWith(root)) throw new Error("Forbidden");
    let data;
    try { data = await readFile(file); }
    catch { file = join(root, "index.html"); data = await readFile(file); }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control":"no-cache" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(4173, () => console.log("FINANCE: http://localhost:4173"));
